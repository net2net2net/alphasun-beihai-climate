/* =========================================================
 * AlphaSun · 北海极端气候全景系统 — 静态前端逻辑（无后端）
 * ---------------------------------------------------------
 * 纯前端直连免密钥、支持 CORS 的外部 API：
 *   - Open-Meteo 气象/天文预报
 *   - Open-Meteo 空气质量 AQI
 *   - Open-Meteo 海洋（浪高/海温）与数值潮位
 *   - USGS 地震实时 GeoJSON
 * 所有 fetch：async/await + try/catch，单模块失败不影响其他模块。
 * 仅使用相对路径，兼容 GitHub/Gitee Pages 子路径托管。
 * ========================================================= */

'use strict';

/* ===================== 配置 ===================== */

/** 监测站点（点击切换；默认 beihai） */
const STATIONS = [
  { id: 'beihai',  name: '北海市区', lat: 21.48, lon: 109.11, desc: '主城区·海城区' },
  { id: 'yinhai',  name: '银海区',   lat: 21.43, lon: 109.05, desc: '银滩·旅游负荷' },
  { id: 'tieshan', name: '铁山港区', lat: 21.40, lon: 109.47, desc: '工业区·港口大用户' },
  { id: 'hepu',    name: '合浦县',   lat: 21.67, lon: 109.20, desc: '县域·农业用电' },
  { id: 'weizhou', name: '涠洲岛',   lat: 21.05, lon: 109.10, desc: '火山岛·海岛旅游' },
];
const CENTER = { lat: 21.48, lon: 109.11, name: '北海' };

/** TZ 常量 */
const TZ = 'Asia/Shanghai';

/** 自动刷新间隔（10 分钟） */
const REFRESH_MS = 10 * 60 * 1000;

/** API 端点（仅 query string，不自定义请求头，避免预检） */
const ENDPOINTS = {
  weather: 'https://api.open-meteo.com/v1/forecast',
  air: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  marine: 'https://marine-api.open-meteo.com/v1/marine',
  quake: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  boundary: './assets/data/beihai.geojson',
};

/* ===================== WMO 天气代码 ===================== */
const WMO = {
  0:  { t: '晴',         e: '☀️' },
  1:  { t: '晴间多云',   e: '🌤️' },
  2:  { t: '多云',       e: '⛅' },
  3:  { t: '阴',         e: '☁️' },
  45: { t: '雾',         e: '🌫️' },
  48: { t: '雾凇',       e: '🌫️' },
  51: { t: '小毛毛雨',   e: '🌦️' },
  53: { t: '毛毛雨',     e: '🌧️' },
  55: { t: '大毛毛雨',   e: '🌧️' },
  56: { t: '冻毛毛雨',   e: '🌧️' },
  57: { t: '强冻毛毛雨', e: '🌧️' },
  61: { t: '小雨',       e: '🌧️' },
  63: { t: '中雨',       e: '🌧️' },
  65: { t: '大雨',       e: '🌧️' },
  66: { t: '冻雨',       e: '🌧️' },
  67: { t: '强冻雨',     e: '🌧️' },
  71: { t: '小雪',       e: '🌨️' },
  73: { t: '中雪',       e: '🌨️' },
  75: { t: '大雪',       e: '❄️' },
  77: { t: '雪粒',       e: '🌨️' },
  80: { t: '小阵雨',     e: '🌦️' },
  81: { t: '阵雨',       e: '🌧️' },
  82: { t: '强阵雨',     e: '⛈️' },
  85: { t: '小阵雪',     e: '🌨️' },
  86: { t: '强阵雪',     e: '❄️' },
  95: { t: '雷暴',       e: '⛈️' },
  96: { t: '雷暴伴冰雹', e: '⛈️' },
  99: { t: '强雷暴冰雹', e: '⛈️' },
};
function wmo(code) { return WMO[code] || { t: '未知 (' + code + ')', e: '❓' }; }

/* ===================== 全局状态 ===================== */
const state = {
  station: STATIONS[0],
  theme: 'dark',
  autoRefresh: true,
  hourlyChart: null,
  tideChart: null,
  map: null,
  stationLayer: null,
  quakeLayer: null,
  boundaryLayer: null,
  stationMarkers: {},
  calYear: 0,
  calMonth: 0,
  refreshTimer: null,
};

/* ===================== 工具函数 ===================== */

/** 简易异步 GET（无自定义请求头） */
async function getJSON(url) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** 数值格式化，缺省返回 — */
function fmt(n, d = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toFixed(d);
}

/** 风向角度 -> 8 方位中文 */
function windDirText(deg) {
  if (deg === null || deg === undefined) return '—';
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const idx = Math.round(((deg % 360) / 45)) % 8;
  return dirs[idx] + '风';
}

/** 上海时区当前时刻字符串 'YYYY-MM-DDTHH:00' */
function shHourString(date = new Date()) {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
  return s.replace(' ', 'T'); // 'YYYY-MM-DD HH:mm' -> 'YYYY-MM-DDTHH:mm'
}

/** 上海时区日期 'YYYY-MM-DD' */
function shDateString(date = new Date()) {
  return shHourString(date).slice(0, 10);
}

/** 上海时区 'MM-DD HH:mm' 用于显示 */
function shDisplay(date = new Date()) {
  return shHourString(date).slice(5).replace('T', ' ');
}

/** 星期中文 */
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function weekdayCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return '周' + WEEK[d.getDay()];
}

/** 日历详情行 */
function row(k, v) {
  return '<div class="row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
}

/** 安全设置模块错误态 */
function setError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) el.innerHTML = '<div class="error-box">数据暂不可用' + (msg ? '（' + msg + '）' : '') + '</div>';
}

/* ===================== URL 构造 ===================== */
function weatherUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,is_day,visibility,uv_index',
    hourly: 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,weather_code,relative_humidity_2m,cloud_cover,pressure_msl',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,pressure_msl_max,sunrise,sunset,moonrise,moonset,moon_phase',
    forecast_days: '16', timezone: TZ, wind_speed_unit: 'ms',
  });
  return ENDPOINTS.weather + '?' + p.toString();
}
function airUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,uv_index,aerosol_optical_depth',
    hourly: 'us_aqi,pm2_5,ozone', forecast_days: '3', timezone: TZ,
  });
  return ENDPOINTS.air + '?' + p.toString();
}
function marineUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'wave_height,wave_period,wave_direction,wind_wave_height,sea_surface_temperature',
    hourly: 'wave_height,sea_surface_temperature', timezone: TZ,
  });
  return ENDPOINTS.marine + '?' + p.toString();
}
function tideUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: 'sea_level_height_msl', forecast_days: '3', timezone: TZ,
  });
  return ENDPOINTS.marine + '?' + p.toString();
}

/* ===================== 潮汐高低潮检测 ===================== */
/**
 * 对逐时潮位序列检测局部极值（高低潮），过滤噪声并按幅度显著性保留交替点。
 * @returns {Array<{type:'high'|'low', t:string, v:number}>}
 */
function detectTides(times, values) {
  if (!times || !values || values.length < 5) return [];
  const n = values.length;
  const ex = [];
  for (let i = 1; i < n - 1; i++) {
    if (values[i] > values[i - 1] && values[i] >= values[i + 1]) ex.push({ type: 'high', i });
    else if (values[i] < values[i - 1] && values[i] <= values[i + 1]) ex.push({ type: 'low', i });
  }
  const amp = Math.max(...values) - Math.min(...values);
  const thr = (amp * 0.12) || 0.04; // 最小显著幅度
  const sig = [];
  for (const e of ex) {
    const v = values[e.i];
    if (e.type === 'high') {
      if (sig.length === 0 || sig[sig.length - 1].type === 'low') {
        if (sig.length === 0 || values[sig[sig.length - 1].i] - v < -thr) sig.push(e);
      } else if (v > values[sig[sig.length - 1].i]) {
        sig[sig.length - 1] = e; // 两个高相邻，保留更高
      }
    } else {
      if (sig.length === 0 || sig[sig.length - 1].type === 'high') {
        if (sig.length === 0 || values[sig[sig.length - 1].i] - v > thr) sig.push(e);
      } else if (v < values[sig[sig.length - 1].i]) {
        sig[sig.length - 1] = e; // 两个低相邻，保留更低
      }
    }
  }
  return sig.map((e) => ({ type: e.type, t: times[e.i], v: values[e.i] }));
}

/* ===================== AQI 分级 ===================== */
function aqiInfo(v) {
  if (v === null || v === undefined) return { label: '—', color: '#64748b', desc: '无数据' };
  if (v <= 50)  return { label: '优',       color: '#22c55e', desc: '空气令人满意' };
  if (v <= 100) return { label: '良',       color: '#eab308', desc: '可接受，少数敏感者不适' };
  if (v <= 150) return { label: '轻度污染', color: '#f97316', desc: '敏感人群应减少户外活动' };
  if (v <= 200) return { label: '中度污染', color: '#ef4444', desc: '对所有人群健康有影响' };
  if (v <= 300) return { label: '重度污染', color: '#a855f7', desc: '应避免户外活动' };
  return { label: '严重污染', color: '#7f1d1d', desc: '尽量留在室内' };
}

/* ===================== 月相 ===================== */
function moonPhaseInfo(frac) {
  if (frac === null || frac === undefined) return { e: '🌑', t: '—' };
  const p = ((frac % 1) + 1) % 1;
  if (p < 0.0625 || p >= 0.9375) return { e: '🌑', t: '新月' };
  if (p < 0.1875) return { e: '🌒', t: '蛾眉月' };
  if (p < 0.3125) return { e: '🌓', t: '上弦月' };
  if (p < 0.4375) return { e: '🌔', t: '盈凸月' };
  if (p < 0.5625) return { e: '🌕', t: '满月' };
  if (p < 0.6875) return { e: '🌖', t: '亏凸月' };
  if (p < 0.8125) return { e: '🌗', t: '下弦月' };
  return { e: '🌘', t: '残月' };
}

/* ===================== 霞光概率启发式 ===================== */
function glowProbability(cloud, vis) {
  let p;
  if (cloud === null || cloud === undefined) p = 40;
  else if (cloud < 15) p = 45;       // 过晴，色彩少
  else if (cloud <= 45) p = 82;      // 20–45% 最佳
  else if (cloud <= 70) p = 45;
  else if (cloud <= 85) p = 25;
  else p = 10;
  if (vis !== null && vis !== undefined) {
    if (vis < 2000) p *= 0.55;
    else if (vis < 6000) p *= 0.78;
  }
  return Math.round(Math.max(5, Math.min(96, p)));
}

/* ===================== 渲染：实时天气 ===================== */
function renderRealtime(cur) {
  const el = document.getElementById('realtimeBody');
  if (!cur) { setError('realtimeBody', '气象接口异常'); return; }
  const w = wmo(cur.weather_code);
  const gustNote = (cur.wind_gusts_10m != null && cur.wind_gusts_10m >= 32)
    ? '<span class="muted small"> · 阵风达台风级</span>' : '';
  el.innerHTML =
    '<div class="rt-main">' +
      '<div class="rt-emoji">' + w.e + '</div>' +
      '<div>' +
        '<div class="rt-temp">' + fmt(cur.temperature_2m, 1) + '<small>°C</small></div>' +
        '<div class="rt-desc">' + w.t + gustNote + '</div>' +
        '<div class="rt-feels">体感 ' + fmt(cur.apparent_temperature, 1) + '°C</div>' +
      '</div>' +
    '</div>' +
    '<div class="rt-grid">' +
      item('相对湿度', fmt(cur.relative_humidity_2m, 0) + '%') +
      item('风', fmt(cur.wind_speed_10m, 1) + ' m/s ' + windDirText(cur.wind_direction_10m)) +
      item('阵风', fmt(cur.wind_gusts_10m, 1) + ' m/s') +
      item('气压', fmt(cur.pressure_msl, 0) + ' hPa') +
      item('云量', fmt(cur.cloud_cover, 0) + '%') +
      item('能见度', cur.visibility != null ? fmt(cur.visibility / 1000, 1) + ' km' : '—') +
      item('降水', fmt(cur.precipitation, 1) + ' mm') +
      item('紫外线', fmt(cur.uv_index, 0)) +
      item('昼夜', cur.is_day ? '☀ 白天' : '🌙 夜间') +
    '</div>';
}
function item(k, v) {
  return '<div class="rt-item"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
}

/* ===================== 渲染：24h 逐时曲线 ===================== */
function renderHourlyChart(hourly) {
  const canvas = document.getElementById('hourlyChart');
  if (!canvas) return;
  if (!window.Chart) { setError('hourlyPanel', 'Chart.js 未加载'); return; }
  if (!hourly || !hourly.time || !hourly.time.length) { setError('hourlyPanel', '逐时数据缺失'); return; }

  const nowH = shHourString();
  let idx = hourly.time.findIndex((t) => t >= nowH);
  if (idx < 0) idx = 0;
  const COUNT = 24;
  const end = Math.min(idx + COUNT, hourly.time.length);
  const labels = [], temp = [], feels = [], pop = [], wind = [];
  for (let i = idx; i < end; i++) {
    labels.push(hourly.time[i].slice(11, 16));
    temp.push(hourly.temperature_2m ? hourly.temperature_2m[i] : null);
    feels.push(hourly.apparent_temperature ? hourly.apparent_temperature[i] : null);
    pop.push(hourly.precipitation_probability ? hourly.precipitation_probability[i] : null);
    wind.push(hourly.wind_speed_10m ? hourly.wind_speed_10m[i] : null);
  }

  if (state.hourlyChart) state.hourlyChart.destroy();
  state.hourlyChart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '温度°C', data: temp, borderColor: '#f87171', backgroundColor: '#f87171', yAxisID: 'yT', tension: 0.3, pointRadius: 2 },
        { label: '体感°C', data: feels, borderColor: '#fb923c', backgroundColor: '#fb923c', yAxisID: 'yT', tension: 0.3, pointRadius: 0, borderDash: [4, 3] },
        { label: '降水概率%', data: pop, borderColor: '#38bdf8', backgroundColor: '#38bdf8', yAxisID: 'yP', tension: 0.3, pointRadius: 2 },
        { label: '风速m/s', data: wind, borderColor: '#34d399', backgroundColor: '#34d399', yAxisID: 'yW', tension: 0.3, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { color: '#8b9bb4', boxWidth: 12, font: { size: 11 } } },
        tooltip: { enabled: true },
      },
      scales: {
        x: { ticks: { color: '#8b9bb4', maxTicksLimit: 12 }, grid: { color: 'rgba(140,160,190,0.08)' } },
        yT: { position: 'left', ticks: { color: '#f87171' }, grid: { color: 'rgba(140,160,190,0.08)' }, title: { display: true, text: '°C', color: '#f87171' } },
        yP: { position: 'right', min: 0, max: 100, ticks: { color: '#38bdf8' }, grid: { drawOnChartArea: false }, title: { display: true, text: '%', color: '#38bdf8' } },
        yW: { position: 'right', ticks: { display: false }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

/* ===================== 渲染：空气质量 ===================== */
function renderAir(cur, hourly, t0) {
  const el = document.getElementById('airBody');
  if (!cur || cur.us_aqi === null || cur.us_aqi === undefined) { setError('airBody', '空气质量接口异常'); return; }
  const aqi = cur.us_aqi;
  const info = aqiInfo(aqi);
  el.innerHTML =
    '<div class="air-body" style="display:flex;flex-direction:column;gap:10px">' +
      '<div class="aqi-badge" style="background:' + info.color + '">' +
        '<span class="aqi-num">' + Math.round(aqi) + '</span>' +
        '<span>' + info.label + '<br><span style="font-size:11px;font-weight:500">' + info.desc + '</span></span>' +
      '</div>' +
      '<div class="air-grid">' +
        airItem('PM2.5', fmt(cur.pm2_5, 0) + ' µg/m³') +
        airItem('PM10', fmt(cur.pm10, 0) + ' µg/m³') +
        airItem('臭氧 O₃', fmt(cur.ozone, 0) + ' µg/m³') +
        airItem('二氧化氮', fmt(cur.nitrogen_dioxide, 0) + ' µg/m³') +
        airItem('二氧化硫', fmt(cur.sulphur_dioxide, 0) + ' µg/m³') +
        airItem('一氧化碳', fmt(cur.carbon_monoxide, 0) + ' µg/m³') +
      '</div>' +
    '</div>';
}
function airItem(k, v) {
  return '<div class="air-item"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
}

/* ===================== 渲染：海洋 ===================== */
function renderMarine(cur) {
  const el = document.getElementById('marineBody');
  if (!cur) { setError('marineBody', '海洋接口异常'); return; }
  el.innerHTML =
    '<div class="marine-item"><div class="k">浪高</div><div class="v">' + fmt(cur.wave_height, 2) + ' m</div></div>' +
    '<div class="marine-item"><div class="k">浪周期</div><div class="v">' + fmt(cur.wave_period, 1) + ' s</div></div>' +
    '<div class="marine-item"><div class="k">浪向</div><div class="v">' + windDirText(cur.wave_direction) + '</div></div>' +
    '<div class="marine-item"><div class="k">风浪高</div><div class="v">' + fmt(cur.wind_wave_height, 2) + ' m</div></div>' +
    '<div class="marine-item" style="grid-column:1/-1"><div class="k">海表温度</div><div class="v">' + fmt(cur.sea_surface_temperature, 1) + ' °C</div></div>';
}

/* ===================== 渲染：潮汐 / 潮位 ===================== */
function renderTide(hourly) {
  const el = document.getElementById('tideBody');
  const canvas = document.getElementById('tideChart');
  if (!hourly || !hourly.time || !hourly.sea_level_height_msl) { setError('tideBody', '潮位接口异常'); return; }
  const tides = detectTides(hourly.time, hourly.sea_level_height_msl);
  const nowH = shHourString();
  const future = tides.filter((t) => t.t >= nowH).slice(0, 8);

  let pills = '<div class="tide-hl">';
  if (future.length === 0) pills += '<span class="muted small">未来 6–8 个高低潮不足</span>';
  for (const t of future) {
    const cls = t.type === 'high' ? 'high' : 'low';
    const label = t.type === 'high' ? '高潮' : '低潮';
    pills += '<span class="tide-pill ' + cls + '">' + label + ' ' + t.t.slice(5, 16).replace('T', ' ') + ' · ' + fmt(t.v, 2) + ' m</span>';
  }
  pills += '</div>';
  el.innerHTML = pills;

  // 72h 潮位曲线
  if (!window.Chart || !canvas) return;
  const times = hourly.time, vals = hourly.sea_level_height_msl;
  const extSet = new Set(future.map((t) => t.t));
  const extData = times.map((t, i) => (extSet.has(t) ? { x: t, y: vals[i] } : null)).filter(Boolean);
  if (state.tideChart) state.tideChart.destroy();
  state.tideChart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: times.map((t) => t.slice(5, 16).replace('T', '\n')),
      datasets: [
        {
          label: '潮位 m', data: vals, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.15)',
          fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5,
        },
        {
          label: '高低潮', type: 'scatter', data: extData, backgroundColor: '#fbbf24',
          pointRadius: 4, pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, labels: { color: '#8b9bb4', boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#8b9bb4', maxTicksLimit: 12, font: { size: 9 } }, grid: { color: 'rgba(140,160,190,0.08)' } },
        y: { ticks: { color: '#8b9bb4' }, grid: { color: 'rgba(140,160,190,0.08)' }, title: { display: true, text: 'm', color: '#8b9bb4' } },
      },
    },
  });
}

/* ===================== 渲染：7/15 日预报 ===================== */
function renderForecast(daily) {
  renderForecastGrid('forecast7Body', daily, 0, 7);
  renderForecastGrid('forecast15Body', daily, 7, Math.min(16, daily.time.length));
}
function renderForecastGrid(elId, daily, start, end) {
  const el = document.getElementById(elId);
  if (!daily || !daily.time) { setError(elId, '预报数据缺失'); return; }
  let html = '';
  for (let i = start; i < end && i < daily.time.length; i++) {
    const w = wmo(daily.weather_code[i]);
    html +=
      '<div class="fc-card">' +
        '<div class="day">' + weekdayCN(daily.time[i]) + '<br>' + daily.time[i].slice(5) + '</div>' +
        '<div class="emoji">' + w.e + '</div>' +
        '<div class="tmax">' + fmt(daily.temperature_2m_max[i], 0) + '°</div>' +
        '<div class="tmin">' + fmt(daily.temperature_2m_min[i], 0) + '°</div>' +
        '<div class="pop">💧' + fmt(daily.precipitation_probability_max[i], 0) + '%</div>' +
        '<div class="wind">🌬' + fmt(daily.wind_speed_10m_max[i], 0) + ' m/s</div>' +
      '</div>';
  }
  el.innerHTML = html;
}

/* ===================== 渲染：天文 ===================== */
function renderAstro(daily) {
  const el = document.getElementById('astroBody');
  if (!daily || !daily.time) { setError('astroBody', '天文数据缺失'); return; }
  // 取今天（上海日期）对应索引
  const today = shDateString();
  let i = daily.time.indexOf(today);
  if (i < 0) i = 0;
  const mp = moonPhaseInfo(daily.moon_phase ? daily.moon_phase[i] : null);
  el.innerHTML =
    '<div class="astro-item"><div class="e">🌅</div><div class="k">日出</div><div class="v">' + safeTime(daily.sunrise[i]) + '</div></div>' +
    '<div class="astro-item"><div class="e">🌇</div><div class="k">日落</div><div class="v">' + safeTime(daily.sunset[i]) + '</div></div>' +
    '<div class="astro-item"><div class="e">🌕</div><div class="k">月出</div><div class="v">' + safeTime(daily.moonrise[i]) + '</div></div>' +
    '<div class="astro-item"><div class="e">🌑</div><div class="k">月落</div><div class="v">' + safeTime(daily.moonset[i]) + '</div></div>' +
    '<div class="astro-item" style="grid-column:1/-1"><div class="e">' + mp.e + '</div><div class="k">月相</div><div class="v">' + mp.t + '</div></div>';
}
function safeTime(iso) {
  if (!iso) return '—';
  return iso.slice(11, 16);
}

/* ===================== 渲染：霞光 ===================== */
function renderGlow(cur) {
  const m = glowProbability(cur ? cur.cloud_cover : null, cur ? cur.visibility : null);
  const e = document.getElementById('morningGlowBody');
  if (e) e.innerHTML = glowHTML(m, '清晨云量 ' + fmt(cur ? cur.cloud_cover : null, 0) + '% · 能见度 ' + (cur && cur.visibility != null ? fmt(cur.visibility / 1000, 1) + ' km' : '—'));
  const g = document.getElementById('glowBody');
  if (g) g.innerHTML = glowHTML(glowProbability(cur ? cur.cloud_cover : null, cur ? cur.visibility : null), '黄昏云量 ' + fmt(cur ? cur.cloud_cover : null, 0) + '% · 能见度 ' + (cur && cur.visibility != null ? fmt(cur.visibility / 1000, 1) + ' km' : '—'));
}
function glowHTML(p, note) {
  return '<div class="glow-ring" style="--p:' + p + '"><span>' + p + '%</span></div>' +
         '<div class="glow-note">' + note + '<br>云量 20–45% 时霞光概率最高</div>';
}

/* ===================== 渲染：多源校核 ===================== */
const sourceStatus = {};
function renderSourceCheck() {
  const el = document.getElementById('checkBody');
  if (!el) return;
  const order = [
    ['气象', 'weather'], ['空气', 'air'], ['海洋', 'marine'],
    ['潮汐', 'tide'], ['地震', 'quake'], ['边界', 'boundary'],
  ];
  let html = '';
  for (const [label, key] of order) {
    const ok = sourceStatus[key];
    const cls = ok === undefined ? '' : (ok ? 'ok' : 'fail');
    const dot = ok === undefined ? '⏳' : (ok ? '✓' : '✕');
    html += '<span class="check-item ' + cls + '"><span class="dot"></span>' + label + ' ' + dot + '</span>';
  }
  el.innerHTML = html;
}

/* ===================== 地图 ===================== */
function initMap() {
  const mapDiv = document.getElementById('map');
  if (!window.L) { mapDiv.innerHTML = '<div class="error-box">地图库（Leaflet）未加载，请检查网络或 CDN</div>'; return; }
  const map = window.L.map('map', { center: [CENTER.lat, CENTER.lon], zoom: 9, attributionControl: true });
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  state.map = map;

  state.stationLayer = window.L.layerGroup().addTo(map);
  state.quakeLayer = window.L.layerGroup().addTo(map);
  state.boundaryLayer = window.L.layerGroup().addTo(map);

  renderStationMarkers();
  loadBoundary();

  // 图例
  document.getElementById('mapLegend').innerHTML =
    '<span class="lg"><span class="sw" style="background:#38bdf8"></span>监测站点</span>' +
    '<span class="lg"><span class="sw" style="background:#f87171"></span>浅源地震(&lt;70km)</span>' +
    '<span class="lg"><span class="sw" style="background:#fbbf24"></span>中源(70-300km)</span>' +
    '<span class="lg"><span class="sw" style="background:#60a5fa"></span>深源(&gt;300km)</span>';

  // 图层开关
  bindLayerToggle('lyrStation', () => state.stationLayer);
  bindLayerToggle('lyrQuake', () => state.quakeLayer);
  bindLayerToggle('lyrBoundary', () => state.boundaryLayer);
}
function bindLayerToggle(id, getLayer) {
  const cb = document.getElementById(id);
  if (!cb) return;
  cb.addEventListener('change', () => {
    const layer = getLayer();
    if (!state.map || !layer) return;
    if (cb.checked) layer.addTo(state.map); else state.map.removeLayer(layer);
  });
}
function renderStationMarkers() {
  if (!state.stationLayer) return;
  state.stationLayer.clearLayers();
  state.stationMarkers = {};
  for (const s of STATIONS) {
    const active = s.id === state.station.id;
    const m = window.L.circleMarker([s.lat, s.lon], {
      radius: active ? 9 : 6,
      color: active ? '#fbbf24' : '#38bdf8',
      weight: 2,
      fillColor: active ? '#fbbf24' : '#38bdf8',
      fillOpacity: 0.8,
    }).bindTooltip(s.name + '（' + s.desc + '）', { permanent: false });
    m.addTo(state.stationLayer);
    state.stationMarkers[s.id] = m;
  }
}
async function loadBoundary() {
  if (!state.boundaryLayer) return;
  try {
    const geo = await getJSON(ENDPOINTS.boundary);
    sourceStatus.boundary = true;
    const layer = window.L.geoJSON(geo, {
      style: { color: '#a855f7', weight: 1.5, fillColor: '#a855f7', fillOpacity: 0.06 },
    });
    layer.addTo(state.boundaryLayer);
  } catch (e) {
    sourceStatus.boundary = false;
    console.warn('边界加载失败', e);
  }
}
function renderQuakes(geo) {
  if (!state.quakeLayer || !window.L) return;
  state.quakeLayer.clearLayers();
  if (!geo || !geo.features) return;
  for (const f of geo.features) {
    const [lon, lat] = f.geometry.coordinates;
    const mag = f.properties.mag || 0;
    const depth = f.geometry.coordinates[2] || 0;
    const color = depth < 70 ? '#f87171' : (depth < 300 ? '#fbbf24' : '#60a5fa');
    const c = window.L.circleMarker([lat, lon], {
      radius: Math.max(3, mag * 2.5),
      color, weight: 1, fillColor: color, fillOpacity: 0.5,
    }).bindTooltip(
      'M' + mag.toFixed(1) + ' · ' + (f.properties.place || '未知') + '<br>深度 ' + depth.toFixed(0) + ' km · ' + (f.properties.time ? new Date(f.properties.time).toLocaleString('zh-CN') : ''),
      { permanent: false }
    );
    c.addTo(state.quakeLayer);
  }
}

/* ===================== 站点切换 ===================== */
function renderStationChips() {
  const el = document.getElementById('stationChips');
  el.innerHTML = '';
  for (const s of STATIONS) {
    const b = document.createElement('button');
    b.className = 'chip' + (s.id === state.station.id ? ' active' : '');
    b.textContent = s.name;
    b.addEventListener('click', () => switchStation(s));
    el.appendChild(b);
  }
  const desc = document.getElementById('stationDesc');
  if (desc) desc.textContent = '当前：' + state.station.name + ' · ' + state.station.desc;
  const rt = document.getElementById('rtStation');
  if (rt) rt.textContent = '· ' + state.station.name;
}
async function switchStation(s) {
  state.station = s;
  renderStationChips();
  renderStationMarkers();
  if (state.map) state.map.panTo([s.lat, s.lon]);
  await refreshStationData();
}

/* ===================== 静态信息卡 ===================== */
function renderStaticInfo() {
  document.getElementById('riverBody').innerHTML =
    infoRow('南流江', '广西独流入海第一大河，发源于玉林，于合浦党江镇注入廉州湾，是北海重要水源与航运通道。') +
    infoRow('西门江', '流经合浦县城的主干河流，承担城区排涝与灌溉功能。') +
    infoRow('白沙河 / 公馆河 / 福成河', '北部湾沿海独立入海的小河系，汛期易引发局地内涝。');

  document.getElementById('reservoirBody').innerHTML =
    infoRow('洪潮江水库（星岛湖）', '位于合浦县的大型水库，以供水、灌溉、防洪为主，也是重要旅游区。') +
    infoRow('牛尾岭水库', '银海区重要饮用水源水库，保障北海市区供水安全。') +
    infoRow('鲤鱼地水库等', '市区与县域中小型水库群，承担农业灌溉与应急备用水源。');

  document.getElementById('climateBody').innerHTML =
    '<div class="info-row"><div class="t">气候特征</div><div class="d">北海属南亚热带海洋性季风气候，年均气温约 22.6℃，温暖湿润，冬无严寒。年降水量约 1600–1800mm，集中于 5–9 月汛期。</div></div>' +
    '<div class="info-row"><div class="t">灾害提示</div><div class="d">夏秋（7–9 月）多台风，需关注风暴潮与近岸大浪；冬季冷空气南下常带来大风与平流雾。本卡为权威档案整理，非实时站测。</div></div>';

  document.getElementById('linksBody').innerHTML = [
    ['Open-Meteo 开放气象', 'https://open-meteo.com/'],
    ['USGS 地震实时', 'https://earthquake.usgs.gov/'],
    ['中央气象台', 'http://www.nmc.cn/'],
    ['国家海洋信息中心', 'http://www.nmdis.org.cn/'],
    ['广西气象', 'http://gx.cma.gov.cn/'],
    ['中国天气网', 'http://www.weather.com.cn/'],
    ['Windy 可视化', 'https://www.windy.com/'],
    ['上海时间校准', 'https://time.is/Asia/Shanghai'],
  ].map(([t, u]) => '<div class="link-row">· <a href="' + u + '" target="_blank" rel="noopener">' + t + '</a></div>').join('');
}
function infoRow(t, d) {
  return '<div class="info-row"><div class="t">' + t + '</div><div class="d">' + d + '</div></div>';
}

/* ===================== 世界时钟 ===================== */
const WORLD_CITIES = [
  { city: '北海/上海', tz: 'Asia/Shanghai' },
  { city: '协调世界时', tz: 'UTC' },
  { city: '东京', tz: 'Asia/Tokyo' },
  { city: '新加坡', tz: 'Asia/Singapore' },
  { city: '伦敦', tz: 'Europe/London' },
  { city: '纽约', tz: 'America/New_York' },
];
function renderWorldClock() {
  const el = document.getElementById('worldClockBody');
  if (!el) return;
  const now = new Date();
  el.innerHTML = WORLD_CITIES.map((c) => {
    const t = new Intl.DateTimeFormat('zh-CN', {
      timeZone: c.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(now);
    return '<div class="wc-item"><div class="city">' + c.city + '</div><div class="time">' + t + '</div></div>';
  }).join('');
}

/* ===================== 日历（lunar.js） ===================== */
function renderCalendar() {
  const now = new Date();
  if (!state.calYear) { state.calYear = now.getFullYear(); state.calMonth = now.getMonth(); }
  const y = state.calYear, m = state.calMonth;
  const titleEl = document.getElementById('calTitle');
  if (titleEl) titleEl.textContent = y + ' 年 ' + (m + 1) + ' 月';

  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();

  const cells = [];
  // 星期表头
  const dows = ['日', '一', '二', '三', '四', '五', '六'];
  for (const d of dows) cells.push('<div class="cal-dow">' + d + '</div>');

  // 上月补位
  for (let i = 0; i < startDow; i++) {
    const pd = prevDays - startDow + 1 + i;
    cells.push('<div class="cal-cell other"><div class="sol">' + pd + '</div><div class="lun"></div></div>');
  }
  // 当月
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(calendarCell(y, m, d));
  }
  // 下月补位（凑满整行）
  const total = startDow + daysInMonth;
  const tail = (7 - (total % 7)) % 7;
  for (let i = 1; i <= tail; i++) {
    cells.push('<div class="cal-cell other"><div class="sol">' + i + '</div><div class="lun"></div></div>');
  }

  const body = document.getElementById('calendarBody');
  if (body) body.innerHTML = '<div class="cal-grid">' + cells.join('') + '</div>';
}
function calendarCell(y, m, d) {
  let lunText = '', jqText = '', festText = '';
  try {
    if (typeof Lunar !== 'undefined') {
      const lunar = Lunar.fromYmd(y, m + 1, d);
      lunText = (d === 1) ? (lunar.getMonthInChinese() + '月') : lunar.getDayInChinese();
      const jq = lunar.getJieQi();
      if (jq) jqText = jq;
      const fests = lunar.getFestivals().concat(Solar.fromYmd(y, m + 1, d).getFestivals());
      if (fests.length) festText = fests[0];
    }
  } catch (e) { /* lunar 解析异常忽略 */ }
  const isToday = (y === new Date().getFullYear() && m === new Date().getMonth() && d === new Date().getDate());
  const style = isToday ? 'border-color:var(--accent);background:color-mix(in srgb,var(--accent) 18%,var(--panel-2));' : '';
  return '<div class="cal-cell" data-y="' + y + '" data-m="' + (m + 1) + '" data-d="' + d + '" style="' + style + '">' +
    '<div class="sol">' + d + '</div>' +
    '<div class="lun">' + lunText + '</div>' +
    (jqText ? '<div class="jq">' + jqText + '</div>' : '') +
    (festText ? '<div class="fest">' + festText + '</div>' : '') +
    '</div>';
}
function showDayDetail(y, m, d) {
  const modal = document.getElementById('dayModal');
  const body = document.getElementById('dayModalBody');
  let html = '<div class="day-detail"><h3>' + y + ' 年 ' + m + ' 月 ' + d + ' 日 · ' + weekdayCN(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')) + '</h3>';
  try {
    if (typeof Lunar !== 'undefined') {
      const lunar = Lunar.fromYmd(y, m, d);
      const solar = Solar.fromYmd(y, m, d);
      html += row('农历', lunar.getYearInChinese() + '年 ' + lunar.getMonthInChinese() + '月 ' + lunar.getDayInChinese());
      html += row('干支', lunar.getYearInGanZhi() + '年 ' + lunar.getMonthInGanZhi() + '月 ' + lunar.getDayInGanZhi() + '日');
      html += row('生肖', lunar.getYearShengXiao());
      const jq = lunar.getJieQi();
      if (jq) html += row('节气', jq);
      const lf = lunar.getFestivals();
      const sf = solar.getFestivals();
      const all = lf.concat(sf);
      if (all.length) html += '<div style="margin-top:6px">' + all.map((f) => '<span class="tag">' + f + '</span>').join('') + '</div>';
    } else {
      html += '<div class="muted">农历库未加载</div>';
    }
  } catch (e) {
    html += '<div class="error-box">日期解析失败</div>';
  }
  html += '</div>';
  body.innerHTML = html;
  modal.classList.remove('hidden');
}

/* ===================== 时钟 / 主题 / 刷新控制 ===================== */
function tickClock() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).format(now);
  const timeStr = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
  const dEl = document.getElementById('clkDate');
  const tEl = document.getElementById('clkTime');
  if (dEl) dEl.textContent = dateStr;
  if (tEl) tEl.textContent = timeStr;
  renderWorldClock();
}
function applyTheme(theme) {
  state.theme = theme;
  document.body.className = theme === 'light' ? 'theme-light' : 'theme-dark';
  const btn = document.getElementById('btnTheme');
  if (btn) btn.textContent = theme === 'light' ? '🌙 深色' : '☀️ 浅色';
  try { localStorage.setItem('as-theme', theme); } catch (e) {}
}
function setLastUpdate() {
  const el = document.getElementById('lastUpdate');
  if (el) el.textContent = '更新于 ' + shDisplay() + '（' + TZ.replace('_', ' ') + '）';
}
function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (!state.autoRefresh) return;
  state.refreshTimer = setInterval(refreshAll, REFRESH_MS);
}
function toggleAuto() {
  state.autoRefresh = !state.autoRefresh;
  const btn = document.getElementById('autoToggle');
  if (btn) {
    btn.textContent = state.autoRefresh ? '⏱ 自动' : '⏸ 已暂停';
    btn.classList.toggle('paused', !state.autoRefresh);
  }
  startAutoRefresh();
}

/* ===================== 主刷新流程 ===================== */
async function refreshStationData() {
  const s = state.station;
  const [w, a, m, t] = await Promise.allSettled([
    getJSON(weatherUrl(s.lat, s.lon)),
    getJSON(airUrl(s.lat, s.lon)),
    getJSON(marineUrl(s.lat, s.lon)),
    getJSON(tideUrl(s.lat, s.lon)),
  ]);

  // 气象 + 衍生
  if (w.status === 'fulfilled') {
    sourceStatus.weather = true;
    const data = w.value;
    renderRealtime(data.current);
    renderHourlyChart(data.hourly);
    renderForecast(data.daily);
    renderAstro(data.daily);
    renderGlow(data.current);
    // 空气质量来自独立接口
    if (a.status === 'fulfilled') { sourceStatus.air = true; renderAir(a.value.current); }
    else { sourceStatus.air = false; setError('airBody', '空气接口异常'); }
    // 海洋
    if (m.status === 'fulfilled') { sourceStatus.marine = true; renderMarine(m.value.current); }
    else { sourceStatus.marine = false; setError('marineBody', '海洋接口异常'); }
    // 潮汐
    if (t.status === 'fulfilled') { sourceStatus.tide = true; renderTide(t.value.hourly); }
    else { sourceStatus.tide = false; setError('tideBody', '潮位接口异常'); }
  } else {
    sourceStatus.weather = false;
    setError('realtimeBody', '气象接口异常');
    setError('hourlyPanel', '气象接口异常');
    setError('forecast7Body', '气象接口异常');
    setError('forecast15Body', '气象接口异常');
    setError('astroBody', '气象接口异常');
    // 即便气象失败，仍尝试其它独立接口
    if (a.status === 'fulfilled') { sourceStatus.air = true; renderAir(a.value.current); } else { sourceStatus.air = false; setError('airBody', '空气接口异常'); }
    if (m.status === 'fulfilled') { sourceStatus.marine = true; renderMarine(m.value.current); } else { sourceStatus.marine = false; setError('marineBody', '海洋接口异常'); }
    if (t.status === 'fulfilled') { sourceStatus.tide = true; renderTide(t.value.hourly); } else { sourceStatus.tide = false; setError('tideBody', '潮位接口异常'); }
  }
  renderSourceCheck();
}

async function refreshQuakes() {
  try {
    const geo = await getJSON(ENDPOINTS.quake);
    sourceStatus.quake = true;
    renderQuakes(geo);
  } catch (e) {
    sourceStatus.quake = false;
    console.warn('地震数据获取失败', e);
  }
  renderSourceCheck();
}

async function refreshAll() {
  await Promise.allSettled([refreshStationData(), refreshQuakes()]);
  setLastUpdate();
}

/* ===================== 事件绑定 / 初始化 ===================== */
function bindEvents() {
  const refreshBtn = document.getElementById('btnRefresh');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshAll);

  const themeBtn = document.getElementById('btnTheme');
  if (themeBtn) themeBtn.addEventListener('click', () => applyTheme(state.theme === 'light' ? 'dark' : 'light'));

  const autoBtn = document.getElementById('autoToggle');
  if (autoBtn) autoBtn.addEventListener('click', toggleAuto);

  const calPrev = document.getElementById('calPrev');
  const calNext = document.getElementById('calNext');
  if (calPrev) calPrev.addEventListener('click', () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCalendar(); });
  if (calNext) calNext.addEventListener('click', () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCalendar(); });

  // 日历日详情（事件委托）
  const calBody = document.getElementById('calendarBody');
  if (calBody) calBody.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (cell && cell.dataset.y) showDayDetail(+cell.dataset.y, +cell.dataset.m, +cell.dataset.d);
  });
  const modalClose = document.getElementById('dayModalClose');
  const modal = document.getElementById('dayModal');
  if (modalClose) modalClose.addEventListener('click', () => modal.classList.add('hidden'));
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal) modal.classList.add('hidden'); });
}

function init() {
  // 主题还原
  let saved = 'dark';
  try { saved = localStorage.getItem('as-theme') || 'dark'; } catch (e) {}
  applyTheme(saved);

  renderStationChips();
  renderStaticInfo();
  renderCalendar();
  initMap();

  bindEvents();
  tickClock();
  setInterval(tickClock, 1000);

  // 首次加载
  refreshAll();
  startAutoRefresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
