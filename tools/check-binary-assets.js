#!/usr/bin/env node
/**
 * AlphaSun 二进制资产完整性校验（Binary Asset Integrity Gate）
 * ------------------------------------------------------------
 * 背景（真实事故）：
 *   仓库里的 9 个 PNG 曾被某次工具以 UTF-8 文本方式读写，导致签名首字节 0x89
 *   被替换成 U+FFFD(EF BF BD)，文件完全无法解码；又因为 .gitattributes 里给
 *   app-android/www/** 声明了 `text eol=lf`，任何 git add / commit -am 都会
 *   对 PNG 再做一次 CRLF->LF 转换（PNG 签名本身就含 0D 0A），二次损坏。
 *
 * 本门禁做两件事：
 *   1) 扫全仓二进制资源，按 magic bytes 校验格式；对 PNG 追加 chunk 级校验
 *      （长度边界 + CRC32 + IDAT zlib inflate），能抓出「签名被改写」这类
 *      静默损坏——文件能读、git 不报错，但浏览器/系统无法解码。
 *   2) 校验 .gitattributes 的 binary 规则存在且位于 text 规则之后
 *      （.gitattributes 中多条规则同时命中时，最后一条生效）。
 *
 * 用法：
 *   node tools/check-binary-assets.js          # 人读格式，失败退出码 1
 *   node tools/check-binary-assets.js --throw  # CI，失败抛错
 *   node tools/check-binary-assets.js --quiet  # 只输出汇总
 *
 * 作为模块复用（供 tools/smoke.js 接入）：
 *   const { runChecks } = require('./check-binary-assets.js');
 *   const results = runChecks({ root: process.cwd() });
 *   results.checks.forEach(c => ok(c.ok, c.msg));
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// 格式定义：magic bytes（文件头）
// ---------------------------------------------------------------------------
const FORMATS = {
  '.png': { name: 'PNG', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  '.jpg': { name: 'JPEG', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  '.jpeg': { name: 'JPEG', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  '.gif': { name: 'GIF', magic: Buffer.from([0x47, 0x49, 0x46, 0x38]) },
  '.ico': { name: 'ICO', magic: Buffer.from([0x00, 0x00, 0x01, 0x00]) },
  '.webp': {
    name: 'WebP',
    magic: Buffer.from([0x52, 0x49, 0x46, 0x46]), // 'RIFF'
    extra: Buffer.from([0x57, 0x45, 0x42, 0x50]), // 'WEBP' at offset 8
    extraOffset: 8,
  },
};

const BINARY_EXTS = Object.keys(FORMATS);

// ---------------------------------------------------------------------------
// PNG chunk 级校验：长度边界 + CRC32 + IDAT zlib inflate
// ---------------------------------------------------------------------------
function inspectPng(buf) {
  const res = { ok: false, reason: '', chunks: [], crcErrors: [] };
  if (buf.length < 8) { res.reason = '文件过短（' + buf.length + 'B），不是合法 PNG'; return res; }
  if (!buf.slice(0, 8).equals(FORMATS['.png'].magic)) {
    res.reason = 'PNG 签名无效（期望 89504e470d0a1a0a，实际 ' + buf.slice(0, 8).toString('hex') + '）';
    return res;
  }
  let off = 8;
  const idat = [];
  let sawIend = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (len > buf.length || off + 12 + len > buf.length) {
      res.reason = 'chunk 长度越界（offset ' + off + '，声明长度 ' + len + '，文件仅 ' + buf.length + 'B）';
      return res;
    }
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    const data = buf.slice(off + 8, off + 8 + len);
    const crcStored = buf.readUInt32BE(off + 8 + len);
    const crcCalc = zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data]));
    if (crcCalc !== crcStored) res.crcErrors.push(type);
    res.chunks.push(type);
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
    if (type === 'IEND') { sawIend = true; break; }
  }
  if (!sawIend) { res.reason = '缺少 IEND 结束块（chunk 流在 offset ' + off + ' 处截断）'; return res; }
  if (res.crcErrors.length) {
    res.reason = 'chunk CRC 校验失败：' + res.crcErrors.join(', ');
    return res;
  }
  if (idat.length) {
    try {
      zlib.inflateSync(Buffer.concat(idat));
    } catch (e) {
      res.reason = 'IDAT zlib 解压失败：' + (e && e.message);
      return res;
    }
  }
  res.ok = true;
  return res;
}

// ---------------------------------------------------------------------------
// 扫描时的目录跳过规则
// ---------------------------------------------------------------------------
// 无条件跳过：非仓库内容（既非入库资产也无须保护）。
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);

// 条件跳过：只有当 git 确认该路径**确实被忽略**时才跳过。
//
// 归档目录 `_releases` 装着约 317MB 发布产物（v8.3，5 个资产），一旦 .gitignore 里的
// `_releases/` 规则被误删或改名，它就会被 git 跟踪。若只按「目录名」无条件跳过，门禁就会
// 对归档目录 100% 失明 —— 二进制扫描看不见它、binary 规则覆盖检查也看不见它，
// 于是 317MB 产物静默入库而门禁绿灯放行（这正是本轮修复的 P0 盲区）。
//
// 因此把「跳过」与「被忽略」绑定：
//   · 未被 git 忽略        → 不跳过，目录重新纳入扫描，由既有的
//                            「全仓二进制均被 .gitattributes 的 binary 规则覆盖」
//                            断言把它抓出来（门禁自愈，项数不变）；
//   · 已被忽略但内部有被跟踪文件 → 同样不跳过（跟踪状态优先于忽略状态）。
// 跳过的前提因此始终由门禁自己守着，不会出现「盲区」。
const CONDITIONAL_SKIP_DIRS = new Set(['_releases']);

// 归档目录名（条件跳过 + git 隔离不变量的唯一目标）。
const ARCHIVE_DIR = '_releases';

// 归档目录 git 隔离不变量的两条断言文案（smoke.js 与 CLI 共用，保证口径一致）。
const ARCHIVE_RULE_MSG = '`_releases/` 归档目录被 git 忽略（发布产物永不入库）';
const ARCHIVE_TRACKED_MSG = '`_releases/` 下无被 git 跟踪的文件（发布产物永不入库）';

/**
 * git 查询结果缓存（按 仓库根 + 相对路径 键控）。
 *
 * 本机每次 spawn git 约 60ms，而同一个问题会被问多次：
 * walk 与 walkBinaryContent 各判一次目录跳过、CLI 路径的不变量检查又要问一次。
 * 缓存后全流程只需 2 次 git 调用（check-ignore + ls-files），而不是 6 次。
 */
const GIT_QUERY_CACHE = new Map();

/** 缓存键：仓库根 + 查询种类 + 相对路径（种类必须区分，否则布尔值与数组会互相覆盖）。 */
function gitCacheKey(root, kind, relPath) {
  return root + '\0' + kind + '\0' + relPath;
}

/**
 * 判断某路径是否被 git 忽略。
 *
 * @param {string} root git 仓库工作区根目录
 * @param {string} relPath 相对仓库根的路径（正斜杠分隔）
 * @returns {boolean|null} true=已忽略；false=未忽略；null=无法判定（git 不可用 / 不在仓库内）
 */
function isIgnoredByGit(root, relPath) {
  const key = gitCacheKey(root, 'ignore', relPath);
  if (GIT_QUERY_CACHE.has(key)) return GIT_QUERY_CACHE.get(key);
  let result = null;
  try {
    // 用 --no-index：让判定**只依据 .gitignore 规则**，与文件是否已被 git 跟踪无关。
    // 否则「已被跟踪」会反过来让 check-ignore 报「未忽略」，把两种不同的故障
    // （规则丢失 / 文件被强加跟踪）混为一谈。
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', relPath], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    result = true;
  } catch (e) {
    // git check-ignore 的退出码：0=命中忽略规则，1=未命中，128+=git 自身错误
    result = (e && e.status === 1) ? false : null;
  }
  GIT_QUERY_CACHE.set(key, result);
  return result;
}

/**
 * 列出 git 已跟踪的、位于指定路径下的文件。
 *
 * @param {string} root git 仓库工作区根目录
 * @param {string} relPath 相对仓库根的路径
 * @returns {Array<string>} 已跟踪文件的相对路径
 */
function listTrackedFiles(root, relPath) {
  const key = gitCacheKey(root, 'tracked', relPath);
  if (GIT_QUERY_CACHE.has(key)) return GIT_QUERY_CACHE.get(key);
  let list = [];
  try {
    const out = execFileSync('git', ['ls-files', '--', relPath], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    list = String(out || '').split(/\r?\n/).filter(Boolean);
  } catch (e) {
    list = [];
  }
  GIT_QUERY_CACHE.set(key, list);
  return list;
}

/**
 * 决定扫描时是否跳过某个子目录。
 *
 * @param {string} root git 仓库工作区根目录
 * @param {string} rel 子目录相对仓库根的路径
 * @param {string} name 子目录名
 * @param {Object} state 收集跳过决策的诊断信息（可选）
 * @returns {boolean} true=跳过，false=纳入扫描
 */
function shouldSkipDir(root, rel, name, state) {
  if (SKIP_DIRS.has(name)) return true;
  if (!CONDITIONAL_SKIP_DIRS.has(name)) return false;

  // 缓存：walk 与 walkBinaryContent 会对同一目录各判一次，每次判定都要问 git
  // （本机 git 进程启动约 60ms/次），不缓存等于把成本翻倍。
  const cache = state && state.skipCache;
  if (cache && cache.has(rel)) return cache.get(rel);

  let skip;
  // 探测路径带尾斜杠：.gitignore 的规则写作 `_releases/`（只匹配目录），
  // 归档目录尚未创建时（全新 clone）不带尾斜杠的探测会误判为「未忽略」→ 假失败。
  const ignored = isIgnoredByGit(root, rel + '/');
  if (ignored === null) {
    // git 不可用 / 不在仓库内：没有 git 也就没有「被提交入库」的风险，
    // 维持旧行为（跳过），避免非 git 场景下把 317MB 归档扫进来。
    skip = true;
  } else if (ignored === false) {
    if (state) state.notIgnored.push(rel);
    skip = false; // 未被忽略 → 纳入扫描，让既有断言把它抓出来
  } else {
    const tracked = listTrackedFiles(root, rel);
    if (tracked.length) {
      if (state) state.tracked.push(rel + '（已被 git 跟踪：' + tracked.join(', ') + '）');
      skip = false; // 内部有被跟踪文件 → 纳入扫描
    } else {
      skip = true;
    }
  }
  if (cache) cache.set(rel, skip);
  return skip;
}

/**
 * 归档目录的 git 隔离不变量（**两条独立断言**，由 tools/smoke.js 第 7 组接入）。
 *
 * 这两条守的是「门禁跳过归档目录」这个动作的**前提**：
 *   1. `_releases/` 必须始终处于 git 忽略状态 —— 否则 317MB 产物会被误提交；
 *   2. `_releases/` 下不得存在被 git 跟踪的文件。
 * 与之配套的还有 {@link shouldSkipDir} 的条件跳过：前提被破坏时目录会被重新
 * 纳入扫描，由既有的 binary 规则覆盖断言直接失败（门禁自愈）。
 *
 * 无 git 环境（不在 git 仓库内 / git 不可用）时**优雅跳过**而非失败：
 * 非 git 场景下既不存在「产物被提交入库」的风险，也无法判定跟踪状态；
 * 与本工具其它 fallback（如 check-attr 不可用时回退扩展名判定）保持同一口径。
 *
 * @param {string} root 仓库根目录
 * @returns {Array<{status: 'pass'|'fail'|'skip', msg: string, detail: string}>}
 */
function checkArchiveInvariants(root) {
  const checks = [];
  // 探测路径带尾斜杠（`_releases/`）：.gitignore 里的规则写作 `_releases/`（只匹配目录），
  // 归档目录尚未创建时（全新 clone / 尚未归档）不带尾斜杠的探测会因
  // 「git 无法确认该路径是目录」而返回「未忽略」→ 造成误报。
  // 带尾斜杠探测时，两种情形都能正确命中规则。
  const ignored = isIgnoredByGit(root, ARCHIVE_DIR + '/');

  if (ignored === null) {
    // 无 git 环境：既无法判定忽略状态，也无法列出跟踪文件 → 跳过（不计失败）。
    const why = '无 git 环境（不在 git 仓库内或 git 不可用）';
    checks.push({ status: 'skip', msg: ARCHIVE_RULE_MSG, detail: why });
    checks.push({ status: 'skip', msg: ARCHIVE_TRACKED_MSG, detail: why });
    return checks;
  }

  checks.push({
    status: ignored ? 'pass' : 'fail',
    msg: ARCHIVE_RULE_MSG,
    detail: ignored
      ? ''
      : ('git check-ignore 未匹配 `' + ARCHIVE_DIR + '/` —— 请在 .gitignore 中加入一行 `'
          + ARCHIVE_DIR + '/`（若疑似被误删或改名，请恢复同名规则）'),
  });

  const tracked = listTrackedFiles(root, ARCHIVE_DIR);
  const shown = tracked.slice(0, 5).join(', ') + (tracked.length > 5 ? ' …（仅列前 5 个）' : '');
  checks.push({
    status: tracked.length ? 'fail' : 'pass',
    msg: ARCHIVE_TRACKED_MSG,
    detail: tracked.length
      ? ('已被 git 跟踪 ' + tracked.length + ' 个文件：' + shown
          + ' —— 请执行 `git rm -r --cached ' + ARCHIVE_DIR + '` 取消跟踪，'
          + '并确认 .gitignore 含 `' + ARCHIVE_DIR + '/`')
      : '',
  });

  return checks;
}

// ---------------------------------------------------------------------------
// 遍历仓库内受检二进制文件
// ---------------------------------------------------------------------------
function walk(dir, rel, out, state) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      if (shouldSkipDir(state && state.root, r, ent.name, state)) continue;
      walk(abs, r, out, state);
      continue;
    }
    if (BINARY_EXTS.includes(path.extname(ent.name).toLowerCase())) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 遍历仓库内「所有」含 NUL 字节的文件（真二进制，与扩展名白名单无关）
// 用途：确保任何二进制资产都被 .gitattributes 的 binary 规则覆盖。
// 背景：若将来引入白名单外的二进制格式（如 .bin / .dat / 新字体），
//       仅按扩展名扫描的门禁会完全看不见它 —— 保护规则与实际资产就会脱节。
// ---------------------------------------------------------------------------
function walkBinaryContent(dir, rel, out, state) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      if (shouldSkipDir(state && state.root, r, ent.name, state)) continue;
      walkBinaryContent(abs, r, out, state);
      continue;
    }
    let buf;
    try { buf = fs.readFileSync(abs); } catch (e) { continue; }
    if (buf.length && buf.includes(0)) out.push(r);
  }
  return out;
}

/**
 * 解析 `git check-attr` 的输出，返回 Map<相对路径, 是否受 binary 规则保护>。
 *
 * 输出形如 "<path>: <attr>: <value>"（path 可能含 ':'，故用贪婪匹配锚定末尾）。
 *
 * **CRLF 鲁棒性**：Windows 上 git 的 stdout 可能是 CRLF 行尾。切行用 /\r?\n/，
 * 再对每行额外去掉尾部残留的 \r —— 否则属性值会变成 "unset\r"，
 * 与 'unset' 比对失败 → 误判「未受保护」→ 门禁假红。
 * （Linux CI 上 git 输出 LF，本函数同样正确；此处的双保险是为了跨平台一致。）
 *
 * @param {string} out `git check-attr` 的原始输出
 * @returns {Map<string, boolean>}
 */
function parseCheckAttrOutput(out) {
  const re = /^(.*): (\w+): (.*)$/;
  const attrs = new Map();
  for (const raw of String(out || '').split(/\r?\n/)) {
    const line = raw.replace(/\r+$/, '');
    if (!line) continue;
    const m = re.exec(line);
    if (!m) continue;
    const [, p, attr, val] = m;
    if (!attrs.has(p)) attrs.set(p, {});
    attrs.get(p)[attr] = val;
  }
  const map = new Map();
  for (const [p, a] of attrs) {
    // binary 宏 = -text -diff → git check-attr 报 "unset"
    map.set(p, a.text === 'unset' && a.diff === 'unset');
  }
  return map;
}

/**
 * 用 `git check-attr` 判定每个文件是否被 binary 规则保护 —— 这是权威来源，
 * 能识别任意形态的规则（`*.ext` / `*.tar.gz` / 路径型 `dir/** binary` 等）。
 * 返回 Map<相对路径, boolean>；不在 git 仓库或 git 不可用时返回 null，
 * 由调用方回退到「按扩展名判定」。
 */
function queryGitBinaryAttrs(root, files) {
  if (!files.length) return new Map();
  let out;
  try {
    out = execFileSync('git', ['check-attr', 'text', 'diff', '--'].concat(files), {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      // 静默 git 的 stderr：不在 git 仓库内时它会打印 "fatal: not a git repository"，
      // 那只是「走回退路径」的信号，不该污染门禁输出。
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    return null;
  }
  return parseCheckAttrOutput(out);
}

// ---------------------------------------------------------------------------
// .gitattributes 规则检查
// ---------------------------------------------------------------------------
function checkGitattributes(root, presentExts) {
  const checks = [];
  const gaPath = path.join(root, '.gitattributes');
  if (!fs.existsSync(gaPath)) {
    checks.push({
      ok: false,
      msg: '.gitattributes 存在（二进制资产需要 binary 规则保护，否则 git add 会损坏 PNG）',
      level: 'error',
    });
    return { checks, exists: false, binaryExts: new Set() };
  }
  const lines = fs.readFileSync(gaPath, 'utf8').split(/\r?\n/);
  // 找到每个 binary 规则与其后是否还有针对同目录的 text 规则
  const textRuleIdx = [];
  const binaryRuleIdx = [];
  lines.forEach((ln, i) => {
    const s = ln.trim();
    if (!s || s.startsWith('#')) return;
    const m = s.match(/^(\S+)\s+([a-z-]+)(\s*=\s*(\S+))?$/);
    if (!m) return;
    const [, pattern, attr, , value] = m;
    if (attr === 'text') textRuleIdx.push({ i, pattern, value });
    if (attr === 'binary' || (attr === 'diff' && value === 'binary')) binaryRuleIdx.push({ i, pattern });
  });
  checks.push({
    ok: true,
    msg: '.gitattributes 存在（已读取 ' + lines.length + ' 行规则）',
    level: 'info',
  });
  // 记录哪些扩展名有 binary 规则（供「全仓二进制覆盖兜底」检查复用）
  // 注意：模式形如 `*.png`，去掉前缀 `*` 后得到 `.png` —— 若再交给 path.extname()
  // 会被当成「点开头无扩展名的文件」而返回空串，所以这里直接取模式末尾的扩展名。
  // 扩展名**不做大小写归一**：git 的路径匹配是大小写敏感的（CI runner 是 Linux，
  // core.ignorecase=false），回退路径必须与 git check-attr 在 CI 上的判定一致，
  // 否则同一份仓库在两条路径下会得出相反结论。
  // 注：Windows 上 core.ignorecase=true 时 git 会大小写不敏感地匹配 `*.png`，
  // 此时两条路径会分歧 —— 回退路径选择「报未保护」（宁可误报也不漏报）。
  const binaryExts = new Set(
    binaryRuleIdx
      .map(r => {
        const m = r.pattern.match(/^\*(\.[A-Za-z0-9]+)$/);
        return m ? m[1] : '';
      })
      .filter(Boolean)
  );
  // 只对「仓库里真实存在的扩展名」要求 binary 规则 —— 不为不存在的格式设门槛，
  // 避免门禁产生噪音而掩盖真正的问题。
  for (const ext of BINARY_EXTS) {
    if (presentExts && !presentExts.has(ext)) continue;
    const want = '*' + ext;
    const found = binaryRuleIdx.find(r => r.pattern === want);
    checks.push({
      ok: !!found,
      msg: '.gitattributes 含 ' + want + ' binary 规则（仓库内存在该格式资产，否则 ' + ext + ' 会被 CRLF 转换损坏）',
      level: 'error',
    });
  }
  // 顺序检查：binary 规则必须排在 text 规则之后（最后一条匹配生效）
  if (binaryRuleIdx.length && textRuleIdx.length) {
    const lastBinary = Math.max(...binaryRuleIdx.map(r => r.i));
    const lastText = Math.max(...textRuleIdx.map(r => r.i));
    checks.push({
      ok: lastBinary > lastText,
      msg: '.gitattributes 中 binary 规则排在 text 规则之后（.gitattributes 多规则命中时最后一条生效）',
      level: 'error',
    });
  }
  return { checks, exists: true, binaryExts };
}

// ---------------------------------------------------------------------------
// 主检查：返回结构化结果，供 CLI 或 smoke.js 复用
// ---------------------------------------------------------------------------
function runChecks(opts) {
  const root = (opts && opts.root) || process.cwd();
  const checks = [];
  // 跳过决策的诊断信息：记录「本该被忽略却没被忽略」「内部有被跟踪文件」的目录，
  // 让 binary 规则覆盖断言在失败时能直接指出根因（而不是只列一串未保护文件）。
  const state = { root: root, notIgnored: [], tracked: [], skipCache: new Map() };
  const files = walk(root, '', [], state);

  // 1) 逐文件校验
  for (const rel of files) {
    const abs = path.join(root, rel);
    const ext = path.extname(rel).toLowerCase();
    const fmt = FORMATS[ext];
    let buf;
    try { buf = fs.readFileSync(abs); } catch (e) { continue; }
    const good = buf.length >= fmt.magic.length &&
      buf.slice(0, fmt.magic.length).equals(fmt.magic) &&
      (!fmt.extra || buf.slice(fmt.extraOffset, fmt.extraOffset + fmt.extra.length).equals(fmt.extra));
    if (!good) {
      checks.push({
        ok: false,
        msg: fmt.name + ' 魔数校验通过：' + rel,
        level: 'error',
        detail: '文件头 ' + buf.slice(0, 12).toString('hex') + ' 不符合 ' + fmt.name + ' 签名',
      });
      continue;
    }
    if (ext === '.png') {
      const r = inspectPng(buf);
      checks.push({
        ok: r.ok,
        msg: 'PNG 结构完整（签名+chunk CRC+IDAT 可解压）：' + rel,
        level: 'error',
        detail: r.ok ? '' : r.reason,
      });
    } else {
      checks.push({
        ok: true,
        msg: fmt.name + ' 魔数校验通过：' + rel,
        level: 'info',
      });
    }
  }

  // 2) .gitattributes 规则（只对仓库内真实存在的格式提要求）
  const presentExts = new Set(files.map(f => path.extname(f).toLowerCase()));
  const ga = checkGitattributes(root, presentExts);
  checks.push(...ga.checks);

  // 3) 覆盖兜底：全仓「真二进制」（含 NUL 字节）文件是否都被 binary 规则保护。
  //    这一项不依赖扩展名白名单 —— 白名单外的二进制格式也能被看见。
  const allBinaries = walkBinaryContent(root, '', [], state);
  const uncovered = [];
  // 判定「某个文件是否被 binary 规则保护」的权威来源是 git 自己的属性解析
  // （git check-attr），它能识别任意形态的规则：*.ext / *.tar.gz / 路径型 /** 等。
  // 若只用正则从 .gitattributes 里抠扩展名，遇到非 `*.<ext>` 形态的规则会误报
  // 「未受保护」（实测：*.tar.gz binary 与路径型规则都会误报）。
  // 因此优先用 git check-attr；不在 git 仓库 / 无 git 时回退到扩展名判定。
  const attrProtected = queryGitBinaryAttrs(root, allBinaries);
  for (const rel of allBinaries) {
    let binaryRule;
    if (attrProtected) {
      binaryRule = attrProtected.get(rel) === true;
    } else {
      // 回退：按扩展名判定（仅能识别 `*.<ext>` 形态；大小写敏感，与 git 一致）
      const ext = path.extname(rel);
      binaryRule = !!(ga.binaryExts && ga.binaryExts.has(ext));
    }
    if (!binaryRule) uncovered.push(rel);
  }
  // 失败详情：除了列出未受保护的文件，还要指出**根因** ——
  // 若归档目录因 .gitignore 规则丢失而重新进入扫描，必须明确说出来，
  // 否则用户只会看到一串 .ipa/.apk/.exe「未受保护」，却找不到真正的原因。
  let coverageDetail = '';
  if (uncovered.length) coverageDetail = '未受保护：' + uncovered.join(', ');
  const rootCauses = [];
  // walk 与 walkBinaryContent 会对同一个目录各判一次，去重后再拼装
  const notIgnored = [...new Set(state.notIgnored)];
  const trackedDirs = [...new Set(state.tracked)];
  if (notIgnored.length) {
    rootCauses.push(notIgnored.join('、') + ' 未被 git 忽略（.gitignore 的 `_releases/` 规则可能被删除或改名）→ 归档产物正面临被提交入库的风险');
  }
  if (trackedDirs.length) {
    rootCauses.push(trackedDirs.join('、') + '（归档目录内存在被 git 跟踪的文件）');
  }
  if (rootCauses.length) {
    coverageDetail += (coverageDetail ? '；根因：' : '根因：') + rootCauses.join('；');
  }
  checks.push({
    ok: uncovered.length === 0,
    msg: '全仓二进制文件均被 .gitattributes 的 binary 规则覆盖（共 ' + allBinaries.length + ' 个真二进制）',
    level: 'error',
    detail: coverageDetail,
  });

  return {
    checks,
    scanned: files.length,
    binaryScanned: allBinaries.length,
    failed: checks.filter(c => !c.ok).length,
    passed: checks.filter(c => c.ok).length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main() {
  const quiet = process.argv.includes('--quiet');
  const root = process.cwd();
  const res = runChecks({ root: root });
  // 归档目录不变量：检查「跳过 _releases/」这个动作的前提是否成立。
  // 与 tools/smoke.js 第 7 组的两条断言同源（同一个函数、同样的判定逻辑），
  // 因此 CLI 直跑与回归门禁不会出现口径分叉。
  const invariants = checkArchiveInvariants(root);
  if (!quiet) {
    console.log('=== 二进制资产完整性校验 ===');
    console.log('扫描文件数：' + res.scanned);
    console.log('');
    // 全部检查都列出（含 info 级）：汇总「通过 N」必须与可见行数一致，
    // 否则读者会误判门禁覆盖范围 —— 曾因隐藏 info 级断言，
    // 误以为 docs/screenshot.jpg 没有专属校验（实际第 10 条就是它）。
    for (const c of res.checks) {
      console.log((c.ok ? '  ✓ ' : '  ✗ ') + c.msg + (c.ok || !c.detail ? '' : '\n      → ' + c.detail));
    }
    console.log('');
    console.log('--- 归档目录不变量（`_releases/` 永不入库；与 smoke.js 第 7 组同源，独立于上面的 ' + res.checks.length + ' 项）---');
    for (const c of invariants) {
      if (c.status === 'pass') {
        console.log('  ✓ ' + c.msg);
      } else if (c.status === 'skip') {
        console.log('  ⊘ 已跳过：' + c.msg + '（' + c.detail + '）');
      } else {
        console.log('  ✗ ' + c.msg + '\n      → ' + c.detail);
      }
    }
  }
  console.log('');
  console.log('通过 ' + res.passed + ' / 失败 ' + res.failed);
  // 只有 status==='fail' 才算失败；status==='skip'（无 git 环境）不计入失败。
  const failedInvariants = invariants.filter((c) => c.status === 'fail').length;
  const skippedInvariants = invariants.filter((c) => c.status === 'skip').length;
  if (skippedInvariants) console.log('（归档目录不变量跳过 ' + skippedInvariants + ' 项：无 git 环境）');
  if (res.failed || failedInvariants) {
    if (res.failed) console.log('❌ 存在损坏或缺保护规则的二进制资产');
    if (failedInvariants) console.log('❌ 归档目录不变量被破坏：`_releases/` 可能正面临被提交入库的风险');
    if (process.argv.includes('--throw')) {
      throw new Error('二进制资产校验未通过：' + (res.failed + failedInvariants) + ' 项');
    }
    process.exit(1);
  }
  console.log('✅ 二进制资产全部完好');
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  runChecks,
  inspectPng,
  FORMATS,
  BINARY_EXTS,
  checkGitattributes,
  checkArchiveInvariants,
  parseCheckAttrOutput,
  isIgnoredByGit,
  listTrackedFiles,
  shouldSkipDir,
  SKIP_DIRS,
  CONDITIONAL_SKIP_DIRS,
  ARCHIVE_DIR,
  ARCHIVE_RULE_MSG,
  ARCHIVE_TRACKED_MSG,
};
