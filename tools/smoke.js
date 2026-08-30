#!/usr/bin/env node
/**
 * AlphaSun 回归测试门禁（Regression Harness）
 * ------------------------------------------------------------
 * 作为「每轮迭代不可回退」的护栏：
 *  1) 语法检查：web/android 的 js/app.js、js/map.js、app/server.js
 *  2) 双端一致性：index.html / css/styles.css / js/app.js / js/map.js / data/beihai.geojson
 *     在 app/public 与 app-android/www 之间必须逐字节一致（Android 专属文件保留不动）
 *  3) 全量渲染运行时：用自定义 DOM / 全局 stub + 完整 mock state 加载 js/app.js 并跑 render() 全模块
 *  4) 历法正确性：农历/节气/干支（正月初一、中秋、2026 丙午年、2033 闰月不抛错）
 *
 * 用法： node tools/smoke.js        （本地，失败打印并退出码 1）
 *       node tools/smoke.js --throw （CI，失败时抛错）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const fails = [];
const okList = [];
function ok(cond, msg) {
  if (cond) { okList.push(msg); console.log('  ✓ ' + msg); }
  else { fails.push(msg); console.log('  ✗ ' + msg); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }
function abort(msg) { console.error('\nFATAL: ' + msg); process.exit(2); }

// ---------------------------------------------------------------------------
// 1) 语法检查
// ---------------------------------------------------------------------------
section('1) 语法检查（vm.Script 完整解析）');
const SYNTAX_FILES = [
  'app/public/js/app.js',
  'app-android/www/js/app.js',
  'app/public/js/map.js',
  'app-android/www/js/map.js',
  'app/server.js',
  'app-android/www/js/data.js',
];
for (const f of SYNTAX_FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { ok(false, '存在: ' + f); continue; }
  try { new vm.Script(fs.readFileSync(p, 'utf8'), { filename: f }); ok(true, '语法 OK: ' + f); }
  catch (e) { ok(false, '语法错误: ' + f + ' -> ' + e.message); }
}

// ---------------------------------------------------------------------------
// 2) 双端一致性
// ---------------------------------------------------------------------------
section('2) 双端一致性（public <-> android/www 共享文件）');
const SYNC = ['index.html', 'css/styles.css', 'js/app.js', 'js/map.js', 'data/beihai.geojson'];
for (const f of SYNC) {
  const a = path.join(ROOT, 'app/public', f);
  const b = path.join(ROOT, 'app-android/www', f);
  if (!fs.existsSync(a) || !fs.existsSync(b)) { ok(false, '双端均存在: ' + f); continue; }
  const ca = fs.readFileSync(a), cb = fs.readFileSync(b);
  ok(ca.toString() === cb.toString(), '一致: ' + f);
}

// ---------------------------------------------------------------------------
// 3) 全量渲染运行时 + 历法断言
// ---------------------------------------------------------------------------
section('3) 全量渲染运行时 + 历法断言（vm 沙箱 + 完整 mock state）');

// ---- 构建完整的 mock state（覆盖 render() 全模块所需字段）----
function buildMock() {
  const stations = ['beihai', 'yinhai', 'tieshan', 'hepu', 'weizhou'].map((id, i) => {
    const hourly24 = [];
    for (let h = 0; h < 24; h++) {
      hourly24.push({
        time: '2026-08-27T' + String(h).padStart(2, '0') + ':00',
        temp: 28 + h * 0.1, feels: 27 + h * 0.1, precip: 0, precipProb: 10 + h,
        wind: 3 + h * 0.1, gust: 5 + h * 0.1, rh: 80 - h, cloud: 30 + h,
        pressure: 1008, aqi: 40 + i,
      });
    }
    const daily = [];
    for (let d = 0; d < 16; d++) {
      const dt = new Date(2026, 7, 27 + d);
      daily.push({
        date: dt.toISOString().slice(0, 10), sunrise: '05:30', sunset: '18:40',
        moonrise: '20:10', moonset: '07:20', moonPhase: (d % 30) / 30,
        tmax: 30 + d * 0.1, tmin: 25, precipProb: 20, code: 0,
      });
    }
    return {
      id, name: id, desc: '', lat: 21.48 + i * 0.01, lon: 109.11 + i * 0.01,
      alert: { level: 0 },
      area: 1200, pop: 1800000,
      poly: [[21.4, 109.0], [21.6, 109.0], [21.6, 109.3], [21.4, 109.3]],
      weather: {
        ok: true,
        current: {
          icon: 'sunny', text: '晴', temp: 30, feels: 29, wind: 4, gust: 6,
          rh: 75, precip: 0, pressure: 1008, cloud: 20, uv: 8, vis: 12,
          realtimeSource: 'Open-Meteo', warningOverride: null,
        },
        hourly24, daily,
      },
      air: { ok: true, aqi: 45, primary: 'PM2.5', pm25: 12, pm10: 24, o3: 60, no2: 18, so2: 6, co: 0.6 },
      marine: { ok: true, waveHeight: 1.2, windWaveHeight: 0.8, wavePeriod: 4.5, seaTemp: 28.5, waveDir: 120 },
      glow: { score: 62, grade: '中', bestTime: '18:40', factors: ['云量适中', '湿度合适'] },
      morningGlow: { score: 40, grade: '低', bestTime: '05:30', factors: ['有薄雾'] },
    };
  });
  const realtimeCheck = {
    agreement: 'high', confidence: 0.95,
    sources: [
      { label: 'Open-Meteo', ok: true, skipped: false, temp: 30, text: '晴', precip: 0, uv: 8, category: 'clear', rh: 75, wind: 4, pressure: 1008 },
      { label: '中国天气网(国家气象中心)', ok: true, skipped: false, temp: 30.2, text: '晴', precip: 0, uv: 8, category: 'clear', rh: 76, wind: 4.2, pressure: 1009 },
      { label: '和风天气(QWeather)', ok: true, skipped: false, temp: 30.1, text: '晴', precip: 0, uv: 8, category: 'clear', rh: 75, wind: 4.1, pressure: 1009 },
      { label: 'wttr.in', ok: true, skipped: false, temp: 29.8, text: '晴', precip: 0, uv: 8, category: 'clear', rh: 74, wind: 3.8, pressure: 0 },
      { label: '彩云天气', ok: true, skipped: false, temp: 30.1, text: '晴', precip: 0, uv: 8, category: 'clear', rh: 75, wind: 4.1, pressure: 0 },
      { label: '中国气象局(CMA)', ok: true, skipped: false, temp: 30.3, text: '晴', precip: 0, uv: null, category: 'clear', rh: 73, wind: 4.3, pressure: 1007 },
      { label: '挪威气象局(yr.no)', ok: true, skipped: false, temp: 30.3, text: '晴', precip: 0, uv: null, category: 'clear', rh: 73, wind: 4.4, pressure: 1007 },
    ],
    fields: [
      { key: 'temp', label: '气温', unit: '℃', vals: [{ label: 'Open-Meteo', v: 30 }, { label: '中国天气网(国家气象中心)', v: 30.2 }, { label: '和风天气(QWeather)', v: 30.1 }, { label: 'wttr.in', v: 29.8 }, { label: '彩云天气', v: 30.1 }, { label: '中国气象局(CMA)', v: 30.3 }, { label: '挪威气象局(yr.no)', v: 30.3 }], spread: 0.5, consistent: true },
      { key: 'rh', label: '湿度', unit: '%', vals: [{ label: 'Open-Meteo', v: 75 }, { label: '中国天气网(国家气象中心)', v: 76 }, { label: '和风天气(QWeather)', v: 75 }, { label: 'wttr.in', v: 74 }, { label: '彩云天气', v: 75 }, { label: '中国气象局(CMA)', v: 73 }, { label: '挪威气象局(yr.no)', v: 73 }], spread: 3, consistent: true },
      { key: 'wind', label: '风速', unit: 'm/s', vals: [{ label: 'Open-Meteo', v: 4 }, { label: '中国天气网(国家气象中心)', v: 4.2 }, { label: '和风天气(QWeather)', v: 4.1 }, { label: 'wttr.in', v: 3.8 }, { label: '彩云天气', v: 4.1 }, { label: '中国气象局(CMA)', v: 4.3 }, { label: '挪威气象局(yr.no)', v: 4.4 }], spread: 0.6, consistent: true },
      { key: 'pressure', label: '气压', unit: 'hPa', vals: [{ label: 'Open-Meteo', v: 1008 }, { label: '中国天气网(国家气象中心)', v: 1009 }, { label: '和风天气(QWeather)', v: 1009 }, { label: 'wttr.in', v: null }, { label: '彩云天气', v: null }, { label: '中国气象局(CMA)', v: 1007 }, { label: '挪威气象局(yr.no)', v: 1007 }], spread: 1, consistent: true },
      { key: 'precip', label: '降水', unit: 'mm', vals: [{ label: 'Open-Meteo', v: 0 }, { label: '中国天气网(国家气象中心)', v: 0 }, { label: '和风天气(QWeather)', v: 0 }, { label: 'wttr.in', v: 0 }, { label: '彩云天气', v: 0 }, { label: '中国气象局(CMA)', v: 0 }, { label: '挪威气象局(yr.no)', v: 0 }], spread: 0, consistent: true },
    ],
    consensus: { category: 'clear', tempMin: 29.8, tempMax: 30.3, tempMean: 30, rhMean: 75, uvMean: 8, uvMin: 8, uvMax: 8, air: { aqi: 45 } },
    discrepancies: [],
    checkedAt: new Date().toISOString(),
    recommended: { source: 'Open-Meteo' },
  };
  const regionalWeather = {
    ok: true, count: 5, tempMin: 29, tempMax: 31, dominantCat: 'clear', windMax: 6, precipAny: false,
    points: [
      { name: '北海', temp: 30, text: '晴' }, { name: '银滩', temp: 30.2, text: '晴' },
      { name: '铁山港', temp: 30.1, text: '晴' }, { name: '合浦', temp: 29.5, text: '晴' },
      { name: '涠洲岛', temp: 30.3, text: '晴' },
    ],
  };
  const globalAlerts = [
    {
      type: '暴雨', station: '北海', region: '北海', level: 3, levelName: '警报',
      detail: '北海市气象台发布暴雨蓝色预警', advice: '注意防范城市内涝',
      adviceDetail: '1. 预置排水设备，巡视易涝站所；2. 地下空间入口封堵，停运低洼线路；3. 果断停运避险，确保人身安全。',
      beihaiRelation: 'direct', dist: 0, lat: 21.48, lon: 109.11, color: '#fb8500',
      id: 'a1', time: '2026-08-27 09:00', summary: '...', source: '北海气象台',
      category: 'rain', minDistBH: 0, relLabel: '涉及北海', url: 'https://www.12379.cn/', icon: '',
    },
  ];
  const alertIntel = {
    count: 2,
    items: [
      { id: 'i1', region: '北海', levelName: '预警', color: '#fb8500', category: 'rain', title: '北海暴雨预警', summary: '...', source: '北海气象台', time: '2026-08-27 09:00', lat: 21.48, lon: 109.11, minDistBH: 0, beihaiRelation: 'direct', relLabel: '涉及北海', url: '', advice: '防范内涝' },
      { id: 'i2', region: '广西', levelName: '注意', color: '#d29922', category: 'wind', title: '广西大风', summary: '...', source: '广西气象', time: '2026-08-27 08:00', lat: 23, lon: 108, minDistBH: 200, beihaiRelation: 'possible', relLabel: '可能涉及北海', url: '', advice: '' },
    ],
  };
  const astronomy = {
    meteors: [
      { name: '英仙座流星雨', peak: [7, 12], inDays: 5, note: '活跃期' },
      { name: '双子座流星雨', peak: [12, 14], inDays: 120, note: '活跃期' },
    ],
    supermoons: [{ name: '年度最大满月', date: '2026-08-29' }],
    galacticCore: '银河中心最佳观测季：夏季夜间', tips: '选择光污染少处观测',
    moon: { nextNew: '2026-09-12', nextFull: '2026-08-29' },
  };
  const tides = [
    {
      name: '北海港', source: 'NMHC', configured: false, model: true, datumLabel: '理论最低潮面 (LAT)',
      current: 2.4, trend: 'falling', rate: -0.42, meanLevel: 1.6, lowest: 0.3, highest: 3.1, range: 2.8,
      warnLevel: 4.0, margin: -1.6, exceeded: false,
      series: [
        { t: '2026-08-28T03:00:00.000Z', h: 2.4 }, { t: '2026-08-28T04:00:00.000Z', h: 2.1 },
        { t: '2026-08-28T05:00:00.000Z', h: 1.7 }, { t: '2026-08-28T06:00:00.000Z', h: 1.3 },
        { t: '2026-08-28T07:00:00.000Z', h: 1.0 }, { t: '2026-08-28T08:00:00.000Z', h: 0.8 },
      ],
      extremes: [
        { idx: 5, time: '2026-08-28T08:00:00.000Z', h: 0.8, type: 'low', next: true, inHours: 5 },
        { idx: 2, time: '2026-08-28T05:00:00.000Z', h: 1.7, type: 'high', next: false, inHours: 2 },
      ],
      next: { idx: 5, time: '2026-08-28T08:00:00.000Z', h: 0.8, type: 'low', inHours: 5 },
      hourly: [
        { t: '2026-08-28T03:00:00.000Z', h: 2.4 }, { t: '2026-08-28T04:00:00.000Z', h: 2.1 },
        { t: '2026-08-28T05:00:00.000Z', h: 1.7 }, { t: '2026-08-28T06:00:00.000Z', h: 1.3 },
      ],
    },
    {
      name: '铁山港', source: 'NMHC', configured: false, model: true, datumLabel: '理论最低潮面 (LAT)',
      current: 1.9, trend: 'rising', rate: 0.31, meanLevel: 1.6, lowest: 0.2, highest: 3.0, range: 2.8,
      warnLevel: 4.2, margin: -2.3, exceeded: false,
      series: [
        { t: '2026-08-28T03:00:00.000Z', h: 1.9 }, { t: '2026-08-28T04:00:00.000Z', h: 2.2 },
        { t: '2026-08-28T05:00:00.000Z', h: 2.5 }, { t: '2026-08-28T06:00:00.000Z', h: 2.4 },
        { t: '2026-08-28T07:00:00.000Z', h: 2.0 }, { t: '2026-08-28T08:00:00.000Z', h: 1.5 },
      ],
      extremes: [
        { idx: 2, time: '2026-08-28T05:00:00.000Z', h: 2.5, type: 'high', next: true, inHours: 2 },
        { idx: 5, time: '2026-08-28T08:00:00.000Z', h: 1.5, type: 'low', next: false, inHours: 5 },
      ],
      next: { idx: 2, time: '2026-08-28T05:00:00.000Z', h: 2.5, type: 'high', inHours: 2 },
      hourly: [
        { t: '2026-08-28T03:00:00.000Z', h: 1.9 }, { t: '2026-08-28T04:00:00.000Z', h: 2.2 },
        { t: '2026-08-28T05:00:00.000Z', h: 2.5 }, { t: '2026-08-28T06:00:00.000Z', h: 2.4 },
      ],
    },
  ];
  const riverReservoir = {
    ok: true, realtime: false, realtimeStatus: 'unreachable', source: '公开资料',
    rivers: [
      { name: '南流江', type: '独流入海', outfall: '廉州湾', note: '' },
      { name: '洪潮江', type: '支流', outfall: '南流江', note: '' },
    ],
    reservoirs: [
      { name: '洪潮江水库', scale: '大(2)型', county: '合浦', totalCapM3: 7.03e8, drinking: true, note: '' },
      { name: '牛尾岭水库', scale: '中型', county: '银海', totalCapM3: 2550e4, drinking: true, note: '' },
    ],
  };
  return {
    updated: new Date().toISOString(),
    stations, realtimeCheck, regionalWeather, globalAlerts, alertIntel, astronomy, tides, riverReservoir,
    primaryClimate: { monthlyTemp: [15, 16, 19, 23, 27, 29, 30, 29, 28, 25, 21, 17], monthlyPrecip: [30, 40, 60, 90, 180, 260, 300, 320, 220, 90, 50, 35] },
    typhoon: { ok: true, count: 0 }, warnings: { ok: true, count: 1 },
  };
}

// ---- DOM / 全局 stub ----
function makeEl() {
  const el = {
    _id: null, textContent: '', innerHTML: '', className: '', title: '', value: '',
    style: {}, dataset: {}, onclick: null, onchange: null, disabled: false,
    classList: {
      _s: new Set(),
      add() { for (const c of arguments) this._s.add(c); el.className = [...this._s].join(' '); },
      remove() { for (const c of arguments) this._s.delete(c); el.className = [...this._s].join(' '); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } el.className = [...this._s].join(' '); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, removeEventListener() {},
    insertAdjacentHTML() {}, appendChild() {}, removeChild() {},
    setAttribute(k, v) { if (k === 'class' || k === 'className') this.className = v; },
    getAttribute(k) { return k === 'class' ? this.className : null; },
    scrollIntoView() {}, focus() {}, blur() {}, closest() { return null; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    getContext() { return makeCtx(); },
    get offsetWidth() { return 1; },
  };
  return el;
}
function makeCtx() {
  return new Proxy({}, {
    get(t, p) { if (p === 'canvas') return { width: 300, height: 170 }; return (typeof p === 'string') ? (() => {}) : undefined; },
    set() { return true; },
  });
}
const els = {};
const documentStub = {
  getElementById(id) { if (!els[id]) { els[id] = makeEl(); els[id]._id = id; } return els[id]; },
  querySelector() { return makeEl(); },
  querySelectorAll() { return []; },
  addEventListener() {}, createElement() { return makeEl(); },
  documentElement: { setAttribute() {}, getAttribute() { return null; }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
  body: { appendChild() {} },
};
function ChartStub() { this.destroy = function () {}; }
const AlphaMap = {
  init() {}, setData() {}, legend() {}, buildOverlayUI() {}, toggle() {}, invalidate() {},
  fmtDist(d) { return d == null ? '—' : (d.toFixed(0) + ' km'); },
  distBH() { return 0; },
};
const fetchStub = async (url) => {
  if (String(url).includes('/api/time')) return { json: async () => ({ now: Date.now() }) };
  return { json: async () => MOCK };
};
const sandbox = {
  document: documentStub,
  window: { AudioContext: undefined, webkitAudioContext: undefined, L: {}, Chart: ChartStub },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  performance: { now: () => 0 },
  fetch: fetchStub,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  console,
  Chart: ChartStub,
  AlphaMap,
  Date, Math, JSON, RegExp, Object, Array, String, Number, Boolean, Promise, Error,
  parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, Set, Map, Symbol, Proxy,
};
const MOCK = buildMock();
const ctx = vm.createContext(sandbox);
ctx.__MOCK = MOCK;

// ---- 追加测试代码（与 app.js 同作用域，可访问 state / render / lunarDate 等）----
const appSrc = fs.readFileSync(path.join(ROOT, 'app/public/js/app.js'), 'utf8');
const testSrc = `
;(function () {
  globalThis.__renderErr = null;
  try {
    state.sel = globalThis.__MOCK.stations[0].id;
    state.data = globalThis.__MOCK;
    render();
  } catch (e) { globalThis.__renderErr = (e && e.stack) || String(e); }
  try {
    globalThis.__algo = {
      newYear: lunarDate(2026, 2, 17),
      midAut: lunarDate(2025, 10, 6),
      gz2026: lunarDate(2026, 6, 1).ganzhi,
      leap2033: (function () { try { lunarDate(2033, 1, 1); lunarDate(2033, 12, 31); return 'ok'; } catch (e) { return 'ERR ' + e.message; } })(),
    };
  } catch (e) { globalThis.__algo = { err: String(e) }; }
  try {
    globalThis.__alertModalHtml = '';
    if (state.data.globalAlerts[0]) { openAlertModal(state.data.globalAlerts[0]); globalThis.__alertModalHtml = document.getElementById('modalBody').innerHTML; }
    openAdviceDetail(state.data.globalAlerts[0]);
    openBeihaiModal();
    openAllIntelModal();
    var lb3 = document.getElementById('locAlertBtn'); if (lb3 && lb3.onclick) lb3.onclick();
    globalThis.__modalOk = 'ok';
  } catch (e) { globalThis.__modalOk = 'ERR ' + e.message; }
  try {
    globalThis.__hl = (typeof huangli === 'function') ? (function(){ try { return huangli(2026, 8, 28); } catch (e) { return 'ERR ' + e.message; } })() : 'NO_FN';
  } catch (e) { globalThis.__hl = 'ERR ' + e.message; }
})();
`;
try {
  vm.runInContext(appSrc + '\n' + testSrc, ctx, { filename: 'app.js(+test)' });
} catch (e) {
  ok(false, 'app.js 加载/运行未抛错: ' + (e.stack || e.message));
}
// 冲刷微任务（让底部的 load().then(renderChartOn) 完成，即使抛错也被 load 内部 try 捕获）
setImmediate(() => runAssertions());

function runAssertions() {
  section('3) 断言');
  const err = ctx.__renderErr;
  ok(err === null || err === undefined, 'render() 全模块未抛错' + (err ? ('\n' + err) : ''));

  const algo = ctx.__algo || {};
  ok(algo.newYear && algo.newYear.monthCn === '正' && algo.newYear.dayCn === '初一',
    '2026-02-17 为正月初一（' + (algo.newYear ? algo.newYear.monthCn + algo.newYear.dayCn : '?') + '）');
  ok(algo.midAut && algo.midAut.monthCn === '八' && algo.midAut.dayCn === '十五',
    '2025-10-06 为八月十五（' + (algo.midAut ? algo.midAut.monthCn + algo.midAut.dayCn : '?') + '）');
  ok(algo.gz2026 === '丙午', '2026 年为丙午年（' + algo.gz2026 + '）');
  ok(algo.leap2033 === 'ok', '2033 闰月年 lunarDate 不抛错（' + algo.leap2033 + '）');

  ok(ctx.__modalOk === 'ok', '告警模态 + 定位联动不抛错（' + (ctx.__modalOk || '?') + '）');

  const updated = (els['updated'] && els['updated'].textContent) || '';
  ok(updated.indexOf('更新于') >= 0, '顶部更新时间已渲染（' + updated + '）');
  const rc = (els['realtimeCheckBody'] && els['realtimeCheckBody'].innerHTML) || '';
  ok(rc.indexOf('校核') >= 0, '多源实况校核面板已渲染');
  ok(rc.indexOf('yr.no') >= 0, '多源校核含新增 yr.no 数据源');
  ok(rc.indexOf('交叉校验') >= 0, '多源校核渲染逐字段交叉校验表');
  const rt = (els['realtimeBody'] && els['realtimeBody'].innerHTML) || '';
  ok(rt.indexOf('rc-badge') >= 0, '实时天气模块显示多源校验徽标（联动）');
  const fc = (els['forecastBody'] && els['forecastBody'].innerHTML) || '';
  ok(fc.indexOf('预测置信') < 0, '预报模块不再显示预测置信（需求①已落实）');
  const cl = (els['climateBody'] && els['climateBody'].innerHTML) || '';
  ok(cl.indexOf('气候距平') >= 0, '气候模块显示实况距平（联动）');
  const cal = (els['calendarBody'] && els['calendarBody'].innerHTML) || '';
  ok(cal.indexOf('cal-grid') >= 0, '日历模块已渲染（农历·节气·假日）');
  ok(cal.indexOf('data-date') >= 0, '日历每格可点击查看黄历·干支历（data-date）');
  // 需求①：活跃告警弹窗含原始链接
  const amHtml = ctx.__alertModalHtml || '';
  ok(amHtml.indexOf('查看官方发布详情') >= 0, '活跃告警弹窗含原始链接（需求①）');
  ok(amHtml.indexOf(ctx.__MOCK.globalAlerts[0].url) >= 0, '活跃告警弹窗链接指向官方源');
  // 需求②：实时气候态势与建议模块重排
  ok(cl.indexOf('cl-al-src') >= 0, '实时气候态势模块含告警原始链接（需求②）');
  ok(cl.indexOf('cl-ad-link') >= 0, '实时气候态势模块简要建议可点击查看详情（需求②）');
  ok(cl.indexOf('▶') < 0, '实时气候态势模块已取消"▶ "前缀（需求②）');
  ok(cl.indexOf('cl-al-line') >= 0, '实时气候态势：官方源/简要/建议已合并到单行（cl-al-line）');
  const wc = (els['worldClockMount'] && els['worldClockMount'].innerHTML) || '';
  ok(wc.indexOf('wc-top') >= 0, '世界时钟：机械钟/电子钟与对时区已用 wc-top 行布局包裹');
  ok(wc.indexOf('wc-sync') >= 0 && wc.indexOf('wc-sync') > wc.indexOf('wc-analog'), '世界时钟：对时区位于机械钟/电子钟右侧');
  // 潮汐/水位模块：波形曲线 + 高潮低潮预报表 + 逐时潮位表 已渲染
  const tb = (els['tideBody'] && els['tideBody'].innerHTML) || '';
  ok(tb.indexOf('tide-svg') >= 0, '潮汐模块渲染 48h 潮位波形曲线（tide-svg）');
  ok(tb.indexOf('tide-tbl') >= 0 && tb.indexOf('高潮') >= 0 && tb.indexOf('低潮') >= 0, '潮汐模块渲染高潮/低潮预报表（tide-tbl）');
  ok(tb.indexOf('逐时潮位表') >= 0, '潮汐模块渲染逐时潮位表（24h）');
  ok(tb.indexOf('距警戒') >= 0 || tb.indexOf('超警戒') >= 0, '潮汐模块渲染当前潮位与警戒水位关系');
  // 需求③：多源校核综合判定突出
  ok(rc.indexOf('rc-cons') >= 0, '多源校核综合判定已突出显示（需求③）');
  ok(rc.indexOf('综合判定') >= 0, '多源校核综合判定含标签（需求③）');
  const alertStatus = (els['alertStatus'] && els['alertStatus'].textContent) || '';
  ok(alertStatus.length > 0, '顶部告警指示器已渲染（' + alertStatus + '）');

  // 日历面板改名 + lunar 库引入（文件级）
  const idxHtml = fs.readFileSync(path.join(ROOT, 'app/public/index.html'), 'utf8');
  ok(idxHtml.indexOf('农历日历') < 0 && idxHtml.indexOf('📅 日历') >= 0, '面板已由「农历日历」改名为「日历」');
  ok(idxHtml.indexOf('vendor/lunar.js') >= 0, '已引入 vendor/lunar.js（黄历/干支数据源）');
  ok(idxHtml.indexOf('多源气候数据校核') >= 0 && idxHtml.indexOf('多源实况校核') < 0, '多源校核模块已改名「多源气候数据校核」（需求③）');
  ok(idxHtml.indexOf('id="calendarCard"') >= 0 && idxHtml.indexOf('id="linksPanel"') > idxHtml.indexOf('id="calendarCard"'), '推荐网站面板已移至日历模块之后（右侧列）');
  const css = fs.readFileSync(path.join(ROOT, 'app/public/css/styles.css'), 'utf8');
  ok(css.indexOf('.clk-ms') >= 0, '顶部时钟：毫秒已拆出 .clk-ms 独立样式（偏小/暗淡）');
  ok(css.indexOf('perspective') >= 0, '顶部时钟：整体已加 3D 外框（perspective + 立体阴影）');
  // 需求①+②：页脚版本信息 + 开源地址（GitHub/Gitee）+ 自动更新入口
  ok(idxHtml.indexOf('id="footGithub"') >= 0 && idxHtml.indexOf('github.com/net2net2net/alphasun-beihai-climate') >= 0,
    '页脚含 GitHub 开源地址链接（需求①）');
  ok(idxHtml.indexOf('id="footGitee"') >= 0 && idxHtml.indexOf('gitee.com/net2net2net/alphasun-beihai-climate') >= 0,
    '页脚含 Gitee 开源地址链接（需求①）');
  ok(idxHtml.indexOf('id="footCheckUpdate"') >= 0 && idxHtml.indexOf('检查更新') >= 0,
    '页脚含「检查更新」入口（需求②）');
  ok(idxHtml.indexOf('id="updateBanner"') >= 0, '页面含更新横幅容器 #updateBanner（需求②）');
  // 需求②：服务端自动更新接口（前端代理比对 + 按平台给下载入口）
  const srvSrc = fs.readFileSync(path.join(ROOT, 'app/server.js'), 'utf8');
  ok(srvSrc.indexOf('/api/version') >= 0, '服务端暴露 /api/version（返回当前运行版本清单）');
  ok(srvSrc.indexOf('/api/latest') >= 0, '服务端暴露 /api/latest（代理上游最新版本检测，绕开浏览器 CORS）');
  // 需求⑤：多源气候数据校核 — 增加和风天气(QWeather) 作为 CMA 实况校核源
  ok(idxHtml.indexOf('和风天气(QWeather)') >= 0, '页脚数据源署名含和风天气(QWeather)（需求⑤）');
  const appSrcQ = fs.readFileSync(path.join(ROOT, 'app/public/js/app.js'), 'utf8');
  ok(appSrcQ.indexOf('和风天气 QWeather') >= 0, '数据源网站清单含和风天气 QWeather 条目（需求⑤）');
  ok(srvSrc.indexOf('loadServerConfig') >= 0 && srvSrc.indexOf('config.json') >= 0, '服务端支持本地 config.json 读取和风天气 KEY（无需硬编码/环境变量）');
  const srcLib = fs.readFileSync(path.join(ROOT, 'app/lib/sources.js'), 'utf8');
  ok(srcLib.indexOf('qweatherNow') >= 0 && srcLib.indexOf('QWEATHER_KEY') >= 0, 'lib/sources.js: qweatherNow() 接入和风天气实况并参与多源校核');
  // 黄历库（vendor/lunar.js）独立校验：2026-08-28 应为 丙午年 丙申月 甲戌日
  try {
    const LL = require(path.join(ROOT, 'app/public/vendor/lunar.js'));
    const h = LL.Solar.fromYmd(2026, 8, 28).getLunar();
    const gzOk = h.getYearInGanZhi() === '丙午' && h.getMonthInGanZhi() === '丙申' && h.getDayInGanZhi() === '甲戌';
    ok(gzOk, 'vendor/lunar.js 干支历正确（' + h.getYearInGanZhi() + h.getMonthInGanZhi() + h.getDayInGanZhi() + '）');
    ok(Array.isArray(h.getDayYi()) && h.getDayYi().length > 0 && Array.isArray(h.getDayJi()) && h.getDayJi().length > 0, 'vendor/lunar.js 宜忌可用（宜 ' + h.getDayYi().slice(0, 3).join('/') + ' …）');
    ok(typeof h.getDayChong() === 'string' && typeof h.getDaySha() === 'string', 'vendor/lunar.js 冲煞可用（冲' + h.getDayChong() + '·煞' + h.getDaySha() + '）');
    ok(typeof h.getXiu() === 'string' && typeof h.getXiuLuck() === 'string', 'vendor/lunar.js 星宿可用（' + h.getXiu() + '·' + h.getXiuLuck() + '）');
    ok(typeof h.getPengZuGan() === 'string' && typeof h.getPengZuZhi() === 'string', 'vendor/lunar.js 彭祖百忌可用');
  } catch (e) { ok(false, 'vendor/lunar.js 黄历校验: ' + e.message); }
  // 前端 huangli() 在库未加载（沙箱无 Solar）时安全降级
  ok(ctx.__hl === null || ctx.__hl === 'NO_FN', '前端 huangli() 库未加载时安全降级（沙箱 __hl=' + (ctx.__hl === null ? 'null' : ctx.__hl) + '）');

  // 4) data.js 运行时加载（安卓专属浏览器聚合层，替代 Node 后端 buildOverview）
  // 安卓端无后端，data.js 是数据唯一来源；IIFE 执行或导出缺失会直接导致白屏，故加运行时护栏。
  try {
    const dCtx = vm.createContext({
      window: {}, console, Date, Math, JSON, RegExp, Object, Array, String, Number, Boolean, Promise, Error,
      parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, Set, Map, Symbol, Proxy,
      navigator: { userAgent: '' },
      document: { createElement: () => ({}), getElementById: () => null },
      fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
      AbortController: class { abort() {} }, setTimeout: () => 0, clearTimeout: () => {},
    });
    const dSrc = fs.readFileSync(path.join(ROOT, 'app-android/www/js/data.js'), 'utf8');
    vm.runInContext(dSrc, dCtx, { filename: 'data.js' });
    const A = dCtx.window && dCtx.window.AlphaData;
    ok(A && typeof A === 'object', 'data.js IIFE 执行后挂载 window.AlphaData（安卓数据层可用）');
    ok(A && typeof A.buildOverview === 'function', 'AlphaData.buildOverview 是可调用函数（安卓端数据入口）');
    ok(A && typeof A.getJson === 'function', 'AlphaData.getJson 已导出（CapHttp 优先 HTTP 封装）');
    ok(A && Array.isArray(A.STATIONS) && A.STATIONS.length >= 5, 'AlphaData.STATIONS 已导出（' + (A ? A.STATIONS.length : 0) + ' 站）');
    ok(A && typeof A.buildAlertIntel === 'function', 'AlphaData.buildAlertIntel 已导出（告警情报）');
    // verifyRealtime / fetchRiverReservoir / fetchRegionalBeihai 由 buildOverview 经闭包内部调用，
    // 无需公开导出；此处校验其在 data.js 中已定义，防止未来重构误删导致安卓取数失败。
    ok(/function\s+verifyRealtime\s*\(/.test(dSrc), 'data.js 含 verifyRealtime 实现（buildOverview 内部依赖·多源校核）');
    ok(/function\s+fetchRiverReservoir\s*\(/.test(dSrc) && /function\s+fetchRegionalBeihai\s*\(/.test(dSrc),
      'data.js 含江河水库/区域天气采集（buildOverview 内部依赖，对齐 server.js）');
    ok(A && typeof A.getClimate === 'function', 'AlphaData.getClimate 已导出（气候常年值）');
  } catch (e) {
    ok(false, 'data.js 运行时加载未抛错: ' + (e.stack || e.message));
  }

  finish();
}

function finish() {
  console.log('\n========================================');
  console.log('通过 ' + okList.length + ' / 失败 ' + fails.length);
  if (fails.length) {
    console.log('失败项：');
    fails.forEach(f => console.log('  - ' + f));
    if (process.argv.includes('--throw')) { throw new Error('回归门禁未通过：' + fails.length + ' 项'); }
    process.exit(1);
  } else {
    console.log('✅ 全部通过：无回退、语法/双端/render/历法均正常');
    process.exit(0);
  }
}
