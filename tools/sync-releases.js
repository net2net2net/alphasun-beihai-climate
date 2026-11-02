#!/usr/bin/env node
/**
 * AlphaSun GitHub Release 产物本地归档工具（Release Archive Sync）
 * ------------------------------------------------------------
 * 背景：
 *   仓库的 GitHub Releases 页面承载着全部已发布版本的构建产物（exe / apk / ipa /
 *   单文件运行时 / 说明文档 / 截图等，累计约 730MB）。此前仓库内只保留源码，
 *   产物一旦从 Release 页面下架或网络不可达就再也拿不回来。本工具把每一个已发布
 *   版本的产物「同步下来」并长期保留在本地（默认 `<仓库根>/_releases`），配合
 *   SynologyDrive 自动同步到 NAS，形成仓库外的第二份归档。
 *
 * 网络约束（已实测确认，勿轻易改动）：
 *   1. 本机 `github.com:443` 长时间不可达，但 `api.github.com` 完全可用。
 *      因此资产下载必须走 API 端点：
 *        GET https://api.github.com/repos/{owner}/{repo}/releases/assets/{asset_id}
 *      请求头 `Accept: application/octet-stream` + `Authorization: Bearer <token>`，
 *      该端点返回 302 重定向到 `release-assets.githubusercontent.com`，必须跟随重定向。
 *   2. 绝对不要发送 `Range` 头 —— 实测会返回 JSON 错误而非二进制。
 *   3. 不要使用 `https://github.com/.../releases/download/...` 直链（本机不可达）。
 *
 * 完整性校验：
 *   GitHub 资产 API 提供 `digest` 字段（形如 `sha256:45c3c8a5...`），这是权威来源，
 *   比本地自算的「基线」可靠。下载后重算 sha256 与之比对，不符则判为损坏。
 *
 * 保留策略（用户明确要求）：
 *   本地磁盘**只保留最新发布版本**的产物（published_at 最新、非草稿），以省磁盘空间；
 *   历史版本仅保留**发布记录**（_releases/_index.json + knowledge-base/发布版本索引.md），
 *   产物本体随时可从 GitHub Release 取回。
 *   `--download` 默认即按此策略执行；`--all` 可显式要求归档全部版本；
 *   `--only <tag>` 用于临时补某一个历史版本。
 *
 * 用法：
 *   node tools/sync-releases.js --list                  # 列出全部 release + 本地归档状态
 *   node tools/sync-releases.js --download              # 默认只归档最新发布版本
 *   node tools/sync-releases.js --download --all        # 归档全部版本
 *   node tools/sync-releases.js --download --only v8.3   # 只处理指定 tag（--only 可重复）
 *   node tools/sync-releases.js --download --dry-run    # 只打印下载计划，不下载不写盘
 *   node tools/sync-releases.js --verify                # 只读校验（GitHub digest / 本地实算 / manifest 三方比对）
 *   node tools/sync-releases.js --prune-older           # 清理本地非最新版本的归档目录（默认先列清单再确认）
 *   node tools/sync-releases.js --out D:\backup         # 覆盖归档根目录（默认 <仓库根>/_releases）
 *   node tools/sync-releases.js --concurrency 6         # 并发下载数（默认 4）
 *
 * 作为模块复用：
 *   const { runList, runDownload, runVerify } = require('./sync-releases.js');
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const readline = require('readline');

// ---------------------------------------------------------------------------
// 常量与默认配置
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');
const API_BASE = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const USER_AGENT = 'alphasun-sync-releases/1.0 (+https://github.com/net2net2net/alphasun-beihai-climate)';
const DEFAULT_REPO = { owner: 'net2net2net', repo: 'alphasun-beihai-climate' };
const DEFAULT_CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;          // 单个资产的最大下载尝试次数
const BACKOFF_BASE_MS = 1000;    // 指数退避基数：1s → 2s → 4s
const SOCKET_TIMEOUT_MS = 60000; // socket 空闲超时（下载中无数据才触发，不限总时长）
const MAX_REDIRECTS = 5;

/** 归档子目录名：所有 release 清单与资产都落在这里。 */
const ARCHIVE_DIR_NAME = '_releases';
const INDEX_FILE = '_index.json';
const MANIFEST_FILE = '_manifest.json';

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

/** 休眠指定毫秒（用于指数退避）。 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 把字节数格式化成人类可读形式。 */
function fmtBytes(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(1) + ' ' + units[i];
}

/** 把 ISO 时间压成紧凑形式，便于表格对齐。 */
function fmtDate(iso) {
  if (!iso) return '-';
  return String(iso).replace('T', ' ').replace(/\.\d+Z$/, 'Z').replace(/Z$/, '').slice(0, 19);
}

/** 当前时间的 ISO 字符串（UTC）。 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * 把资产名转换成安全的本地文件名。
 * GitHub 资产名理论上可以包含路径分隔符或 Windows 非法字符，直接落盘会有
 * 目录穿越与创建失败的风险，因此统一净化。
 */
function safeFileName(name) {
  let base = String(name == null ? '' : name)
    .replace(/[\\/]+/g, '_')                       // 路径分隔符
    .replace(/[<>:"|?*]/g, '_')                   // Windows 非法字符
    .replace(/[\x00-\x1f\x7f]/g, '_')            // 控制字符
    .replace(/[. ]+$/g, '')                      // 结尾的点与空格（Windows 不允许）
    .trim();
  if (!base || /^\.+$/.test(base)) base = 'asset';
  // Windows 保留设备名
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = '_' + base;
  return base;
}

/**
 * 从 GitHub 的 `digest` 字段（形如 `sha256:abc...`）取出十六进制摘要。
 * 老资产可能没有该字段（返回 null），此时退化为「仅按文件大小校验」。
 */
function extractDigest(digest) {
  if (!digest || typeof digest !== 'string') return null;
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(digest.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * 判断字符是否为「全角 / 宽字符」（中文、日文、韩文、全角标点等）——
 * 这类字符在等宽终端里占 2 列，中英混排的表格对齐必须按 2 列计。
 * @param {string} ch 单个字符
 * @returns {boolean}
 */
function isWideChar(ch) {
  const code = ch.codePointAt(0);
  return (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd);
}

/**
 * 按「显示宽度」补齐字符串，用于中英混排的表格对齐。
 * @param {*} s 待补齐的内容
 * @param {number} n 目标显示宽度
 * @returns {string}
 */
function padText(s, n) {
  const str = String(s);
  let width = 0;
  for (const ch of str) width += isWideChar(ch) ? 2 : 1;
  return str + ' '.repeat(Math.max(0, n - width));
}

/**
 * 计算文件的 sha256（流式，避免把大文件整个读进内存）。
 * @param {string} file 绝对路径
 * @returns {Promise<string>} 十六进制摘要
 */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** 读取 JSON 文件，失败时返回 null（不抛错，便于「文件不存在」这类正常分支）。 */
function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** 写 JSON 文件（UTF-8，2 空格缩进，末尾换行）。 */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * 进度渲染器：仅在 TTY 下原地刷新单行；非 TTY（重定向到日志文件）时静默，
 * 避免把一堆 \r 控制字符写进日志。
 */
function makeProgressRenderer() {
  const tty = Boolean(process.stdout.isTTY);
  return {
    update(text) {
      if (!tty) return;
      process.stdout.write('\r[2K' + text);
    },
    clear() {
      if (!tty) return;
      process.stdout.write('\r[2K');
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP 层（使用内置 https，避免 fetch 的 undici bodyTimeout 掐断大文件下载）
// ---------------------------------------------------------------------------

/**
 * 发起一次 HTTPS GET，返回原始 IncomingMessage（由调用方决定读 body 还是消费流）。
 * @param {string} urlStr 完整 URL
 * @param {Object} headers 请求头
 * @param {number} timeoutMs socket 空闲超时
 * @returns {Promise<import('http').IncomingMessage>}
 */
function httpsGet(urlStr, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
      },
      (res) => resolve(res),
    );
    req.setTimeout(timeoutMs || SOCKET_TIMEOUT_MS, () => {
      req.destroy(new Error('请求超时（' + (timeoutMs || SOCKET_TIMEOUT_MS) + 'ms 无数据）'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 跟随重定向地打开一个流式响应。
 *
 * 关键点：跨主机重定向时**丢弃 Authorization**。资产下载的 302 目标是
 * `release-assets.githubusercontent.com`（带自签名查询串的直链），不需要也不应该
 * 带上 api.github.com 的 token。
 *
 * @returns {Promise<import('http').IncomingMessage>} 最终的 200 响应
 */
async function openStream(urlStr, headers, maxRedirects = MAX_REDIRECTS) {
  let current = urlStr;
  let currentHeaders = Object.assign({}, headers);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await httpsGet(current, currentHeaders, SOCKET_TIMEOUT_MS);
    const status = res.statusCode;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume(); // 丢弃重定向响应体，保持 socket 干净
      const next = new URL(res.headers.location, current).toString();
      if (new URL(next).host !== new URL(current).host) {
        delete currentHeaders['Authorization'];
      }
      current = next;
      continue;
    }
    return res;
  }
  throw new Error('重定向次数超过上限（' + maxRedirects + '）');
}

/** 读取一个 JSON 响应体（带状态码检查与有限次重试）。 */
async function httpJson(urlStr, headers, attempts = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await openStream(urlStr, headers, 3);
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return JSON.parse(body);
      }
      // 5xx / 429 值得重试；4xx 直接失败
      const retryable = res.statusCode >= 500 || res.statusCode === 429;
      lastErr = new Error('HTTP ' + res.statusCode + ' ' + urlStr + ' -> ' + body.slice(0, 200));
      if (!retryable || attempt === attempts) break;
    } catch (e) {
      lastErr = e;
      if (attempt === attempts) break;
    }
    await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
  }
  throw lastErr || new Error('请求失败: ' + urlStr);
}

// ---------------------------------------------------------------------------
// 认证与仓库定位
// ---------------------------------------------------------------------------

/**
 * 解析 GitHub token。
 * 优先级：环境变量 GITHUB_TOKEN → 环境变量 GH_TOKEN → `gh auth token`。
 * token 绝不写入任何文件，也绝不打印到日志。
 *
 * @returns {string|null} token，未取到时返回 null
 */
function resolveToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const out = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // 静默 gh 的 stderr，避免污染输出
      windowsHide: true,
    });
    const token = String(out || '').trim();
    if (token) return token;
  } catch (e) {
    // gh 不存在或未登录 —— 允许降级为匿名访问（公开仓库可读），由调用方给出提示。
  }
  return null;
}

/**
 * 从 git remote 解析 owner/repo，失败时回退到默认仓库。
 * @param {string|null} explicit 显式指定的 owner/repo
 * @returns {{owner: string, repo: string}}
 */
function resolveRepo(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.GITHUB_REPOSITORY) candidates.push(process.env.GITHUB_REPOSITORY);
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    candidates.push(String(remote).trim());
  } catch (e) {
    // 不在 git 仓库内或没有 origin —— 走默认仓库。
  }
  for (const raw of candidates) {
    const parsed = parseRepoSpec(raw);
    if (parsed) return parsed;
  }
  return Object.assign({}, DEFAULT_REPO);
}

/**
 * 从 `owner/repo`、`https://github.com/owner/repo.git`、`git@github.com:owner/repo.git`
 * 等形式中解析出 owner/repo。
 * @returns {{owner: string, repo: string}|null}
 */
function parseRepoSpec(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const ssh = /^git@([^:]+):(.+)$/.exec(s);
  if (ssh) s = ssh[2];
  else {
    const http = /^[a-z+]+:\/\/[^/]+\/(.+)$/i.exec(s);
    if (http) s = http[1];
  }
  s = s.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

/** 构造 API 请求头（带 token 时附加 Authorization）。 */
function apiHeaders(token, extra) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return Object.assign(headers, extra || {});
}

/**
 * 拉取仓库的全部 release（含 draft，取决于 token 权限），自动翻页。
 * @returns {Promise<Array<Object>>}
 */
async function fetchReleases(token, repo) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const url = API_BASE + '/repos/' + repo.owner + '/' + repo.repo + '/releases?per_page=100&page=' + page;
    const batch = await httpJson(url, apiHeaders(token));
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push.apply(all, batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** 归一化 release 对象，只保留归档索引需要的字段。 */
function normalizeRelease(r) {
  const assets = (r.assets || []).map((a) => ({
    asset_id: a.id,
    name: a.name,
    label: a.label || '',
    size: typeof a.size === 'number' ? a.size : null,
    digest: a.digest || null,
    sha256: extractDigest(a.digest),
    content_type: a.content_type || '',
    browser_download_url: a.browser_download_url || '',
    download_count: typeof a.download_count === 'number' ? a.download_count : 0,
    created_at: a.created_at || null,
    updated_at: a.updated_at || null,
  }));
  return {
    tag_name: r.tag_name,
    name: r.name || r.tag_name,
    published_at: r.published_at || null,
    created_at: r.created_at || null,
    prerelease: Boolean(r.prerelease),
    draft: Boolean(r.draft),
    html_url: r.html_url || '',
    target_commitish: r.target_commitish || '',
    assets,
  };
}

/** 计算 release 的资产总字节数。 */
function releaseTotalBytes(release) {
  return release.assets.reduce((sum, a) => sum + (a.size || 0), 0);
}

// ---------------------------------------------------------------------------
// 保留策略（Retention Policy）
// ---------------------------------------------------------------------------
// 本地磁盘只保留**最新发布版本**的产物；历史版本仅保留发布记录（索引 + 知识库文档），
// 产物本体随时可以从 GitHub Release 取回。
//   --download            → 默认只归档最新发布版本
//   --download --all      → 显式要求归档全部版本
//   --download --only X   → 临时补某一个历史版本
// ---------------------------------------------------------------------------

/**
 * 找出「最新发布版本」：按 published_at 最新，且排除草稿（draft）。
 * 若全部都是草稿，则退化为按 published_at 取最新。
 *
 * @param {Array<Object>} releases 归一化后的 release 列表
 * @returns {Object|null}
 */
function latestRelease(releases) {
  if (!releases || releases.length === 0) return null;
  const published = releases.filter((r) => !r.draft);
  const candidates = published.length ? published : releases;
  let best = null;
  let bestTime = -Infinity;
  for (const r of candidates) {
    const t = r.published_at ? Date.parse(r.published_at) : 0;
    if (!best || t > bestTime) {
      best = r;
      bestTime = t;
    }
  }
  return best;
}

/**
 * 解析本次的作用范围（scope）与归档目标（targets）。
 *
 * @param {Array<Object>} releases 全部 release
 * @param {Object} opts { only: string[], all: boolean }
 * @returns {{scope: Array<Object>, targets: Array<Object>, latest: Object|null,
 *            policyLabel: string, retentionOf: Function}}
 */
function resolveScope(releases, opts) {
  const only = (opts && opts.only) || [];
  const onlySet = new Set(only);
  const latest = latestRelease(releases);

  // scope：本次要「展示 / 校验」的集合 —— --only 生效时只含指定 tag，否则全部
  const scope = onlySet.size ? releases.filter((r) => onlySet.has(r.tag_name)) : releases.slice();

  // targets：本次要「下载归档」的集合 —— --only > --all > 默认最新版本
  let targets;
  let policyLabel;
  if (onlySet.size) {
    targets = scope.slice();
    policyLabel = '--only 指定（' + scope.map((r) => r.tag_name).join(', ') + '）';
  } else if (opts && opts.all) {
    targets = releases.slice();
    policyLabel = '--all（显式归档全部 ' + releases.length + ' 个 release）';
  } else {
    targets = latest ? [latest] : [];
    policyLabel = '默认策略：只保留最新发布版本' + (latest ? '（' + latest.tag_name + '）' : '（无可归档版本）');
  }

  // 保留策略标注：最新版本 = 本地长期保留；其余 = 仅远端保留
  const retentionOf = (release) => (latest && release.tag_name === latest.tag_name ? 'latest' : 'remote-only');

  return { scope: scope, targets: targets, latest: latest, policyLabel: policyLabel, retentionOf: retentionOf };
}

// ---------------------------------------------------------------------------
// 本地归档状态评估
// ---------------------------------------------------------------------------

/** 单个资产的本地状态取值。 */
const ASSET_STATUS = {
  ARCHIVED: 'archived',
  MISSING: 'missing',
  MISMATCH: 'mismatch',
};

/**
 * release 级的本地归档状态取值（写入 _index.json 的 local_status）：
 *   archived     —— 本地已归档，全部资产存在且 sha256 与 GitHub digest 一致
 *   not_archived —— 远端存在，但本地按「只保留最新版本」策略未下载（或资产不全）
 *   empty        —— 该 release 本身没有资产（空发布）
 *   mismatch     —— 本地文件齐全，但至少一个资产 sha256 与 GitHub digest 不符
 */
const RELEASE_STATUS = {
  ARCHIVED: 'archived',
  NOT_ARCHIVED: 'not_archived',
  EMPTY: 'empty',
  MISMATCH: 'mismatch',
};

/**
 * 评估某个 release 在本地的归档状态。
 *
 * @param {Object} release 归一化后的 release
 * @param {string} outDir 归档根目录
 * @param {Object} opts { quick: boolean } —— quick 为 true 时只比大小不算 sha256
 * @returns {Promise<{status: string, assets: Array<Object>, archivedBytes: number}>}
 */
async function assessRelease(release, outDir, opts) {
  const options = opts || {};
  const tagDir = path.join(outDir, release.tag_name);
  const rows = [];
  let archivedBytes = 0;

  for (const asset of release.assets) {
    const file = path.join(tagDir, safeFileName(asset.name));
    const row = { asset: asset, file: file, status: ASSET_STATUS.MISSING, actual: null, reason: '' };
    if (!fs.existsSync(file)) {
      rows.push(row);
      continue;
    }
    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch (e) {
      row.reason = '无法 stat: ' + e.message;
      rows.push(row);
      continue;
    }
    row.bytes = stat.size;
    if (asset.size !== null && stat.size !== asset.size) {
      row.status = ASSET_STATUS.MISMATCH;
      row.reason = '大小不符（期望 ' + asset.size + '，实际 ' + stat.size + '）';
      rows.push(row);
      continue;
    }
    if (options.quick || !asset.sha256) {
      // 未提供 digest 的老资产只能按大小判定
      row.status = ASSET_STATUS.ARCHIVED;
      row.actual = null;
      row.reason = asset.sha256 ? '' : 'GitHub 未提供 digest，仅按大小校验';
      archivedBytes += stat.size;
      rows.push(row);
      continue;
    }
    const actual = await sha256File(file);
    row.actual = actual;
    if (actual === asset.sha256) {
      row.status = ASSET_STATUS.ARCHIVED;
      archivedBytes += stat.size;
    } else {
      row.status = ASSET_STATUS.MISMATCH;
      row.reason = 'sha256 不符（期望 ' + asset.sha256.slice(0, 12) + '…，实际 ' + actual.slice(0, 12) + '…）';
    }
    rows.push(row);
  }

  let status;
  if (release.assets.length === 0) {
    status = RELEASE_STATUS.EMPTY;
  } else if (rows.every((r) => r.status === ASSET_STATUS.ARCHIVED)) {
    status = RELEASE_STATUS.ARCHIVED;
  } else if (rows.some((r) => r.status === ASSET_STATUS.MISMATCH) && rows.every((r) => r.status !== ASSET_STATUS.MISSING)) {
    status = RELEASE_STATUS.MISMATCH;
  } else {
    status = RELEASE_STATUS.NOT_ARCHIVED;
  }
  return { status: status, assets: rows, archivedBytes: archivedBytes };
}

// ---------------------------------------------------------------------------
// 下载
// ---------------------------------------------------------------------------

/**
 * 把已损坏的文件改名隔离（`*.corrupt`），绝不直接删除 —— 保留现场便于事后排查。
 * @returns {string|null} 隔离后的路径，失败返回 null
 */
function quarantineFile(file) {
  const primary = file + '.corrupt';
  let target = primary;
  if (fs.existsSync(target)) {
    target = file + '.corrupt.' + nowIso().replace(/[:.]/g, '-');
  }
  try {
    fs.renameSync(file, target);
    return target;
  } catch (e) {
    return null;
  }
}

/**
 * 下载单个资产到指定路径（先写 `.part`，校验通过再改名）。
 *
 * @param {Object} asset 归一化后的资产
 * @param {string} destFile 目标文件绝对路径
 * @param {Object} ctx { token, owner, repo, maxAttempts, backoffBaseMs }
 * @returns {Promise<{ok: boolean, sha256: string|null, bytes: number, error: string|null, attempts: number}>}
 */
async function downloadAsset(asset, destFile, ctx) {
  const tmp = destFile + '.part';
  let lastError = '未知错误';

  for (let attempt = 1; attempt <= ctx.maxAttempts; attempt++) {
    try {
      // 清理上一次中断残留的临时片（GitHub 资产端点不支持 Range，无法字节级续传，
      // 因此断点续传只能做到「整文件级别」的跳过）。
      if (fs.existsSync(tmp)) {
        try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
      }

      const url = API_BASE + '/repos/' + ctx.owner + '/' + ctx.repo + '/releases/assets/' + asset.asset_id;
      const headers = {
        'Accept': 'application/octet-stream',
        'User-Agent': USER_AGENT,
      };
      if (ctx.token) headers['Authorization'] = 'Bearer ' + ctx.token;

      const res = await openStream(url, headers, MAX_REDIRECTS);
      if (res.statusCode !== 200) {
        const body = [];
        for await (const c of res) {
          body.push(c);
          if (body.length > 8) break; // 只取开头用于报错
        }
        throw new Error('HTTP ' + res.statusCode + ' ' + Buffer.concat(body).toString('utf8').slice(0, 200));
      }

      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        let written = 0;
        res.on('data', (chunk) => {
          written += chunk.length;
          if (ctx.onProgress) ctx.onProgress(asset, written, asset.size);
        });
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('连接被中断')));
        out.on('error', reject);
        out.on('finish', resolve);
        res.pipe(out);
      });

      const stat = fs.statSync(tmp);
      if (asset.size !== null && stat.size !== asset.size) {
        throw new Error('文件大小不符（期望 ' + asset.size + '，实际 ' + stat.size + '）');
      }
      const actual = await sha256File(tmp);
      if (asset.sha256 && actual !== asset.sha256) {
        throw new Error('sha256 校验失败（期望 ' + asset.sha256 + '，实际 ' + actual + '）');
      }

      fs.renameSync(tmp, destFile);
      return { ok: true, sha256: actual, bytes: stat.size, error: null, attempts: attempt };
    } catch (e) {
      lastError = (e && e.message) || String(e);
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) { /* 忽略 */ }
      if (attempt >= ctx.maxAttempts) break;
      const wait = ctx.backoffBaseMs * Math.pow(2, attempt - 1);
      if (ctx.onRetry) ctx.onRetry(asset, attempt, lastError, wait);
      await sleep(wait);
    }
  }
  return { ok: false, sha256: null, bytes: 0, error: lastError, attempts: ctx.maxAttempts };
}

/**
 * 简易并发池：固定并发度地消费任务列表，保持结果顺序。
 * @param {Array} items 任务数组
 * @param {number} limit 并发数
 * @param {Function} worker (item, index) => Promise
 */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const runners = [];
  for (let i = 0; i < width; i++) {
    runners.push((async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
      }
    })());
  }
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// 清单（manifest）与索引（index）
// ---------------------------------------------------------------------------

/**
 * 写出某个 tag 的 `_manifest.json`。
 * @param {Object} release 归一化后的 release
 * @param {Array<Object>} rows assessRelease 得到的逐资产状态
 * @param {string} outDir 归档根目录
 * @param {Object} extra { downloadedAt: Map<assetId, string> }
 */
function writeManifest(release, rows, outDir, extra) {
  const downloadedAt = (extra && extra.downloadedAt) || new Map();
  const manifest = {
    tag_name: release.tag_name,
    name: release.name,
    published_at: release.published_at,
    prerelease: release.prerelease,
    draft: release.draft,
    html_url: release.html_url,
    target_commitish: release.target_commitish,
    asset_count: release.assets.length,
    total_bytes: releaseTotalBytes(release),
    assets: rows.map((row) => ({
      name: row.asset.name,
      asset_id: row.asset.asset_id,
      size: row.asset.size,
      digest: row.asset.digest,
      sha256: row.asset.sha256,
      local_sha256: row.actual || null,
      local_path: path.join(release.tag_name, path.basename(row.file)).split(path.sep).join('/'),
      content_type: row.asset.content_type,
      browser_download_url: row.asset.browser_download_url,
      download_count: row.asset.download_count,
      downloaded_at: downloadedAt.get(row.asset.asset_id) || null,
      local_status: row.status,
      local_bytes: typeof row.bytes === 'number' ? row.bytes : null,
    })),
  };
  writeJson(path.join(outDir, release.tag_name, MANIFEST_FILE), manifest);
  return manifest;
}

/**
 * 写出归档根目录的 `_index.json`（机器可读的全局清单）。
 *
 * 索引**始终覆盖全部 release**（含空发布与 prerelease），每个 release 记录发布
 * 元信息、资产清单与 `local_status`：
 *   archived     本地已归档（全部资产存在且 sha256 一致）
 *   not_archived 远端存在但本地未下载（按「只保留最新版本」策略）
 *   empty        该 release 无资产
 *   mismatch     本地文件齐全但校验不符
 *
 * @param {Array<Object>} releases 全部 release
 * @param {Array<Object>} assessments 与 releases 等长的本地状态评估
 * @param {string} outDir 归档根目录
 * @param {Object} repo { owner, repo }
 * @param {boolean} tokenPresent 是否已认证
 * @param {Object} meta { retentionOf: Function, latest: Object|null }
 */
function writeIndex(releases, assessments, outDir, repo, tokenPresent, meta) {
  const info = meta || {};
  const retentionOf = info.retentionOf || (() => 'remote-only');
  const latest = info.latest || null;
  let totalBytes = 0;
  let archivedBytes = 0;
  const rows = releases.map((release, i) => {
    const a = assessments[i];
    totalBytes += releaseTotalBytes(release);
    archivedBytes += a.archivedBytes;
    return {
      tag_name: release.tag_name,
      name: release.name,
      published_at: release.published_at,
      prerelease: release.prerelease,
      draft: release.draft,
      html_url: release.html_url,
      target_commitish: release.target_commitish,
      asset_count: release.assets.length,
      total_bytes: releaseTotalBytes(release),
      local_status: a.status,
      local_bytes: a.archivedBytes,
      retention: retentionOf(release),
      is_latest_published: Boolean(latest && release.tag_name === latest.tag_name),
      assets: a.assets.map((row) => ({
        name: row.asset.name,
        asset_id: row.asset.asset_id,
        size: row.asset.size,
        digest: row.asset.digest,
        sha256: row.asset.sha256,
        content_type: row.asset.content_type,
        browser_download_url: row.asset.browser_download_url,
        download_count: row.asset.download_count,
        local_path: path.join(release.tag_name, path.basename(row.file)).split(path.sep).join('/'),
        local_status: row.status,
        local_sha256: row.actual || null,
      })),
    };
  });
  const index = {
    schema: 'alphasun-release-archive-index/2',
    generated_at: nowIso(),
    repo: repo.owner + '/' + repo.repo,
    api_base: API_BASE,
    authenticated: Boolean(tokenPresent),
    out_dir: outDir,
    retention_policy: '本地只保留最新发布版本的产物；历史版本仅保留发布记录，产物本体见 GitHub Release',
    latest_release: latest ? latest.tag_name : null,
    release_count: rows.length,
    asset_count: rows.reduce((n, r) => n + r.asset_count, 0),
    total_bytes: totalBytes,
    archived_bytes: archivedBytes,
    releases: rows,
  };
  writeJson(path.join(outDir, INDEX_FILE), index);
  return index;
}

/** release 级本地状态的中文标签。 */
const STATUS_LABEL = {
  archived: '已归档',
  not_archived: '仅远端保留',
  mismatch: '校验不符',
  empty: '空发布',
};

/** 单资产状态的中文标签。 */
const ASSET_STATUS_LABEL = {
  archived: '已归档',
  missing: '缺失',
  mismatch: '校验不符',
};

/**
 * 依据资产文件名推断平台 / 类型（用于人类可读的发布版本索引）。
 * @param {string} name 资产名
 * @returns {string} 平台标签
 */
function platformOf(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.apk')) return 'Android';
  if (n.endsWith('.ipa')) return 'iOS';
  if (n.endsWith('.exe') || n.includes('-windows') || n.includes('-win')) return 'Windows';
  if (n.includes('-linux')) return 'Linux';
  if (n.includes('-macos') || n.includes('-darwin') || n.endsWith('.dmg')) return 'macOS';
  if (n.endsWith('.md') || n.endsWith('.txt')) return '文档';
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(n)) return '图片';
  if (/\.(zip|tar|tgz|gz)$/.test(n)) return '压缩包';
  return '其他';
}

/**
 * 生成人类可读的「发布版本索引」Markdown。
 *
 * 这份文档要进 git（长期留存的发布版本记录），因此内容只取自 GitHub Releases
 * 这一**权威且与机器无关**的事实源 —— 不掺入「本地是否已归档」这类每台机器
 * 不同的状态（那部分由 _releases/_index.json 承载）。
 *
 * @param {Array<Object>} releases 归一化后的 release 列表
 * @returns {string} Markdown 文本
 */
/**
 * 生成人类可读的「发布版本索引」Markdown。
 *
 * 这份文档要进 git（长期留存的发布版本记录），因此**必须覆盖全部 release**，
 * 包括 0 资产的空发布与 prerelease 标记 —— 哪怕这些版本的产物按「只保留最新
 * 版本」策略并没有下载到本地。
 *
 * 内容分两类，来源不同：
 *   - 事实（tag / 日期 / 平台 / 资产 / 体积 / sha256 / 下载链接）→ 取自 GitHub
 *     Releases API，与机器无关；
 *   - 本地归档状态 → 取自本机归档实况，随归档工具刷新而更新。
 *
 * @param {Array<Object>} releases 归一化后的 release 列表（全量）
 * @param {Array<Object>} assessments 与 releases 等长的本地状态评估
 * @param {Object|null} latest 最新发布版本（用于标注 ★）
 * @returns {string} Markdown 文本
 */
function buildMarkdown(releases, assessments, latest) {
  const list = assessments || [];
  const statusOf = (i) => (list[i] && list[i].status) || RELEASE_STATUS.NOT_ARCHIVED;
  const totalBytes = releases.reduce((n, r) => n + releaseTotalBytes(r), 0);
  const totalAssets = releases.reduce((n, r) => n + r.assets.length, 0);
  const lines = [];

  lines.push('# 发布版本索引（Published Release Index）');
  lines.push('');
  lines.push('> **本表是仓库内长期留存的「发布版本记录」**：回答「本项目发布过哪些版本、每个版本带哪些');
  lines.push('> 产物、产物多大、到哪里下载」。');
  lines.push('>');
  lines.push('> **口径**：本地归档**只保留最新发布版本**的产物以省磁盘；**全部发布版本记录见本文档**，');
  lines.push('> 产物本体在 GitHub Release 可随时取回。');
  lines.push('>');
  lines.push('> | 要素 | 位置 |');
  lines.push('> | --- | --- |');
  lines.push('> | 产物归档（本地，git 忽略） | `_releases/<tag>/`（默认仅最新发布版本） |');
  lines.push('> | 机器可读全局清单 | `_releases/_index.json`（含全部 release 的 local_status） |');
  lines.push('> | 逐 tag 资产清单（含实算 sha256） | `_releases/<tag>/_manifest.json` |');
  lines.push('> | 本文档的生成命令 | `node tools/sync-releases.js --list --export-md` |');
  lines.push('> | 数据来源 | GitHub Releases API（`net2net2net/alphasun-beihai-climate`） |');
  lines.push('');
  lines.push('> ⚠️ 本页的「下载」链接指向 `github.com` 官方 Release 页面。本机若无法直连 `github.com`');
  lines.push('> （已知 `github.com:443` 长时间不可达，但 `api.github.com` 可用），请改用归档工具经');
  lines.push('> API 通道拉取：`node tools/sync-releases.js --download --only <tag>`。');
  lines.push('');
  lines.push('> 📌 本文件由工具自动生成，**请勿手工编辑**；改动请改工具后重新生成。');
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## 一、总览');
  lines.push('');
  lines.push('共 **' + releases.length + ' 个 release**、**' + totalAssets + ' 个资产**、合计 **' + fmtBytes(totalBytes) + '**（' + totalBytes + ' 字节）。');
  lines.push('');
  lines.push('> ★ = 最新发布版本（本地长期保留该版本产物）；「本地归档」列说明产物当前在不在本机');
  lines.push('> ——它是**文档生成时该机器上的归档实况**，随 `sync-releases.js` 刷新而更新，');
  lines.push('> 与「保留策略」是两回事：策略是长期约定，状态是此刻的快照。');
  lines.push('');
  lines.push('| # | Tag | 发布日期 (UTC) | 平台 | 资产数 | 总体积 | 类型 | 本地归档 | 归档目录 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  releases.forEach((r, i) => {
    const platforms = [];
    for (const a of r.assets) {
      const p = platformOf(a.name);
      if (!platforms.includes(p)) platforms.push(p);
    }
    const type = r.draft ? '草稿' : (r.prerelease ? '**预发布**' : '正式版');
    const isLatest = latest && r.tag_name === latest.tag_name;
    lines.push('| ' + (i + 1) +
      ' | `' + r.tag_name + '`' + (isLatest ? ' ★' : '') +
      ' | ' + fmtDate(r.published_at) +
      ' | ' + (platforms.length ? platforms.join(' / ') : '—') +
      ' | ' + r.assets.length +
      ' | ' + fmtBytes(releaseTotalBytes(r)) +
      ' | ' + type +
      ' | ' + STATUS_LABEL[statusOf(i)] +
      ' | ' + (r.assets.length ? '`_releases/' + r.tag_name + '/`' : '—') + ' |');
  });
  lines.push('');

  lines.push('## 二、逐版本明细');
  lines.push('');
  releases.forEach((r, i) => {
    const type = r.draft ? '草稿（draft = true）' : (r.prerelease ? '**预发布**（prerelease = true）' : '正式版（prerelease = false）');
    const isLatest = latest && r.tag_name === latest.tag_name;
    lines.push('### ' + (i + 1) + '. `' + r.tag_name + '` — ' + (r.name || '') + (isLatest ? '  ★' : ''));
    lines.push('');
    lines.push('- **发布日期**：' + fmtDate(r.published_at) + ' UTC');
    lines.push('- **发布类型**：' + type);
    lines.push('- **保留策略**：' + (isLatest ? '最新发布版本 —— 本地长期保留该版本产物' : '历史版本 —— 仅保留发布记录，产物本体见 GitHub Release'));
    lines.push('- **当前本地状态**：' + STATUS_LABEL[statusOf(i)]);
    lines.push('- **Release 页面**：<' + r.html_url + '>');
    if (r.target_commitish) lines.push('- **目标提交**：`' + r.target_commitish + '`');
    lines.push('- **产物归档**：' + (r.assets.length ? '`_releases/' + r.tag_name + '/`' : '—（无资产）'));
    lines.push('- **资产合计**：' + r.assets.length + ' 个 / ' + fmtBytes(releaseTotalBytes(r)));
    lines.push('');
    if (r.assets.length === 0) {
      lines.push('> **空发布（0 个资产）** —— 该 release 已创建但没有上传任何产物。');
      lines.push('> 保留此条目是为了完整记录发布历史：它同样占用一个版本号，后续版本均由此演进而来。');
      lines.push('');
      lines.push('归档目录 `_releases/' + r.tag_name + '/` ' + (statusOf(i) === RELEASE_STATUS.ARCHIVED ? '仍会生成，内含 `_manifest.json`（`assets: []`）。' : '默认不生成（按「只保留最新版本」策略，该版本产物只存在于远端）。'));
      lines.push('');
      return;
    }
    lines.push('| 资产名 | 平台 | 体积 | sha256（GitHub digest） | 下载次数 | 下载 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const a of r.assets) {
      lines.push('| `' + a.name + '`' +
        ' | ' + platformOf(a.name) +
        ' | ' + fmtBytes(a.size) +
        ' | `' + (a.sha256 || '—') + '`' +
        ' | ' + a.download_count +
        ' | [下载](' + a.browser_download_url + ') |');
    }
    lines.push('');
  });

  lines.push('---');
  lines.push('');
  lines.push('## 三、维护方式');
  lines.push('');
  lines.push('```bash');
  lines.push('# 刷新全局清单（并重新生成本文档）');
  lines.push('node tools/sync-releases.js --list --export-md');
  lines.push('');
  lines.push('# 归档最新发布版本的产物到本地（默认策略，只保留最新版本）');
  lines.push('node tools/sync-releases.js --download');
  lines.push('');
  lines.push('# 只看下载计划，不下载不写盘');
  lines.push('node tools/sync-releases.js --download --dry-run');
  lines.push('');
  lines.push('# 临时补某一个历史版本');
  lines.push('node tools/sync-releases.js --download --only v8.2.0');
  lines.push('');
  lines.push('# 显式归档全部版本');
  lines.push('node tools/sync-releases.js --download --all');
  lines.push('');
  lines.push('# 清理本地非最新版本的归档目录（先列清单，再交互确认）');
  lines.push('node tools/sync-releases.js --prune-older');
  lines.push('');
  lines.push('# 只读校验（GitHub digest / 本地实算 / manifest 三方比对）');
  lines.push('node tools/sync-releases.js --verify');
  lines.push('```');
  lines.push('');
  lines.push('下载的每个资产都会用 GitHub 资产 API 提供的 `digest`（sha256）做完整性校验，');
  lines.push('校验不通过的文件会被改名 `*.corrupt` 隔离并重新下载；已归档且校验通过的文件在');
  lines.push('后续执行中自动跳过，因此中断后可直接重跑续作。');
  lines.push('');
  lines.push('**清理旧版本**：`--prune-older` 会先打印待删目录清单与体积，再要求确认（交互式终端');
  lines.push('询问 y/N；非交互环境需显式加 `--yes`），默认不会删除任何东西。最新发布版本的目录');
  lines.push('与 `_index.json` 永远不会被删。');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

/**
 * 通用前置：解析仓库 / token / 拉取 release / 校验 `--only` / 解析作用范围。
 *
 * 注意：`releases` 始终是**全部** release。`_index.json` 是全局归档清单，必须覆盖
 * 全部 release —— 否则用 `--only` 下载一次就会把索引截断成只剩一个 tag，
 * 全局状态从此失真。因此索引永远基于 `releases` 构建，`--only` 只影响
 * 「本次要处理哪些 release」。
 *
 * @returns {Promise<{repo: Object, token: string|null, outDir: string,
 *                    releases: Array<Object>, scope: Array<Object>,
 *                    targets: Array<Object>, latest: Object|null, policyLabel: string}>}
 */
async function prepare(opts) {
  const repo = resolveRepo(opts.repo);
  const token = resolveToken();
  const outDir = path.resolve(opts.out || path.join(ROOT, ARCHIVE_DIR_NAME));
  const raw = await fetchReleases(token, repo);
  const releases = raw.map(normalizeRelease);

  if (opts.only && opts.only.length) {
    const missing = opts.only.filter((t) => !releases.some((r) => r.tag_name === t));
    if (missing.length) {
      const available = releases.map((r) => r.tag_name).join(', ');
      throw new Error('未找到 tag：' + missing.join(', ') + '；可用 tag：' + available);
    }
  }

  const resolved = resolveScope(releases, opts);
  return {
    repo: repo,
    token: token,
    outDir: outDir,
    releases: releases,
    only: (opts && opts.only) || [],
    scope: resolved.scope,
    targets: resolved.targets,
    latest: resolved.latest,
    policyLabel: resolved.policyLabel,
    retentionOf: resolved.retentionOf,
  };
}

/**
 * `--list`：列出全部 release 与本地归档状态，并刷新 `_index.json`。
 */
async function runList(opts) {
  const ctx = await prepare(opts);
  console.log('=== AlphaSun GitHub Release 产物 · 归档清单 ===');
  console.log('仓库      ： ' + ctx.repo.owner + '/' + ctx.repo.repo);
  console.log('归档目录  ： ' + ctx.outDir);
  console.log('数据源    ： ' + API_BASE + (ctx.token ? '（已认证）' : '（匿名，限流 60 次/小时）'));
  console.log('保留策略  ： 本地只保留最新发布版本（' + (ctx.latest ? ctx.latest.tag_name : '—') +
    '）的产物；历史版本仅保留发布记录，产物本体见 GitHub Release');
  console.log('');

  // 评估**全部** release —— `_index.json` 必须反映整个归档的真实状态
  const assessments = [];
  for (const release of ctx.releases) {
    assessments.push(await assessRelease(release, ctx.outDir, { quick: Boolean(opts.quick) }));
  }
  // 展示区只列本次作用域内的 release（`--only` 生效时只含指定 tag），索引仍是全量
  const display = [];
  for (const release of ctx.scope) {
    const i = ctx.releases.indexOf(release);
    display.push({ release: release, assessment: assessments[i] });
  }

  const pad = padText;

  console.log(pad('#', 3) + pad('TAG', 26) + pad('发布日期', 21) + pad('预发布', 9) + pad('资产', 7) + pad('总体积', 13) + '本地状态');
  for (let i = 0; i < display.length; i++) {
    const r = display[i].release;
    const a = display[i].assessment;
    const isLatest = ctx.latest && r.tag_name === ctx.latest.tag_name;
    console.log(
      pad(i + 1, 3) +
      pad(r.tag_name + (isLatest ? ' ★最新' : '') + (r.draft ? ' [draft]' : ''), 26) +
      pad(fmtDate(r.published_at), 21) +
      pad(r.prerelease ? '是' : '否', 9) +
      pad(String(r.assets.length), 7) +
      pad(fmtBytes(releaseTotalBytes(r)), 13) +
      STATUS_LABEL[a.status],
    );
  }

  console.log('\n--- 资产明细 ---');
  for (const item of display) {
    const r = item.release;
    const a = item.assessment;
    console.log('\n[' + r.tag_name + '] ' + r.name + (r.prerelease ? '  （预发布 prerelease=true）' : '') + (r.draft ? '  （草稿 draft=true）' : ''));
    if (r.assets.length === 0) {
      console.log('  （空发布：该 release 没有上传任何资产）');
      continue;
    }
    for (const row of a.assets) {
      console.log(
        '  ' + pad(ASSET_STATUS_LABEL[row.status], 12) +
        pad(fmtBytes(row.asset.size), 12) +
        pad(row.asset.name, 46) +
        'sha256:' + (row.asset.sha256 ? row.asset.sha256.slice(0, 16) + '…' : '（GitHub 未提供）') +
        (row.reason ? '  ← ' + row.reason : ''),
      );
    }
  }

  const index = writeIndex(ctx.releases, assessments, ctx.outDir, ctx.repo, ctx.token, {
    retentionOf: ctx.retentionOf,
    latest: ctx.latest,
  });
  const archived = index.releases.filter((r) => r.local_status === 'archived').length;
  const remoteOnly = index.releases.filter((r) => r.local_status === 'not_archived').length;
  console.log('\n--- 汇总（全量 release，' + index.release_count + ' 个）---');
  console.log('release 数：' + index.release_count + '　资产数：' + index.asset_count +
    '　总体积：' + fmtBytes(index.total_bytes) + '　已归档体积：' + fmtBytes(index.archived_bytes));
  console.log('本地已归档 ' + archived + ' 个（最新版本：' + (ctx.latest ? ctx.latest.tag_name : '—') +
    '）　仅远端保留 ' + remoteOnly + ' 个；索引已写入 ' + path.join(ctx.outDir, INDEX_FILE));

  // 导出人类可读的发布版本索引（始终基于**全量** release，不受 --only 影响）
  if (opts.exportMd) {
    const target = typeof opts.exportMd === 'string'
      ? path.resolve(opts.exportMd)
      : path.join(ROOT, 'knowledge-base', '发布版本索引.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buildMarkdown(ctx.releases, assessments, ctx.latest), 'utf8');
    console.log('发布版本索引已生成：' + target);
  }
  return { index: index, assessments: assessments };
}

/**
 * `--download`：下载全部缺失资产。
 * 已有且校验通过的文件会被跳过（幂等）；校验不通过的会被改名 `*.corrupt` 后重下。
 */
async function runDownload(opts) {
  const ctx = await prepare(opts);
  console.log('=== AlphaSun GitHub Release 产物 · 下载归档 ===');
  console.log('仓库      ： ' + ctx.repo.owner + '/' + ctx.repo.repo);
  console.log('归档目录  ： ' + ctx.outDir);
  console.log('数据源    ： ' + API_BASE + (ctx.token ? '（已认证）' : '（匿名，限流 60 次/小时）'));
  console.log('并发数    ： ' + opts.concurrency);
  console.log('归档策略  ： ' + ctx.policyLabel);
  if (!ctx.token) {
    console.log('⚠ 未取到 GitHub token（环境变量 GITHUB_TOKEN / gh auth token 均不可用），');
    console.log('  将尝试匿名访问。公开仓库通常可用，但 API 限流 60 次/小时，且私有仓库会 404。');
  }
  console.log('');

  // 试运行：不下载、不建目录、不写任何文件，只打印将要做什么
  if (opts.dryRun) {
    console.log('--- 试运行（--dry-run）：以下只是计划，不做任何下载、不写任何文件 ---');
    let planBytes = 0;
    let planAssets = 0;
    for (const release of ctx.targets) {
      const bytes = releaseTotalBytes(release);
      planBytes += bytes;
      planAssets += release.assets.length;
      const isLatest = ctx.latest && release.tag_name === ctx.latest.tag_name;
      console.log('\n[' + release.tag_name + ']' + (isLatest ? '  ★最新发布版本' : '') + '  ' + release.name);
      if (release.assets.length === 0) {
        console.log('  （空发布：0 个资产）');
        continue;
      }
      for (const a of release.assets) {
        console.log('  · ' + padText(a.name, 46) + padText(fmtBytes(a.size), 12) + 'sha256:' + (a.sha256 || '—').slice(0, 16) + '…');
      }
    }
    console.log('\n合计：' + ctx.targets.length + ' 个 release / ' + planAssets + ' 个资产 / ' + fmtBytes(planBytes));
    const latestTag = ctx.latest ? ctx.latest.tag_name : null;
    if (!latestTag || !ctx.targets.some((r) => r.tag_name === latestTag)) {
      console.log('（无可归档的最新版本）');
    }
    const otherCount = ctx.releases.length - ctx.targets.length;
    if (otherCount > 0) {
      console.log('注意：本次不归档的 ' + otherCount + ' 个 release 按策略不产生本地目录，仅保留发布记录。');
    } else {
      console.log('注意：本次归档全部 ' + ctx.targets.length + ' 个 release（显式 --all）。');
    }
    return { dryRun: true, targets: ctx.targets };
  }

  fs.mkdirSync(ctx.outDir, { recursive: true });

  const progress = makeProgressRenderer();
  const downloadedAt = new Map(); // assetId -> 首次归档时间（跨轮次保留）

  // 先做一轮「跳过已归档」的判定，避免把已存在的文件重复下载。
  const assessments = [];
  for (const release of ctx.releases) {
    const a = await assessRelease(release, ctx.outDir, { quick: false });
    assessments.push(a);
    // 读取既有 manifest，保留历史 downloaded_at
    const old = readJsonSafe(path.join(ctx.outDir, release.tag_name, MANIFEST_FILE));
    if (old && Array.isArray(old.assets)) {
      for (const a2 of old.assets) {
        if (a2 && a2.asset_id && a2.downloaded_at) downloadedAt.set(a2.asset_id, a2.downloaded_at);
      }
    }
  }

  // 组装下载任务：只处理本次归档目标（默认仅最新发布版本；索引仍覆盖全量）
  const tasks = [];
  for (const release of ctx.targets) {
    const i = ctx.releases.indexOf(release);
    const a = assessments[i];
    for (const row of a.assets) {
      if (row.status === ASSET_STATUS.ARCHIVED) continue;
      tasks.push({ release: release, row: row, releaseIndex: i });
    }
  }

  let skipped = 0;
  let okCount = 0;
  let failCount = 0;
  const failures = [];
  const corruptFiles = [];

  for (const release of ctx.targets) {
    const i = ctx.releases.indexOf(release);
    for (const row of assessments[i].assets) {
      if (row.status === ASSET_STATUS.ARCHIVED) skipped++;
    }
  }

  console.log('待下载资产：' + tasks.length + ' 个；已归档跳过：' + skipped + ' 个\n');

  await pool(tasks, opts.concurrency, async (task) => {
    const { release, row } = task;
    const asset = row.asset;
    const tagDir = path.join(ctx.outDir, release.tag_name);
    fs.mkdirSync(tagDir, { recursive: true });
    const dest = path.join(tagDir, safeFileName(asset.name));

    // 校验不通过的旧文件：改名隔离，绝不静默保留，也不直接删除
    if (row.status === ASSET_STATUS.MISMATCH && fs.existsSync(dest)) {
      const q = quarantineFile(dest);
      corruptFiles.push({ file: dest, quarantined: q, reason: row.reason });
      console.log('  ⚠ 校验不符，已隔离：' + path.basename(dest) + (q ? ' → ' + path.basename(q) : '（隔离失败）') +
        '　' + (row.reason || ''));
    }

    const started = Date.now();
    const res = await downloadAsset(asset, dest, {
      token: ctx.token,
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      maxAttempts: MAX_ATTEMPTS,
      backoffBaseMs: BACKOFF_BASE_MS,
      onRetry: (a, attempt, err, wait) => {
        console.log('  ↻ 重试 ' + a.name + '（第 ' + attempt + ' 次失败：' + err + '，' + Math.round(wait / 1000) + 's 后重试）');
      },
      onProgress: (a, written, total) => {
        const pct = total ? Math.floor((written / total) * 100) : 0;
        progress.update('  ↓ ' + a.name + '  ' + fmtBytes(written) + ' / ' + fmtBytes(total) + '  ' + pct + '%');
      },
    });
    progress.clear();

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (res.ok) {
      okCount++;
      if (!downloadedAt.has(asset.asset_id)) downloadedAt.set(asset.asset_id, nowIso());
      row.status = ASSET_STATUS.ARCHIVED;
      row.actual = res.sha256;
      row.bytes = res.bytes;
      row.reason = '';
      console.log('  ✓ ' + release.tag_name + '/' + asset.name + '　' + fmtBytes(res.bytes) + '　' + secs + 's　sha256 ' + res.sha256.slice(0, 16) + '…');
      return true;
    }
    failCount++;
    failures.push({ tag: release.tag_name, name: asset.name, error: res.error });
    console.log('  ✗ ' + release.tag_name + '/' + asset.name + '　失败（重试 ' + res.attempts + ' 次）：' + res.error);
    return false;
  });

  // 重新评估并落盘 manifest / index
  // manifest 只为**本次归档目标**的 release 落盘 —— 未归档的历史版本不产生本地目录
  const finalAssessments = [];
  for (const release of ctx.releases) {
    finalAssessments.push(await assessRelease(release, ctx.outDir, { quick: false }));
  }
  for (const release of ctx.targets) {
    const i = ctx.releases.indexOf(release);
    writeManifest(release, finalAssessments[i].assets, ctx.outDir, { downloadedAt: downloadedAt });
  }
  const index = writeIndex(ctx.releases, finalAssessments, ctx.outDir, ctx.repo, ctx.token, {
    retentionOf: ctx.retentionOf,
    latest: ctx.latest,
  });

  console.log('\n--- 下载汇总 ---');
  console.log('归档策略：' + ctx.policyLabel);
  console.log('成功 ' + okCount + '　失败 ' + failCount + '　跳过（已归档）' + skipped);
  if (corruptFiles.length) {
    console.log('隔离的损坏文件 ' + corruptFiles.length + ' 个：');
    for (const c of corruptFiles) {
      console.log('  · ' + path.basename(c.file) + '　' + c.reason + (c.quarantined ? '　→ ' + path.basename(c.quarantined) : '　（隔离失败，文件仍在原处）'));
    }
  }
  if (failures.length) {
    console.log('失败明细：');
    for (const f of failures) console.log('  · ' + f.tag + '/' + f.name + '　' + f.error);
  }
  const archived = index.releases.filter((r) => r.local_status === 'archived').length;
  const remoteOnly = index.releases.filter((r) => r.local_status === 'not_archived').length;
  console.log('本地已归档 ' + archived + ' 个 release（' + fmtBytes(index.archived_bytes) + '）　仅远端保留 ' + remoteOnly + ' 个');
  console.log('索引：' + path.join(ctx.outDir, INDEX_FILE));
  if (failCount) process.exitCode = 1;
  return { index: index, failures: failures };
}

/**
 * `--verify`：只读校验。对本地已下载文件重算 sha256，与 GitHub 的 `digest`
 * 以及本地 manifest 做三方比对。**不写任何文件、不删任何文件。**
 */
async function runVerify(opts) {
  const ctx = await prepare(opts);
  console.log('=== AlphaSun GitHub Release 产物 · 只读校验（GitHub digest / 本地实算 / manifest 三方比对）===');
  console.log('仓库      ： ' + ctx.repo.owner + '/' + ctx.repo.repo);
  console.log('归档目录  ： ' + ctx.outDir);
  console.log('保留策略  ： 本地只保留最新发布版本（' + (ctx.latest ? ctx.latest.tag_name : '—') +
    '）的产物；历史版本未归档属预期，不计为异常');
  console.log('');

  let total = 0;
  let okN = 0;
  let mismatchN = 0;
  let missingN = 0;
  let manifestDrift = 0;
  let skippedN = 0;
  const problems = [];

  for (const release of ctx.scope) {
    const tagDir = path.join(ctx.outDir, release.tag_name);
    const manifest = readJsonSafe(path.join(tagDir, MANIFEST_FILE));
    const manifestById = new Map();
    if (manifest && Array.isArray(manifest.assets)) {
      for (const m of manifest.assets) if (m && m.asset_id) manifestById.set(m.asset_id, m);
    }
    const isLatest = Boolean(ctx.latest && release.tag_name === ctx.latest.tag_name);

    console.log('\n[' + release.tag_name + '] ' + (release.name || '') + (isLatest ? '  ★最新发布版本' : ''));
    if (release.assets.length === 0) {
      console.log('  ✓ 空发布（0 个资产）—— 与 GitHub 记录一致');
      continue;
    }

    // 该 release 在本地一个资产文件都没有，且不是最新版本 →
    // 按「只保留最新版本」策略本就应当只存在于远端，属预期状态，不计为异常。
    const localPresent = release.assets.some((a) => fs.existsSync(path.join(tagDir, safeFileName(a.name))));
    if (!localPresent && !isLatest) {
      skippedN += release.assets.length;
      console.log('  – 本地未归档（按「只保留最新版本」策略，仅远端保留）　跳过 ' + release.assets.length + ' 个资产的校验');
      continue;
    }
    if (!manifest) {
      console.log('  ! 缺少 _manifest.json（该 release 从未归档过）');
    }

    for (const asset of release.assets) {
      total++;
      const file = path.join(tagDir, safeFileName(asset.name));
      const m = manifestById.get(asset.asset_id) || null;

      if (!fs.existsSync(file)) {
        missingN++;
        console.log('  ✗ ' + asset.name + '　本地缺失' + (m ? '' : '　（manifest 也无记录）'));
        problems.push({ tag: release.tag_name, name: asset.name, issue: '本地缺失' });
        continue;
      }
      const actual = await sha256File(file);
      const expect = asset.sha256;

      const digestOk = expect ? actual === expect : null;
      const manifestOk = !m ? null : (m.sha256 || m.local_sha256 ? (m.sha256 || m.local_sha256) === actual : null);

      if (digestOk === false) {
        mismatchN++;
        console.log('  ✗ ' + asset.name + '　GitHub digest 不符　期望 ' + expect.slice(0, 16) + '…　本地实算 ' + actual.slice(0, 16) + '…');
        problems.push({ tag: release.tag_name, name: asset.name, issue: 'sha256 与 GitHub digest 不符' });
      } else if (manifestOk === false) {
        manifestDrift++;
        console.log('  ✗ ' + asset.name + '　manifest 记录与本地实算不符　manifest ' + String((m.sha256 || m.local_sha256)).slice(0, 16) + '…　本地实算 ' + actual.slice(0, 16) + '…');
        problems.push({ tag: release.tag_name, name: asset.name, issue: 'manifest 记录与本地实算不符' });
      } else {
        okN++;
        const tag = digestOk === null ? '（GitHub 无 digest，仅比大小/manifest）' : '✓';
        console.log('  ✓ ' + asset.name + '　' + tag +
          (expect ? '　GitHub digest ✓　本地实算 ✓　' : '　') +
          (m ? 'manifest ✓' : 'manifest —（无记录）'));
      }
    }
  }

  console.log('\n--- 校验汇总 ---');
  console.log('参与校验的资产 ' + total + '　通过 ' + okN + '　sha256 不符 ' + mismatchN +
    '　本地缺失 ' + missingN + '　manifest 漂移 ' + manifestDrift +
    '　按策略跳过（仅远端保留）' + skippedN);
  if (problems.length) {
    console.log('问题清单：');
    for (const p of problems) console.log('  · ' + p.tag + '/' + p.name + '　' + p.issue);
    console.log('修复方式：node tools/sync-releases.js --download --only ' + [...new Set(problems.map((p) => p.tag))].join(' --only '));
    process.exitCode = 1;
  } else {
    console.log('全部一致，无异常。');
  }
  return { total: total, ok: okN, mismatch: mismatchN, missing: missingN, skipped: skippedN, problems: problems };
}

/**
 * 递归计算目录占用字节数（删除前给用户看体积用）。
 * @param {string} dir 目录绝对路径
 * @returns {number} 字节数
 */
function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      total += dirSize(p);
    } else {
      try { total += fs.statSync(p).size; } catch (e) { /* 文件可能已被并发删除，忽略 */ }
    }
  }
  return total;
}

/**
 * 交互式询问 yes/no。非交互终端下调用方不应走到这里。
 * @param {string} question 提示语
 * @returns {Promise<boolean>}
 */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

/**
 * 判断一个目录是否是「本工具管理的、以 release tag 命名的归档目录」。
 *
 * 判定依据（满足其一即可）：
 *   1) 目录内含 `_manifest.json`，且其中的 `tag_name` 与目录名一致
 *      —— 这是本工具写下的凭证；同时天然覆盖了「远端已删除的 release」
 *         所遗留的孤儿目录（它同样带 manifest）；
 *   2) 目录名是当前从 GitHub API 拉到的某个 release 的 tag
 *      —— 兼容 manifest 尚未写出的半成品目录。
 *
 * 两者都不满足 → 视为「非本工具管理的目录」，**跳过不删**。
 *
 * @param {string} dirPath 目录绝对路径
 * @param {string} dirName 目录名
 * @param {Set<string>} knownTags 远端已知的 release tag 集合
 * @returns {boolean}
 */
function isManagedReleaseDir(dirPath, dirName, knownTags) {
  const manifest = readJsonSafe(path.join(dirPath, MANIFEST_FILE));
  if (manifest && manifest.tag_name && manifest.tag_name === dirName) return true;
  if (knownTags && knownTags.has(dirName)) return true;
  return false;
}

/**
 * `--prune-older`：清理本地 `_releases/` 下**非最新发布版本**的目录。
 *
 * 安全约束（不可放宽）：
 *   1. 默认**不执行删除** —— 必须先把完整待删清单与体积打印出来；
 *   2. 必须显式确认 —— 交互式终端下询问 y/N；非交互环境必须加 `--yes` 才动手；
 *   3. 最新发布版本的目录与根目录下的 `_index.json` 永不删除；
 *   4. **只删「本工具管理的、以 release tag 命名的目录」**（见 isManagedReleaseDir），
 *      其它目录一律跳过并在清单中说明；
 *   5. **路径守卫** —— 每个删除目标都必须是归档根目录的**直接子目录**，
 *      解析后越界的路径一律拒绝并报错，绝不触碰仓库其它路径。
 */
async function runPruneOlder(opts) {
  const ctx = await prepare(opts);
  const latest = ctx.latest;
  const outDir = ctx.outDir;
  const outRoot = path.resolve(outDir);
  const knownTags = new Set(ctx.releases.map((r) => r.tag_name));

  console.log('=== 清理本地旧版本归档（--prune-older）===');
  console.log('归档目录  ： ' + outRoot);
  console.log('保留版本  ： ' + (latest ? latest.tag_name + '（最新发布版本）' : '—（无可用版本）'));
  console.log('');

  let entries = [];
  try { entries = fs.readdirSync(outRoot, { withFileTypes: true }); } catch (e) { entries = []; }
  const dirs = entries.filter((e) => e.isDirectory());
  const victims = [];
  const skipped = [];
  for (const d of dirs) {
    if (latest && d.name === latest.tag_name) continue; // 最新发布版本永不删除
    const target = path.resolve(path.join(outRoot, d.name));
    // 路径守卫：必须是归档根目录的直接子目录，越界即拒绝
    if (path.dirname(target) !== outRoot) {
      throw new Error('拒绝删除：目标不在归档根目录内 → ' + target);
    }
    if (!isManagedReleaseDir(target, d.name, knownTags)) {
      skipped.push({
        name: d.name,
        path: target,
        reason: '非本工具管理的目录（无 release manifest，且 tag 名不在远端 release 列表中）',
      });
      continue;
    }
    victims.push({ name: d.name, path: target, bytes: dirSize(target) });
  }
  victims.sort((a, b) => b.bytes - a.bytes);

  if (!victims.length) {
    console.log('本地除最新版本外没有其它「本工具管理的」归档目录，无需清理。');
    if (skipped.length) {
      console.log('（以下目录不属于本工具管理，已跳过，未做任何改动）:');
      for (const s of skipped) console.log('  · ' + s.name + '　' + s.reason);
    }
    console.log('（最新版本目录：' + (latest ? path.join(outRoot, latest.tag_name) : '—') + '）');
    return { removed: [], victims: [], skipped: skipped };
  }

  console.log('--- 将要删除以下 ' + victims.length + ' 个目录（非最新发布版本）---');
  for (const v of victims) {
    console.log('  · ' + padText(v.name, 28) + padText(fmtBytes(v.bytes), 12) + v.path);
  }
  const totalBytes = victims.reduce((n, v) => n + v.bytes, 0);
  console.log('合计：' + victims.length + ' 个目录 / ' + fmtBytes(totalBytes));
  if (skipped.length) {
    console.log('');
    console.log('以下 ' + skipped.length + ' 个目录**不属于本工具管理**，已跳过、不会删除：');
    for (const s of skipped) console.log('  · ' + s.name + '　' + s.reason);
  }
  console.log('');

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.error('非交互环境：默认不执行删除。请核对上面的清单后加 --yes 重跑，或改用交互终端。');
      process.exitCode = 2;
      return { removed: [], victims: victims, skipped: skipped };
    }
    const confirmed = await askYesNo('确认删除以上 ' + victims.length + ' 个目录？（y/N）');
    if (!confirmed) {
      console.log('已取消，未删除任何文件。');
      return { removed: [], victims: victims, skipped: skipped, cancelled: true };
    }
  }

  const removed = [];
  const failed = [];
  for (const v of victims) {
    // 删除前再校验一次路径守卫（纵深防御）
    const resolved = path.resolve(v.path);
    if (path.dirname(resolved) !== outRoot) {
      failed.push({ dir: v.name, error: '拒绝删除：目标不在归档根目录内 → ' + resolved });
      continue;
    }
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      removed.push(v);
    } catch (e) {
      failed.push({ dir: v.name, error: e.message });
    }
  }
  console.log('\n已删除 ' + removed.length + ' 个目录，释放 ' + fmtBytes(removed.reduce((n, v) => n + v.bytes, 0)));
  if (failed.length) {
    for (const f of failed) console.log('  ✗ ' + f.dir + '　' + f.error);
    process.exitCode = 1;
  }

  // 刷新索引，使 local_status 与清理后的实际状态一致
  const assessments = [];
  for (const release of ctx.releases) {
    assessments.push(await assessRelease(release, outRoot, { quick: false }));
  }
  writeIndex(ctx.releases, assessments, outRoot, ctx.repo, ctx.token, {
    retentionOf: ctx.retentionOf,
    latest: ctx.latest,
  });
  console.log('索引已刷新：' + path.join(outRoot, INDEX_FILE));
  return { removed: removed, victims: victims, skipped: skipped, failed: failed };
}

// ---------------------------------------------------------------------------
// 命令行参数
// ---------------------------------------------------------------------------

/** 参数解析错误。 */
class UsageError extends Error {}

/**
 * 解析布尔型开关的取值：接受 true/false/1/0/yes/no（不区分大小写）。
 * 其它值一律视为 true（`--all=whatever` 仍是"打开"的意思，避免误判成关闭）。
 * @param {string} raw 开关值
 * @returns {boolean}
 */
function parseBoolFlag(raw) {
  const v = String(raw).trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return true;
}

/**
 * 解析命令行参数。
 * @param {Array<string>} argv 不含 node 与脚本路径的参数数组
 */
function parseArgs(argv) {
  const opts = {
    mode: null,
    only: [],
    out: null,
    concurrency: DEFAULT_CONCURRENCY,
    repo: null,
    quick: false,
    exportMd: false,
    all: false,
    dryRun: false,
    yes: false,
    help: false,
  };
  const need = (i, flag) => {
    const v = argv[i];
    if (v === undefined || String(v).startsWith('--')) {
      throw new UsageError(flag + ' 需要一个参数值');
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.mode = 'list';
    else if (a === '--download') opts.mode = 'download';
    else if (a === '--verify') opts.mode = 'verify';
    else if (a === '--prune-older') opts.mode = 'prune-older';
    else if (a === '--all') opts.all = true;
    else if (a.startsWith('--all=')) opts.all = parseBoolFlag(a.slice('--all='.length));
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--dry-run=')) opts.dryRun = parseBoolFlag(a.slice('--dry-run='.length));
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a.startsWith('--yes=')) opts.yes = parseBoolFlag(a.slice('--yes='.length));
    else if (a === '--only') opts.only.push(need(++i, '--only'));
    else if (a.startsWith('--only=')) opts.only.push(a.slice('--only='.length));
    else if (a === '--out') opts.out = need(++i, '--out');
    else if (a.startsWith('--out=')) opts.out = a.slice('--out='.length);
    else if (a === '--concurrency') opts.concurrency = parseInt(need(++i, '--concurrency'), 10);
    else if (a.startsWith('--concurrency=')) opts.concurrency = parseInt(a.slice('--concurrency='.length), 10);
    else if (a === '--repo') opts.repo = need(++i, '--repo');
    else if (a.startsWith('--repo=')) opts.repo = a.slice('--repo='.length);
    else if (a === '--quick') opts.quick = true;
    else if (a === '--export-md') {
      // 可选值：紧跟一个非 `--` 开头的参数时视为输出路径，否则用默认路径
      const next = argv[i + 1];
      if (next !== undefined && !String(next).startsWith('--')) { opts.exportMd = next; i++; }
      else opts.exportMd = true;
    }
    else if (a.startsWith('--export-md=')) opts.exportMd = a.slice('--export-md='.length);
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new UsageError('未知参数：' + a);
  }
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) opts.concurrency = DEFAULT_CONCURRENCY;
  opts.concurrency = Math.min(opts.concurrency, 16);
  return opts;
}

/** 打印用法说明。 */
function printUsage() {
  console.log([
    'AlphaSun GitHub Release 产物本地归档工具',
    '',
    '用法：node tools/sync-releases.js <动作> [选项]',
    '',
    '保留策略：--download 默认只归档「最新发布版本」的产物（published_at 最新且非草稿）；',
    '          历史版本仅保留发布记录，产物本体见 GitHub Release；',
    '          如需全部归档请显式加 --all。',
    '          （当前最新版本以 --list 输出为准）',
    '',
    '动作（必选其一）：',
    '  --list                 列出全部 release 及本地归档状态，并刷新 _index.json',
    '  --download             下载缺失资产（默认只归档最新发布版本）',
    '  --verify               只读校验：GitHub digest / 本地实算 / manifest 三方比对',
    '  --prune-older          清理本地非最新版本的归档目录（默认不删，先列清单再确认）',
    '',
    '选项：',
    '  --only <tag>           只处理指定 tag（可重复：--only v8.3 --only v8.2.0）',
    '                         临时补某一个历史版本用；可与 --all 同用',
    '  --all                  显式归档**全部** release（默认关闭）',
    '  --dry-run              只打印下载计划，不下载、不写任何文件',
    '  --yes, -y              --prune-older 跳过交互确认直接执行（非交互环境必需）',
    '  --out <dir>            归档根目录（默认 <仓库根>/' + ARCHIVE_DIR_NAME + '）',
    '  --concurrency <n>      并发下载数（默认 ' + DEFAULT_CONCURRENCY + '，上限 16）',
    '  --repo <owner/name>    指定仓库（默认从 git remote origin 推断）',
    '  --quick                --list 时只比文件大小、不算 sha256（更快但更弱）',
    '  --export-md [file]     额外生成人类可读的发布版本索引 Markdown',
    '                         （默认写入 <仓库根>/knowledge-base/发布版本索引.md）',
    '  -h, --help             显示本帮助',
    '',
    '示例：',
    '  node tools/sync-releases.js --download                 # 只归档最新版本',
    '  node tools/sync-releases.js --download --all           # 归档全部版本',
    '  node tools/sync-releases.js --download --only v8.2.0   # 临时补一个历史版本',
    '  node tools/sync-releases.js --download --dry-run       # 只看计划不下载',
    '  node tools/sync-releases.js --prune-older              # 清理旧版本（交互确认）',
    '  node tools/sync-releases.js --prune-older --yes        # 清理旧版本（跳过确认）',
    '',
    '环境变量：',
    '  GITHUB_TOKEN           GitHub token（缺省时回退到 `gh auth token`）',
    '  GITHUB_REPOSITORY      仓库 owner/name（缺省时从 git remote 推断）',
    '  GITHUB_API_URL         API 根地址（默认 https://api.github.com）',
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('参数错误：' + e.message);
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    printUsage();
    return;
  }
  if (!opts.mode) {
    console.error('必须指定一个动作：--list / --download / --verify / --prune-older');
    printUsage();
    process.exitCode = 2;
    return;
  }
  try {
    if (opts.mode === 'list') await runList(opts);
    else if (opts.mode === 'download') await runDownload(opts);
    else if (opts.mode === 'verify') await runVerify(opts);
    else if (opts.mode === 'prune-older') await runPruneOlder(opts);
  } catch (e) {
    console.error('\n执行失败：' + ((e && e.message) || e));
    if (process.env.SYNC_RELEASES_DEBUG) console.error(e && e.stack);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  printUsage,
  resolveRepo,
  resolveToken,
  fetchReleases,
  normalizeRelease,
  latestRelease,
  resolveScope,
  assessRelease,
  downloadAsset,
  sha256File,
  safeFileName,
  extractDigest,
  dirSize,
  isManagedReleaseDir,
  writeManifest,
  writeIndex,
  buildMarkdown,
  platformOf,
  runList,
  runDownload,
  runVerify,
  runPruneOlder,
  ARCHIVE_DIR_NAME,
  INDEX_FILE,
  MANIFEST_FILE,
  RELEASE_STATUS,
};
