// AlphaSun · 数据源适配层
// 所有函数返回归一化对象；失败返回 { ok:false, error } 不影响整体。
const http = require('https');
const { API, wmo, GEO, PROV_GEO, WARN_CAT, WARN_LEVEL, RIVER_PROFILE, RESERVOIR_PROFILE } = require('./config');

function fetchJSON(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => clearTimeout(t));
}

// 解析 JSONP 文本：typhoon_jsons_xxx(({...})) → 对象（兼容单/双外层括号）
function parseJSONP(text) {
  const m = text.match(/^\s*[\w$]+\s*\(+\s*([\s\S]*?)\s*\)+\s*;?\s*$/);
  if (!m) throw new Error('not JSONP');
  return JSON.parse(m[1]);
}
function fetchJSONP(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(parseJSONP)
    .finally(() => clearTimeout(t));
}

// 从预警标题中解析发布城市坐标（先匹配市/县，未命中再兜底到省级）
function geoFromTitle(title) {
  if (!title) return null;
  let best = null, bestLen = 0;
  for (const name of Object.keys(GEO)) {
    if (title.includes(name) && name.length > bestLen) { best = name; bestLen = name.length; }
  }
  if (best) { const [lat, lon] = GEO[best]; return { city: best.replace(/市$/, ''), lat, lon }; }
  // 省级兜底
  for (const name of Object.keys(PROV_GEO)) {
    if (title.includes(name) && name.length > bestLen) { best = name; bestLen = name.length; }
  }
  if (best) { const [lat, lon] = PROV_GEO[best]; return { city: best.replace(/省$|自治区$|市$/, ''), lat, lon, approx: true }; }
  return null;
}

// 从预警标题解析级别（蓝色/黄色/橙色/红色）
function levelFromTitle(title) {
  for (const k of ['红色', '橙色', '黄色', '蓝色']) if (title.includes(k)) return k;
  return '未知';
}

function qs(base, params) {
  const u = new URL(base);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

// ===== 1. 陆地气象 + 天文（Open-Meteo Forecast）=====
async function fetchForecast(s) {
  const url = qs(API.forecast, {
    latitude: s.lat, longitude: s.lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,is_day',
    hourly: 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,weather_code,relative_humidity_2m,cloud_cover,pressure_msl',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,pressure_msl_max,sunrise,sunset,moonrise,moonset,moon_phase',
    forecast_days: '16', timezone: 'Asia/Shanghai', wind_speed_unit: 'ms',
  });
  const d = await fetchJSON(url);
  const cur = d.current, daily = d.daily, hr = d.hourly;
  const nowIdx = hr.time.findIndex(t => t > cur.time.slice(0, 13));
  const start = nowIdx < 0 ? 0 : nowIdx;
  const next24 = Array.from({ length: 24 }, (_, i) => {
    const k = start + i;
    return {
      time: hr.time[k], temp: hr.temperature_2m[k], feels: hr.apparent_temperature[k],
      precip: hr.precipitation[k], precipProb: hr.precipitation_probability[k],
      wind: hr.wind_speed_10m[k], gust: hr.wind_gusts_10m[k],
      code: hr.weather_code[k], rh: hr.relative_humidity_2m[k],
      cloud: hr.cloud_cover[k], pressure: hr.pressure_msl[k],
    };
  });
  return {
    ok: true,
    current: {
      time: cur.time, temp: cur.temperature_2m, feels: cur.apparent_temperature,
      rh: cur.relative_humidity_2m, precip: cur.precipitation, code: cur.weather_code,
      text: wmo(cur.weather_code)[0], icon: wmo(cur.weather_code)[1],
      wind: cur.wind_speed_10m, gust: cur.wind_gusts_10m, windDir: cur.wind_direction_10m,
      pressure: cur.pressure_msl, cloud: cur.cloud_cover, isDay: cur.is_day,
    },
    daily: daily.time.map((t, i) => ({
      date: t, code: daily.weather_code[i], text: wmo(daily.weather_code[i])[0],
      tmax: daily.temperature_2m_max[i], tmin: daily.temperature_2m_min[i],
      precip: daily.precipitation_sum[i], precipProb: daily.precipitation_probability_max[i],
      windMax: daily.wind_speed_10m_max[i], gustMax: daily.wind_gusts_10m_max[i],
      pressure: daily.pressure_msl_max[i],
      sunrise: daily.sunrise[i], sunset: daily.sunset[i],
      moonrise: daily.moonrise[i], moonset: daily.moonset[i],
      moonPhase: daily.moon_phase[i],
    })),
    hourly24: next24,
  };
}

// ===== 1.5 中国天气网站测实况（CMA 官方，免 key，作为 current 权威校验/覆盖源）=====
function zhWeatherToWmo(text) {
  if (!text) return 3;
  if (/雷阵雨|雷雨|雷电|暴雨|大暴雨|特大暴雨/.test(text)) return 95;
  if (/暴雨/.test(text)) return 65;
  if (/大雨/.test(text)) return 65;
  if (/中雨/.test(text)) return 63;
  if (/小雨|阵雨|零星小雨|小阵雨/.test(text)) return 80;
  if (/雨夹雪/.test(text)) return 85;
  if (/雪/.test(text)) return 73;
  if (/雾|霾|沙尘/.test(text)) return 45;
  if (/晴/.test(text)) return 0;
  if (/多云|阴/.test(text)) return 3;
  return 3;
}
function dirToDeg(d) {
  const M = { 北: 0, 东北: 45, 东: 90, 东南: 135, 南: 180, 西南: 225, 西: 270, 西北: 315 };
  if (!d) return 0;
  for (const k of Object.keys(M)) if (String(d).includes(k)) return M[k];
  return 0;
}
// 中国天气网(CMA) 公开接口 d1.weather.com.cn/sk_ 已于近年全局下线（301 跳转商用引导页），
// 故改用「和风天气 QWeather」——CMA 数据的官方商业分发方——作为权威中国实况源。
// 配置环境变量 QWEATHER_KEY（免费 dev key）后启用；未配置时回退原 d1 接口（通常不可达，标记 skipped）。
async function qweatherNow(s) {
  const key = process.env.QWEATHER_KEY;
  if (!key) return null;
  const host = process.env.QWEATHER_HOST || 'devapi.qweather.com';
  const url = `https://${host}/v7/weather/now?location=${s.lon.toFixed(3)},${s.lat.toFixed(3)}&key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let d;
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'X-Qweather-Token': key } });
    if (!r.ok) throw new Error('qweather HTTP ' + r.status);
    d = await r.json();
  } finally { clearTimeout(t); }
  if (!d || String(d.code) !== '200' || !d.now) throw new Error('qweather: ' + (d && d.code) + ' ' + (d && d.message || ''));
  const n = d.now;
  const zh = String(n.text || '').trim();
  const code = zhWeatherToWmo(zh);
  const wind = (parseFloat(n.windSpeed) || 0) / 3.6; // km/h -> m/s
  return {
    ok: true, source: 'cma', label: '中国天气网(CMA)', time: n.obsTime || null,
    current: {
      time: new Date().toISOString().slice(0, 16),
      temp: parseFloat(n.temp), feels: parseFloat(n.feelsLike),
      rh: parseInt(n.humidity, 10) || 0, precip: parseFloat(n.precip) || 0,
      code, text: zh || wmo(code)[0], icon: wmo(code)[1],
      wind, gust: 0, windDir: dirToDeg(n.windDir),
      pressure: parseFloat(n.pressure) || 0, cloud: parseInt(n.cloud, 10) || 100, isDay: 1,
    },
  };
}
async function fetchCmaLive(s) {
  const lat = (s && typeof s.lat === 'number') ? s.lat : 21.48;
  const lon = (s && typeof s.lon === 'number') ? s.lon : 109.11;
  // 1) 优先和风天气（CMA 官方分发，需免费 key）；无 key 或拉取失败则回落原接口
  const qw = await qweatherNow({ lat, lon }).catch(() => null);
  if (qw) { return qw; }
  // 2) 原公开接口（多数网络已停用，保留兼容）
  const CITY = '101300501'; // 北海市（中国天气网城市代码）
  const url = `http://d1.weather.com.cn/sk_${CITY}.html`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let text;
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'http://www.weather.com.cn/' } });
    text = await r.text();
  } catch (e) { return { ok: false, error: 'cma fetch failed: ' + (e.message || e), skipped: !process.env.QWEATHER_KEY }; }
  finally { clearTimeout(t); }
  try {
    const m = text.match(/var\s+dataSK\s*=\s*(\{[\s\S]*?\});/);
    if (!m) return { ok: false, error: 'cma: 公开接口已停用(需配置 QWEATHER_KEY)', skipped: !process.env.QWEATHER_KEY };
    const j = JSON.parse(m[1]);
    const zh = String(j.weather || '').trim();
    const code = zhWeatherToWmo(zh);
    const wmoPair = wmo(code);
    const rh = parseInt(j.SD, 10);
    const precip = parseFloat(j.rain);
    const wind = parseFloat(String(j.WS || '0').replace(/[^0-9.]/g, ''));
    return {
      ok: true, source: 'cma', city: CITY, time: j.time,
      current: {
        time: new Date().toISOString().slice(0, 16),
        temp: parseFloat(j.temp), feels: parseFloat(j.temp),
        rh: isNaN(rh) ? null : rh, precip: isNaN(precip) ? 0 : precip,
        code, text: zh || wmoPair[0], icon: wmoPair[1],
        wind: isNaN(wind) ? 0 : wind, gust: 0,
        windDir: dirToDeg(j.WD), pressure: 0, cloud: 100, isDay: 1,
      },
    };
  } catch (e) { return { ok: false, error: 'cma parse: ' + (e.message || e) }; }
}

// ===== 1.6 wttr.in 实况（第三方独立源，用于多源交叉校核）=====
function enToWmo(text) {
  const t = String(text || '').toLowerCase();
  if (/thunder|storm|lightning/.test(t)) return { code: 95, zh: '雷阵雨' };
  if (/heavy rain|暴雨|torrential/.test(t)) return { code: 65, zh: '大雨' };
  if (/rain|shower|drizzle|wet|precip/.test(t)) return { code: 61, zh: '雨' };
  if (/snow|sleet|blizzard|ice|frost/.test(t)) return { code: 71, zh: '雪' };
  if (/fog|mist|haze|smog/.test(t)) return { code: 45, zh: '雾' };
  if (/sunny|clear/.test(t)) return { code: 0, zh: '晴' };
  if (/cloud|overcast|grey/.test(t)) return { code: 3, zh: '多云' };
  return { code: 3, zh: '多云' };
}
async function fetchWttrLive(s) {
  const url = `https://wttr.in/${s.lat.toFixed(2)},${s.lon.toFixed(2)}?format=j1`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let text;
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (AlphaSun-Beihai)' } });
    text = await r.text();
  } catch (e) { return { ok: false, error: 'wttr fetch failed: ' + (e.message || e) }; }
  finally { clearTimeout(t); }
  try {
    const d = JSON.parse(text);
    const c = d.current_condition && d.current_condition[0];
    if (!c) return { ok: false, error: 'wttr: no current_condition' };
    const desc = (c.weatherDesc && c.weatherDesc[0] && c.weatherDesc[0].value) || '';
    const m = enToWmo(desc);
    return {
      ok: true, source: 'wttr', label: 'wttr.in', time: c.localObsDateTime || null,
      current: {
        temp: parseFloat(c.temp_C), feels: parseFloat(c.FeelsLikeC),
        rh: parseInt(c.humidity, 10) || 0,
        precip: parseFloat(c.precipMM) || 0,
        code: m.code, text: m.zh, icon: wmo(m.code)[1],
        wind: (parseFloat(c.windspeedKmph) || 0) / 3.6, gust: 0,
        windDir: parseFloat(c.winddirDegree) || 0, pressure: 0,
        cloud: parseInt(c.cloudcover, 10) || 0, isDay: 1,
      },
    };
  } catch (e) { return { ok: false, error: 'wttr parse: ' + (e.message || e) }; }
}

// ===== 1.6b 彩云天气实况（独立中国源，用于与 CMA/和风、Open-Meteo、wttr.in 交叉校核；
//        环境变量 CAIYUN_TOKEN 配置后启用；未配置标记 skipped。不同模型/提供商，增强分歧识别）=====
function caiyunSkyconToWmo(sky) {
  const t = String(sky || '').toUpperCase();
  if (/THUNDER|LIGHTNING|HAIL/.test(t)) return { code: 95, zh: '雷阵雨' };
  if (/RAIN|DRIZZLE/.test(t)) return { code: 61, zh: '雨' };
  if (/SNOW|SLEET/.test(t)) return { code: 71, zh: '雪' };
  if (/FOG|HAZE/.test(t)) return { code: 45, zh: '雾' };
  if (/CLOUDY|OVERCAST/.test(t)) return { code: 3, zh: '多云' };
  if (/CLEAR|PARTLY/.test(t)) return { code: 0, zh: '晴' };
  return { code: 3, zh: '多云' };
}
async function fetchCaiyunLive(s) {
  const token = process.env.CAIYUN_TOKEN;
  if (!token) return { ok: false, error: '未配置 CAIYUN_TOKEN（可选中国源）', skipped: true };
  const lat = (s && typeof s.lat === 'number') ? s.lat : 21.48;
  const lon = (s && typeof s.lon === 'number') ? s.lon : 109.11;
  const url = `https://api.caiyunapp.com/v2.6/${token}/${lon.toFixed(4)},${lat.toFixed(4)}/realtime.json`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let d;
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('caiyun HTTP ' + r.status);
    d = await r.json();
  } catch (e) { return { ok: false, error: 'caiyun fetch: ' + (e.message || e) }; }
  finally { clearTimeout(t); }
  try {
    const rt = (d && d.result && d.result.realtime) || {};
    const sky = caiyunSkyconToWmo(rt.skycon);
    const rh = (typeof rt.humidity === 'number') ? Math.round(rt.humidity * 100) : 0;
    const cloud = (typeof rt.cloudrate === 'number') ? Math.round(rt.cloudrate * 100) : 100;
    const windObj = (rt.wind && typeof rt.wind === 'object') ? rt.wind : null;
    const wind = windObj ? (parseFloat(windObj.speed) || 0) : 0;       // m/s
    const windDir = windObj ? (parseFloat(windObj.direction) || 0) : 0; // deg
    let precip = 0;
    if (rt.precipitation && typeof rt.precipitation === 'object') precip = parseFloat(rt.precipitation.local) || 0;
    else if (typeof rt.precipitation === 'number') precip = rt.precipitation;
    return {
      ok: true, source: 'caiyun', label: '彩云天气(Caiyun)', time: null,
      current: {
        time: new Date().toISOString().slice(0, 16),
        temp: parseFloat(rt.temperature),
        feels: parseFloat(rt.apparent_temperature != null ? rt.apparent_temperature : rt.temperature),
        rh, precip: isNaN(precip) ? 0 : precip,
        code: sky.code, text: sky.zh, icon: wmo(sky.code)[1],
        wind, gust: 0, windDir, pressure: 0, cloud, isDay: 1,
      },
    };
  } catch (e) { return { ok: false, error: 'caiyun parse: ' + (e.message || e) }; }
}

// ===== 1.7 多数据源实况交叉校核（CMA / Open-Meteo / wttr.in / 彩云天气）=====
// 归一化天气大类，用于源间一致性判定
function wxCategory(code, zh) {
  const t = String(zh || '');
  if (/雷|暴|雨|阵雨|降水|降雨/.test(t) || [61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return 'rain';
  if (/雪|霰|冰/.test(t) || [71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if (/雾|霾|沙尘/.test(t) || [45, 48].includes(code)) return 'fog';
  if (/晴/.test(t) && code <= 1) return 'clear';
  if (/多云|阴|云/.test(t) || [2, 3].includes(code)) return 'cloud';
  return 'other';
}
function snapOf(result, label, key) {
  let v = null;
  if (result && result.status === 'fulfilled') v = result.value;
  else if (result && typeof result.ok === 'boolean') v = result;
  if (!v || !v.ok || !v.current) {
    const err = (result && result.reason) ? String(result.reason) : (v && v.error ? v.error : (v ? '无实况数据' : '源不可达'));
    return { ok: false, label, source: key, error: err, skipped: !!(v && v.skipped) };
  }
  const c = v.current;
  return {
    ok: true, source: v.source || key, label: v.label || label,
    temp: c.temp, feels: c.feels, rh: c.rh, precip: c.precip,
    code: c.code, text: c.text, icon: c.icon, wind: c.wind,
    fetchedAt: v.time || null, category: wxCategory(c.code, c.text),
  };
}
// results: { openMeteo, cma, wttr }（Promise.allSettled 条目或归一化对象）；warnings: 北海相关预警数组 [{category, level, levelName}]
function verifyRealtime(results, warnings) {
  const srcs = [
    snapOf(results.openMeteo, 'Open-Meteo', 'openmeteo'),
    snapOf(results.cma, '中国天气网(CMA)', 'cma'),
    snapOf(results.wttr, 'wttr.in', 'wttr'),
    snapOf(results.caiyun, '彩云天气(Caiyun)', 'caiyun'),
  ];
  const valid = srcs.filter(s => s.ok);
  const checkedAt = new Date().toISOString();
  if (valid.length === 0) {
    return { ok: false, checkedAt, city: '北海', sources: srcs, agreement: 'unknown', confidence: 0, consensus: null, discrepancies: [{ field: 'availability', message: '全部实况数据源不可达', severity: 'high' }], recommended: null };
  }
  const catCount = {};
  valid.forEach(s => { catCount[s.category] = (catCount[s.category] || 0) + 1; });
  const cats = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a]);
  let consensusCat = cats[0];
  const temps = valid.map(s => s.temp).filter(x => typeof x === 'number' && !isNaN(x));
  const tmin = Math.min.apply(null, temps), tmax = Math.max.apply(null, temps);
  const tmean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const spread = tmax - tmin;
  const rhs = valid.map(s => s.rh).filter(x => typeof x === 'number' && !isNaN(x) && x > 0);
  const rhMean = rhs.length ? Math.round(rhs.reduce((a, b) => a + b, 0) / rhs.length) : null;
  const precipMax = Math.max.apply(null, [0].concat(valid.map(s => s.precip || 0)));
  const precipAny = precipMax > 0.3;
  const discrepancies = [];
  let conf = 1, agreement = 'high';
  if (valid.length >= 2 && cats.length > 1) {
    const minority = valid.length - catCount[consensusCat];
    if (consensusCat === 'rain' || consensusCat === 'storm') {
      discrepancies.push({ field: 'condition', message: '部分源未报降雨（综合判定：' + (consensusCat === 'storm' ? '雷暴' : '降雨') + '）', severity: minority >= 2 ? 'medium' : 'low' });
      if (minority >= 2) conf -= 0.1;
    } else {
      discrepancies.push({ field: 'condition', message: '天气现象源间不一致（' + cats.join(' / ') + '）', severity: minority >= 2 ? 'high' : 'medium' });
      conf -= minority >= 2 ? 0.35 : 0.18;
      agreement = minority >= 2 ? 'low' : 'medium';
    }
  }
  if (spread > 3) {
    discrepancies.push({ field: 'temp', message: '气温源间差异较大（' + tmin.toFixed(1) + '~' + tmax.toFixed(1) + '℃，差 ' + spread.toFixed(1) + '℃）', severity: spread > 5 ? 'high' : 'medium' });
    conf -= 0.2; if (agreement === 'high') agreement = 'medium';
  }
  if (precipAny && valid.some(s => (s.precip || 0) < 0.1 && consensusCat === 'rain')) {
    discrepancies.push({ field: 'precip', message: '部分源实况无降水，但综合有降雨', severity: 'low' });
  }
  // 官方预警佐证：若北海暴雨/强对流预警生效而综合未判降雨，则上调为降雨
  if (warnings && warnings.length) {
    const storm = warnings.find(a => /暴雨|雷雨|强对流|大风/.test(a.category || '') && (a.level || 0) >= 2);
    if (storm && consensusCat !== 'rain' && consensusCat !== 'storm') {
      discrepancies.push({ field: 'warning', message: '官方预警佐证降雨（' + (storm.levelName || '') + '），综合判定上调为降雨', severity: 'low' });
      consensusCat = 'rain'; conf = Math.min(1, conf + 0.1);
      if (agreement === 'low') agreement = 'medium';
    }
  }
  conf = Math.max(0, Math.min(1, +conf.toFixed(2)));
  const rec = valid.find(s => s.source === 'cma') || valid.find(s => s.category === consensusCat) || valid[0];
  const recommended = { temp: +tmean.toFixed(1), rh: rhMean, precip: +precipMax.toFixed(1), code: rec.code, text: rec.text, icon: rec.icon, source: rec.label };
  return {
    ok: true, checkedAt, city: '北海', sources: srcs,
    consensus: { category: consensusCat, tempMin: +tmin.toFixed(1), tempMax: +tmax.toFixed(1), tempMean: +tmean.toFixed(1), tempSpread: +spread.toFixed(1), rhMean, precipAny, precipMax: +precipMax.toFixed(1) },
    agreement, confidence: conf, discrepancies, recommended,
  };
}

// ===== 2. 空气质量（Open-Meteo Air Quality）=====
async function fetchAir(s) {
  const url = qs(API.air, {
    latitude: s.lat, longitude: s.lon,
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide',
    hourly: 'us_aqi,pm2_5,ozone', forecast_days: '3', timezone: 'Asia/Shanghai',
  });
  const d = await fetchJSON(url);
  const c = d.current;
  const aqiByHour = (d.hourly && d.hourly.time)
    ? d.hourly.time.map((t, i) => ({ time: t, aqi: d.hourly.us_aqi[i] }))
    : [];
  return {
    ok: true,
    aqi: c.us_aqi, pm25: c.pm2_5, pm10: c.pm10, o3: c.ozone,
    no2: c.nitrogen_dioxide, so2: c.sulphur_dioxide, co: c.carbon_monoxide,
    primary: aqiPrimary(c), hourlyAqi: aqiByHour,
  };
}
function aqiPrimary(c) {
  const arr = [['PM2.5', c.pm2_5], ['PM10', c.pm10], ['O₃', c.ozone], ['NO₂', c.nitrogen_dioxide], ['SO₂', c.sulphur_dioxide], ['CO', c.carbon_monoxide]];
  arr.sort((a, b) => b[1] - a[1]);
  return arr[0][0];
}

// ===== 3. 海洋（Open-Meteo Marine：浪高/浪周期/海温）=====
async function fetchMarine(s) {
  const url = qs(API.marine, {
    latitude: s.lat, longitude: s.lon,
    current: 'wave_height,wave_period,wave_direction,sea_surface_temperature,wind_wave_height',
    hourly: 'wave_height,sea_surface_temperature', timezone: 'Asia/Shanghai',
  });
  const d = await fetchJSON(url);
  const c = d.current;
  return {
    ok: true,
    waveHeight: c.wave_height, wavePeriod: c.wave_period,
    waveDir: c.wave_direction, windWaveHeight: c.wind_wave_height,
    seaTemp: c.sea_surface_temperature,
  };
}

// ===== 4. 洪涝（Open-Meteo Flood：近邻河流流量）=====
async function fetchFlood(s) {
  const url = qs(API.flood, {
    latitude: s.lat, longitude: s.lon,
    daily: 'river_discharge', forecast_days: '3', timezone: 'Asia/Shanghai',
  });
  const d = await fetchJSON(url);
  const v = d.daily.river_discharge;
  return { ok: true, discharge: v[0], hasRiver: v.some(x => x !== null && x > 0) };
}


// ===== 10. 江河 · 水库 权威档案（依据广西水文中心/北海市政府等公开资料整理；实时接口当前不可达，降级为档案）=====
async function fetchRiverReservoir() {
  let realtimeStatus = 'unreachable';
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const r = await fetch('http://swzx.gxzf.gov.cn/swfw/sqfw/sssq/', { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(t);
    realtimeStatus = (r.status < 400) ? 'reachable' : 'blocked';
  } catch (e) { realtimeStatus = 'unreachable'; }
  return {
    ok: true,
    realtime: false,
    realtimeStatus,
    source: '广西水文中心 / 北海市政府 / 北海新闻网 等公开资料整理（非实时站测）',
    updated: '2026-08-27',
    rivers: RIVER_PROFILE,
    reservoirs: RESERVOIR_PROFILE,
  };
}
// ===== 5. 气候背景（Open-Meteo Climate：1991–2020 月均态）=====
async function fetchClimate(s) {
  const url = qs(API.climate, {
    latitude: s.lat, longitude: s.lon,
    start_date: '1991-01-01', end_date: '2020-12-31',
    daily: 'temperature_2m_mean,precipitation_sum',
    models: 'CMCC_CM2_VHR4', timezone: 'Asia/Shanghai',
  });
  const d = await fetchJSON(url, 25000);
  const t = d.daily.temperature_2m_mean, p = d.daily.precipitation_sum;
  const monthT = Array(12).fill(0), monthP = Array(12).fill(0), cnt = Array(12).fill(0);
  d.daily.time.forEach((tm, i) => {
    const m = new Date(tm).getMonth();
    if (t[i] != null) { monthT[m] += t[i]; monthP[m] += p[i] || 0; cnt[m]++; }
  });
  return {
    ok: true,
    monthlyTemp: monthT.map((v, i) => +(v / cnt[i]).toFixed(1)),
    monthlyPrecip: monthP.map((v, i) => +(v / cnt[i]).toFixed(1)),
  };
}

// ===== 6. 地震（USGS GeoJSON，实时）=====
async function fetchEarthquakes() {
  const d = await fetchJSON(API.usgs, 20000);
  return {
    ok: true,
    events: d.features.map(f => ({
      mag: f.properties.mag, place: f.properties.place,
      time: f.properties.time, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      depth: f.geometry.coordinates[2], url: f.properties.url,
    })),
  };
}

// ===== 7. 野火（NASA FIRMS 活跃火点，需 MAP_KEY）=====
async function fetchFires() {
  if (!process.env.FIRMS_MAP_KEY) return { ok: false, configured: false, reason: '未配置 FIRMS_MAP_KEY' };
  // bbox 覆盖北部湾 + 桂南：经度 106–112，纬度 20–23
  const url = `${API.firms}/${process.env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/-1/106,20,112,23/1`;
  const csv = await fetch(url, { signal: AbortController ? new AbortController().signal : undefined }).then(r => r.text());
  const lines = csv.trim().split('\n').slice(1);
  const fires = lines.map(l => l.split(','))
    .filter(a => a.length > 5)
    .map(a => ({ lat: +a[0], lon: +a[1], frp: +a[2], time: a[5], conf: a[6] }));
  return { ok: true, configured: true, fires };
}

// ===== 8. 台风（中央气象台 nmc，实时路径）=====
async function fetchTyphoon() {
  try {
    const list = await fetchJSONP(API.typhoonList, 20000);
    const items = (list && list.typhoonList) || [];
    // 仅取活动台风（status === 'start'）
    const activeIds = items.filter(t => t[7] === 'start').map(t => t[0]);
    const typhoons = [];
    for (const id of activeIds.slice(0, 4)) {
      try {
        const v = await fetchJSONP(API.typhoonView + id, 20000);
        const arr = v.typhoon; if (!arr || !arr[8]) continue;
        const points = arr[8]
          .filter(p => Array.isArray(p) && p.length >= 8)
          .map(p => ({
            time: p[1], ts: p[2],
            lon: p[4], lat: p[5],
            pressure: p[6], wind: p[7],
            intensity: p[3] || 'TD',
            moveDir: p[8], moveSpeed: p[9],
            // 风圈半径（东北/东南/西南/西北，km）：取最大
            radius: (Array.isArray(p[10]) && p[10][0] && Array.isArray(p[10][0]))
              ? Math.max(...p[10].map(r => Math.max(r[1] || 0, r[2] || 0, r[3] || 0, r[4] || 0)))
              : 0,
          }))
          .filter(p => p.lat && p.lon);
        if (!points.length) continue;
        const cur = points[points.length - 1];
        typhoons.push({
          id, enName: arr[1], cnName: arr[2], number: arr[3], status: arr[7],
          points, current: cur,
        });
      } catch (e) { /* 单台风失败忽略 */ }
    }
    return { ok: true, count: typhoons.length, typhoons };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ===== 9. 气象预警信号（中央气象台 nmc：台风/暴雨/地灾/强对流）=====
// 覆盖：台风、暴雨(汛情)、地质灾害、雷暴大风(龙卷·强对流)
async function fetchWarnings() {
  const CATS = [
    { key: '台风',     signaltype: '台风' },
    { key: '暴雨',     signaltype: '暴雨' },
    { key: '地质灾害', signaltype: '地质灾害' },
    { key: '强对流',   signaltype: '雷暴大风' },
  ];
  const out = { typhoon: [], rainstorm: [], geological: [], convective: [], all: [] };
  await Promise.all(CATS.map(async ({ key, signaltype }) => {
    try {
      const url = `${API.alarm}?pageNo=1&pageSize=60&signaltype=${encodeURIComponent(signaltype)}&signallevel=&province=`;
      const d = await fetchJSON(url, 20000);
      const list = (d && d.data && d.data.page && d.data.page.list) || [];
      list.forEach(a => {
        const cat = WARN_CAT[signaltype];
        const geo = geoFromTitle(a.title);
        const lvTxt = levelFromTitle(a.title);
        const rec = {
          id: a.alertid, title: a.title, time: a.issuetime,
          url: a.url ? 'https://www.nmc.cn' + a.url : '',
          level: lvTxt, levelNum: (WARN_LEVEL[lvTxt] || {}).lv || 0,
          cat: cat.cat, catLabel: cat.label, color: cat.color,
          city: geo ? geo.city : null, lat: geo ? geo.lat : null, lon: geo ? geo.lon : null,
        };
        if (cat.cat === 'typhoon') out.typhoon.push(rec);
        else if (cat.cat === 'rainstorm') out.rainstorm.push(rec);
        else if (cat.cat === 'geological') out.geological.push(rec);
        else if (cat.cat === 'convective') out.convective.push(rec);
        out.all.push(rec);
      });
    } catch (e) { /* 单类失败忽略 */ }
  }));
  return { ok: true, count: out.all.length, ...out };
}

// 统一聚合单个站点（气象+空气+海洋+洪水+气候），容错
async function aggregateStation(s, cache) {
  const [wx, air, marine, flood] = await Promise.allSettled([
    fetchForecast(s), fetchAir(s), fetchMarine(s), fetchFlood(s),
  ]);
  const get = (r, fb) => (r.status === 'fulfilled' ? r.value : fb);
  const wea = get(wx, { ok: false, error: wx.reason });
  const airObj = get(air, { ok: false, error: air.reason });
  // 将逐时 AQI 按时间对齐并入逐时气象序列（空气质量维度）
  if (wea.ok && airObj.ok && wea.hourly24 && airObj.hourlyAqi && airObj.hourlyAqi.length) {
    const aqiByTime = new Map(airObj.hourlyAqi.map(a => [a.time, a.aqi]));
    wea.hourly24.forEach(h => { const v = aqiByTime.get(h.time); h.aqi = (v == null ? null : v); });
  }
  return {
    id: s.id, name: s.name, kind: s.kind, desc: s.desc, lat: s.lat, lon: s.lon,
    area: s.area, pop: s.pop, poly: s.poly,
    weather: wea,
    air: airObj,
    marine: get(marine, { ok: false, error: marine.reason }),
    flood: get(flood, { ok: false, error: flood.reason }),
  };
}

module.exports = {
  fetchForecast, fetchAir, fetchMarine, fetchFlood, fetchClimate,
  fetchEarthquakes, fetchFires, fetchTyphoon, fetchWarnings, aggregateStation, fetchRiverReservoir, fetchCmaLive,
  fetchWttrLive, fetchCaiyunLive, verifyRealtime,
};
