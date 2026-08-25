// AlphaSun · 数据源适配层
// 所有函数返回归一化对象；失败返回 { ok:false, error } 不影响整体。
const http = require('https');
const { API, wmo, GEO, PROV_GEO, WARN_CAT, WARN_LEVEL } = require('./config');

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
    forecast_days: '7', timezone: 'Asia/Shanghai', wind_speed_unit: 'ms',
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
    weather: wea,
    air: airObj,
    marine: get(marine, { ok: false, error: marine.reason }),
    flood: get(flood, { ok: false, error: flood.reason }),
  };
}

module.exports = {
  fetchForecast, fetchAir, fetchMarine, fetchFlood, fetchClimate,
  fetchEarthquakes, fetchFires, fetchTyphoon, fetchWarnings, aggregateStation,
};
