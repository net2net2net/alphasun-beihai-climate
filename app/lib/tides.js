// AlphaSun · 潮汐/水位
// 主源：国家海洋信息中心 潮汐潮流预报服务（service-tide.nmdis.org.cn）
//   接口：POST /api/v1/CoreData/GetPortTideData?SiteCode=<站点代码>&Date=<YYYY-MM-DD>
//   认证：请求头 appid / appsecret（简单身份认证）；返回 a0..a23(逐时潮高cm) + csN/cgN(高低潮时分/潮高cm)
//   文档：http://service-tide.nmdis.org.cn/API/direction
// 降级：调和模型估算（六分潮 M2/S2/N2/K1/O1/P1，按站点 tideScale/tidePhase 差异化）。方法与 NMDIS 天文潮预报同源，
//       仅调和常数用北海近似估值，故标注「模型估算」；配置 NMDIS_APPID/APPSECRET + 站点 siteCode 后切换官方预报。
const { API, TIDE_STATIONS } = require('./config');
// 站点代码匹配逻辑（与 tools/nmdis-portlist.js、app-android/www/js/data.js 共用同一套规则）
const { matchStations, pickPortList } = require('./tideSites');
// NMDIS 访问层（含 DNS 兜底：本机 DNS 解析失败时自动走 DoH 直连 IP）
const { postNmdis } = require('./nmdisHttp');

// 北海近似调和常数（相对海图基准面/LAT，单位 m），公开资料估算值，仅供演示。
// 主分潮 M2/S2 主导半日潮；N2/P1 修正大潮-小潮与日潮不等；K1/O1 主导日潮不等。
const CONSTITUENTS = [
  { name: 'M2', amp: 0.95, period: 12.4206, phase: 1.2 },
  { name: 'S2', amp: 0.40, period: 12.0000, phase: 0.4 },
  { name: 'N2', amp: 0.19, period: 12.6584, phase: 2.1 },
  { name: 'K1', amp: 0.22, period: 23.9345, phase: 3.1 },
  { name: 'O1', amp: 0.17, period: 25.8194, phase: 5.0 },
  { name: 'P1', amp: 0.12, period: 24.0659, phase: 3.6 },
];
// 各分潮振幅之和：用于把曲线基准面校准到 LAT，使天文潮下限 ≈ 0（避免低潮被钳平的假象）。
const SUM_AMP = CONSTITUENTS.reduce((a, c) => a + c.amp, 0);

// 潮汐天文潮高（相对 LAT，m）。st 可携带 tideScale(潮差缩放)/tidePhase(相位微调)。
function tideAt(st, date, phaseOff = 0) {
  const t = date.getTime() / 1000; // 秒
  const scale = (st && st.tideScale) || 1;            // 站点潮差缩放
  const ph = (st && st.tidePhase) || 0;               // 站点相位微调
  const offset = SUM_AMP * scale;                     // 基准面：令曲线下限≈LAT(>0)，消除钳平假象
  let h = offset;
  for (const c of CONSTITUENTS) {
    h += c.amp * scale * Math.cos((2 * Math.PI * t) / (c.period * 3600) - c.phase + phaseOff + ph);
  }
  return +h.toFixed(2); // 已无需 Math.max(0,h)，offset 保证下界为正；极端情形仍保留安全下限
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
  for (let k = 0; k < 48; k++) base.push(tideAt(st, new Date(startMs + k * 3600000), phaseOff));
  return { base, startMs };
}

// 由模型连续波形检测高低潮极值（局部极大/极小）。
// 以序列自身均值判定高/低，并过滤 15min 插值的微抖：要求最低显著起伏 PROM 与相邻间隔 MIN_GAP_H，
// 且强制高/低交替（保留离均值更远者），避免把接近均值的次要拐点误标为「低潮 3.5m」之类。
function modelExtremes(series) {
  if (!series.length) return [];
  const m = series.reduce((a, b) => a + b.h, 0) / series.length;
  const PROM = 0.18;        // 最小显著起伏(m)
  const MIN_GAP_H = 2.5;    // 相邻极值最小时间间隔(h)
  const raw = [];
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1].h, b = series[i].h, c = series[i + 1].h;
    if ((b > a && b >= c) || (b < a && b <= c)) {
      raw.push({ t: new Date(series[i].t).getTime(), h: b, type: b >= m ? 'high' : 'low' });
    }
  }
  const out = [];
  for (const e of raw) {
    if (Math.abs(e.h - m) < PROM) continue; // 太接近均值，视为平台噪声
    if (out.length) {
      const last = out[out.length - 1];
      const gapH = (e.t - last.t) / 3600000;
      if (gapH < MIN_GAP_H || e.type === last.type) {
        if (Math.abs(e.h - m) <= Math.abs(last.h - m)) continue; // 保留更显著者
        out.pop();
      }
    }
    out.push(e);
  }
  return out.map(e => ({ time: new Date(e.t).toISOString(), h: +e.h.toFixed(2), type: e.type }));
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

// NMDIS 请求（认证头 appid/appsecret，SiteCode/Date 走查询参数，空 body）
// 带 8s 超时 + 单次重试；任意失败返回 null，由 getTide 降级模型
// 凭证在每次调用时从 process.env 懒读取（server.js 已把 config.json/环境变量回写进 process.env，
// 模块加载期捕获会导致 EXE 双击启动时注入的 config.json 凭证不生效）。
// 走 nmdisHttp.postNmdis：本机 DNS 解析不到 service-tide.nmdis.org.cn 时自动 DoH 兜底直连 IP。
const NMDIS_TIMEOUT_MS = 8000;
async function nmdisFetch(siteCode, dateStr, attempt = 0) {
  const appid = process.env.NMDIS_APPID || '';
  const appsecret = process.env.NMDIS_APPSECRET || '';
  if (!appid || !appsecret) return null; // 无凭证直接走降级，避免无效外网请求
  const pathAndQuery = `/api/v1/CoreData/GetPortTideData?SiteCode=${encodeURIComponent(siteCode)}&Date=${dateStr}`;
  try {
    const r = await postNmdis(API.nmdis, pathAndQuery, { appid, appsecret }, {}, NMDIS_TIMEOUT_MS);
    if (!r || r.status < 200 || r.status >= 300) { if (attempt < 1) return nmdisFetch(siteCode, dateStr, attempt + 1); return null; }
    const j = JSON.parse(r.text);
    if (!j || j.ResultCode !== '200' || !j.ResultValue || !j.ResultValue.data) {
      if (attempt < 1) return nmdisFetch(siteCode, dateStr, attempt + 1);
      return null;
    }
    return j.ResultValue; // { report:{...Benchmark...}, data:{ a0..a23, csN, cgN } }
  } catch (e) {
    if (attempt < 1) return nmdisFetch(siteCode, dateStr, attempt + 1);
    return null;
  }
}

// ---- 站点代码自动解析（NMDIS「获取站点列表」接口，需凭证）----
// 用户只需在 config.json 配置 NMDIS_APPID/APPSECRET（EXE 放 .exe 同目录），
// 应用首次取数时自行调用 GetPortList 解析三港真实 SiteCode，免去人工查码；
// config.json 的 tideSiteCodes 仍为最高优先级覆盖。解析结果缓存 24h。
// 匹配规则见 lib/tideSites.js：站名别名优先 → 同名多候选用坐标消歧 → 坐标就近兜底。
const PORTLIST_PATH = '/api/v1/CoreData/GetPortList';
let _codeCache = null, _codeCacheAt = 0, _codeInflight = null, _codeLogged = false;
async function resolveSiteCodes() {
  const appid = process.env.NMDIS_APPID || '';
  const appsecret = process.env.NMDIS_APPSECRET || '';
  if (!appid || !appsecret) return null;
  try {
    const r = await postNmdis(API.nmdis, PORTLIST_PATH, { appid, appsecret }, {}, NMDIS_TIMEOUT_MS);
    if (!r || r.status < 200 || r.status >= 300) return null;
    const j = JSON.parse(r.text);
    if (!j) return null;
    const list = pickPortList(j);
    if (!list) return null;
    // matchStations 返回 { bhg:{code,title,via,distKm}, tsg:{...}, wzd:{...} }
    const matched = matchStations(list, TIDE_STATIONS);
    return Object.keys(matched).length ? matched : null;
  } catch (e) {
    return null;
  }
}
async function ensureCodes() {
  const now = Date.now();
  if (_codeCache && now - _codeCacheAt <= 24 * 3600 * 1000) return _codeCache;
  if (_codeInflight) return _codeInflight; // 并发去重：同一时刻只发一次 GetPortList
  _codeInflight = (async () => {
    const m = await resolveSiteCodes();
    _codeCache = m; _codeCacheAt = Date.now(); _codeInflight = null;
    if (m) {
      const detail = Object.entries(m)
        .map(([id, v]) => `${id}=${v.code}(${v.via === 'coord' ? '坐标兜底' : '站名匹配'})`)
        .join(' ');
      console.log(`[tide] 已从 NMDIS 解析站点代码：${detail}`);
    } else if (!_codeLogged) {
      console.log('[tide] NMDIS 站点列表解析失败（凭证无效或网络不可达），潮汐回退演示模型；可在 config.json 用 tideSiteCodes 显式指定各港代码');
    }
    _codeLogged = true;
    return m;
  })();
  return _codeInflight;
}
// 解析某站点的有效 SiteCode：显式配置（config.json tideSiteCodes / TIDE_STATIONS.siteCode）> 自动解析缓存
async function siteCodeFor(st) {
  if (st.siteCode) return st.siteCode;
  const map = await ensureCodes();
  if (map && map[st.id] && map[st.id].code) return map[st.id].code;
  return null;
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
  const range = +(highest - lowest).toFixed(2);
  // 大潮/中潮/小潮 估算：窗口潮差相对站点理论最大潮差，随 M2−S2/N2 拍频自然在朔望大潮↔上/下弦小潮间摆动
  const scale = (st && st.tideScale) || 1;
  const typicalRange = +(2 * SUM_AMP * scale).toFixed(2);
  let springNeap = '中潮';
  if (typicalRange > 0) {
    const rr = range / typicalRange;
    springNeap = rr >= 0.8 ? '大潮' : (rr <= 0.45 ? '小潮' : '中潮');
  }
  const tidalType = (st && st.tideType) || '半日潮';
  const perHour = 60 / 15;
  const hourly = [];
  for (let k = 0; k <= 24; k++) hourly.push(series[Math.min(k * perHour, series.length - 1)]);
  return {
    ok: true,
    source: meta.source, configured: meta.configured, model: !!meta.model, real: !!meta.real, degraded: !!meta.degraded,
    datumLabel: meta.datumLabel || '理论最低潮面 (LAT)',
    meanLevel, current, trend, rate, lowest, highest, range,
    tidalType, springNeap, typicalRange,
    warnLevel: st.warnLevel, margin: +(current - st.warnLevel).toFixed(2), exceeded: current >= st.warnLevel,
    series, extremes: ext, next, hourly,
  };
}

// 降级/兜底：调和模型估算；degraded=true 表示已配置 NMDIS 但请求失败，仅用于 UI 提示
function modelFallback(st, degraded) {
  const { base, startMs } = modelBase(st);
  const series = buildSeries(base, startMs, Date.now());
  const rawExtremes = modelExtremes(series); // 模型极值已自带正确的高/低类型，不再经 classifyExtremes（其严格交替假设会在近均值点误标）
  return finalizeTide(st, series, rawExtremes, {
    source: degraded ? '官方预报不可用·已降级模型' : '调和模型估算(演示)',
    configured: !!degraded, model: true, real: false, degraded: !!degraded,
    datumLabel: '理论最低潮面 (LAT)',
  });
}

// 单站潮汐（NMDIS 官方预报优先；缺凭据/站点代码或请求超时/失败 → 降级模型并标记 degraded）
async function getTide(st) {
  const NMDIS_APPID = process.env.NMDIS_APPID || '';
  const NMDIS_APPSECRET = process.env.NMDIS_APPSECRET || '';
  if (NMDIS_APPID && NMDIS_APPSECRET) {
    const siteCode = await siteCodeFor(st); // 显式配置优先，否则从 NMDIS 站点列表自动解析
    if (siteCode) {
      try {
        const today = new Date();
        const d0 = localDateStr(today);
        const d1 = localDateStr(new Date(today.getTime() + 86400000));
        const [r0, r1] = await Promise.all([nmdisFetch(siteCode, d0), nmdisFetch(siteCode, d1)]);
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
        return modelFallback(st, true); // 已配置但无可用数据
      } catch (e) {
        return modelFallback(st, true); // 请求/超时/解析异常
      }
    }
    return modelFallback(st, false); // 已配置凭证但未能解析到该站代码 → 仍走演示模型
  }
  return modelFallback(st, false); // 未配置凭证
}

async function getAllTides() {
  return Promise.all(TIDE_STATIONS.map(async st => ({ ...st, ...(await getTide(st)) })));
}

module.exports = {
  tideAt, modelBase, buildSeries, parseNmdisDay, classifyExtremes,
  sampleBase, sampleSeries, finalizeTide, getTide, getAllTides,
};
