#!/usr/bin/env node
/**
 * AlphaSun · NMDIS 验潮站代码查询与回填工具
 * ------------------------------------------------------------
 * 用途：向国家海洋信息中心(NMDIS)「获取站点列表」接口查询各港真实 SiteCode，
 *      匹配出北海三港（北海港 / 铁山港 / 涠洲岛），并可一键写入 config.json 的
 *      tideSiteCodes —— 避免人工抄写代码出错。
 *
 * 用法：
 *   # 1) 用命令行参数凭证查询（只打印，不落盘）
 *   node tools/nmdis-portlist.js --appid <ID> --secret <SECRET>
 *
 *   # 2) 用环境变量凭证查询
 *   set NMDIS_APPID=xxx & set NMDIS_APPSECRET=yyy
 *   node tools/nmdis-portlist.js
 *
 *   # 3) 从 config.json 读凭证并查询 + 自动回填 tideSiteCodes
 *   node tools/nmdis-portlist.js --write
 *
 *   # 4) 指定目标 config.json（含 EXE 同目录）
 *   node tools/nmdis-portlist.js --write --config "D:\Tools\alphasun-beihai-climate\config.json"
 *
 *   # 5) 导出接口返回的全部站点（人工查阅/排查用）
 *   node tools/nmdis-portlist.js --all
 *
 * 凭证获取：service-tide.nmdis.org.cn 注册申请（电子潮汐表 500 元/站/年），
 *          接口为「简单身份认证」：请求头 appid / appsecret。
 * 说明：接口未授权时返回 {"code":"1000.1","message":"用户未授权"}，属正常鉴权拦截。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { TIDE_STATIONS } = require('../app/lib/config');
const { matchStations, pickPortList } = require('../app/lib/tideSites');
// NMDIS 访问层（含 DNS 兜底：本机 DNS 解析不到 service-tide.nmdis.org.cn 时自动走 DoH 直连 IP）
const { postNmdis } = require('../app/lib/nmdisHttp');

const ROOT = path.join(__dirname, '..');
const API_NMDIS = 'http://service-tide.nmdis.org.cn:8080';
const PORTLIST_PATH = '/api/v1/CoreData/GetPortList';
const TIMEOUT_MS = 15000;
const RETRIES = 3;

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
function argVal(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}
const OPT = {
  appid: argVal('--appid'),
  secret: argVal('--secret'),
  config: argVal('--config'),
  write: argv.includes('--write'),
  all: argv.includes('--all'),
  help: argv.includes('--help') || argv.includes('-h'),
};
if (OPT.help) {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

// ---------- 定位 config.json（与 server.js 保持一致：app/ 与 .exe 同目录） ----------
function configCandidates() {
  const list = [
    path.join(ROOT, 'app', 'config.json'),
    path.join(ROOT, 'config.json'),
  ];
  try { list.push(path.join(path.dirname(process.execPath), 'config.json')); } catch (e) {}
  if (OPT.config) list.unshift(path.resolve(OPT.config));
  return list;
}
function findConfig() {
  for (const p of configCandidates()) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return null;
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

// ---------- 凭证解析：命令行 > 环境变量 > config.json ----------
function resolveCreds() {
  const cfgPath = findConfig();
  const cfg = cfgPath ? readJson(cfgPath) : null;
  const appid = OPT.appid || process.env.NMDIS_APPID || (cfg && cfg.nmdisAppId) || '';
  const secret = OPT.secret || process.env.NMDIS_APPSECRET || (cfg && cfg.nmdisAppSecret) || '';
  return { appid: String(appid).trim(), secret: String(secret).trim(), cfgPath, cfg };
}

// ---------- 调用 GetPortList（带超时 + 重试；DNS 解析失败时自动 DoH 兜底直连 IP） ----------
async function fetchPortList(appid, secret) {
  let lastErr = '未知错误';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const r = await postNmdis(API_NMDIS, PORTLIST_PATH, { appid, appsecret: secret }, {}, TIMEOUT_MS);
      if (!r) { lastErr = '无响应'; }
      else {
        let j = null;
        try { j = JSON.parse(r.text); } catch (e) { /* 非 JSON */ }
        if (!j) { lastErr = `响应非 JSON（http=${r.status}）：${r.text.slice(0, 120)}`; }
        else if (j.code && String(j.code) !== '200' && j.message) {
          // NMDIS 鉴权/业务错误
          lastErr = `${j.code} ${j.message}`;
          if (String(j.message).includes('未授权') || String(j.code) === '201') {
            throw new Error(`鉴权失败：${j.code} ${j.message} —— 请检查 appid/appsecret 是否有效、是否已获该接口订购权限。`);
          }
        } else {
          const list = pickPortList(j);
          if (!list) { lastErr = '响应中未找到站点数组（结构与预期不符）'; }
          else return list;
        }
      }
    } catch (e) {
      if (e && e.message && e.message.startsWith('鉴权失败')) throw e;
      lastErr = e && e.message ? e.message : String(e);
    }
    if (attempt < RETRIES) {
      console.error(`  … 第 ${attempt} 次尝试失败（${lastErr}），${2}s 后重试`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error(`查询失败：${lastErr}`);
}

// ---------- 主流程 ----------
(async () => {
  const { appid, secret, cfgPath, cfg } = resolveCreds();
  console.log('=== AlphaSun · NMDIS 验潮站代码查询 ===');
  console.log('凭证来源:', appid
    ? (OPT.appid ? '命令行 --appid' : process.env.NMDIS_APPID ? '环境变量 NMDIS_APPID' : `config.json（${cfgPath}）`)
    : '未找到');
  console.log('配置文件:', cfgPath || '未找到（可指定 --config <路径>）');
  if (!appid || !secret) {
    console.error('\n❌ 缺少 NMDIS 凭证。请任选其一提供：');
    console.error('   node tools/nmdis-portlist.js --appid <ID> --secret <SECRET>');
    console.error('   设置环境变量 NMDIS_APPID / NMDIS_APPSECRET');
    console.error('   或在 config.json 填入 nmdisAppId / nmdisAppSecret');
    console.error('\n凭证申请：service-tide.nmdis.org.cn →「获取电子数据流程」/ API 订购（潮汐站点 500 元/站/年）');
    process.exit(2);
  }

  console.log('\n正在调用 GetPortList …');
  const list = await fetchPortList(appid, secret);
  console.log(`✅ 接口返回 ${list.length} 个站点`);

  if (OPT.all) {
    console.log('\n=== 全部站点（SiteCode / Title / 坐标）===');
    for (const it of list) {
      const code = it.SiteCode || it.siteCode || it.Code || it.code || '';
      const title = it.Title || it.SiteName || it.name || it.PortName || '';
      const coord = it.Coordinate || it.coord || '';
      console.log(`${String(code).padEnd(10)} ${title}${coord ? '  ' + coord : ''}`);
    }
  }

  const matched = matchStations(list, TIDE_STATIONS);
  console.log('\n=== 北海三港匹配结果 ===');
  const rows = [];
  for (const st of TIDE_STATIONS) {
    const m = matched[st.id];
    const viaLabel = { name: '站名命中', 'name+coord': '站名+坐标消歧', coord: '坐标兜底' }[m ? m.via : ''] || '未命中';
    if (m) {
      console.log(`  ✅ ${st.name.padEnd(6)} → SiteCode=${m.code}  「${m.title}」  (${viaLabel}${m.distKm != null ? `, 距标称点 ${m.distKm}km` : ''})`);
      rows.push([st.id, st.name, m.code]);
    } else {
      console.log(`  ❌ ${st.name.padEnd(6)} → 未匹配到（可加 --all 导出全量站点人工挑选）`);
    }
  }

  if (!rows.length) {
    console.error('\n❌ 未能匹配任何一港。');
    process.exit(1);
  }

  const codesObj = {};
  for (const [id, , code] of rows) codesObj[id] = code;
  console.log('\n=== 可直接粘贴到 config.json 的 tideSiteCodes ===');
  console.log(JSON.stringify(codesObj, null, 2));

  if (OPT.write) {
    const target = OPT.config ? path.resolve(OPT.config) : cfgPath;
    if (!target) {
      console.error('\n❌ 未找到目标 config.json，无法回填。请用 --config 指定路径。');
      process.exit(3);
    }
    let j = readJson(target);
    if (!j) {
      const example = path.join(ROOT, 'app', 'config.example.json');
      j = readJson(example) || {};
      console.log(`\n[写入] 目标文件不存在，以 config.example.json 为模板新建：${target}`);
    }
    if (typeof j.tideSiteCodes !== 'object' || !j.tideSiteCodes) j.tideSiteCodes = {};
    for (const [id, , code] of rows) j.tideSiteCodes[id] = code;
    // 清理示例注释键，保持文件干净
    if (j.tideSiteCodes._note) delete j.tideSiteCodes._note;
    fs.writeFileSync(target, JSON.stringify(j, null, 2) + '\n', 'utf8');
    console.log(`\n✅ 已写入 ${target}`);
    console.log('   提示：EXE 版请确认该 config.json 位于 .exe 同目录（启动日志会打印「[cfg] 已加载…」）。');
  } else {
    console.log('\n提示：加 --write 可自动写入 config.json。');
  }
})().catch(e => {
  console.error('\n❌ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
