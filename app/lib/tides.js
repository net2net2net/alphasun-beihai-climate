// AlphaSun · 潮汐/水位
// 主源：国家海洋信息中心 潮汐潮流预报服务（service-tide.nmdis.org.cn）
//   接口：POST /api/v1/CoreData/GetPortTideData?SiteCode=<站点代码>&Date=<YYYY-MM-DD>
//   认证：请求头 appid / appsecret（简单身份认证）；返回 a0..a23(逐时潮高cm) + csN/cgN(高低潮时分/潮高cm)
//   文档：http://service-tide.nmdis.org.cn/API/direction
// 降级：调和模型估算（双半日潮 M2+S2 + 日潮 K1+O1）。方法与 NMDIS 天文潮预报同源，
//       仅调和常数用北海近似估值，故标注「模型估算」；配置 NMDIS_APPID/APPSECRET + 站点 siteCode 后切换官方预报。
const { API, NMDIS_APPID, NMDIS_APPSECRET, TIDE_STATIONS } = require('./config');

// 北海近似调和常数（相对海图基准面/LAT，单位 m），公开资料估算值，仅供演示
const CONSTITUENTS = [
  { name: 'M2', amp: 1.9, period: 12.4206, phase: 1.2 },
  { name: 'S2', amp: 0.7, period: 12.0000, phase: 0.4 },
  { name: 'K1', amp: 0.4, period: 23.9345, phase: 3.1 },
  { name: 'O1', amp: 0.3, period: 25.8194, phase: 5.0 },
];
const MEAN_LEVEL = 1.6; // 平均潮位 m

function tideAt(date, phaseOff = 0) {
  const t = date.getTime() / 1000; // 秒
  let h = MEAN_LEVEL;
  for (const c of CONSTITUENTS) {
    h += c.amp * Math.cos((2 * Math.PI * t) / (c.period * 3600) - c.phase + phaseOff);
  }
  return +Math.max(0, h).toFixed(2); // 相对理论最低潮面(LAT)，下限钳 0
}

// 本地日期 YYYY-MM-DD（按设备/服务器时区）
function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 由「今日+明日」48 个逐时潮高(m) 插值任意时刻潮高；base[k] 对应 当日00:00 + k 小时
function sampleBase(base, startMs, ms) {
  const hr = (ms - startMs) / 3600000;
  if (hr <= 0) return base[0];
  if (hr >= base.length - 1) return base[base.length - 1];
  const i0 = Math.floor(hr), frac = hr - i0;
  return base[i0] + (base[i0 + 1] - base[i0]) * frac;
}

// 生成 48h / 15min 连续波形，起点为 now（与前端曲线/「现在」标记对齐）
function buildSeries(base, startMs, nowMs, STEP_MIN = 15, HORIZON_H = 48) {
  const n = HORIZON_H * 60 / STEP_MIN; // 192 步
  const series = [];
  for (let i = 0; i <= n; i++) {
    const ms = nowMs + i * STEP_MIN * 60000;
    series.push({ t: new Date(ms).toISOString(), h: +sampleBase(base, startMs, ms).toFixed(2) });
  }
  return series;
}

// 模型逐时基底（今日+明日，本地时）
function modelBase(st) {
  const phaseOff = (st.lon - 109.11) * 0.3; // 各验潮站按经度给微小潮时滞后，使港口间存在差异
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const startMs = start.getTime();
  const base = [];
  for (let k = 0; k < 48; k++) base.push(tideAt(new Date(startMs + k * 3600000), phaseOff));
  return { base, startMs };
}

// 由模型连续波形检测高低潮极值（局部极大/极小）
function modelExtremes(series) {
  const ext = [];
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1].h, b = series[i].h, c = series[i + 1].h;
    if ((b > a && b >= c) || (b < a && b <= c)) {
      ext.push({ time: series[i].t, h: b, type: b >= MEAN_LEVEL ? 'high' : 'low' });
    }
  }
  return ext;
}

// 解析 NMDIS 单日返回：a0..a23 逐时潮高(cm) + csN/cgN 高低潮（时分 HH:MM / 潮高 cm）
function parseNmdisDay(data, dateStr) {
  const hourly = [];
  for (let h = 0; h <= 23; h++) {
    const v = data['a' + h];
    if (typeof v !== 'number') break;
    hourly.push(+(v / 100).toFixed(2)); // cm → m（相对海图基准面/LAT）
  }
  const extremes = [];
  for (let i = 0; i < 12; i++) {
    const ts = data['cs' + i], g = data['cg' + i];
    if (ts == null || g == null) break;
    const parts = String(ts).split(':');
    const d = new Date(dateStr + 'T00:00:00'); // 本地日界
    d.setHours(+parts[0], +(parts[1] || 0), 0, 0);
    extremes.push({ time: d.toISOString(), h: +(g / 100).toFixed(2), type: g >= 0 ? 'high' : 'low' });
  }
  return { hourly, extremes, benchmark: data.Benchmark || null };
}

// 由按时间序的高低潮重新判定高/低（NMDIS 仅给时分与潮高，不标类型）
function classifyExtremes(exts) {
  return exts.map((e, i) => {
    const prev = exts[i - 1] && exts[i - 1].h, next = exts[i + 1] && exts[i + 1].h;
    const isHigh = (prev == null || e.h > prev) && (next == null || e.h > next);
    return { time: e.time, h: e.h, type: isHigh ? 'high' : 'low' };
  });
}

// NMDIS 请求（Node 端用全局 fetch；认证头 appid/appsecret，SiteCode/Date 走查询参数，空 body）
async function nmdisFetch(siteCode, dateStr) {
  const url = `${API.nmdis}/api/v1/CoreData/GetPortTideData?SiteCode=${encodeURIComponent(siteCode)}&Date=${dateStr}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', appid: NMDIS_APPID, appsecret: NMDIS_APPSECRET },
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j || j.ResultCode !== '200' || !j.ResultValue || !j.ResultValue.data) return null;
  return j.ResultValue; // { report:{...Benchmark...}, data:{ a0..a23, csN, cgN } }
}

// 等间隔(15min)序列任意时刻插值
function sampleSeries(series, ms) {
  const t0 = new Date(series[0].t).getTime();
  const f = (ms - t0) / (15 * 60000);
  if (f <= 0) return series[0].h;
  if (f >= series.length - 1) return series[series.length - 1].h;
  const i0 = Math.floor(f), frac = f - i0;
  return series[i0].h + (series[i0 + 1].h - series[i0].h) * frac;
}

// 统一收口：由连续波形 + 原始极值 → 前端所需全部派生量
function finalizeTide(st, series, rawExtremes, meta) {
  const nowMs = new Date(series[0].t).getTime();
  const lastMs = new Date(series[series.length - 1].t).getTime();
  const STEP_MS = 15 * 60000;
  const current = series[0].h;
  const h30 = sampleSeries(series, nowMs + 30 * 60000);
  const rate = +((h30 - current) / 0.5).toFixed(3); // m/h
  const trend = Math.abs(rate) < 0.02 ? 'flat' : (rate > 0 ? 'rising' : 'falling');
  // 极值：仅保留 [now, now+48h] 窗口，定位曲线 idx、距今 inHours、标记下一次(next)
  const ext = (rawExtremes || [])
    .filter(e => { const ms = new Date(e.time).getTime(); return ms >= nowMs && ms <= lastMs; })
    .sort((a, b) => new Date(a.time) - new Date(b.time))
    .map(e => {
      const ms = new Date(e.time).getTime();
      const idx = Math.max(0, Math.min(series.length - 1, Math.round((ms - nowMs) / STEP_MS)));
      return { idx, time: e.time, h: e.h, type: e.type, inHours: +((ms - nowMs) / 3600000).toFixed(1) };
    });
  let next = null;
  for (const e of ext) { if (new Date(e.time).getTime() >= nowMs) { next = e; break; } }
  if (next) ext.forEach(e => { e.next = (e.time === next.time); });
  const hs = series.map(s => s.h);
  const lowest = +Math.min(...hs).toFixed(2), highest = +Math.max(...hs).toFixed(2);
  const meanLevel = +(hs.reduce((a, b) => a + b, 0) / hs.length).toFixed(2);
  const perHour = 60 / 15;
  const hourly = [];
  for (let k = 0; k <= 24; k++) hourly.push(series[Math.min(k * perHour, series.length - 1)]);
  return {
    ok: true,
    source: meta.source, configured: meta.configured, model: !!meta.model, real: !!meta.real,
    datumLabel: meta.datumLabel || '理论最低潮面 (LAT)',
    meanLevel, current, trend, rate, lowest, highest, range: +(highest - lowest).toFixed(2),
    warnLevel: st.warnLevel, margin: +(current - st.warnLevel).toFixed(2), exceeded: current >= st.warnLevel,
    series, extremes: ext, next, hourly,
  };
}

// 单站潮汐（NMDIS 官方预报优先，缺凭据/站点代码或请求失败时降级模型）
async function getTide(st) {
  if (NMDIS_APPID && NMDIS_APPSECRET && st.siteCode) {
    try {
      const today = new Date();
      const d0 = localDateStr(today);
      const d1 = localDateStr(new Date(today.getTime() + 86400000));
      const [r0, r1] = await Promise.all([nmdisFetch(st.siteCode, d0), nmdisFetch(st.siteCode, d1)]);
      if (r0 && r0.data) {
        const p0 = parseNmdisDay(r0.data, d0);
        const p1 = r1 && r1.data ? parseNmdisDay(r1.data, d1) : null;
        if (p0.hourly.length === 24) {
          const base = p0.hourly.concat(p1 && p1.hourly.length === 24 ? p1.hourly : []);
          const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
          const startMs = start.getTime();
          const series = buildSeries(base, startMs, today.getTime());
          const rawExtremes = classifyExtremes(p0.extremes.concat(p1 ? p1.extremes : []));
          const benchmark = p0.benchmark || (r0.report && r0.report.Benchmark) || null;
          return finalizeTide(st, series, rawExtremes, {
            source: '国家海洋信息中心(预报)',
            configured: true, real: true,
            datumLabel: benchmark ? ('海图基准面：' + benchmark) : '理论最低潮面 (LAT)',
          });
        }
      }
    } catch (e) { /* 落回模型 */ }
  }
  // 降级：调和模型估算
  const { base, startMs } = modelBase(st);
  const series = buildSeries(base, startMs, Date.now());
  const rawExtremes = classifyExtremes(modelExtremes(series));
  return finalizeTide(st, series, rawExtremes, {
    source: '调和模型估算(演示)',
    configured: false, model: true,
    datumLabel: '理论最低潮面 (LAT)',
  });
}

async function getAllTides() {
  return Promise.all(TIDE_STATIONS.map(async st => ({ ...st, ...(await getTide(st)) })));
}

module.exports = {
  tideAt, modelBase, buildSeries, parseNmdisDay, classifyExtremes,
  sampleBase, sampleSeries, finalizeTide, getTide, getAllTides,
};
