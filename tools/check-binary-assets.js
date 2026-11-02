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
// 遍历仓库内受检二进制文件
// ---------------------------------------------------------------------------
function walk(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'dist') continue;
    const abs = path.join(dir, ent.name);
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(abs, r, out);
    else if (BINARY_EXTS.includes(path.extname(ent.name).toLowerCase())) out.push(r);
  }
  return out;
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
    return { checks, exists: false };
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
  return { checks, exists: true };
}

// ---------------------------------------------------------------------------
// 主检查：返回结构化结果，供 CLI 或 smoke.js 复用
// ---------------------------------------------------------------------------
function runChecks(opts) {
  const root = (opts && opts.root) || process.cwd();
  const checks = [];
  const files = walk(root, '', []);

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

  // 2) .gitattributes 规则
  // 2) .gitattributes 规则（只对仓库内真实存在的格式提要求）
  const presentExts = new Set(files.map(f => path.extname(f).toLowerCase()));
  const ga = checkGitattributes(root, presentExts);
  checks.push(...ga.checks);

  return {
    checks,
    scanned: files.length,
    failed: checks.filter(c => !c.ok).length,
    passed: checks.filter(c => c.ok).length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main() {
  const quiet = process.argv.includes('--quiet');
  const res = runChecks({ root: process.cwd() });
  if (!quiet) {
    console.log('=== 二进制资产完整性校验 ===');
    console.log('扫描文件数：' + res.scanned);
    console.log('');
    for (const c of res.checks) {
      if (c.level === 'info' && res.failed === 0) continue;
      console.log((c.ok ? '  ✓ ' : '  ✗ ') + c.msg + (c.ok || !c.detail ? '' : '\n      → ' + c.detail));
    }
  }
  console.log('');
  console.log('通过 ' + res.passed + ' / 失败 ' + res.failed);
  if (res.failed) {
    console.log('❌ 存在损坏或缺保护规则的二进制资产');
    if (process.argv.includes('--throw')) throw new Error('二进制资产校验未通过：' + res.failed + ' 项');
    process.exit(1);
  }
  console.log('✅ 二进制资产全部完好');
  process.exit(0);
}

if (require.main === module) main();

module.exports = { runChecks, inspectPng, FORMATS, BINARY_EXTS, checkGitattributes };
