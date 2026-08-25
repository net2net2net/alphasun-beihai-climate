// AlphaSun · 潮汐/水位
// 主源：国家海洋信息中心（需 NMDIS_APPID/APPSECRET，POST GetPortTideData）
// 降级：调和模型估算（双半日潮 M2+S2 + 日潮 K1+O1），供演示，标注「模型估算」
const { API, NMDIS_APPID, NMDIS_APPSECRET, TIDE_STATIONS } = require('./config');

// 北海近似调和常数（相对基准面，单位 m），为公开资料估算值，仅供演示
const CONSTITUENTS = [
  { name: 'M2', amp: 1.9, period: 12.4206, phase: 1.2 },
  { name: 'S2', amp: 0.7, period: 12.0000, phase: 0.4 },
  { name: 'K1', amp: 0.4, period: 23.9345, phase: 3.1 },
  { name: 'O1', amp: 0.3, period: 25.8194, phase: 5.0 },
];
const MEAN_LEVEL = 1.6; // 平均潮位 m

function tideAt(date) {
  const t = date.getTime() / 1000; // 秒
  let h = MEAN_LEVEL;
  for (const c of CONSTITUENTS) {
    h += c.amp * Math.cos((2 * Math.PI * t) / (c.period * 3600) - c.phase);
  }
  return +h.toFixed(2);
}

// 求未来24h内的高/低潮
function predictDay(st) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 24 * 4; i++) {
    const t = new Date(now.getTime() + i * 15 * 60000);
    const h = tideAt(t);
    out.push({ time: t, h });
  }
  const ext = [];
  for (let i = 1; i < out.length - 1; i++) {
    if ((out[i].h > out[i - 1].h && out[i].h >= out[i + 1].h) ||
        (out[i].h < out[i - 1].h && out[i].h <= out[i + 1].h)) {
      ext.push({ time: out[i].time, h: out[i].h, type: out[i].h >= MEAN_LEVEL ? 'high' : 'low' });
    }
  }
  return { current: +tideAt(now).toFixed(2), extremes: ext.slice(0, 4) };
}

// 单站潮汐（真实或降级）
async function getTide(st) {
  if (NMDIS_APPID && NMDIS_APPSECRET) {
    try {
      // 真实接口调用占位（需按国家海洋信息中心协议实现）
      const res = await fetch(`${API.nmdis}/GetPortTideData`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: NMDIS_APPID, appsecret: NMDIS_APPSECRET, port: st.name }),
      });
      if (res.ok) {
        const d = await res.json();
        return { ok: true, source: '国家海洋信息中心', current: d.cur, extremes: d.extremes, warnLevel: st.warnLevel };
      }
    } catch (e) { /* fallthrough to model */ }
  }
  const p = predictDay(st);
  return {
    ok: true, source: '调和模型估算(演示)', configured: false,
    current: p.current, extremes: p.extremes,
    warnLevel: st.warnLevel, meanLevel: MEAN_LEVEL,
    exceeded: p.current >= st.warnLevel,
  };
}

async function getAllTides() {
  return Promise.all(TIDE_STATIONS.map(async st => ({ ...st, ...(await getTide(st)) })));
}

module.exports = { tideAt, predictDay, getTide, getAllTides };
