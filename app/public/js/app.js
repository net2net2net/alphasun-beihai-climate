// AlphaSun · 前端仪表盘逻辑
const ICON = { sunny:'☀️', partly:'⛅', cloudy:'☁️', fog:'🌫️', drizzle:'🌦️', rain:'🌧️', snow:'❄️', storm:'⛈️', unknown:'❓' };
const state = { data: null, sel: null, chart: null, dims: new Set(['temp','precip','wind','rh','aqi']) };

// ===== 主题（深色/浅色，默认深色，localStorage 持久化）=====
let theme = (() => { try { return localStorage.getItem('alphasun-theme') || 'dark'; } catch (e) { return 'dark'; } })();
function updateThemeBtn(){
  const b = $('themeBtn'); if (!b) return;
  b.textContent = theme === 'light' ? '🌙 深色' : '☀ 浅色';
}
function applyTheme(t){
  theme = t;
  try { localStorage.setItem('alphasun-theme', t); } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
  updateThemeBtn();
}
function toggleTheme(){
  applyTheme(theme === 'light' ? 'dark' : 'light');
  renderChartOn('hourlyChart');
  if (charts.focusChart) { try { charts.focusChart.destroy(); } catch (e) {} delete charts.focusChart; renderChartOn('focusChart'); }
}
function chartColors(){
  return theme === 'light'
    ? { legend:'#243044', grid:'#e3e8ef', tick:'#57636e', yTitle:'#c2410c', y1Title:'#57636e' }
    : { legend:'#e6edf3', grid:'#1c2330', tick:'#8b949e', yTitle:'#fb8500', y1Title:'#8b949e' };
}

// ===== 声音警报（默认关闭，置于顶部"警报"旁；Web Audio 生成报警音，零外部文件）=====
let audioCtx = null, soundOn = false, soundTimer = null;
function ensureAudio(){
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; } }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playAlarmBeep(){
  const ctx = ensureAudio(); if (!ctx) return;
  const now = ctx.currentTime;
  [[880,0],[660,0.18],[880,0.36]].forEach(([f,t]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
    const s = now + t;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.22, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
    o.start(s); o.stop(s + 0.17);
  });
}
function startSoundAlarm(){ if (soundTimer) return; playAlarmBeep(); soundTimer = setInterval(playAlarmBeep, 4000); }
function stopSoundAlarm(){ if (soundTimer) { clearInterval(soundTimer); soundTimer = null; } }
function updateSoundAlarm(hasAlert){ if (soundOn && hasAlert) startSoundAlarm(); else stopSoundAlarm(); }
function setSound(on){
  soundOn = on;
  const b = $('soundBtn');
  if (b) { b.textContent = on ? '🔊' : '🔇'; b.classList.toggle('on', on); b.title = on ? '声音警报：开（点击关闭）' : '声音警报：关（点击开启）'; }
  if (on) ensureAudio();
  updateSoundAlarm(state.data && state.data.globalAlerts && state.data.globalAlerts.length > 0);
}
// ===== 世界时钟（位于「推荐天气/数据源网站」面板底部）：设备时间 / 北京时间 / 常用国际时区，机械钟+数字钟，毫秒精度，对时功能 =====
// 常用时区（tz 为 IANA 名；local 表示设备本地时钟，不参与校准）
const ZONES = [
  { name: '设备时间', tz: 'local', accent: true },
  { name: '北京时间', tz: 'Asia/Shanghai', accent: true },
  { name: '协调世界时 UTC', tz: 'UTC' },
  { name: '纽约 New York', tz: 'America/New_York' },
  { name: '伦敦 London', tz: 'Europe/London' },
  { name: '东京 Tokyo', tz: 'Asia/Tokyo' },
  { name: '巴黎 Paris', tz: 'Europe/Paris' },
  { name: '洛杉矶 Los Angeles', tz: 'America/Los_Angeles' },
  { name: '悉尼 Sydney', tz: 'Australia/Sydney' },
  { name: '莫斯科 Moscow', tz: 'Europe/Moscow' },
  { name: '迪拜 Dubai', tz: 'Asia/Dubai' },
  { name: '新加坡 Singapore', tz: 'Asia/Singapore' },
];
let calibOffset = 0;      // 校准偏差（设备时刻 + 偏差 = 真实 UTC ms）
let devBase = 0, perfBase = 0, rafWorld = 0;
function fmtZone(epochMs, tz) {
  const d = new Date(epochMs);
  let h, m, s, dateStr;
  if (tz === 'local') {
    h = d.getHours(); m = d.getMinutes(); s = d.getSeconds();
    dateStr = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' });
  } else {
    const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d);
    const get = (t) => { const x = parts.find(p => p.type === t); return x ? x.value : '0'; };
    h = +get('hour'); m = +get('minute'); s = +get('second');
    dateStr = `${get('year')}-${get('month')}-${get('day')} ${get('weekday')}`;
  }
  const ms = d.getMilliseconds();
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return { h, m, s, ms, hms, dateStr };
}
function setRot(root, sel, deg) { const el = root.querySelector(sel); if (el) el.setAttribute('transform', `rotate(${deg.toFixed(3)} 100 100)`); }
function paintClock(root, bjEpoch, devEpoch) {
  const bj = fmtZone(bjEpoch, 'Asia/Shanghai');
  const secA = (bj.s + bj.ms / 1000) * 6;
  const minA = (bj.m + bj.s / 60) * 6;
  const hourA = ((bj.h % 12) + bj.m / 60) * 30;
  setRot(root, '.wc-hour-hand', hourA);
  setRot(root, '.wc-min-hand', minA);
  setRot(root, '.wc-sec-hand', secA);
  const big = root.querySelector('.wc-big-time'); if (big) big.textContent = bj.hms;
  const bigms = root.querySelector('.wc-big-ms'); if (bigms) bigms.textContent = '.' + String(bj.ms).padStart(3, '0');
  root.querySelectorAll('.wc-z').forEach(z => {
    const tz = z.getAttribute('data-tz');
    const f = fmtZone(tz === 'local' ? devEpoch : bjEpoch, tz);
    const t = z.querySelector('.wc-z-time'); if (t) t.textContent = f.hms + '.' + String(f.ms).padStart(3, '0');
    const dd = z.querySelector('.wc-z-date'); if (dd) dd.textContent = f.dateStr;
  });
}
function buildClockSVG() {
  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0;
    const a = i * 6 * Math.PI / 180;
    const r1 = big ? 76 : 81, r2 = 88;
    const x1 = (100 + r1 * Math.sin(a)).toFixed(1), y1 = (100 - r1 * Math.cos(a)).toFixed(1);
    const x2 = (100 + r2 * Math.sin(a)).toFixed(1), y2 = (100 - r2 * Math.cos(a)).toFixed(1);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${big ? 'wc-tick-major' : 'wc-tick-minor'}"/>`;
  }
  let nums = '';
  for (let n = 1; n <= 12; n++) {
    const a = n * 30 * Math.PI / 180;
    const r = 66;
    const x = (100 + r * Math.sin(a)).toFixed(1), y = (100 - r * Math.cos(a) + 4).toFixed(1);
    nums += `<text x="${x}" y="${y}" class="wc-num">${n}</text>`;
  }
  return `<svg viewBox="0 0 200 200" class="wc-svg" aria-label="机械时钟">
    <defs>
      <radialGradient id="wcFace" cx="42%" cy="38%" r="65%">
        <stop offset="0%" class="wc-g0"/><stop offset="100%" class="wc-g1"/>
      </radialGradient>
    </defs>
    <circle cx="100" cy="100" r="96" class="wc-bezel"/>
    <circle cx="100" cy="100" r="89" fill="url(#wcFace)" class="wc-face"/>
    ${ticks}${nums}
    <g class="wc-hour-hand"><line x1="100" y1="100" x2="100" y2="56"/></g>
    <g class="wc-min-hand"><line x1="100" y1="100" x2="100" y2="34"/></g>
    <g class="wc-sec-hand"><line x1="100" y1="114" x2="100" y2="28"/></g>
    <circle cx="100" cy="100" r="5.5" class="wc-cap"/>
  </svg>`;
}
function renderWorldClock() {
  const mount = document.getElementById('worldClockMount');
  if (!mount) return;
  const zonesHtml = ZONES.map(z => `<div class="wc-z ${z.accent ? 'wc-z-accent' : ''}" data-tz="${z.tz}">
      <div class="wc-z-name">${z.name}</div>
      <div class="wc-z-time">--:--:--.000</div>
      <div class="wc-z-date muted"></div>
    </div>`).join('');
  mount.innerHTML = `
    <div class="wc-top">
      <div class="wc-main">
        <div class="wc-analog">${buildClockSVG()}</div>
        <div class="wc-readout">
          <div class="wc-big"><span class="wc-big-time">--:--:--</span><span class="wc-big-ms">.000</span></div>
          <div class="wc-big-label">北京时间 · 数字钟</div>
          <div class="wc-big-label2">与左侧机械钟同步</div>
        </div>
      </div>
      <div class="wc-sync">
        <button id="syncBtn" class="btn">🕒 对时</button>
        <span id="syncStatus" class="wc-sync-status">未对时（使用设备时间）</span>
      </div>
    </div>
    <div class="wc-zones">${zonesHtml}</div>`;
}
function tickWorld() {
  const dev = devBase + (performance.now() - perfBase);   // 亚毫秒平滑的设备时刻
  const bj = dev + calibOffset;                           // 校准后的真实 UTC ms（北京时间据此 +8h）
  const main = document.getElementById('worldClockMount'); if (main) paintClock(main, bj, dev);
  const fc = document.querySelector('#focusBody #worldClockMount'); if (fc) paintClock(fc, bj, dev); // 放大模态内的克隆也同步走时
  rafWorld = requestAnimationFrame(tickWorld);
}
async function syncTime() {
  const st = document.getElementById('syncStatus');
  const btn = document.getElementById('syncBtn');
  if (st) st.textContent = '对时中…';
  try {
    const t0 = performance.now();
    const r = await fetch('/api/time');
    const t1 = performance.now();
    const data = await r.json();
    const rtt = t1 - t0;
    const clientReceive = Date.now();
    const serverEst = data.now + rtt / 2;       // 估算服务器在客户端接收时刻的真实时间
    calibOffset = serverEst - clientReceive;      // 设备时刻 → 真实 UTC ms 的偏差
    const sign = calibOffset >= 0 ? '+' : '−';
    if (st) st.textContent = `已对时 · 偏差 ${sign}${Math.abs(calibOffset).toFixed(0)} ms（往返 ${rtt.toFixed(0)} ms）`;
    if (btn) btn.classList.add('on');
  } catch (e) {
    if (st) st.textContent = '对时失败（网络错误）';
  }
}
function startWorldClock() {
  renderWorldClock();
  devBase = Date.now(); perfBase = performance.now();
  const btn = document.getElementById('syncBtn'); if (btn) btn.onclick = syncTime;
  if (!rafWorld) tickWorld();
}

// ===== 农历 / 节气 / 中国法定节假日（客户端计算，无需联网） =====
const LUNAR_INFO = [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,0x0a2e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,0x0d520];
function lYearDays(y){ let sum=348; for(let i=0x8000;i>0x8;i>>=1) sum += (LUNAR_INFO[y-1900]&i)?1:0; return sum + leapDays(y); }
function leapDays(y){ const lm=leapMonth(y); if(lm){ return (LUNAR_INFO[y-1900]&0x10000)?30:29; } return 0; }
function leapMonth(y){ return LUNAR_INFO[y-1900]&0xf; }
function monthDays(y,m){ return (LUNAR_INFO[y-1900]&(0x10000>>m))?30:29; }
function solar2lunar(y,m,d){
  const baseDate = new Date(1900, 0, 31);
  const objDate = new Date(y, m-1, d);
  let offset = Math.round((objDate - baseDate)/86400000);
  let lunarY = 1900;
  for(; lunarY < 2101 && offset > 0; lunarY++) offset -= lYearDays(lunarY);
  if(offset < 0){ offset += lYearDays(lunarY-1); lunarY--; }
  const leap = leapMonth(lunarY);
  let month = 1, isLeap = false;
  while(offset > 0){
    if(!isLeap && leap > 0 && month === leap){
      offset -= leapDays(lunarY);
      isLeap = true;
      if(offset <= 0) break;
      continue;
    }
    if(offset > monthDays(lunarY, month)){ offset -= monthDays(lunarY, month); if(isLeap) isLeap = false; month++; }
    else break;
  }
  return { lYear:lunarY, lMonth:month, lDay:offset + 1, isLeap };
}
const CN_MONTH=['正','二','三','四','五','六','七','八','九','十','冬','腊'];
const CN_DAY=['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
function lunarDate(y,m,d){
  const s=solar2lunar(y,m,d);
  const gz=['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  const dz=['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const sx=['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
  const g=i=>((s.lYear-4)%10+10)%10, j=i=>((s.lYear-4)%12+12)%12;
  return { monthCn: CN_MONTH[s.lMonth-1], dayCn: CN_DAY[s.lDay-1], leap: s.isLeap,
    ganzhi: gz[g(0)]+dz[j(0)], zodiac: sx[j(0)] };
}
// 二十四节气
const TERM_NAME=['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];
const TERM_INFO=[0,21208,42467,63836,85337,107014,128867,150921,173149,195551,218072,240693,263343,285989,308563,331033,353350,375494,397447,419210,440795,462224,483532,504758];
function solarTermDay(y,n){ const off=new Date((31556925974.7*(y-1900)+TERM_INFO[n]*60000)+Date.UTC(1900,0,6,2,5)); return off.getUTCDate(); }
function getTerm(y,m,d){ const i=(m-1)*2; if(d===solarTermDay(y,i)) return TERM_NAME[i]; if(d===solarTermDay(y,i+1)) return TERM_NAME[i+1]; return ''; }
// 中国法定节假日（2025-2026 依据国务院办公厅通知；2027 待公布，仅显示周末）
const HOLIDAY_RAW = {
  '2025': [
    ['01-01','01-01','元旦','rest'], ['01-28','02-04','春节','rest'], ['01-26','01-26','春节补班','work'],
    ['04-04','04-06','清明','rest'], ['05-01','05-05','劳动节','rest'], ['04-27','04-27','劳动节补班','work'],
    ['05-31','06-02','端午','rest'], ['10-01','10-08','中秋·国庆','rest'], ['09-28','09-28','中秋国庆补班','work'],
  ],
  '2026': [
    ['01-01','01-03','元旦','rest'], ['01-04','01-04','元旦补班','work'],
    ['02-15','02-23','春节','rest'], ['02-14','02-14','春节补班','work'], ['02-28','02-28','春节补班','work'],
    ['04-04','04-06','清明','rest'], ['05-01','05-05','劳动节','rest'], ['05-09','05-09','劳动节补班','work'],
    ['06-19','06-21','端午','rest'], ['09-25','09-27','中秋','rest'],
    ['10-01','10-07','国庆','rest'], ['09-20','09-20','国庆补班','work'], ['10-10','10-10','国庆补班','work'],
  ],
};
const HOLIDAYS = {};
(function buildHolidays(){
  for(const y in HOLIDAY_RAW){
    for(const [s,e,n,t] of HOLIDAY_RAW[y]){
      let [sm,sd]=s.split('-').map(Number), [em,ed]=e.split('-').map(Number), d=sd;
      while(true){
        HOLIDAYS[y+'-'+String(sm).padStart(2,'0')+'-'+String(d).padStart(2,'0')]={t,n};
        if(sm===em && d===ed) break;
        d++; if(d>31){ d=1; sm++; }
      }
    }
  }
})();
function getHoliday(y,m,d){ return HOLIDAYS[y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')] || null; }

// 黄历（传统历法推算，由 vendor/lunar.js 注入全局 Solar/Lunar；库未加载时安全降级为 null）
// 输出：干支历 年/月/日柱、每日宜忌、冲煞、二十八宿（含吉凶）、彭祖百忌、值神、喜神方位
function huangli(y, m, d) {
  try {
    if (typeof Solar === 'undefined' || !Solar.fromYmd) return null;
    const lu = Solar.fromYmd(y, m, d).getLunar();
    const join = a => (Array.isArray(a) ? a.join(' ') : (a || ''));
    return {
      yearGZ: lu.getYearInGanZhi(), monthGZ: lu.getMonthInGanZhi(), dayGZ: lu.getDayInGanZhi(),
      yi: join(lu.getDayYi()), ji: join(lu.getDayJi()),
      chong: lu.getDayChong(), sha: lu.getDaySha(),
      xiu: lu.getXiu(), xiuLuck: lu.getXiuLuck(),
      pengGan: lu.getPengZuGan(), pengZhi: lu.getPengZuZhi(),
      tianShen: lu.getDayTianShen(), posXi: lu.getDayPositionXi(),
      monthCn: lu.getMonthInChinese(), dayCn: lu.getDayInChinese(),
    };
  } catch (e) { return null; }
}

// ===== 农历日历模块（右侧底部，可翻看） =====
let calView = null;
function renderCalendar(){
  const el = $('calendarBody'); if(!el) return;
  const now = new Date();
  if(!calView) calView = { y: now.getFullYear(), m: now.getMonth()+1 };
  const y = calView.y, m = calView.m;
  const startW = (new Date(y, m-1, 1).getDay()+6)%7; // 周一为首列
  const daysInMonth = new Date(y, m, 0).getDate();
  const wkns=['一','二','三','四','五','六','日'];
  let html = '<div class="cal-bar">';
  html += '<button class="cal-nav" data-cal="prev" title="上一月">‹</button>';
  html += '<span class="cal-title">'+y+'年 '+m+'月</span>';
  html += '<button class="cal-nav" data-cal="next" title="下一月">›</button>';
  html += '<button class="cal-nav cal-today" data-cal="today" title="回到今天">今</button>';
  html += '</div><div class="cal-grid cal-head">';
  for(const w of wkns) html += '<div class="cal-w">'+w+'</div>';
  html += '</div><div class="cal-grid">';
  for(let i=0;i<startW;i++) html += '<div class="cal-cell cal-empty"></div>';
  for(let d=1; d<=daysInMonth; d++){
    const lu = lunarDate(y,m,d), term = getTerm(y,m,d), hol = getHoliday(y,m,d);
    const isToday = (y===now.getFullYear() && m===now.getMonth()+1 && d===now.getDate());
    const dow = new Date(y,m-1,d).getDay();
    const isWeekend = (dow===0||dow===6) && !(hol && hol.t==='work');
    let cls = 'cal-cell'; if(isToday) cls += ' cal-today'; if(isWeekend) cls += ' cal-weekend';
    const sub = term || ((lu.leap?'闰':'')+lu.monthCn+lu.dayCn);
    const hl = huangli(y,m,d);
    const yiTag = (hl && hl.yi) ? '<div class="cal-yi">宜 '+hl.yi.split(' ')[0]+'</div>' : '';
    html += '<div class="'+cls+'" data-date="'+y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')+'" title="点击查看黄历·干支历"><div class="cal-d">'+d+'</div><div class="cal-sub">'+sub+'</div>'+yiTag;
    if(hol) html += '<span class="cal-badge '+(hol.t==='rest'?'rest':'work')+'">'+(hol.t==='rest'?'休':'班')+'</span><div class="cal-hname">'+hol.n+'</div>';
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}
function startCalendar(){
  const el = $('calendarBody'); if(!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-cal]');
    if (b) {
      const act = b.getAttribute('data-cal');
      if(act==='prev'){ calView.m--; if(calView.m<1){ calView.m=12; calView.y--; } }
      else if(act==='next'){ calView.m++; if(calView.m>12){ calView.m=1; calView.y++; } }
      else if(act==='today'){ const n=new Date(); calView={ y:n.getFullYear(), m:n.getMonth()+1 }; }
      renderCalendar();
      return;
    }
    const cell = e.target.closest('[data-date]');
    if (cell) {
      const p = cell.getAttribute('data-date').split('-').map(Number);
      renderHuangliDetail(p[0], p[1], p[2]);
    }
  });
  renderCalendar();
  setInterval(renderCalendar, 60000); // 跨日自动刷新“今天”高亮
  // 黄历弹窗关闭（点击遮罩 / 关闭按钮 / Esc）
  const mask = $('hlModal');
  if (mask) mask.addEventListener('click', e => { if (e.target === mask || (e.target.closest && e.target.closest('[data-hl-close]'))) closeHuangli(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHuangli(); });
}
// 打开黄历·干支历详情弹窗
function renderHuangliDetail(y, m, d) {
  const el = $('hlModal'); if (!el) return;
  const hl = huangli(y, m, d);
  const lu = lunarDate(y, m, d);
  const term = getTerm(y, m, d);
  const hol = getHoliday(y, m, d);
  const wk = ['日','一','二','三','四','五','六'][new Date(y, m-1, d).getDay()];
  let html = '<div class="hl-card" role="dialog" aria-label="黄历详情">';
  html += '<button class="hl-close" data-hl-close title="关闭">✕</button>';
  html += '<div class="hl-h">'+y+'年'+m+'月'+d+'日 · 周'+wk+'</div>';
  html += '<div class="hl-sub">农历 '+(lu.leap?'闰':'')+lu.monthCn+'月'+lu.dayCn+(term?(' · '+term):'')+(hol?(' · '+hol.n):'')+'</div>';
  if (hl) {
    html += '<div class="hl-gz">干支历 <b>'+hl.yearGZ+'</b>年 <b>'+hl.monthGZ+'</b>月 <b>'+hl.dayGZ+'</b>日</div>';
    html += '<div class="hl-grid">';
    html += '<div class="hl-row"><span class="hl-k yi">宜</span><span class="hl-v">'+hl.yi+'</span></div>';
    html += '<div class="hl-row"><span class="hl-k ji">忌</span><span class="hl-v">'+hl.ji+'</span></div>';
    html += '<div class="hl-row"><span class="hl-k">冲煞</span><span class="hl-v">冲'+hl.chong+' · 煞'+hl.sha+'</span></div>';
    const xiuCls = hl.xiuLuck === '吉' ? 'luck-good' : 'luck-bad';
    html += '<div class="hl-row"><span class="hl-k">星宿</span><span class="hl-v">'+hl.xiu+' <em class="'+xiuCls+'">('+hl.xiuLuck+')</em></span></div>';
    html += '<div class="hl-row"><span class="hl-k">彭祖百忌</span><span class="hl-v">'+hl.pengGan+'；'+hl.pengZhi+'</span></div>';
    html += '<div class="hl-row"><span class="hl-k">值神</span><span class="hl-v">'+hl.tianShen+'</span></div>';
    html += '<div class="hl-row"><span class="hl-k">喜神</span><span class="hl-v">'+(hl.posXi||'—')+'</span></div>';
    html += '</div>';
  } else {
    html += '<div class="hl-sub muted">黄历数据暂不可用（lunar 库未加载）</div>';
  }
  html += '<div class="hl-foot muted">黄历为传统历法推算，宜忌趋避仅供参考</div>';
  html += '</div>';
  el.innerHTML = html;
  el.hidden = false;
}
function closeHuangli() { const el = $('hlModal'); if (el) el.hidden = true; }

function startTopClock() {
  const dEl = document.getElementById('clkDate');
  const tEl = document.getElementById('clkTime');
  if (!dEl || !tEl) return;
  const pad = n => String(n).padStart(2, '0');
  const wk = ['日','一','二','三','四','五','六'];
  let lastKey = '';
  function frame() {
    const d = new Date();
    const key = d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate();
    if (key !== lastKey) {
      lastKey = key;
      const lu = lunarDate(d.getFullYear(), d.getMonth()+1, d.getDate());
      const hl0 = huangli(d.getFullYear(), d.getMonth()+1, d.getDate());
      dEl.textContent = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' 周'+wk[d.getDay()]+' · '+(hl0?hl0.yearGZ+'年 · ':'')+'农历'+(lu.leap?'闰':'')+lu.monthCn+'月'+lu.dayCn;
    }
    const ms = String(d.getMilliseconds()).padStart(3,'0');
    tEl.innerHTML = pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+'<span class="clk-ms">.'+ms+'</span>';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

const LNAME = ['正常','注意','预警','警报','紧急'];
const LCOL = ['#3fb950','#d29922','#fb8500','#e5484d','#bc1a1a'];

// 24h 逐时曲线可选维度（key 对应 hourly24 字段，axis: y=左轴温度类, y1=右轴强度类）
const DIMS = {
  temp:      { label:'气温',     unit:'℃',  color:'#fb8500', axis:'y',  dec:1, key:'temp' },
  feels:     { label:'体感',     unit:'℃',  color:'#ffb703', axis:'y',  dec:1, key:'feels' },
  precip:    { label:'降水',     unit:'mm', color:'#58a6ff', axis:'y1', dec:1, key:'precip' },
  precipProb:{ label:'降水概率', unit:'%',  color:'#4cc9f0', axis:'y1', dec:0, key:'precipProb' },
  wind:      { label:'风速',     unit:'m/s',color:'#80ed99', axis:'y1', dec:1, key:'wind' },
  gust:      { label:'阵风',     unit:'m/s',color:'#ff6b6b', axis:'y1', dec:1, key:'gust' },
  rh:        { label:'湿度',     unit:'%',  color:'#c77dff', axis:'y1', dec:0, key:'rh' },
  cloud:     { label:'云量',     unit:'%',  color:'#adb5bd', axis:'y1', dec:0, key:'cloud' },
  pressure:  { label:'气压',     unit:'hPa',color:'#ffd166', axis:'y1', dec:1, key:'pressure' },
  aqi:       { label:'AQI',      unit:'',   color:'#e0aaff', axis:'y1', dec:0, key:'aqi' },
};

function fmt(t){ return t ? t.slice(11,16) : '—'; }
function $(id){ return document.getElementById(id); }

// ===== 原生端（Capacitor）判定：Android/iOS 壳内运行 =====
// 原生端没有 Node 后端，/api/overview 走本地静态服务器会 404 → 全屏无数据。
// 因此原生端改用 window.AlphaData.buildOverview()（浏览器版聚合层，js/data.js 已挂载）。
function isNative() {
  try {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  } catch (e) { return false; }
}
// 仅在原生端动态注入 js/data.js（Web/PWA 不加载这份 ~56KB 文件，保持双端单源一致）。
// js/data.js 是 Android 专属、不参与双端同步；用动态注入避免破坏 index.html 逐字节一致护栏。
function ensureAlphaData() {
  if (window.AlphaData) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/data.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('AlphaData 数据层加载失败（js/data.js）'));
    document.head.appendChild(s);
  });
}
async function load() {
  try {
    let data;
    if (isNative()) {
      await ensureAlphaData();
      data = await window.AlphaData.buildOverview();
    } else {
      const r = await fetch('/api/overview');
      data = await r.json();
    }
    state.data = data;
    if (!state.sel) state.sel = state.data.stations[0].id;
    render();
  } catch (e) {
    $('updated').textContent = '加载失败：' + e.message;
  }
}

function render() {
  const d = state.data;
  $('updated').textContent = '更新于 ' + new Date(d.updated).toLocaleString('zh-CN');
  state.lastUpdatedTs = Date.now(); updateAutoRefresh();
  // 顶部"警报 / 无警报"指示器（唯一"警报"显示）：有告警显示闪烁"警报"，无告警显示绿色"无警报"
  const hasAlert = d.globalAlerts.length > 0;
  const asEl = $('alertStatus');
  if (asEl) {
    if (hasAlert) { asEl.textContent = '⚠ 警报'; asEl.className = 'alert-status alert'; }
    else { asEl.textContent = '✅ 无警报'; asEl.className = 'alert-status ok'; }
  }
  updateSoundAlarm(hasAlert);
  // 横幅（活跃告警，点击查看详情）
  const banner = $('alertBanner');
  const top = d.globalAlerts.filter(a => a.beihaiRelation === 'direct' || a.beihaiRelation === 'possible').slice(0, 8);
  if (top.length) {
    banner.classList.remove('hidden');
    banner.innerHTML = '<span class="a-label">⚠ 活跃告警：</span>' + top.map((a, i) =>
      `<span class="a-item" data-i="${i}">${a.type}·${a.station || a.region || '—'}（${a.levelName}）</span>`).join('');
    banner.querySelectorAll('.a-item').forEach(el => {
      el.onclick = () => openAlertModal(top[+el.dataset.i]);
    });
  } else banner.classList.add('hidden');

  renderStations(); renderRealtime(); renderRealtimeCheck(); renderAir(); renderMarine(); renderRiverReservoir();
  renderAstro(); renderGlow(); renderMorningGlow(); renderTides();
  renderForecast7(); renderForecast15();
  renderAlerts(); renderEvents(); renderChartDims();
  renderClimate(); renderLinks();
  renderTicker();
  if (!tk.autostarted) { tk.autostarted = true; tkStartAuto(); }
  AlphaMap.setData(d); AlphaMap.legend($('mapLegend'));
  renderGlobalLevelAlert();
}

// ===== 刷新可用性：忙碌态 + 下次自动刷新倒计时（日常可用）=====
function doRefresh() {
  const b = document.getElementById('refreshBtn');
  if (b) { b.classList.add('busy'); b.disabled = true; }
  load().finally(() => {
    if (b) { b.classList.remove('busy'); b.disabled = false; }
    updateAutoRefresh();
    try { renderChartOn('hourlyChart'); } catch (e) {}
  });
}
function updateAutoRefresh() {
  const el = document.getElementById('autoRefresh'); if (!el) return;
  const base = state.lastUpdatedTs || Date.now();
  let ms = (base + 10 * 60 * 1000) - Date.now(); if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  el.textContent = '· 下次自动刷新 ' + m + ' 分 ' + String(s).padStart(2, '0') + ' 秒';
}

function renderChartDims() {
  const el = $('chartDims'); if (!el) return;
  el.innerHTML = Object.entries(DIMS).map(([k, d]) => {
    const on = state.dims.has(k);
    return `<button class="dim-chip ${on?'on':''}" data-k="${k}" style="--c:${d.color}">${d.label}</button>`;
  }).join('');
  el.querySelectorAll('.dim-chip').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.k;
      if (state.dims.has(k)) state.dims.delete(k); else state.dims.add(k);
      b.classList.toggle('on');
      renderChart();
    };
  });
}

function selStation(){ return state.data.stations.find(s => s.id === state.sel); }

function renderStations() {
  const el = $('stationPicker');
  const ICONS = { beihai: '🏙️', yinhai: '🏖️', tieshan: '🏭', hepu: '🌾', weizhou: '🌋' };
  const tabs = state.data.stations.map(s => {
    const lv = s.alert.level;
    const sel = s.id === state.sel;
    return `<div class="st-tab ${sel?'active':''}" data-id="${s.id}" title="${s.desc || s.name}">
      <span class="st-ico">${ICONS[s.id] || '📍'}</span>
      <span class="st-name">${s.name}</span>
      <span class="st-check">✓</span></div>`;
  }).join('');
  // 仅替换 .st-tabs（保留 panel-h 标题）
  let tabsEl = el.querySelector('.st-tabs');
  if (!tabsEl) { el.insertAdjacentHTML('beforeend', '<div class="st-tabs"></div>'); tabsEl = el.querySelector('.st-tabs'); }
  tabsEl.innerHTML = tabs;
  tabsEl.querySelectorAll('.st-tab').forEach(t => t.onclick = () => {
    state.sel = t.dataset.id;
    renderRealtime(); renderAir(); renderMarine(); renderAstro(); renderGlow(); renderMorningGlow(); renderForecast7(); renderForecast15(); renderChart();
  });
}

function renderRealtime() {
  const s = selStation(); $('rtStation').textContent = '· ' + s.name;
  const w = s.weather;
  if (!w || !w.ok) { $('realtimeBody').innerHTML = '<div class="muted">气象数据暂不可用</div>'; return; }
  const c = w.current;
  const trend = buildWeatherTrend(w);
  // 预警优先：在「实时天气」模块顶部以淡红色字体标注（北海暴雨/强对流预警生效时即显示，不覆盖实况值）
  const warnBanner = (c.warningOverride)
    ? `<div style="margin:0 0 10px;padding:8px 12px;border-radius:8px;background:rgba(239,154,154,0.12);border:1px solid rgba(239,154,154,0.40);border-left:4px solid #ef9a9a;color:#ef9a9a;font-size:13px;font-weight:600;line-height:1.5;">
        ⚠️ 预警优先 · 实况以气象台预警为准${c.warningOverride ? `<div style="font-weight:400;font-size:12px;color:#ffab91;margin-top:3px;">${c.warningOverride.title}${c.warningOverride.time ? ' · ' + c.warningOverride.time : ''}</div>` : ''}
      </div>`
    : '';
  $('realtimeBody').innerHTML = `
    ${warnBanner}
    ${rcBadgeHtml(state.data.realtimeCheck)}
    <div class="rt-head">
      <div class="rt-icon">${ICON[c.icon]||'❓'}</div>
      <div class="rt-main">
        <div class="rt-temp">${c.temp.toFixed(1)}<span class="rt-deg">°</span></div>
        <div class="rt-cond">${c.text}</div>
      </div>
      ${c.source !== 'warning-override' && c.realtimeSource ? `<div class="rt-src">📡 ${c.realtimeSource}</div>` : ''}
    </div>
    <div class="rt-band">
      <div class="rt-grp rt-grp-weather">
        <div class="rt-grp-h">实时天气</div>
        <div class="rt-metrics">
          <div class="rt-metric"><span class="l">体感</span><b>${c.feels.toFixed(1)}℃</b></div>
          <div class="rt-metric"><span class="l">风</span><b>${c.wind.toFixed(1)}<i>m/s</i></b></div>
          <div class="rt-metric"><span class="l">阵风</span><b>${c.gust.toFixed(1)}</b></div>
          <div class="rt-metric"><span class="l">湿度</span><b>${c.rh}%</b></div>
          <div class="rt-metric"><span class="l">降水</span><b>${c.precip.toFixed(1)}<i>mm</i></b></div>
          <div class="rt-metric"><span class="l">气压</span><b>${c.pressure.toFixed(0)}<i>hPa</i></b></div>
          <div class="rt-metric"><span class="l">云量</span><b>${c.cloud}%</b></div>
          <div class="rt-metric"><span class="l">紫外线</span><b>${uvBadge(c.uv)}</b></div>
          <div class="rt-metric"><span class="l">能见度</span><b>${c.vis != null ? c.vis.toFixed(1)+'<i>km</i>' : '—'}</b></div>
        </div>
      </div>
      ${regionBlock(s)}
    </div>
    <div class="rt-trend">${trend}</div>`;
}

// 多源实况校核面板：展示 Open-Meteo / 中国天气网(CMA·和风) / wttr.in / 彩云天气 多源读数与综合判定（inline 样式自包含）
function catLabelZh(cat) {
  return ({ rain: '降雨', storm: '雷暴', snow: '降雪', fog: '雾', clear: '晴', cloud: '多云', other: '其他' })[cat] || '其他';
}
// 实况多源校验徽标（用于实时天气模块顶部，体现「校验结果→其它实况展示」联动）
function rcBadgeHtml(rc) {
  if (!rc) return '';
  const agr = rc.agreement;
  const label = { high: '✓ 实况多源校验一致', medium: '⚠ 源间有分歧', low: '✗ 源间显著分歧', unknown: '？ 源不可达' }[agr] || '';
  const reach = (rc.sources || []).filter(s => s.ok).length;
  const total = (rc.sources || []).length;
  const color = { high: '#3fb950', medium: '#d29922', low: '#e5484d', unknown: '#8b949e' }[agr] || '#8b949e';
  return `<div class="rc-badge" style="border-color:${color};color:${color}">${label} · ${reach}/${total} 源</div>`;
}
function renderRealtimeCheck() {
  const el = $('realtimeCheckBody');
  if (!el) return;
  const rc = state.data && state.data.realtimeCheck;
  if (!rc) { el.innerHTML = '<div class="muted">校核数据暂不可用</div>'; return; }
  const agrTxt = { high: '高度一致', medium: '部分分歧', low: '显著分歧', unknown: '源不可达' }[rc.agreement] || rc.agreement;
  const confPct = Math.round((rc.confidence || 0) * 100);
  const srcRows = (rc.sources || []).map(s => `
    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-top:1px solid var(--line)">
      <span style="flex:0 0 96px;color:${s.ok ? 'var(--info)' : 'var(--muted)'}">${s.label}</span>
      <span style="flex:1">${s.ok
        ? `${s.temp.toFixed(1)}℃ · ${s.text}${s.precip > 0.1 ? ' · 💧' + s.precip.toFixed(1) + 'mm' : ''}${s.uv != null ? ' · ☀UV' + s.uv.toFixed(0) : ''}`
        : (s.skipped ? '<span style="color:var(--muted)">未配置·可选</span>' : '<span style="color:#e5484d">✗ 不可达</span>')}</span>
      <span style="flex:0 0 48px;text-align:right;color:var(--muted);font-size:11px">${s.ok ? catLabelZh(s.category) : ''}</span>
    </div>`).join('');
  const fieldRows = (rc.fields || []).map(f => `
    <tr>
      <td style="padding:3px 6px;color:var(--muted);white-space:nowrap">${f.label}<span style="font-size:10px;color:var(--muted)"> ${f.unit}</span></td>
      ${f.vals.map(v => `<td style="padding:3px 6px;text-align:right;color:${v.v == null ? 'var(--muted)' : (f.consistent ? 'var(--text)' : '#d29922')}">${v.v == null ? '—' : v.v}</td>`).join('')}
    </tr>`).join('');
  const tableHtml = (rc.fields && rc.fields.length) ? `<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:11px">
    <thead><tr><th style="text-align:left;color:var(--muted);font-weight:400;padding:3px 6px">交叉校验</th>${rc.fields[0].vals.map(v => `<th style="text-align:right;color:var(--muted);font-weight:400;padding:3px 6px">${v.label}</th>`).join('')}</tr></thead>
    <tbody>${fieldRows}</tbody></table>` : '';
  const cons = rc.consensus
    ? `综合判定：<b style="color:var(--accent)">${catLabelZh(rc.consensus.category)}</b> ｜ 气温 ${rc.consensus.tempMin}~${rc.consensus.tempMax}℃（均 ${rc.consensus.tempMean}） ｜ 湿度 ${rc.consensus.rhMean != null ? rc.consensus.rhMean + '%' : '—'}${rc.consensus.uvMean != null ? ' ｜ ☀UV ' + rc.consensus.uvMean + (rc.consensus.uvMax && rc.consensus.uvMax !== rc.consensus.uvMean ? '(' + rc.consensus.uvMin + '~' + rc.consensus.uvMax + ')' : '') : ''}${rc.air && rc.air.aqi != null ? ' ｜ AQI ' + rc.air.aqi : ''}`
    : '';
  const disc = (rc.discrepancies && rc.discrepancies.length)
    ? `<div style="margin-top:6px;color:#d29922;font-size:12px">⚠ ${rc.discrepancies.map(d => d.message).join('；')}</div>` : '';
  const reg = state.data && state.data.regionalWeather;
  const regHtml = (reg && reg.ok) ? `<div style="margin-top:6px;font-size:12px;color:var(--muted)">北海区域（${reg.count}点）：气温 ${reg.tempMin}~${reg.tempMax}℃ ｜ 主导 <b style="color:var(--accent)">${catLabelZh(reg.dominantCat)}</b> ｜ 最大风 ${reg.windMax}m/s${reg.precipAny ? ' ｜ ⚠有降水' : ''}<div style="margin-top:3px;line-height:1.6">${reg.points.map(p => p.name + ' ' + p.temp.toFixed(1) + '℃·' + p.text).join('　｜　')}</div></div>` : '';
  const badgeColor = { high: '#3fb950', medium: '#d29922', low: '#e5484d', unknown: '#8b949e' }[rc.agreement] || '#8b949e';
  const reach = (rc.sources || []).filter(s => s.ok).length;
  const total = (rc.sources || []).length;
  el.innerHTML = `<div style="font-size:13px">${srcRows}</div>
    ${tableHtml}
    <div class="rc-cons"><span class="rc-cons-tag">综合判定</span>${cons}</div>
    ${disc}
    ${regHtml}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
      <span style="font-size:11px;color:var(--muted)">校核于 ${new Date(rc.checkedAt).toLocaleTimeString('zh-CN')} ｜ ${reach}/${total} 源可达 ｜ 主值 ${rc.recommended ? rc.recommended.source : '—'}</span>
      <span style="font-size:12px;color:#06121f;background:${badgeColor};padding:2px 8px;border-radius:10px">${agrTxt} · 置信 ${confPct}%</span>
    </div>`;
}

// 实时天气变化趋势：基于未来逐时数据给出降水/气温/风力预报（需求5）
function buildWeatherTrend(w) {
  const h = w.hourly24; if (!h || !h.length) return '';
  const now = h[0], h1 = h[1] || now, h3 = h[Math.min(3, h.length - 1)];
  const items = [];
  const rp1 = h1.precipProb, rp3 = h3.precipProb, rn1 = h1.precip, rn3 = h3.precip;
  if (rn1 > 0.1 || rn3 > 0.1) items.push({ t: 'rain', s: '⚠ 未来3小时内有降雨' });
  else if (rp1 >= 60) items.push({ t: 'rain', s: `1小时内大概率降雨（概率 ${rp1}%）` });
  else if (rp1 >= 30) items.push({ t: 'cloud', s: `1小时内可能有小雨（概率 ${rp1}%）` });
  else if (rp3 >= 30) items.push({ t: 'cloud', s: `3小时内转小雨可能（概率 ${rp3}%）` });
  else items.push({ t: 'ok', s: '1–3小时内无降水' });
  const dt = h3.temp - now.temp;
  if (dt > 0.5) items.push({ t: 'temp', s: `未来3小时升温约 ${dt.toFixed(1)}℃` });
  else if (dt < -0.5) items.push({ t: 'temp', s: `未来3小时降温约 ${Math.abs(dt).toFixed(1)}℃` });
  else items.push({ t: 'temp', s: '未来3小时气温平稳' });
  if (h3.wind >= 10 && h3.wind - now.wind >= 2) items.push({ t: 'wind', s: '风力将增强，注意防风' });
  else if (h3.wind < 4 && now.wind >= 6) items.push({ t: 'wind', s: '风力将转小' });
  const col = { rain: '#58a6ff', cloud: '#8b949e', ok: '#3fb950', temp: '#fb8500', wind: '#80ed99' };
  return items.map(i => `<span class="rt-chip" style="color:${col[i.t]}">● ${i.s}</span>`).join('');
}

function renderAir() {
  const a = selStation().air;
  if (!a || !a.ok) { $('airBody').innerHTML = '<div class="muted">空气质量数据暂不可用</div>'; return; }
  const pct = Math.min(100, a.aqi / 3.5);
  $('airBody').innerHTML = `
    <div><div class="aqi-num" style="color:${aqiColor(a.aqi)}">${a.aqi}</div>
      <div class="muted">US AQI · 首要 ${a.primary}</div></div>
    <div><div class="aqi-bar"><div class="aqi-dot" style="left:${pct}%"></div></div>
      <div class="pollutants" style="margin-top:8px">
        <div>PM2.5 <b>${a.pm25}</b></div><div>PM10 <b>${a.pm10}</b></div><div>O₃ <b>${a.o3}</b></div>
        <div>NO₂ <b>${a.no2}</b></div><div>SO₂ <b>${a.so2}</b></div><div>CO <b>${a.co.toFixed(0)}</b></div>
      </div></div>`;
}
function aqiColor(v){ return v>=300?'#bc1a1a':v>=200?'#e5484d':v>=150?'#fb8500':v>=100?'#d29922':'#3fb950'; }
function uvBadge(uv){ if(uv==null) return '—'; const lv = uv<=2?'低':uv<=5?'中等':uv<=7?'高':uv<=10?'很高':'极高'; return uv.toFixed(0)+' · '+lv; }

function renderMarine() {
  const m = selStation().marine;
  if (!m || !m.ok) { $('marineBody').innerHTML = '<div class="muted">海洋数据暂不可用</div>'; return; }
  const wh = m.waveHeight || 0, ww = m.windWaveHeight || 0, per = m.wavePeriod || 0, st = m.seaTemp || 0;
  const dir = m.waveDir != null ? m.waveDir : null;
  const dirArrow = dir != null ? `<span class="wave-dir" style="transform:rotate(${dir}deg)" title="波向 ${dir.toFixed(0)}°">↑</span>` : '';
  const whPct = Math.min(100, wh / 4 * 100);     // 以 4m 为满刻度
  const wwPct = Math.min(100, ww / 4 * 100);
  $('marineBody').innerHTML = `
    <div class="marine-row">
      <span class="marine-ico">🌊</span>
      <div class="marine-main">
        <div class="marine-h">浪高 <b style="color:var(--accent);font-size:18px">${wh.toFixed(2)} m</b> ${dirArrow}<span class="muted" style="font-size:11px">波向 ${dir != null ? dir.toFixed(0) + '°' : '—'}</span></div>
        <div class="wave-bar"><div class="wave-fill" style="width:${whPct}%"></div></div>
      </div>
    </div>
    <div class="marine-sub">
      <div>风浪高 <b>${ww.toFixed(2)} m</b><div class="wave-bar sm"><div class="wave-fill" style="width:${wwPct}%"></div></div></div>
      <div>周期 <b>${per.toFixed(1)} s</b> ｜ 海温 <b style="color:#4cc9f0">${st.toFixed(1)} ℃</b></div>
    </div>
    <div class="muted" style="font-size:11px">风力等级参考（蒲福）：浪高 0.5m≈3级，1.0m≈4级，2.0m≈5级</div>`;
}

function renderAstro() {
  const s = selStation();
  const w = s.weather;
  if (!w || !w.ok) { $('astroBody').innerHTML = '<div class="muted">天文数据暂不可用</div>'; return; }
  const d0 = w.daily[0];
  const sun = sunAltAz(s.lat, s.lon, new Date());
  const dayNight = sun.alt >= 0 ? '☀ 白昼（地平线上）' : '🌙 夜间（地平线下）';
  $('astroBody').innerHTML = `
    <div>🌅 日出 <b>${fmt(d0.sunrise)}</b> · 🌇 日落 <b>${fmt(d0.sunset)}</b></div>
    <div>🌒 月出 <b>${fmt(d0.moonrise)}</b> · 🌕 月落 <b>${fmt(d0.moonset)}</b></div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:6px">
      <div class="astro-sun">${sunDiagramSVG(s.lat, s.lon)}</div>
      <div class="astro-moon">
        ${moonPhaseSVG(d0.moonPhase)}
        <div class="muted" style="font-size:11px;text-align:center;margin-top:2px">${moonPhase(d0.moonPhase)}<br>相值 ${d0.moonPhase?.toFixed(2)}</div>
      </div>
    </div>
    <div class="muted" style="font-size:11px;margin-top:4px">☀ 当前太阳：高度 <b style="color:#f0a500">${sun.alt.toFixed(1)}°</b> ｜ 方位 <b>${sun.az.toFixed(0)}°</b> ｜ ${dayNight}</div>`;
}
function moonPhase(p){ const D=['新月','蛾眉月','上弦月','盈凸月','满月','亏凸月','下弦月','残月']; if(p==null)return'—'; if(p<0.06||p>0.94)return'新月'; if(p<0.19)return'蛾眉月'; if(p<0.31)return'上弦月'; if(p<0.44)return'盈凸月'; if(p<0.56)return'满月'; if(p<0.69)return'亏凸月'; if(p<0.81)return'下弦月'; return'残月'; }

// ===== 太阳高度/方位算法（标准近似，用于太阳位置图）=====
function sunAltAz(latDeg, lonDeg, when) {
  const rad = Math.PI / 180;
  const jd = when.getTime() / 86400000 + 2440587.5;       // 儒略日
  const n = jd - 2451545.0;                                // 自 J2000 天数
  const L = (280.460 + 0.9856474 * n) % 360;               // 平黄经
  const g = (357.528 + 0.9856003 * n) % 360;               // 平近点角
  const lambda = L + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad); // 黄经
  const eps = 23.439 - 0.0000004 * n;                      // 黄赤交角
  const ra = Math.atan2(Math.cos(eps * rad) * Math.sin(lambda * rad), Math.cos(lambda * rad)) / rad;
  const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;
  const gmst = (280.46061837 + 360.98564736629 * n) % 360; // 格林尼治恒星时
  const lst = (gmst + lonDeg) % 360;                       // 本地恒星时
  let ha = lst - ra;
  const sinAlt = Math.sin(latDeg * rad) * Math.sin(dec * rad)
    + Math.cos(latDeg * rad) * Math.cos(dec * rad) * Math.cos(ha * rad);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / rad;
  let cosAz = (Math.sin(dec * rad) - Math.sin(alt * rad) * Math.sin(latDeg * rad))
    / (Math.cos(alt * rad) * Math.cos(latDeg * rad));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / rad;
  if (Math.sin(ha * rad) > 0) az = 360 - az;
  return { alt, az };
}

// 太阳周日弧线图：展示当前太阳在天空中的位置与白昼轨迹（基于北海经纬度与当下时刻）
function sunDiagramSVG(lat, lon) {
  const W = 210, H = 122, cx = 105, horizonY = 102, domeH = 84, leftX = 18, rightX = 192;
  const now = new Date();
  const sun = sunAltAz(lat, lon, now);
  const day = sun.alt >= 0;
  const pts = [];
  for (let h = 0; h < 24; h++) {
    const t = new Date(now); t.setHours(h, 0, 0, 0);
    const s = sunAltAz(lat, lon, t);
    if (s.alt >= -0.3) {
      const x = leftX + (s.az - 90) / 180 * (rightX - leftX);
      const y = horizonY - (Math.max(0, s.alt) / 90) * domeH;
      pts.push([Math.max(leftX, Math.min(rightX, x)), Math.max(16, y)]);
    }
  }
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const sx = Math.max(leftX, Math.min(rightX, leftX + (sun.az - 90) / 180 * (rightX - leftX)));
  const sy = day ? Math.max(16, horizonY - (sun.alt / 90) * domeH) : horizonY + 10;
  const dot = day
    ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6" fill="#ffd166" stroke="#f0a500" stroke-width="1.5"/>
       <text x="${sx.toFixed(1)}" y="${(sy - 9).toFixed(1)}" font-size="9" fill="#ffd166" text-anchor="middle">☀</text>`
    : `<text x="${cx}" y="44" font-size="22" text-anchor="middle">🌙</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:210px;display:block;background:var(--bg3);border-radius:8px">
    <rect x="0" y="${horizonY}" width="${W}" height="${H - horizonY}" fill="var(--bg3)"/>
    ${path ? `<path d="${path}" fill="none" stroke="${day ? '#f0a500' : '#3a4658'}" stroke-width="1.6" stroke-dasharray="${day ? '' : '4 3'}"/>` : ''}
    <line x1="${leftX}" y1="${horizonY}" x2="${rightX}" y2="${horizonY}" stroke="var(--line)" stroke-width="1"/>
    <text x="${leftX}" y="${H - 4}" font-size="9" fill="var(--muted)">东</text>
    <text x="${cx - 7}" y="${H - 4}" font-size="9" fill="var(--muted)">南</text>
    <text x="${rightX - 14}" y="${H - 4}" font-size="9" fill="var(--muted)">西</text>
    ${dot}
  </svg>`;
}

// 月相外观图：根据 moonPhase 值(0–1)绘制当前月相形状
function moonPhaseSVG(p) {
  if (p == null) return '';
  const R = 26, cx = 30, cy = 30;
  const k = (1 - Math.cos(2 * Math.PI * p)) / 2;          // 亮面比例 0–1
  const waxing = p < 0.5;
  const rx = R * Math.abs(1 - 2 * k);                      // 明暗界线水平半径
  const limb = `M ${cx} ${cy - R} A ${R} ${R} 0 0 ${waxing ? 1 : 0} ${cx} ${cy + R}`;
  const termSweep = waxing ? (k < 0.5 ? 1 : 0) : (k < 0.5 ? 0 : 1);
  const term = `A ${rx.toFixed(2)} ${R} 0 0 ${termSweep} ${cx} ${cy - R}`;
  const craters = k > 0.05
    ? `<circle cx="${cx + 7}" cy="${cy - 8}" r="2.2" fill="rgba(0,0,0,.16)"/>
       <circle cx="${cx - 4}" cy="${cy + 6}" r="3" fill="rgba(0,0,0,.13)"/>
       <circle cx="${cx + 2}" cy="${cy + 13}" r="1.7" fill="rgba(0,0,0,.13)"/>` : '';
  return `<svg viewBox="0 0 60 60" width="58" height="58" style="display:block;margin:0 auto">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="#1b2230" stroke="#2a3340" stroke-width="1"/>
    <path d="${limb} ${term} Z" fill="#e8edf3"/>
    ${craters}
  </svg>`;
}

// 潮汐曲线：基于高低潮极值连线，标出当前潮位
function tideSVG(t) {
  const W = 240, H = 70, padX = 14, base = 56, top = 10;
  const ex = (t.extremes || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  if (ex.length < 2) return '';
  const hs = ex.map(e => e.h);
  const minH = Math.min(...hs), maxH = Math.max(...hs);
  const span = (maxH - minH) || 1;
  const yOf = h => base - (h - minH) / span * (base - top);
  const xOf = (i) => padX + i * (W - 2 * padX) / (ex.length - 1);
  const dpath = ex.map((e, i) => (i ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(e.h).toFixed(1)).join(' ');
  const dots = ex.map((e, i) => {
    const isHigh = e.type === 'high';
    return `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(e.h).toFixed(1)}" r="3" fill="${isHigh ? '#58a6ff' : '#3fb950'}"/>`;
  }).join('');
  const curY = yOf(Math.max(minH, Math.min(maxH, t.current)));
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;margin-top:4px">
    <line x1="${padX}" y1="${base}" x2="${W - padX}" y2="${base}" stroke="#33414f" stroke-width="1"/>
    <path d="${dpath}" fill="none" stroke="#58a6ff" stroke-width="1.6"/>
    ${dots}
    <line x1="${padX}" y1="${curY.toFixed(1)}" x2="${W - padX}" y2="${curY.toFixed(1)}" stroke="#fb8500" stroke-width="1" stroke-dasharray="3 3"/>
    <circle cx="${W - padX}" cy="${curY.toFixed(1)}" r="3.5" fill="#fb8500"/>
    <text x="${W - padX}" y="${(curY - 6).toFixed(1)}" font-size="9" fill="#fb8500" text-anchor="end">现 ${t.current}m</text>
  </svg>`;
}

// 区域轮廓缩略图：将 [lat,lon] 多边形归一化到 viewBox，填充展示（用于"区域形状"）
function regionShapeSVG(poly) {
  if (!poly || poly.length < 3) return '';
  const lats = poly.map(p => p[0]), lons = poly.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const W = 132, H = 96, pad = 10;
  const s = Math.min((W - 2 * pad) / ((maxLon - minLon) || 1), (H - 2 * pad) / ((maxLat - minLat) || 1));
  const cx = (minLon + maxLon) / 2, cy = (minLat + maxLat) / 2;
  const pts = poly.map(([la, lo]) => {
    const x = (W / 2 + (lo - cx) * s).toFixed(1);
    const y = (H / 2 - (la - cy) * s).toFixed(1);
    return x + ',' + y;
  }).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:132px;display:block;background:var(--bg3);border-radius:8px" title="区域轮廓（示意）">
    <polygon points="${pts}" fill="rgba(88,166,255,.20)" stroke="#58a6ff" stroke-width="1.3"/>
  </svg>`;
}

// 区域概况：区域形状（左） + 覆盖面积/人口（右），地理区域选择后于实时天气中与实时数据并列展示
function regionBlock(s) {
  const area = s.area, pop = s.pop, poly = s.poly;
  if (area == null && pop == null && !poly) return '';
  const areaTxt = area != null ? (area < 100 ? area.toFixed(1) : Math.round(area).toLocaleString('zh-CN')) + ' km²' : '—';
  const popTxt = pop != null ? (pop / 10000).toFixed(1) + ' 万' : '—';
  return `<div class="rt-grp rt-grp-region">
    <div class="rt-grp-h">区域概况</div>
    <div class="rt-region-inner">
      <div class="rt-region-shape">${regionShapeSVG(poly)}</div>
      <div class="rt-region-meta">
        <div>覆盖面积 <b>${areaTxt}</b></div>
        <div>覆盖人口 <b>${popTxt}</b></div>
      </div>
    </div>
  </div>`;
}

// 流星雨辐射点赤纬（用于按北海纬度计算峰值高度，判断可见性）
const RADIANT_DEC = {
  '象限仪座流星雨': 49, '英仙座流星雨': 58, '双子座流星雨': 32,
  '天龙座流星雨': 53, '猎户座流星雨': 15, '宝瓶座流星雨': -1,
};
function meteorPeakAlt(name, lat) {
  const dec = RADIANT_DEC[name];
  if (dec == null) return null;
  return Math.max(0, Math.min(90, 90 - lat + dec));   // 上中天高度近似
}

function renderGlow() {
  const s = selStation();
  const g = s.glow;
  if (!g) { $('glowBody').innerHTML = '<div class="muted">霞光概率暂不可用</div>'; return; }
  const col = g.grade==='高'?'#ffd166':g.grade==='中'?'#fb8500':'#8b949e';
  $('glowBody').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:24px;font-weight:700;color:${col}">${g.score}<span style="font-size:13px">/100</span></div>
      <div>等级 <b style="color:${col}">${g.grade}</b></div></div>
    <div class="glow-meter"><div class="glow-fill" style="width:${g.score}%"></div></div>
    <div class="muted" style="font-size:11px">最佳观赏：日落 ${fmt(g.bestTime)} 前后</div>
    <div style="font-size:11px;color:var(--info)">${g.factors.join('；')}</div>
    <div class="glow-loc">📍 基于 ${s.name} 实时观测</div>`;
}

function renderMorningGlow() {
  const s = selStation();
  const g = s.morningGlow;
  if (!g) { $('morningGlowBody').innerHTML = '<div class="muted">霞光概率暂不可用</div>'; return; }
  const col = g.grade==='高'?'#ffd166':g.grade==='中'?'#fb8500':'#8b949e';
  $('morningGlowBody').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:24px;font-weight:700;color:${col}">${g.score}<span style="font-size:13px">/100</span></div>
      <div>等级 <b style="color:${col}">${g.grade}</b></div></div>
    <div class="glow-meter"><div class="glow-fill" style="width:${g.score}%"></div></div>
    <div class="muted" style="font-size:11px">最佳观赏：日出 ${fmt(g.bestTime)} 前后</div>
    <div style="font-size:11px;color:var(--info)">${g.factors.join('；')}</div>
    <div class="glow-loc">📍 基于 ${s.name} 实时观测</div>`;
}

function renderTides() {
  $('tideBody').innerHTML = state.data.tides.map(t => `
    <div class="tide-st">
      <div class="nm">${t.name} <span class="muted" style="font-size:11px">（${t.source}）</span></div>
      <div>当前潮位 <b>${''}</b><b class="${t.current >= t.warnLevel ? 'tide-warn' : ''}">${t.current} m</b> · 警戒 ${t.warnLevel} m</div>
      <div class="tide-ext">${t.extremes.map(e=>`<span>${e.type==='high'?'▲高':'▼低'} ${fmt(e.time)} ${e.h}m</span>`).join('')}</div>
      ${tideSVG(t)}
    </div>`).join('');
}

function renderForecast(days, targetId) {
  const w = selStation().weather;
  const el = $(targetId);
  if (!w || !w.ok) { el.innerHTML = '<div class="muted">预报暂不可用</div>'; return; }
  const wk = ['日','一','二','三','四','五','六'];
  const list = w.daily.slice(0, days);
  el.innerHTML = list.map(d => {
    const dt = new Date(d.date); const ic = ICON[wmoIcon(d.code)] || '❓';
    return `<div class="fc-day"><div class="d">${dt.getMonth()+1}/${dt.getDate()} 周${wk[dt.getDay()]}</div>
      <div class="ic">${ic}</div><div class="t">${d.tmax.toFixed(0)}°/${d.tmin.toFixed(0)}°</div>
      <div class="p">💧${d.precipProb.toFixed(0)}%</div></div>`;
  }).join('');
}
function renderForecast7() { renderForecast(7, 'forecastBody'); }
function renderForecast15() { renderForecast(15, 'forecast15Body'); }
function wmoIcon(code){ const M={0:'sunny',1:'sunny',2:'partly',3:'cloudy',45:'fog',48:'fog',51:'drizzle',53:'drizzle',55:'drizzle',56:'drizzle',57:'drizzle',61:'rain',63:'rain',65:'rain',66:'rain',67:'rain',71:'snow',73:'snow',75:'snow',77:'snow',80:'rain',81:'rain',82:'rain',85:'snow',86:'snow',95:'storm',96:'storm',99:'storm'}; return M[code]||'unknown'; }

function renderAlerts() {
  const list = state.data.globalAlerts;
  const cnt = $('alertCount');
  cnt.textContent = list.length;
  cnt.classList.toggle('zero', list.length === 0);
  if (!list.length) { $('alertBody').innerHTML = '<div class="muted">当前无活跃告警 ✅</div>'; return; }
  $('alertBody').innerHTML = list.map((a, i) => {
    const rel = a.beihaiRelation === 'direct' ? '<span class="rel-badge direct">涉及北海</span>'
      : a.beihaiRelation === 'possible' ? '<span class="rel-badge possible">可能涉及北海</span>' : '';
    const reg = a.region && a.region !== '其他' ? `<span class="al-region ${a.region}">${a.region}</span>` : '';
    return `<div class="al-item" data-i="${i}" style="border-left-color:${LCOL[a.level]}">
      <div class="h"><span>${a.type} · ${a.station}</span><span style="color:${LCOL[a.level]}">${a.levelName}</span></div>
      <div class="d">${a.detail} ${reg} ${rel}</div>${a.advice ? `<div class="ad">▶ ${a.advice}</div>` : ''}</div>`;
  }).join('');
  $('alertBody').querySelectorAll('.al-item').forEach(el => {
    el.onclick = () => openAlertModal(list[+el.dataset.i]);
  });
}

function renderClimate() {
  const d = state.data;
  const temps = d.stations.map(s => s.weather && s.weather.ok ? s.weather.current.temp : null).filter(v => v != null);
  const tmin = temps.length ? Math.min(...temps) : null, tmax = temps.length ? Math.max(...temps) : null;
  const aqis = d.stations.map(s => s.air && s.air.ok ? s.air.aqi : null).filter(v => v != null);
  const aqi = aqis.length ? Math.round(aqis.reduce((a, b) => a + b, 0) / aqis.length) : null;
  const waves = d.stations.map(s => s.marine && s.marine.ok ? s.marine.waveHeight : null).filter(v => v != null);
  const wv = waves.length ? Math.max(...waves) : null;
  // 气候距平联动：将当前实况气温与气候月均态（Open-Meteo 1991–2020）对比，体现「校验结果→气候数据」联动
  const pc = d.primaryClimate;
  let anomalyHtml = '';
  if (pc && pc.monthlyTemp && temps.length) {
    const m = new Date().getMonth();
    const normal = pc.monthlyTemp[m];
    const cur = (tmin + tmax) / 2;
    if (normal != null && !isNaN(cur)) {
      const diff = +(cur - normal).toFixed(1);
      const cls = diff > 1 ? 'warm' : (diff < -1 ? 'cool' : 'ok');
      const tag = diff > 1 ? '偏暖' : (diff < -1 ? '偏冷' : '接近常年');
      anomalyHtml = `<div class="cl-anom cl-anom-${cls}">📊 气候距平：本月气候均温 <b>${normal}℃</b> ｜ 当前实况 <b>${cur.toFixed(1)}℃</b> ｜ 距平 <b>${diff >= 0 ? '+' : ''}${diff}℃</b>（${tag} · 基于多源实况校验）</div>`;
    }
  }
  const ai = d.alertIntel || { count: 0, items: [] };
  const ty = (d.typhoon && d.typhoon.ok) ? d.typhoon.count : 0;
  const wn = (d.warnings && d.warnings.ok) ? d.warnings.count : 0;
  const bhInv = ai.items.filter(i => i.beihaiRelation && i.beihaiRelation !== 'none').length;
  const astro = d.astronomy || {};
  const narrative = `北海市位于广西南端、北部湾东北岸，属<b>亚热带海洋性季风气候</b>：年平均气温约 22.6℃，最热 7 月、最冷 1 月；年降水量 1600–1800 mm，<b>5–9 月为雨季与汛期和台风季</b>，常受热带气旋（台风）影响；三面环海、海陆风明显，湿度大、雾日较多（冬春清晨常见）。`;
  const stats = [
    ['实时气温', temps.length ? `${tmin.toFixed(1)}–${tmax.toFixed(1)} ℃` : '—'],
    ['平均 AQI', aqi != null ? aqi : '—'],
    ['最大浪高', wv != null ? wv.toFixed(2) + ' m' : '—'],
    ['活跃告警', `${ai.count} 条（涉北海 ${bhInv}）`],
    ['台风', `${ty} 个`],
    ['气象预警', `${wn} 条`],
    ['下次满月', astro.moon ? (astro.moon.nextFull || '—') : '—'],
    ['下次新月', astro.moon ? (astro.moon.nextNew || '—') : '—'],
  ];
  const dyn = buildClimateDynamic(d);
  $('climateBody').innerHTML = `
    <div class="cl-narr">${narrative}</div>
    <div class="cl-stats">${stats.map(([k, v]) => `<div class="cl-stat"><span class="cl-k">${k}</span><b class="cl-v">${v}</b></div>`).join('')}</div>
    ${anomalyHtml}
    ${dyn}
    <div class="cl-note muted">注：气候特征为长期统计概况；下方数据为本次加载的实时/近期值，仅供参考。涉及北海的告警已在上方情报条与告警卡中标注。</div>`;
}

// 动态气候态势分析：基于当前极端气候告警，给出针对性结论与处置建议（需求5）
function buildClimateDynamic(d) {
  const all = d.globalAlerts || [];
  const bh = all.filter(a => a.beihaiRelation === 'direct' || a.beihaiRelation === 'possible');
  if (!bh.length) {
    return `<div class="cl-dyn">
      <div class="cl-dyn-h">实时气候态势与建议</div>
      <div class="cl-ok">✅ 当前无涉及或可能涉及北海的极端气候告警，整体气象态势平稳。建议保持常规监测，关注本系统实时更新与顶部情报条。</div>
    </div>`;
  }
  const byCat = {};
  bh.forEach(a => { (byCat[a.type] = byCat[a.type] || []).push(a); });
  const catSummary = Object.entries(byCat).map(([t, arr]) => {
    const lv = Math.max(...arr.map(a => a.level));
    return `<li><b style="color:${LCOL[lv]}">${t}</b> ×${arr.length}（最高等级 ${LNAME[lv]}）</li>`;
  }).join('');
  window.__climateAlerts = bh;
  const items = bh.map((a, i) => `
    <div class="cl-al">
      <div class="cl-al-h">
        <span class="${a.beihaiRelation === 'direct' ? 'rel-badge direct' : 'rel-badge possible'}">${a.beihaiRelation === 'direct' ? '涉及北海' : '可能涉及北海'}</span>
        <b>${a.type} · ${a.station || a.region}</b>
        <span style="color:${LCOL[a.level]}">${a.levelName}</span>
      </div>
      <div class="cl-al-line">
        ${a.url ? `<a class="cl-al-src" href="${a.url}" target="_blank" rel="noopener">🔗 官方发布来源 ↗</a>` : ''}
        <span class="cl-al-d">${a.detail || ''}</span>
        ${a.advice ? `<span class="cl-ad-link" onclick="openAdviceDetail(window.__climateAlerts[${i}])">建议处置：${a.advice} ▸ 查看详细</span>` : ''}
      </div>
    </div>`).join('');
  const directN = bh.filter(a => a.beihaiRelation === 'direct').length;
  const possibleN = bh.filter(a => a.beihaiRelation === 'possible').length;
  return `<div class="cl-dyn">
    <div class="cl-dyn-h">实时气候态势与建议（针对当前极端气候告警）</div>
    <div class="cl-dyn-sum">检测到 <b style="color:#ff7b7b">${bh.length}</b> 条涉及/可能涉及北海的告警（涉及 ${directN} · 可能涉及 ${possibleN}）：</div>
    <ul class="cl-cat">${catSummary}</ul>
    <div class="cl-al-list">${items}</div>
    <div class="cl-dyn-tip">处置优先级：<b>涉及北海（direct）</b> ＞ <b>可能涉及北海（possible）</b>；建议按区域落实防台 / 防汛 / 防地灾 / 防雷措施，并以官方发布为准。</div>
  </div>`;
}

const SITES = [
  { cat: '权威气象机构（官方发布）', items: [
    { n: '中央气象台（国家气象中心）', u: 'https://www.nmc.cn/', note: '台风路径 / 预警信号 / 卫星雷达产品（本系统直连数据源）' },
    { n: '中国气象局', u: 'http://www.cma.gov.cn/', note: '国家级气象主管机构' },
    { n: '广西气象局', u: 'http://gx.cma.gov.cn/', note: '广西本地预报与预警' },
    { n: '国家突发事件预警信息发布网', u: 'http://www.12379.cn/', note: '权威预警发布平台' },
  ] },
  { cat: '实时数据 / API（系统主源）', items: [
    { n: 'Open-Meteo', u: 'https://open-meteo.com/', note: '气象/空气/海洋/气候数据主源（免费免密钥）' },
    { n: '和风天气 QWeather', u: 'https://www.qweather.com/', note: '中国气象局授权商业气象数据（本系统 CMA 实况校核源，需 KEY）' },
    { n: 'USGS 地震', u: 'https://earthquake.usgs.gov/', note: '全球地震实时 Feed（本系统震情源）' },
    { n: '国家海洋信息中心', u: 'http://www.nmdis.org.cn/', note: '潮汐 / 海浪（需凭证）' },
    { n: 'NASA FIRMS', u: 'https://firms.modaps.eosdis.nasa.gov/', note: '活跃火点（需 KEY）' },
  ] },
  { cat: '可视化 / 卫星实况（叠加源）', items: [
    { n: 'Windy', u: 'https://www.windy.com/', note: '风场 / 降水 / 雷达可视化' },
    { n: 'RainViewer', u: 'https://www.rainviewer.com/', note: '全球雷达 / 卫星云图（本系统叠加源）' },
    { n: 'NASA GIBS', u: 'https://earthdata.nasa.gov/gibs', note: '卫星真彩 / 海温瓦片（本系统叠加源）' },
    { n: '中国天气网', u: 'http://www.weather.com.cn/', note: '公众天气预报' },
  ] },
];

function renderRiverReservoir() {
  var rr = state.data && state.data.riverReservoir;
  var rb = $('riverBody'), sb = $('reservoirBody');
  if (!rr || !rr.ok) {
    if (rb) rb.innerHTML = '<div class="muted">江河数据暂不可用</div>';
    if (sb) sb.innerHTML = '<div class="muted">水库数据暂不可用</div>';
    return;
  }
  var statusTxt = rr.realtime ? '实时' : ('档案（' + (rr.realtimeStatus === 'unreachable' ? '实时源不可达' : rr.realtimeStatus) + '）');
  var tbl = 'width:100%;border-collapse:collapse;border:1px solid #2a3b4d';
  var th = '<th style="padding:3px 6px;text-align:left">';
  var riverRows = (rr.rivers || []).map(function(r){
    return '<tr><td style="padding:3px 6px"><b>'+(r.name||'')+'</b></td><td style="padding:3px 6px">'+(r.type||'')+'</td><td style="padding:3px 6px">'+(r.outfall||'—')+'</td><td class="muted" style="font-size:11px;padding:3px 6px">'+(r.note||'')+'</td></tr>';
  }).join('');
  var resRows = (rr.reservoirs || []).map(function(r){
    var cap = r.totalCapM3 != null ? (r.totalCapM3/1e8).toFixed(2)+'亿m³' : '待核实';
    return '<tr><td style="padding:3px 6px"><b>'+(r.name||'')+'</b></td><td style="padding:3px 6px">'+(r.scale||'')+'</td><td style="padding:3px 6px">'+(r.county||'—')+'</td><td style="padding:3px 6px">'+cap+'</td><td style="padding:3px 6px">'+(r.drinking?'🚰饮用水源':'—')+'</td><td class="muted" style="font-size:11px;padding:3px 6px">'+(r.note||'')+'</td></tr>';
  }).join('');
  if (rb) rb.innerHTML = '<div class="muted" style="font-size:11px;margin-bottom:6px">数据性质：'+statusTxt+' ｜ 来源：'+rr.source+'</div><table style="'+tbl+'"><thead><tr style="background:#16202c">'+th+'江河</th>'+th+'类型</th>'+th+'入海口/归属</th>'+th+'说明</th></tr></thead><tbody>'+riverRows+'</tbody></table>';
  if (sb) sb.innerHTML = '<div class="muted" style="font-size:11px;margin-bottom:6px">数据性质：'+statusTxt+' ｜ 来源：'+rr.source+'</div><table style="'+tbl+'"><thead><tr style="background:#16202c">'+th+'水库</th>'+th+'规模</th>'+th+'位置</th>'+th+'总库容</th>'+th+'功能</th>'+th+'说明</th></tr></thead><tbody>'+resRows+'</tbody></table>';
}
function renderLinks() {
  $('linksBody').innerHTML = SITES.map(g => `
    <div class="ln-group">
      <div class="ln-gt">${g.cat}</div>
      <div class="ln-items">
        ${g.items.map(s => `<a class="ln-item" href="${s.u}" target="_blank" rel="noopener">
          <span class="ln-n">${s.n} ↗</span><span class="ln-note">${s.note}</span></a>`).join('')}
      </div>
    </div>`).join('');
}

function renderEvents() {
  const e = state.data.astronomy;
  const lat = (selStation().lat != null) ? selStation().lat : 21.48;
  const meteors = e.meteors
    .map(m => {
      const alt = meteorPeakAlt(m.name, lat);
      const vis = (alt == null) ? '' : (alt >= 15
        ? `<span class="ev-vis ok">北海可见·峰值高度≈${alt.toFixed(0)}°</span>`
        : `<span class="ev-vis no">北海偏低·峰值高度≈${alt.toFixed(0)}°</span>`);
      return `<div class="ev-row"><span class="n">${m.name}</span><span class="c">${m.peak[0]}/${m.peak[1]} · ${m.inDays}天后</span></div>
        <div class="ev-note">${m.note} ｜ ${vis}</div>`;
    })
    .filter(Boolean)
    .join('');
  const supers = e.supermoons.map(s => `<div class="ev-row"><span class="n">${s.name}</span><span class="c">${s.date}</span></div>`).join('');
  $('eventBody').innerHTML = `
    <div class="ev-head">📍 以下天象均按北海（21.48°N, 109.11°E）可观测性筛选</div>
    <div class="ev-row"><span class="n">🌑 下次新月</span><span class="c">${e.moon.nextNew}</span></div>
    <div class="ev-row"><span class="n">🌕 下次满月</span><span class="c">${e.moon.nextFull}</span></div>
    <div style="border-top:1px solid var(--line);margin:4px 0"></div>
    <div class="muted" style="font-size:11px">流星雨</div>${meteors}
    <div style="border-top:1px solid var(--line);margin:4px 0"></div>
    <div class="muted" style="font-size:11px">超级月亮</div>${supers}
    <div style="border-top:1px solid var(--line);margin:4px 0"></div>
    <div class="muted" style="font-size:11px">${e.galacticCore}</div>
    <div class="muted" style="font-size:11px">${e.tips}</div>`;
}

const charts = {};
function chartDatasets() {
  const w = selStation().weather;
  if (!w || !w.ok) return null;
  const h = w.hourly24; const labels = h.map(x => x.time.slice(11,16));
  const selected = [...state.dims];
  const datasets = selected
    .filter(k => DIMS[k])
    .map(k => {
      const d = DIMS[k];
      return {
        label: d.label,
        data: h.map(x => x[d.key] == null ? null : x[d.key]),
        borderColor: d.color, backgroundColor: d.color + '22',
        yAxisID: d.axis, tension: .3, pointRadius: 0, borderWidth: 1.6, fill: false,
      };
    })
    .filter(ds => ds.data.some(v => v != null));
  return { labels, datasets };
}
function renderChartOn(canvasId) {
  const cd = chartDatasets(); if (!cd) return;
  if (charts[canvasId]) charts[canvasId].destroy();
  const ctx = $(canvasId).getContext('2d');
  const cc = chartColors();
  charts[canvasId] = new Chart(ctx, {
    type: 'line', data: cd,
    options: {
      responsive: true, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: cc.legend, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => {
          const d = DIMS[[...state.dims][c.datasetIndex]];
          return `${d.label}: ${c.parsed.y == null ? '—' : c.parsed.y.toFixed(d.dec)}${d.unit}`;
        } } },
      },
      scales: {
        x: { ticks: { color: cc.tick, maxTicksLimit: 8 }, grid: { color: cc.grid } },
        y: { ticks: { color: cc.yTitle }, grid: { color: cc.grid }, title: { display: true, text: '气温/体感 ℃', color: cc.yTitle, font: { size: 10 } } },
        y1: { position: 'right', ticks: { color: cc.y1Title }, grid: { drawOnChartArea: false }, title: { display: true, text: '强度/百分比/指数', color: cc.y1Title, font: { size: 10 } } },
      },
    },
  });
}
function renderChart() { renderChartOn('hourlyChart'); }

// ===== 顶部告警情报：手动翻页 + 播放/暂停 + 点击详情 =====
const REGION_TAG = { '北海': '🟢北海', '广西': '🔵广西', '其他': '⚪其他' };
let tk = { items: [], idx: 0, timer: null, playing: false, autostarted: false };
function relBadge(it) {
  if (it.beihaiRelation === 'direct') return '<span class="rel-badge direct">涉及北海</span>';
  if (it.beihaiRelation === 'possible') return '<span class="rel-badge possible">可能涉及北海</span>';
  return '';
}
function tkCardHTML(it) {
  const dist = (it.minDistBH != null) ? `距北海 ${AlphaMap.fmtDist(it.minDistBH)}` : '';
  return `<span class="tk-region ${it.region}">${REGION_TAG[it.region] || it.region}</span>
    <span class="tk-lv" style="background:${it.color};color:#06121f">${it.levelName}</span>
    ${relBadge(it)}
    <span class="tk-cat">${it.category}</span>
    <span class="tk-title">${it.title}</span>
    <span class="tk-dist muted">${dist}</span>
    <span class="tk-src muted">${it.source}</span>`;
}
function renderTicker() {
  const items = (state.data.alertIntel && state.data.alertIntel.items) || [];
  tk.items = items; if (tk.idx >= items.length) tk.idx = 0;
  const box = $('tickerCard'), cnt = $('tkCount');
  if (!items.length) { if (box) box.innerHTML = '<span class="muted">暂无极端气候告警情报</span>'; if (cnt) cnt.textContent = ''; return; }
  box.innerHTML = tkCardHTML(items[tk.idx]);
  box.classList.remove('tk-anim'); void box.offsetWidth; box.classList.add('tk-anim');
  cnt.textContent = `第 ${tk.idx + 1}/${items.length} 条`;
  box.onclick = () => openIntelModal(items[tk.idx]);
}
function tkGo(dir) { const n = tk.items.length; if (!n) return; tk.idx = (tk.idx + dir + n) % n; renderTicker(); }
function tkStartAuto() {
  if (tk.timer) clearInterval(tk.timer);
  tk.playing = true;
  const b = $('tkPlay'); if (b) b.textContent = '⏸';
  const st = $('tkStatus'); if (st) { st.textContent = '自动播报中'; st.classList.add('on'); }
  tk.timer = setInterval(() => tkGo(1), 6000);
}
function tkTogglePlay() {
  if (tk.playing) {
    tk.playing = false;
    if (tk.timer) { clearInterval(tk.timer); tk.timer = null; }
    const b = $('tkPlay'); if (b) b.textContent = '▶';
    const st = $('tkStatus'); if (st) { st.textContent = '已暂停'; st.classList.remove('on'); }
  } else {
    tkStartAuto();
  }
}

function openIntelModal(it) {
  const body = $('modalBody');
  const coordTxt = (it.lat != null && it.lon != null) ? `${it.lat.toFixed(2)}°N, ${it.lon.toFixed(2)}°E` : '—';
  const distTxt = (it.minDistBH != null) ? `${AlphaMap.fmtDist(it.minDistBH)}` : '—';
  body.innerHTML = `
    <div class="m-head">
      <span class="tk-region ${it.region}">${REGION_TAG[it.region] || it.region}</span>
      <span class="tk-lv" style="background:${it.color};color:#06121f">${it.levelName}</span>
      ${relBadge(it)}
      <span class="m-cat">${it.category}</span>
    </div>
    <div class="m-title">${it.title}</div>
    <div class="m-summary">${it.summary}</div>
    <div class="m-grid">
      <div><span class="muted">区域</span><b>${it.region}${it.relLabel ? ' · ' + it.relLabel : ''}</b></div>
      <div><span class="muted">距北海</span><b>${distTxt}</b></div>
      <div><span class="muted">来源</span><b>${it.source}</b></div>
      <div><span class="muted">发布时间</span><b>${it.time || '—'}</b></div>
      <div><span class="muted">坐标</span><b>${coordTxt}</b></div>
    </div>
    ${it.advice ? `<div class="m-advice"><b>处置建议：</b>${it.advice}</div>` : ''}
    ${it.url ? `<a class="m-link" href="${it.url}" target="_blank">查看官方发布详情 ↗</a>` : ''}
  `;
  $('intelModal').classList.remove('hidden');
}

// 告警 → 实时天气 / 地图 跨模块定位（模块联动 / 数据共享）：切换监测站 + 滚动并高亮实时卡 + 聚焦地图
function locateAlert(a) {
  if (!a) return;
  const stationOf = { '北海': 'beihai', '广西': 'beihai' };
  let sid = stationOf[a.region];
  if (!sid && a.station) { const s = state.data.stations.find(x => x.id === a.station || x.name === a.station); if (s) sid = s.id; }
  if (!sid) sid = state.sel || (state.data.stations[0] && state.data.stations[0].id);
  if (sid && state.sel !== sid) {
    state.sel = sid;
    renderRealtime(); renderAir(); renderMarine(); renderAstro(); renderGlow(); renderMorningGlow();
    renderForecast7(); renderForecast15(); renderChart();
  }
  const rt = document.getElementById('realtimeCard');
  if (rt) { rt.scrollIntoView({ behavior: 'smooth', block: 'center' }); rt.classList.add('flash'); setTimeout(() => rt.classList.remove('flash'), 1200); }
  const mp = document.getElementById('mapPanel'); if (mp) mp.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 活跃告警（globalAlerts）详情弹窗：与情报弹窗共用容器
function openAlertModal(a) {
  window.__curAlert = a;
  const body = $('modalBody');
  const regTag = REGION_TAG[a.region] || a.region;
  const rel = a.beihaiRelation === 'direct' ? '<span class="rel-badge direct">涉及北海</span>'
    : a.beihaiRelation === 'possible' ? '<span class="rel-badge possible">可能涉及北海</span>' : '';
  let distTxt = '—';
  if (a.dist != null) distTxt = AlphaMap.fmtDist(a.dist);
  else if (a.lat != null && a.lon != null) distTxt = AlphaMap.fmtDist(AlphaMap.distBH(a.lat, a.lon));
  const coordTxt = (a.lat != null && a.lon != null) ? `${a.lat.toFixed(2)}°N, ${a.lon.toFixed(2)}°E` : '—';
  body.innerHTML = `
    <div class="m-head">
      <span class="tk-region ${a.region}">${regTag}</span>
      <span class="tk-lv" style="background:${a.color};color:#06121f">${a.levelName}</span>
      ${rel}
    </div>
    <div class="m-title">${a.type}${a.station ? ' · ' + a.station : ''}</div>
    <div class="m-summary">${a.detail || ''}</div>
    <div class="m-grid">
      <div><span class="muted">区域</span><b>${a.region}${a.relLabel ? ' · ' + a.relLabel : ''}</b></div>
      <div><span class="muted">距北海</span><b>${distTxt}</b></div>
      <div><span class="muted">发布时间</span><b>${a.time || '—'}</b></div>
      <div><span class="muted">坐标</span><b>${coordTxt}</b></div>
    </div>
    ${a.advice ? `<div class="m-advice"><b>处置建议：</b>${a.advice}</div>` : ''}
    ${a.adviceDetail ? `<div style="margin-top:8px"><span class="m-link m-link-btn" onclick="openAdviceDetail(window.__curAlert)">查看详细处置建议 ▸</span></div>` : ''}
    ${a.url ? `<div style="margin-top:8px"><a class="m-link" href="${a.url}" target="_blank" rel="noopener">查看官方发布详情 ↗</a></div>` : ''}
    <div style="margin-top:10px"><button id="locAlertBtn" class="m-link" style="cursor:pointer;border:1px solid var(--accent);border-radius:8px;padding:6px 12px;background:rgba(88,166,255,.10)">📍 在实时天气 / 地图中定位</button></div>`;
  const lb = document.getElementById('locAlertBtn'); if (lb) lb.onclick = () => locateAlert(a);
  $('intelModal').classList.remove('hidden');
}
// 详细处置建议弹窗（点击"简要处置建议"链接展开更完整处置指引）
function openAdviceDetail(a) {
  if (!a) a = window.__curAlert;
  if (!a) return;
  const body = $('modalBody');
  const regTag = REGION_TAG[a.region] || a.region;
  const rel = a.beihaiRelation === 'direct' ? '<span class="rel-badge direct">涉及北海</span>'
    : a.beihaiRelation === 'possible' ? '<span class="rel-badge possible">可能涉及北海</span>' : '';
  const detailLines = (a.adviceDetail || '暂无更详细建议，请以官方发布为准。')
    .split(/[；;。.\n]/).map(s => s.trim()).filter(Boolean);
  body.innerHTML = `
    <div class="m-head">
      <span class="tk-region ${a.region}">${regTag}</span>
      <span class="tk-lv" style="background:${a.color};color:#06121f">${a.levelName}</span>
      ${rel}
      <span class="m-cat">${a.type}</span>
    </div>
    <div class="m-title">${a.type}${a.station ? ' · ' + a.station : ''} · 处置建议详情</div>
    <div class="m-summary">${a.detail || ''}</div>
    ${a.advice ? `<div class="m-advice"><b>简要处置建议：</b>${a.advice}</div>` : ''}
    <div class="m-advice-detail"><b>详细处置建议：</b>
      <div style="margin-top:6px;line-height:1.8">${detailLines.map(s => `<div class="m-dt-item">${s}</div>`).join('')}</div>
    </div>
    ${a.url ? `<div style="margin-top:10px"><a class="m-link" href="${a.url}" target="_blank" rel="noopener">查看官方发布详情 ↗</a></div>` : ''}`;
  $('intelModal').classList.remove('hidden');
}
// 顶部"极端气候告警情报"标签 → 全部情报弹窗（需求3）
function intelRowHTML(it) {
  return `<div class="m-list-row" data-id="${it.id}">
    <span class="tk-region ${it.region}">${REGION_TAG[it.region] || it.region}</span>
    ${relBadge(it)}
    <span class="tk-lv" style="background:${it.color};color:#06121f">${it.levelName}</span>
    <span class="m-lr-cat">${it.category}</span>
    <span class="m-lr-title">${it.title}</span>
    <span class="m-lr-dist muted">${it.minDistBH != null ? AlphaMap.fmtDist(it.minDistBH) : ''}</span>
  </div>`;
}
function openAllIntelModal() {
  const items = (state.data.alertIntel && state.data.alertIntel.items) || [];
  const body = $('modalBody');
  const rows = items.length ? items.map(intelRowHTML).join('')
    : '<div class="muted">暂无极端气候告警情报</div>';
  body.innerHTML = `<div class="m-head"><b>全部极端气候告警情报（${items.length} 条）</b></div>
    <div class="m-list">${rows}</div>`;
  body.querySelectorAll('.m-list-row').forEach(r => {
    const it = items.find(x => x.id === r.dataset.id);
    r.onclick = () => { if (it) openIntelModal(it); };
  });
  $('intelModal').classList.remove('hidden');
}

// 顶部右侧等级徽标 → 涉及/可能涉及北海的告警弹窗（需求6）
function renderGlobalLevelAlert() {
  const badge = $('globalLevel');
  if (!badge) return;
  const all = (state.data && state.data.globalAlerts) || [];
  const bh = all.filter(a => a.beihaiRelation === 'direct' || a.beihaiRelation === 'possible');
  const directN = bh.filter(a => a.beihaiRelation === 'direct').length;
  const possibleN = bh.filter(a => a.beihaiRelation === 'possible').length;
  if (bh.length) {
    badge.textContent = directN ? `涉北海 ${directN}` : `或涉北海 ${possibleN}`;
    badge.classList.add('alert-red');
    badge.style.background = '#e5484d';
    badge.style.color = '#fff';
    badge.style.cursor = 'pointer';
    badge.title = `${directN ? '涉及' : '可能涉及'}北海的告警 ${bh.length} 条，点击查看`;
    badge.onclick = openBeihaiModal;
  } else {
    badge.textContent = '无涉北海';
    badge.classList.remove('alert-red');
    badge.style.background = 'var(--bg3)';
    badge.style.color = 'var(--muted)';
    badge.style.cursor = 'default';
    badge.title = '当前无涉及北海的告警';
    badge.onclick = null;
  }
}
function openBeihaiModal() {
  const all = (state.data && state.data.globalAlerts) || [];
  const bh = all.filter(a => a.beihaiRelation === 'direct' || a.beihaiRelation === 'possible');
  const body = $('modalBody');
  const rows = bh.length ? bh.map((a, i) => `
    <div class="m-list-row" data-i="${i}">
      <span class="${a.beihaiRelation === 'direct' ? 'rel-badge direct' : 'rel-badge possible'}">${a.beihaiRelation === 'direct' ? '涉及北海' : '可能涉及北海'}</span>
      <span class="tk-lv" style="background:${a.color};color:#06121f">${a.levelName}</span>
      <span class="m-lr-cat">${a.type}</span>
      <span class="m-lr-title">${a.station || a.region}</span>
    </div>`).join('') : '<div class="muted">当前无涉及北海的告警</div>';
  body.innerHTML = `<div class="m-head"><b>涉及 / 可能涉及北海的告警（${bh.length} 条）</b></div>
    <div class="m-list">${rows}</div>`;
  body.querySelectorAll('.m-list-row').forEach(r => {
    const a = bh[+r.dataset.i];
    r.onclick = () => { if (a) openAlertModal(a); };
  });
  if (bh.length) body.innerHTML += '<div style="margin-top:10px"><button id="locBeihaiBtn" class="m-link" style="cursor:pointer;border:1px solid var(--accent);border-radius:8px;padding:6px 12px;background:rgba(88,166,255,.10)">📍 在实时天气 / 地图中定位（涉北海）</button></div>';
  const lbb = document.getElementById('locBeihaiBtn'); if (lbb) lbb.onclick = () => locateAlert(bh[0]);
  $('intelModal').classList.remove('hidden');
}

$('modalClose').onclick = () => $('intelModal').classList.add('hidden');
$('intelModal').onclick = (e) => { if (e.target === $('intelModal')) $('intelModal').classList.add('hidden'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('intelModal').classList.add('hidden'); closeFocus(); } });
$('tkPrev').onclick = () => tkGo(-1);
$('tkNext').onclick = () => tkGo(1);
$('tkPlay').onclick = tkTogglePlay;
const tTag = $('tickerTag'); if (tTag) tTag.onclick = openAllIntelModal;
const tAll = $('tickerAll'); if (tAll) tAll.onclick = openAllIntelModal;

// 图层开关
['Station', 'Quake', 'Fire', 'Tide', 'Boundary', 'Typhoon', 'Conv', 'Rain', 'Geo'].forEach(n => {
  const box = $('lyr' + n);
  if (box) box.onchange = () => AlphaMap.toggle(n.toLowerCase(), box.checked);
});

$('refreshBtn').onclick = () => doRefresh();
setInterval(doRefresh, 10 * 60 * 1000);
setInterval(updateAutoRefresh, 1000);
// ===== 模块放大（点击模块标题 → 在页面中央放大展示该板块与数据）=====
let focusState = null;
function closeFocus() {
  if (focusState && focusState.type === 'map' && focusState.parent) {
    try { focusState.parent.insertBefore($('map'), focusState.next); }
    catch (e) { const mp = document.getElementById('mapPanel'); if (mp) mp.appendChild($('map')); }
    setTimeout(() => { try { AlphaMap.invalidate(); } catch (e) {} }, 80);
  }
  if (charts.focusChart) { try { charts.focusChart.destroy(); } catch (e) {} delete charts.focusChart; }
  $('focusModal').classList.add('hidden');
  $('focusBody').innerHTML = '';
  focusState = null;
}
function openFocus(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  closeFocus();
  const h = panel.querySelector('.panel-h');
  $('focusTitle').textContent = (h ? h.textContent : panelId).replace(/\s+/g, ' ').trim();
  const body = $('focusBody');
  if (panelId === 'chartCard') {
    body.innerHTML = '<canvas id="focusChart" height="360"></canvas>';
    $('focusModal').classList.remove('hidden');
    renderChartOn('focusChart');
    focusState = { type: 'chart' };
  } else if (panelId === 'mapPanel') {
    body.innerHTML = '<div id="focusMap" style="height:72vh;width:100%;border-radius:8px;overflow:hidden"></div>';
    const mapEl = $('map');
    focusState = { type: 'map', parent: mapEl.parentNode, next: mapEl.nextSibling };
    $('focusMap').appendChild(mapEl);
    $('focusModal').classList.remove('hidden');
    setTimeout(() => { try { AlphaMap.invalidate(); } catch (e) {} }, 80);
  } else {
    body.innerHTML = panel.innerHTML;
    $('focusModal').classList.remove('hidden');
    focusState = { type: 'html' };
  }
}
$('focusClose').onclick = closeFocus;
$('focusModal').onclick = (e) => { if (e.target === $('focusModal')) closeFocus(); };
document.querySelectorAll('.panel').forEach(p => {
  const h = p.querySelector('.panel-h');
  if (!h || !p.id) return;
  h.style.cursor = 'zoom-in';
  h.title = (h.title ? h.title + ' ｜ ' : '') + '点击放大该模块';
  h.addEventListener('click', (e) => {
    if (e.target.closest('input,button,label,select,a,.chart-dims,.layers,.dim-chip')) return;
    openFocus(p.id);
  });
});

// ===== 版本 / 多端自动更新 =====
function appVersion() {
  const v = document.querySelector && document.querySelector('.ver');
  const t = v && v.textContent;
  return t ? String(t).replace(/^v/i, '').trim() : '0.0.0';
}
function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
function detectPlatform() {
  try {
    if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
      const p = window.Capacitor.getPlatform();
      if (p === 'android' || p === 'ios' || p === 'web') return p;
    }
  } catch (e) {}
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Win/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'web';
}
function platformLabel(p) {
  return { windows: 'Windows', linux: 'Linux', macos: 'macOS', android: 'Android', ios: 'iOS', web: '网页', agent: '智能体(技能)' }[p] || p;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function openUpdateUrl(url) {
  if (!url || url === '#') return;
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
      window.Capacitor.Plugins.Browser.openUrl({ url });
      return;
    }
  } catch (e) {}
  try { window.open(url, '_blank', 'noopener'); } catch (e) {}
}
function showUpdateBanner(cur, latest) {
  const banner = document.getElementById('updateBanner');
  if (!banner) return;
  const platform = detectPlatform();
  const dl = (latest.downloads && (latest.downloads[platform] || latest.downloads.windows))
    || latest.releases || latest.github || '#';
  const all = latest.releases || latest.github || '#';
  banner.innerHTML = '';
  const icon = document.createElement('div'); icon.className = 'ub-icon'; icon.textContent = '🚀';
  const body = document.createElement('div'); body.className = 'ub-body';
  body.innerHTML = '<div class="ub-title">发现新版本 v' + latest.version + '（当前 v' + cur + '）'
    + (latest.released ? ' · ' + latest.released + ' 发布' : '') + '</div>'
    + '<div class="ub-notes">' + escapeHtml(latest.notes || '') + '</div>';
  const actions = document.createElement('div'); actions.className = 'ub-actions';
  const b1 = document.createElement('button'); b1.className = 'ub-btn ub-primary'; b1.textContent = '下载 ' + platformLabel(platform) + ' 版'; b1.onclick = () => openUpdateUrl(dl);
  const b2 = document.createElement('button'); b2.className = 'ub-btn'; b2.textContent = '全部平台'; b2.onclick = () => openUpdateUrl(all);
  const b3 = document.createElement('button'); b3.className = 'ub-btn ub-ghost'; b3.textContent = '稍后'; b3.onclick = () => { banner.hidden = true; };
  actions.append(b1, b2, b3);
  banner.append(icon, body, actions);
  banner.hidden = false;
}
function checkUpdate(manual) {
  if (typeof fetch !== 'function') return; // 门禁桩环境无 fetch → 直接跳过
  const native = isNative();
  if (!native) {
    // Web / PWA：仍走 Node 后端接口（有后端、同源无 CORS 问题）
    let cur = null;
    try {
      fetch('/api/version').then(r => r.json()).then(j => {
        if (j && j.version) {
          cur = j.version;
          populateFooterVersion(cur);
          if (j.github) { const g = document.getElementById('footGithub'); if (g) g.href = j.github; }
          if (j.gitee) { const ge = document.getElementById('footGitee'); if (ge) ge.href = j.gitee; }
        }
      }).catch(() => {});
    } catch (e) {}
    if (!cur) cur = appVersion();
    fetch('/api/latest').then(r => r.json()).then(j2 => {
      if (j2 && j2.ok && j2.version && cmpVer(j2.version, cur) > 0) { showUpdateBanner(cur, j2); return; }
      if (manual) showNoUpdate(cur);
    }).catch(() => { if (manual) showNoUpdate(cur); });
    return;
  }
  // 原生端（Android/iOS）：无 Node 后端，/api/version 与 /api/latest 走本地静态服务器会 404 →
  // 页脚版本不刷新、更新横幅不出来。当前版本从页头 .ver 解析（始终可用）；
  // 最新版直接拉 GitHub raw 的 version.json，CapacitorHttp 原生 HTTP 绕过 CORS。
  const cur = appVersion();
  populateFooterVersion(cur);
  const url = 'https://raw.githubusercontent.com/net2net2net/alphasun-beihai-climate/main/app/public/data/version.json';
  fetch(url).then(r => r.json()).then(j2 => {
    if (j2 && j2.version && cmpVer(j2.version, cur) > 0) { showUpdateBanner(cur, j2); return; }
    if (manual) showNoUpdate(cur);
  }).catch(() => { if (manual) showNoUpdate(cur); });
}
function populateFooterVersion(v) { const el = document.getElementById('footVer'); if (el && v) el.textContent = 'v' + v; }
function showNoUpdate(cur) {
  const b = document.getElementById('updateBanner');
  if (!b) return;
  b.innerHTML = '<div class="ub-body"><div class="ub-title">已是最新版本 v' + (cur || appVersion()) + ' ✅</div></div>'
    + '<div class="ub-actions"><button class="ub-btn ub-ghost" onclick="this.closest(\'.update-banner\').hidden=true">关闭</button></div>';
  b.hidden = false;
}

$('themeBtn').onclick = toggleTheme;
$('soundBtn').onclick = () => setSound(!soundOn);
setSound(false);
applyTheme(theme);
AlphaMap.init();
AlphaMap.buildOverlayUI($('overlayPanel'));
startWorldClock();
startTopClock();
startCalendar();
load().then(() => renderChartOn('hourlyChart'));
// 页脚版本/开源地址 + 多端自动更新
const _fc = $('footCheckUpdate'); if (_fc) _fc.onclick = () => checkUpdate(true);
populateFooterVersion(appVersion());
if (typeof fetch === 'function') {
  checkUpdate(false);
  if (typeof setInterval === 'function') setInterval(() => checkUpdate(false), 30 * 60 * 1000);
}
