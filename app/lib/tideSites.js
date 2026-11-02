// AlphaSun · 北海极端气候全景系统 — NMDIS 验潮站代码解析（Node 端共享模块）
// ---------------------------------------------------------------------------
// 背景：国家海洋信息中心(NMDIS) 的「获取站点列表」接口 GetPortList 返回全球约 500 个
// 港口/验潮站，每个站点带 SiteCode（真实站点代码）与 Title（如
// "中国－北海港（CHINA－BEIHAI）" 或 "斯里兰卡－科伦坡港（SRILANKA－PORTCOLOMBO）"）。
// 该接口需 appid/appsecret 鉴权；未授权时返回 {"code":"1000.1","message":"用户未授权"}。
//
// 本模块把「列表 → 北海三港真实 SiteCode」的匹配逻辑独立出来，供三处复用：
//   1) app/lib/tides.js        —— 运行时自动解析（用户只需配凭证，不必手抄代码）
//   2) tools/nmdis-portlist.js —— 命令行查询并回填 config.json
//   3) app-android/www/js/data.js —— 安卓端镜像（同逻辑内联副本）
//
// 匹配策略（按可靠性递降）：
//   A. 站名别名命中（NMDIS 中英文标题均带别名，如 铁山港 / TIESHANGANG）
//   B. 同名多候选 → 坐标就近消歧（防止匹配到外省同名港，如辽宁铁山港）
//   C. 站名完全未命中 → 坐标就近兜底（30km 内最近站），并在结果中标注 via='coord'
// 注：CJK 与英文别名统一走「规范化后子串包含」，故 "WEI ZHOU DAO"、"weizhou"、
//     "涠洲岛" 均可命中同一站点。

'use strict';

// 三港别名（中文名 + 常见英文/旧译名）。normName 已去除空格与标点。
const TIDE_SITE_ALIASES = {
  bhg: ['北海港', '北海', 'BEIHAI'],
  tsg: ['铁山港', '铁山', 'TIESHANGANG', 'TIESHAN'],
  wzd: ['涠洲岛', '涠洲', 'WEIZHOU', 'WEIZHOUDao'],
};

// 规范化：小写 + 去空白/连字符/括号/斜杠/全角符号
function normName(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\s\-_－—–()（）\/·、,，.。'"“”‘’]/g, '');
}

// 解析 NMDIS 的 Coordinate 字段。
// 支持："21°29′N 109°04′E" / "21.48N 109.07E" / "21.4822 109.0700" / "21°28.8′N,109°04.2′E"
// 关键点：
//   ① 度符号 °/度 及其后的「分」整体可选 —— 部分站点只给十进制度+方位（如 "21.48N 109.07E"）；
//      若把 ° 设为必需，整串匹配不到而返回 null。
//   ② 「分」必须嵌在 ° 分支内 —— 否则纯十进制对（"21.48 109.07"）会把第二个数误当「分」。
function parseCoord(raw) {
  if (!raw) return null;
  const s = String(raw);
  const re = /(\d+(?:\.\d+)?)\s*(?:(?:°|度)\s*(?:(\d+(?:\.\d+)?)\s*(?:['′’]|分)?)?)?\s*([NSEWnsew])?/g;
  const pts = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    let v = parseFloat(m[1]);
    if (!isFinite(v)) continue;
    const mi = m[2] !== undefined ? parseFloat(m[2]) : 0;
    if (isFinite(mi)) v += mi / 60;
    const d = (m[3] || '').toUpperCase();
    if (d === 'S' || d === 'W') v = -v;
    pts.push(v);
    if (pts.length >= 2) break;
  }
  if (pts.length < 2) return null;
  const lat = pts[0], lon = pts[1];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// 大圆距离（km）
function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// 从站点列表条目抽取 {code, title, coord}（兼容 NMDIS 多种字段命名）
function extractItem(it) {
  if (!it || typeof it !== 'object') return null;
  const code = it.SiteCode || it.siteCode || it.Code || it.code || '';
  const title = it.Title || it.SiteName || it.siteName || it.Name || it.name ||
    it.PortName || it.portName || it.CnName || '';
  const coordRaw = it.Coordinate || it.coordinate || it.Coord || it.coord || it.Position || '';
  if (!code && !title) return null;
  return { code: String(code || '').trim(), title: String(title || '').trim(), coord: parseCoord(coordRaw) };
}

// 标题是否命中该站别名
function titleHit(title, id) {
  const t = normName(title);
  if (!t) return false;
  const aliases = TIDE_SITE_ALIASES[id] || [];
  return aliases.some(a => {
    const n = normName(a);
    return n && (t.indexOf(n) >= 0 || n.indexOf(t) >= 0);
  });
}

/**
 * 把 NMDIS 站点列表匹配到北海三港。
 * @param {Array} rawList 原始接口数组
 * @param {Array} stations TIDE_STATIONS（需含 id/lat/lon/name）
 * @returns {{bhg?:Object,tsg?:Object,wzd?:Object}} 每项 {id,code,title,via,distKm}
 */
function matchStations(rawList, stations) {
  const items = (rawList || []).map(extractItem).filter(Boolean);
  const out = {};
  for (const st of stations) {
    // A/B：站名别名命中
    let cands = items.filter(it => titleHit(it.title, st.id));
    let via = 'name';
    if (cands.length > 1) {
      // B：同名多候选 → 坐标就近（无坐标则取首个）
      const withC = cands.filter(c => c.coord);
      if (withC.length) {
        withC.sort((a, b) => distKm(a.coord, st) - distKm(b.coord, st));
        cands = [withC[0]];
      } else {
        cands = [cands[0]];
      }
      via = 'name+coord';
    } else if (cands.length === 0) {
      // C：站名未命中 → 坐标兜底（30km 内最近）
      const near = items
        .filter(it => it.coord && it.code)
        .map(it => ({ it, d: distKm(it.coord, st) }))
        .filter(x => x.d <= 30)
        .sort((a, b) => a.d - b.d);
      if (!near.length) continue;
      out[st.id] = { id: st.id, code: near[0].it.code, title: near[0].it.title, via: 'coord', distKm: Math.round(near[0].d) };
      continue;
    }
    const pick = cands[0];
    if (!pick.code) continue;
    out[st.id] = {
      id: st.id,
      code: pick.code,
      title: pick.title,
      via,
      distKm: pick.coord ? Math.round(distKm(pick.coord, st)) : null,
    };
  }
  return out;
}

// 从接口返回中取出站点数组（兼容多种返回结构）
function pickPortList(j) {
  if (!j) return null;
  if (j.ResultValue && Array.isArray(j.ResultValue.data)) return j.ResultValue.data;
  if (j.ResultValue && Array.isArray(j.ResultValue)) return j.ResultValue;
  if (j.ResultValue && Array.isArray(j.ResultValue.list)) return j.ResultValue.list;
  if (j.ResultValue && Array.isArray(j.ResultValue.ports)) return j.ResultValue.ports;
  if (j.data && Array.isArray(j.data)) return j.data;
  if (j.data && Array.isArray(j.data.list)) return j.data.list;
  if (Array.isArray(j)) return j;
  if (j.ResultValue && typeof j.ResultValue === 'object' && !Array.isArray(j.ResultValue)) {
    // 可能是单对象或键值映射
    const vals = Object.values(j.ResultValue);
    if (vals.length && vals.every(v => v && typeof v === 'object')) return vals;
  }
  return null;
}

module.exports = {
  TIDE_SITE_ALIASES,
  normName,
  parseCoord,
  distKm,
  extractItem,
  titleHit,
  matchStations,
  pickPortList,
};
