// AlphaSun · 北海极端气候全景系统 — 聚合服务（纯 Node，无第三方依赖）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { STATIONS, TIDE_STATIONS } = require('./lib/config');
// 内联静态资源（构建期由 build-assets.js 生成）——单文件 exe / 无 public 目录时从此读取
let ASSETS = {};
try { ASSETS = require('./embedded-assets'); } catch (e) {}
const src = require('./lib/sources');
const tides = require('./lib/tides');
const alert = require('./lib/alerts');
const astro = require('./lib/astronomy');
const intel = require('./lib/intel');
const { BEIHAI_BOUNDARY } = require('./lib/config');

const PORT = process.env.PORT || 8765;
const PUBLIC = path.join(__dirname, 'public');
const climateCache = new Map(); // id -> {expire, data}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
const ASSET_CT = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(res, urlPath) {
  let f = urlPath === '/' ? '/index.html' : urlPath;
  // 仅做 POSIX 风格清理（防目录穿越），不使用 Windows path.normalize（会把前导 / 变成 \，破坏资源 key 匹配）
  f = f.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\.[/])+/, '');
  const rel = f.startsWith('/') ? f : '/' + f;
  // 磁盘优先：node server.js 本地运行有 public/ 目录，改完即时生效（无需重启/重建）
  const fp = path.join(PUBLIC, rel.replace(/^\/+/, ''));
  if (fp.startsWith(PUBLIC)) {
    try {
      const data = fs.readFileSync(fp);
      const ct = ASSET_CT[path.extname(fp).toLowerCase()] || 'text/plain';
      res.writeHead(200, { 'Content-Type': ct, 'Content-Length': Buffer.byteLength(data) });
      return res.end(data);
    } catch (e) { /* 磁盘无此文件，回退内联资源 */ }
  }
  // 兜底：内联资源（单文件 exe / 无 public 目录场景，由 build-assets.js 生成）
  if (ASSETS[rel]) {
    const buf = Buffer.from(ASSETS[rel], 'base64');
    const ct = ASSET_CT[path.extname(rel).toLowerCase()] || 'text/plain';
    res.writeHead(200, { 'Content-Type': ct, 'Content-Length': buf.length });
    return res.end(buf);
  }
  res.writeHead(404); return res.end('not found');
}

// ===== 中央气象台(nmc) 产品图代理：抓取官方页面→提取产品图→服务端重发（绕开防盗链/CORS）=====
const NMC_PAGES = {
  satellite: 'https://www.nmc.cn/publish/satellite/fy2.htm',
  radar: 'https://www.nmc.cn/publish/radar/chinaall.html',
  precip: 'https://www.nmc.cn/publish/precipitation/',
  wind: 'https://www.nmc.cn/publish/diagnose/wind/',
  wave: 'https://www.nmc.cn/publish/marine/wave/',
  subhigh: 'https://www.nmc.cn/publish/diagnose/',
  disturb: 'https://www.nmc.cn/publish/typhoon/',
};
function extractImageUrls(html) {
  const set = new Set();
  const re = /(?:src|data-src)\s*=\s*["']([^"']+)["']|background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\)/gi;
  let m; while ((m = re.exec(html))) { const u = m[1] || m[2]; if (u) set.add(u); }
  return [...set];
}
function normUrl(u, base) {
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('http')) return u;
  try { return new URL(u, base).href; } catch (e) { return null; }
}
function pickBest(urls, p) {
  const extOk = u => /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(u);
  const bad = /assets|static|logo|icon|css|themes|32x32|nav|arrow|btn|bg|conac|beian|gongan|\/w\//i;
  const cands = urls.filter(u => extOk(u) && !bad.test(u));
  if (!cands.length) return null;
  const prod = cands.filter(u => /\/product\//i.test(u)); // 真实产品图优先
  const pool = prod.length ? prod : cands;
  const kw = {
    satellite: ['satellite', 'cloud', 'fy', 'vis', 'ir', 'rdcp'], radar: ['radar', 'rdcp'], precip: ['precip', 'rain'],
    wind: ['wind', 'windf'], wave: ['wave'], subhigh: ['subhigh', 'high', 'circul', 'diagnose'], disturb: ['typhoon', 'disturb', 'low'],
  }[p] || [];
  const hit = pool.filter(u => kw.some(k => u.toLowerCase().includes(k)));
  return hit[0] || pool[0];
}
async function fetchNmcProduct(p) {
  const page = NMC_PAGES[p]; if (!page) return null;
  const html = await fetch(page, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.nmc.cn/' } }).then(r => r.text()).catch(() => null);
  if (!html) return { link: page, img: null };
  const urls = extractImageUrls(html).map(u => normUrl(u, page)).filter(Boolean);
  return { link: page, img: pickBest(urls, p) };
}
async function nmcImageMeta(p) { const r = await fetchNmcProduct(p); if (!r || !r.img) return { ok: false, link: r ? r.link : '' }; return { ok: true, link: r.link, img: r.img }; }
async function nmcImageBuffer(p) {
  const r = await fetchNmcProduct(p); if (!r || !r.img) return null;
  const resp = await fetch(r.img, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.nmc.cn/' } }).catch(() => null);
  if (!resp || !resp.ok) return null;
  const buf = Buffer.from(await resp.arrayBuffer());
  return { buf, ct: resp.headers.get('content-type') || 'image/jpeg' };
}

async function getClimate(s) {
  const cached = climateCache.get(s.id);
  if (cached && cached.expire > Date.now()) return cached.data;
  try { const d = await src.fetchClimate(s); climateCache.set(s.id, { expire: Date.now() + 24 * 3600e3, data: d }); return d; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// 多源实况校核快照：节流写入 data/realtime-check.json，作为可审计的校核数据留存（本地缓存，不入库提交）
const rtCheckCache = { last: 0, path: path.join(__dirname, '..', 'data', 'realtime-check.json') };
function persistRealtimeCheck(rc) {
  const now = Date.now();
  if (now - rtCheckCache.last < 60000) return; // 最多每分钟落盘一次
  rtCheckCache.last = now;
  try {
    const dir = path.dirname(rtCheckCache.path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(rtCheckCache.path, JSON.stringify(rc, null, 2));
  } catch (e) { /* 落盘失败忽略 */ }
}

function parseAlertTime(t) {
  if (!t) return 0;
  const m = String(t).match(/(\d{4})\D(\d{2})\D(\d{2})\D(\d{2})\D(\d{2})/);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}
// 实况修正：优先采用可达的权威实况源（CMA 官方 > wttr.in 独立第三方），如实反映当前强度
// （如暴雨减弱为零星小雨）；预警仍生效时在「实时天气」顶部以淡红标注，但不强行覆盖实况强度。
// 仅当所有实况源均不可达、且北海暴雨/强对流预警生效时，才以预警类别预估实况（标注「预估」）。
function applyRealtimeOverride(stations, alertIntel, cmaRes, wttrRes, caiyunRes) {
  const cma = (cmaRes && cmaRes.status === 'fulfilled') ? cmaRes.value : null;
  const cmaOk = !!(cma && cma.ok && cma.current);
  const wttr = (wttrRes && wttrRes.status === 'fulfilled') ? wttrRes.value : null;
  const wttrOk = !!(wttr && wttr.ok && wttr.current);
  const items = (alertIntel && alertIntel.items) || [];
  const now = Date.now();
  const storm = items.find(a =>
    a.beihaiRelation === 'direct' &&
    /暴雨|雷雨|强对流|大风/.test(a.category || '') &&
    (a.level || 0) >= 2 &&
    parseAlertTime(a.time) && (now - parseAlertTime(a.time)) < 6 * 3600e3
  );
  for (const st of stations) {
    if (!st.weather || !st.weather.ok || !st.weather.current) continue;
    const cur = st.weather.current;
    // 优先取可达实况源（CMA > wttr.in），如实反映当前强度
    let live = null, liveSrc = '';
    if (cmaOk) { live = cma.current; liveSrc = '中国天气网实况'; }
    else if (wttrOk) { live = wttr.current; liveSrc = 'wttr.in 实况'; }
    if (live) {
      Object.assign(cur, {
        temp: live.temp, feels: live.feels, rh: live.rh, precip: live.precip,
        code: live.code, text: live.text, icon: live.icon, wind: live.wind, windDir: live.windDir,
        uv: (live.uv != null ? live.uv : cur.uv), vis: (live.vis != null ? live.vis : cur.vis),
        source: cmaOk ? 'cma' : 'wttr', realtimeSource: liveSrc,
      });
    }
    // 预警仍生效：顶部淡红标注（见前端）；有实况源则保留实况值仅附预警提示，无实况源才以预警预估
    if (storm) {
      cur.warningOverride = { title: storm.title, level: storm.levelName, time: storm.time, active: true };
      if (!live) {
        cur.code = 95;
        cur.text = (storm.category || '暴雨').replace('·汛情', '');
        cur.icon = 'storm';
        cur.source = 'warning-override';
        cur.realtimeSource = '预警优先·实况以气象台预警为准(预估)';
      } else {
        cur.realtimeSource = liveSrc + '（预警生效中）';
      }
    }
  }
}

async function buildOverview() {
  const results = await Promise.allSettled([
    Promise.all(STATIONS.map(s => src.aggregateStation(s))),
    tides.getAllTides(),
    src.fetchEarthquakes().catch(e => ({ ok: false, error: String(e.message || e) })),
    src.fetchFires().catch(e => ({ ok: false, error: String(e.message || e) })),
    src.fetchTyphoon().catch(e => ({ ok: false, error: String(e.message || e) })),
    src.fetchWarnings().catch(e => ({ ok: false, error: String(e.message || e) })),
    src.fetchRiverReservoir().catch(e => ({ ok: false, error: String(e.message || e) })),
    src.fetchCmaLive({}).catch(e => ({ ok: false, error: String(e.message || e) })),
    src.fetchWttrLive({ lat: 21.48, lon: 109.11 }).catch(e => ({ ok: false, error: String(e.message || e) })),
    src.fetchCaiyunLive({ lat: 21.48, lon: 109.11 }).catch(e => ({ ok: false, error: String(e.message || e) })),
    src.fetchRegionalBeihai().catch(e => ({ ok: false, error: String(e.message || e) })),
  ]);
  const [stationsAgg, tideRes, quakeRes, fireRes, tyRes, warnRes, rrRes, cmaRes, wttrRes, caiyunRes, regionalRes] = results;
  const tideList = tideRes.status === 'fulfilled' ? tideRes.value : [];
  const stations = (stationsAgg.status === 'fulfilled' ? stationsAgg.value : []).map(st => {
    const ev = alert.evaluateStation(st);
    const glow = astro.sunsetGlow(st);
    const morningGlow = astro.sunriseGlow(st);
    return { ...st, alert: ev, glow, morningGlow };
  });
  // 多源实况交叉校核：使用尚未被覆盖的原始 Open-Meteo current + CMA + wttr.in（独立第三方源）
  const primaryAgg = (stationsAgg.status === 'fulfilled') ? stationsAgg.value[0] : null;
  const cmaVal = (cmaRes && cmaRes.status === 'fulfilled') ? cmaRes.value : cmaRes;
  const wttrVal = (wttrRes && wttrRes.status === 'fulfilled') ? wttrRes.value : wttrRes;
  const caiyunVal = (caiyunRes && caiyunRes.status === 'fulfilled') ? caiyunRes.value : caiyunRes;
  const warnCtx = [
    ...((warnRes.status === 'fulfilled' && warnRes.value.ok && warnRes.value.rainstorm) ? warnRes.value.rainstorm : []).map(a => ({ category: a.catLabel || a.cat, level: a.levelNum || 0, levelName: a.level })),
    ...((warnRes.status === 'fulfilled' && warnRes.value.ok && warnRes.value.convective) ? warnRes.value.convective : []).map(a => ({ category: a.catLabel || a.cat, level: a.levelNum || 0, levelName: a.level })),
  ];
  const realtimeCheck = src.verifyRealtime({ openMeteo: primaryAgg ? primaryAgg.weather : null, cma: cmaVal, wttr: wttrVal, caiyun: caiyunVal }, warnCtx, primaryAgg ? primaryAgg.air : null);
  const regionalWeather = (regionalRes && regionalRes.status === 'fulfilled') ? regionalRes.value : { ok: false, error: (regionalRes && regionalRes.reason) ? String(regionalRes.reason) : '区域天气采集失败' };
  persistRealtimeCheck(realtimeCheck);
  const quakes = quakeRes.status === 'fulfilled' && quakeRes.value.ok ? quakeRes.value.events : [];
  const fires = fireRes.status === 'fulfilled' && fireRes.value.ok ? fireRes.value.fires : [];
    const typhoons = tyRes.status === 'fulfilled' && tyRes.value.ok ? tyRes.value.typhoons : [];
  const warningsAll = warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.all : [];
  const eqAlerts = alert.evaluateEarthquakes(quakes);
  const fireAlerts = alert.evaluateFires(fires);
  const tideAlerts = alert.evaluateTides(tideList);
  const tyAlerts = alert.evaluateTyphoon(typhoons);
    const warnAlerts = alert.evaluateWarnings(warningsAll);
  const rawAlerts = [
    ...stations.flatMap(s => s.alert.items),
    ...eqAlerts, ...fireAlerts, ...tideAlerts, ...tyAlerts, ...warnAlerts,
  ];
  const STATION_NAMES = new Set(STATIONS.map(s => s.name));
  const REL_TXT = { direct: '涉及北海', possible: '可能涉及北海', none: '' };
  const globalAlerts = rawAlerts.map(a => {
    let region = '其他', rel = 'none';
    if (a.station && STATION_NAMES.has(a.station)) { region = '北海'; rel = 'direct'; }
    else if (typeof a.lat === 'number' && typeof a.lon === 'number') {
      const reg = intel.regionOf(a.lat, a.lon, a.station || null);
      region = reg.region;
      rel = intel.beihaiRelationFor(a.lat, a.lon, reg.region, { kind: a.type });
    }
    return { ...a, region, beihaiRelation: rel, relLabel: REL_TXT[rel] || '' };
  }).sort((a, b) => {
    // 情报优先级：北海(direct) -> 可能涉及北海(possible) -> 广西 -> 其他；同级按级别、再时间
    const pri = x => (x.beihaiRelation === 'direct' || x.region === '北海') ? 0
      : (x.beihaiRelation === 'possible') ? 1
      : (x.region === '广西') ? 2 : 3;
    return (pri(a) - pri(b)) || (b.level - a.level) || String(b.time || '').localeCompare(String(a.time || ''));
  });
  const maxLevel = globalAlerts.reduce((m, x) => Math.max(m, x.level), 0);
  const alertIntel = intel.buildAlertIntel({ typhoons, warnings: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value : { all: [] }, quakes });
  applyRealtimeOverride(stations, alertIntel, cmaRes, wttrRes, caiyunRes);
  return {
    updated: new Date().toISOString(),
    center: { name: '北海', lat: 21.48, lon: 109.11 },
    maxLevel, maxLevelName: alert.levelName(maxLevel),
    boundary: BEIHAI_BOUNDARY,
    alertIntel,
    stations, tides: tideList,
    earthquakes: { ok: quakeRes.status === 'fulfilled' && quakeRes.value.ok, count: quakes.length, events: quakes.slice(0, 12) },
    fires: { ok: fireRes.status === 'fulfilled' && fireRes.value.ok, configured: !!(fireRes.status === 'fulfilled' && fireRes.value.configured), count: fires.length, fires: fires.slice(0, 50) },
    typhoon: { ok: tyRes.status === 'fulfilled' && tyRes.value.ok, count: typhoons.length, typhoons },
    warnings: { ok: warnRes.status === 'fulfilled' && warnRes.value.ok, count: warningsAll.length,
      all: warnRes.status === 'fulfilled' && warnRes.value.ok ? warningsAll : [],
      typhoon: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.typhoon : [],
      rainstorm: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.rainstorm : [],
      geological: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.geological : [],
      convective: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.convective : [] },
    riverReservoir: rrRes.status === 'fulfilled' ? rrRes.value : { ok: false, error: 'unavailable' },
    astronomy: astro.astronomicalEvents(),
    realtimeCheck,
    regionalWeather,
    globalAlerts,
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (p === '/api/nmc-img') {
      const p2 = u.searchParams.get('p') || '';
      const meta = u.searchParams.get('meta') === '1';
      if (meta) return send(res, 200, await nmcImageMeta(p2));
      const r = await nmcImageBuffer(p2);
      if (!r) { res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify({ ok: false })); }
      res.writeHead(200, { 'Content-Type': r.ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' });
      return res.end(r.buf);
    }
    if (p === '/api/overview') return send(res, 200, await buildOverview());
    if (p === '/api/tides') return send(res, 200, await tides.getAllTides());
    if (p === '/api/quakes') { const r = await src.fetchEarthquakes().catch(() => ({ ok: false })); return send(res, 200, r); }
    if (p === '/api/fires') { const r = await src.fetchFires().catch(() => ({ ok: false })); return send(res, 200, r); }
    if (p === '/api/typhoon') { const r = await src.fetchTyphoon().catch(() => ({ ok: false })); return send(res, 200, r); }
    if (p === '/api/warnings') { const r = await src.fetchWarnings().catch(() => ({ ok: false })); return send(res, 200, r); }
    if (p === '/api/alerts') { const r = await intel.fetchAndBuildIntel(src).catch(() => ({ ok: false })); return send(res, 200, r); }
    if (p === '/api/astronomy') return send(res, 200, astro.astronomicalEvents());
    if (p === '/api/version') { let pv='0'; try { pv = require('./package.json').version; } catch(e){} return send(res, 200, { version: pv, name: 'AlphaSun·北海极端气候全景系统', updated: new Date().toISOString() }); }
    if (p === '/api/time') return send(res, 200, { now: Date.now(), iso: new Date().toISOString() });
    if (p.startsWith('/api/climate/')) {
      const id = p.split('/').pop(); const s = STATIONS.find(x => x.id === id);
      return send(res, 200, s ? await getClimate(s) : { ok: false, error: 'unknown station' });
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    return serveStatic(res, p);
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`AlphaSun 北海极端气候全景系统 -> http://localhost:${PORT}`);
  // 双击 exe 运行时自动打开浏览器（设环境变量 OPEN=0 可关闭）
  if (process.env.OPEN !== '0' && process.platform === 'win32') {
    setTimeout(() => { try { exec('start http://localhost:' + PORT); } catch (e) {} }, 1200);
  }
});
