// AlphaSun · NMDIS 接口访问层（含 DNS 兜底）
// ---------------------------------------------------------------------------
// 为什么需要这一层：
//   部分国内 DNS（如 114DNS）会把 service-tide.nmdis.org.cn 解析为 NXDOMAIN，
//   而 8.8.8.8 / 阿里 DoH 能正常解析出 A 记录（实测 221.239.0.155）。
//   若直接用 fetch，一旦本机 DNS 抽风，潮汐模块会「静默降级为演示模型」，
//   用户即便配好了 NMDIS 凭证也看不到权威预报，且毫无提示 —— 极难排查。
//
// 本模块的处理：
//   1) 优先走标准 DNS + fetch；
//   2) 若报 ENOTFOUND / EAI_AGAIN（DNS 解析失败），改用 DoH（阿里 / 腾讯，国内可达）
//      解析出 IP，再用 http.request 直连该 IP 并显式带 Host 头（SNI/Host 保持原域名）；
//   3) 仍失败则返回 null，由上层降级，并打印可诊断的日志。
//
// 注意：NMDIS 接口为明文 HTTP（service-tide.nmdis.org.cn:8080），故 Host 头覆盖安全可行；
//       若将来切换到 HTTPS，则需改用自定义 lookup 的 undici dispatcher，不可直连 IP。

'use strict';
const http = require('http');

// DoH 解析器（按顺序尝试，均为国内可达）
const DOH_RESOLVERS = [
  'https://dns.alidns.com/resolve',  // 阿里公共 DNS
  'https://doh.pub/resolve',          // 腾讯 DNSPod
];

const DNS_ERRORS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'EAI_NONAME']);

/** 取错误码（fetch 失败时错误在 e.cause.code） */
function errCode(e) {
  if (!e) return '';
  const c = e.cause && (e.cause.code || e.cause.code);
  if (c) return String(c);
  if (e.code) return String(e.code);
  const m = String(e.message || '').match(/getaddrinfo\s+(\S+)/);
  return m ? m[1] : '';
}

/** 通过 DoH 解析 A 记录 */
async function dohResolve(hostname, timeoutMs = 8000) {
  for (const base of DOH_RESOLVERS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const url = `${base}?name=${encodeURIComponent(hostname)}&type=A`;
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/dns-json' } });
      if (!res.ok) continue;
      const j = await res.json().catch(() => null);
      if (!j || !Array.isArray(j.Answer)) continue;
      const ips = j.Answer.filter(a => a && a.type === 1 && a.data).map(a => String(a.data));
      if (ips.length) return ips;
    } catch (e) {
      /* 试下一个解析器 */
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

/** 直连 IP 的 POST（显式 Host 头，NMDIS 为明文 HTTP 故可行） */
function postViaIp(ip, hostname, port, pathAndQuery, headers, bodyStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: ip,
      port,
      path: pathAndQuery,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers, { Host: hostname }),
      timeout: timeoutMs,
    }, res => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: d }));
    });
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.on('error', reject);
    try { req.end(bodyStr || ''); } catch (e) { reject(e); }
  });
}

/**
 * POST JSON 到 NMDIS，自动处理 DNS 解析失败。
 * @param {string} origin      如 http://service-tide.nmdis.org.cn:8080
 * @param {string} pathAndQuery 如 /api/v1/CoreData/GetPortTideData?SiteCode=..&Date=..
 * @param {object} headers     认证头 { appid, appsecret }
 * @param {object} bodyObj     请求体（通常为空对象）
 * @param {number} timeoutMs
 * @returns {Promise<{status:number,text:string}|null>} null 表示彻底失败
 */
async function postNmdis(origin, pathAndQuery, headers, bodyObj, timeoutMs = 8000) {
  const bodyStr = JSON.stringify(bodyObj || {});
  const url = origin + pathAndQuery;
  let dnsFallbackUsed = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: bodyStr,
        signal: ctrl.signal,
      });
      const text = await res.text();
      return { status: res.status, text, viaIp: false };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (!DNS_ERRORS.has(errCode(e))) throw e; // 非 DNS 错误（如超时）直接上抛
    dnsFallbackUsed = true;
  }

  // DNS 兜底：DoH 解析 → 直连 IP
  const u = new URL(origin);
  const ips = await dohResolve(u.hostname);
  if (!ips.length) {
    const err = new Error(`DNS 解析失败且 DoH 兜底无结果（${u.hostname}）`);
    err.cause = { code: 'ENOTFOUND' };
    throw err;
  }
  let lastErr = null;
  for (const ip of ips) {
    try {
      const r = await postViaIp(ip, u.hostname, u.port || 80, pathAndQuery, headers, bodyStr, timeoutMs);
      if (dnsFallbackUsed) {
        console.log(`[nmdis] 本机 DNS 无法解析 ${u.hostname}，已通过 DoH 直连 ${ip} 完成请求`);
      }
      return { status: r.status, text: r.text, viaIp: true, ip };
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('DoH 直连失败');
}

module.exports = { postNmdis, dohResolve, errCode };
