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
      { label: 'Open-Meteo', ok: true, skipped: false, temp: 30, text: '晴', precip: 0, uv: 8, category: 'clear' },
      { label: '中国天气网', ok: true, skipped: false, temp: 30.2, text: '晴', precip: 0, uv: 8, category: 'clear' },
      { label: 'wttr.in', ok: true, skipped: false, temp: 29.8, text: '晴', precip: 0, uv: 8, category: 'clear' },
      { label: '彩云天气', ok: true, skipped: false, temp: 30.1, text: '晴', precip: 0, uv: 8, category: 'clear' },
    ],
    consensus: { category: 'clear', tempMin: 29.8, tempMax: 30.2, tempMean: 30, rhMean: 75, uvMean: 8, uvMin: 8, uvMax: 8, air: { aqi: 45 } },
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
      type: '暴雨', station: '北海', region: '北海', level: 3, levelName: '预警',
      detail: '北海市气象台发布暴雨蓝色预警', advice: '注意防范城市内涝',
      beihaiRelation: 'direct', dist: 0, lat: 21.48, lon: 109.11, color: '#fb8500',
      id: 'a1', time: '2026-08-27 09:00', summary: '...', source: '北海气象台',
      category: 'rain', minDistBH: 0, relLabel: '涉及北海', url: '', icon: '',
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
    { name: '北海港', source: 'NMHC', current: 1.5, warnLevel: 3.0, extremes: [{ type: 'high', time: '10:00', h: 2.8 }, { type: 'low', time: '16:00', h: 0.6 }] },
    { name: '铁山港', source: 'NMHC', current: 1.2, warnLevel: 3.2, extremes: [{ type: 'high', time: '10:30', h: 3.0 }, { type: 'low', time: '16:30', h: 0.5 }] },
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
  try { var dq = document.getElementById('dqChip'); if (dq.onclick) dq.onclick(); globalThis.__dqClick = 'ok'; } catch (e) { globalThis.__dqClick = 'ERR ' + e.message; }
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

  const dqText = (els['dqChip'] && els['dqChip'].textContent) || '';
  ok(dqText.indexOf('数据可信度') >= 0, '顶部 #dqChip 已渲染数据可信度（' + dqText + '）');
  ok(ctx.__dqClick === 'ok', '点击 #dqChip 跳转逻辑不抛错（' + (ctx.__dqClick || '?') + '）');

  const updated = (els['updated'] && els['updated'].textContent) || '';
  ok(updated.indexOf('更新于') >= 0, '顶部更新时间已渲染（' + updated + '）');
  const rc = (els['realtimeCheckBody'] && els['realtimeCheckBody'].innerHTML) || '';
  ok(rc.indexOf('校核') >= 0, '多源实况校核面板已渲染');
  const cal = (els['calendarBody'] && els['calendarBody'].innerHTML) || '';
  ok(cal.indexOf('cal-grid') >= 0, '农历日历模块已渲染');
  const alertStatus = (els['alertStatus'] && els['alertStatus'].textContent) || '';
  ok(alertStatus.length > 0, '顶部告警指示器已渲染（' + alertStatus + '）');

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
