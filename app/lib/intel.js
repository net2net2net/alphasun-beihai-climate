// AlphaSun · 极端气候告警情报（区域分级 + 统一情报列表 + 北海关联）
// 数据源：中央气象台(nmc) 台风路径/气象预警信号、USGS 地震 —— 均为政府/气象主管机构发布。
const { CENTER, BEIHAI_NAMES, GUANGXI_CITIES, tyIntensity } = require('./config');
const { haversine, levelName, levelColor, ADVICE } = require('./alerts');

// 北海 / 广西 关注范围（WGS-84 经纬度框）
const BEIHAI_BBOX = { minLat: 21.20, maxLat: 21.90, minLon: 108.85, maxLon: 109.65 };
const GUANGXI_BBOX = { minLat: 21.40, maxLat: 26.50, minLon: 104.50, maxLon: 112.10 };

// 区域分级：北海(rank0) > 广西(rank1) > 其他(rank2)
function regionOf(lat, lon, city) {
  if (city && BEIHAI_NAMES.some(n => city.includes(n))) return { region: '北海', rank: 0 };
  if (lat != null && lon != null &&
      lat >= BEIHAI_BBOX.minLat && lat <= BEIHAI_BBOX.maxLat &&
      lon >= BEIHAI_BBOX.minLon && lon <= BEIHAI_BBOX.maxLon) return { region: '北海', rank: 0 };
  if (city && GUANGXI_CITIES.some(n => city.includes(n))) return { region: '广西', rank: 1 };
  if (lat != null && lon != null &&
      lat >= GUANGXI_BBOX.minLat && lat <= GUANGXI_BBOX.maxLat &&
      lon >= GUANGXI_BBOX.minLon && lon <= GUANGXI_BBOX.maxLon) return { region: '广西', rank: 1 };
  return { region: '其他', rank: 2 };
}

// 北海关联判定：direct=涉及北海 / possible=可能涉及北海 / none=无
function beihaiRelationFor(lat, lon, region, opts) {
  opts = opts || {};
  const d = (lat != null && lon != null) ? haversine(CENTER.lat, CENTER.lon, lat, lon) : null;
  const md = (opts.minDistBH != null) ? opts.minDistBH : d;
  if (region === '北海') return 'direct';
  if (opts.kind === '台风') {
    if (md != null && md < 300) return 'direct';
    if (md != null && md < 800) return 'possible';
    return 'none';
  }
  if (region === '广西') return (d != null && d < 250) ? 'possible' : 'none';
  if (d != null && d < 400) return 'possible';
  return 'none';
}
const REL_LABEL = { direct: '涉及北海', possible: '可能涉及北海', none: '' };

function tyLevel(intensity, lat, lon) {
  const sInt = { TD: 1, TS: 1, STS: 2, TY: 2, STY: 3, SuperTY: 4, SUPER: 4 }[intensity] || 1;
  const dist = haversine(CENTER.lat, CENTER.lon, lat, lon);
  if (dist < 300) return Math.min(4, sInt + 1);
  if (dist < 700) return Math.min(3, sInt);
  if (dist < 1200) return Math.max(1, sInt - 1);
  return 1;
}
function typhoonMinDistBH(t) {
  const pts = [t.current, ...(t.points || [])].filter(p => p && p.lat != null && p.lon != null);
  if (!pts.length) return null;
  return Math.min(...pts.map(p => haversine(CENTER.lat, CENTER.lon, p.lat, p.lon)));
}

// 统一情报列表：接受已抓取的数据（避免重复请求）
function buildAlertIntel({ typhoons = [], warnings = {}, quakes = [] } = {}) {
  const items = [];

  (typhoons || []).forEach(t => {
    const c = t.current; if (!c || !c.lat) return;
    const lv = tyLevel(c.intensity, c.lat, c.lon);
    const reg = regionOf(c.lat, c.lon, null);
    const inten = tyIntensity(c.intensity);
    const md = typhoonMinDistBH(t);
    const rel = beihaiRelationFor(c.lat, c.lon, reg.region, { kind: '台风', minDistBH: md });
    items.push({
      id: 'ty-' + t.id,
      category: '台风',
      level: lv, levelName: levelName(lv), color: levelColor(lv),
      title: `${t.cnName || t.enName || '台风'}（${t.enName || ''}）${inten.name}`,
      summary: `中心 ${c.lat.toFixed(2)}°N ${c.lon.toFixed(2)}°E · 风速 ${c.wind || '—'} m/s · 气压 ${c.pressure || '—'} hPa`,
      advice: (ADVICE['台风'] && ADVICE['台风'][lv]) || '',
      region: reg.region, rank: reg.rank,
      beihaiRelation: rel, relLabel: REL_LABEL[rel], minDistBH: md,
      source: '中央气象台',
      time: c.ts || '',
      lat: c.lat, lon: c.lon, url: '',
    });
  });

  const wlist = (warnings && warnings.all) || [];
  wlist.forEach(w => {
    const lv = w.levelNum || 1;
    const reg = regionOf(w.lat, w.lon, w.city);
    let adviceKey = null;
    if (w.cat === 'geological') adviceKey = '地质灾害';
    else if (w.cat === 'rainstorm') adviceKey = '汛情';
    else if (w.cat === 'convective') adviceKey = '龙卷';
    else if (w.cat === 'typhoon') adviceKey = '台风';
    const rel = beihaiRelationFor(w.lat, w.lon, reg.region, { kind: w.cat });
    items.push({
      id: 'w-' + w.id,
      category: w.catLabel || w.cat,
      level: lv, levelName: levelName(lv), color: levelColor(lv),
      title: w.title,
      summary: `${w.city || ''} ${w.level || ''}${w.catLabel || w.cat}预警`,
      advice: (adviceKey && ADVICE[adviceKey] && ADVICE[adviceKey][lv]) || '关注官方预警，做好防范',
      region: reg.region, rank: reg.rank,
      beihaiRelation: rel, relLabel: REL_LABEL[rel], minDistBH: (w.lat != null ? haversine(CENTER.lat, CENTER.lon, w.lat, w.lon) : null),
      source: '地方气象台',
      time: w.time || '',
      lat: w.lat, lon: w.lon, url: w.url || '',
    });
  });

  (quakes || []).forEach(q => {
    if (q.mag == null) return;
    const dist = haversine(CENTER.lat, CENTER.lon, q.lat, q.lon);
    if (dist > 600) return;
    let lv = 0;
    if (q.mag >= 7) lv = 4; else if (q.mag >= 6) lv = 3; else if (q.mag >= 5) lv = 2;
    else if (q.mag >= 4.5 && dist < 400) lv = 1;
    if (lv <= 0) return;
    const reg = regionOf(q.lat, q.lon, null);
    const rel = beihaiRelationFor(q.lat, q.lon, reg.region, { kind: '地震' });
    items.push({
      id: 'eq-' + q.time + '-' + q.lat.toFixed(2) + '-' + q.lon.toFixed(2),
      category: '地震',
      level: lv, levelName: levelName(lv), color: levelColor(lv),
      title: `地震 M${q.mag}`,
      summary: `${q.place} · 距北海约 ${dist.toFixed(0)} km · 深度 ${q.depth} km`,
      advice: (ADVICE['地震'] && ADVICE['地震'][lv]) || '',
      region: reg.region, rank: reg.rank,
      beihaiRelation: rel, relLabel: REL_LABEL[rel], minDistBH: dist,
      source: 'USGS',
      time: new Date(q.time).toISOString().slice(0, 16).replace('T', ' '),
      lat: q.lat, lon: q.lon, url: q.url || '',
    });
  });

  items.sort((a, b) =>
    (a.rank - b.rank) ||
    (b.level - a.level) ||
    String(b.time || '').localeCompare(String(a.time || ''))
  );
  return { updated: new Date().toISOString(), count: items.length, items };
}

// 独立抓取并构建（供 /api/alerts 直接调用）
async function fetchAndBuildIntel(src) {
  const [tyRes, warnRes, eqRes] = await Promise.allSettled([
    src.fetchTyphoon(),
    src.fetchWarnings(),
    src.fetchEarthquakes().catch(() => ({ ok: false })),
  ]);
  const typhoons = tyRes.status === 'fulfilled' && tyRes.value.ok ? tyRes.value.typhoons : [];
  const warnings = warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value : { all: [] };
  const quakes = eqRes.status === 'fulfilled' && eqRes.value.ok ? eqRes.value.events : [];
  return buildAlertIntel({ typhoons, warnings, quakes });
}

module.exports = { regionOf, beihaiRelationFor, buildAlertIntel, fetchAndBuildIntel, tyLevel };
