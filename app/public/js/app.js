// AlphaSun · 前端仪表盘逻辑
const ICON = { sunny:'☀️', partly:'⛅', cloudy:'☁️', fog:'🌫️', drizzle:'🌦️', rain:'🌧️', snow:'❄️', storm:'⛈️', unknown:'❓' };
const state = { data: null, sel: null, chart: null, dims: new Set(['temp','precip','wind','rh','aqi']) };
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

async function load() {
  try {
    const r = await fetch('/api/overview');
    state.data = await r.json();
    if (!state.sel) state.sel = state.data.stations[0].id;
    render();
  } catch (e) {
    $('updated').textContent = '加载失败：' + e.message;
  }
}

function render() {
  const d = state.data;
  $('updated').textContent = '更新于 ' + new Date(d.updated).toLocaleString('zh-CN');
  // 全局等级
  const gl = $('globalLevel');
  gl.textContent = d.maxLevelName;
  gl.style.background = LCOL[d.maxLevel]; gl.style.color = '#06121f';
  // 横幅（活跃告警，点击查看详情）
  const banner = $('alertBanner');
  const top = d.globalAlerts.filter(a => a.level >= 2).slice(0, 6);
  if (top.length) {
    banner.classList.remove('hidden');
    banner.innerHTML = '<span class="a-label">⚠ 活跃告警：</span>' + top.map((a, i) =>
      `<span class="a-item" data-i="${i}">${a.type}·${a.station}（${a.levelName}）</span>`).join('');
    banner.querySelectorAll('.a-item').forEach(el => {
      el.onclick = () => openAlertModal(top[+el.dataset.i]);
    });
  } else banner.classList.add('hidden');

  renderStations(); renderRealtime(); renderAir(); renderMarine();
  renderAstro(); renderGlow(); renderTides(); renderForecast();
  renderAlerts(); renderEvents(); renderChartDims();
  renderClimate(); renderLinks();
  renderTicker();
  if (!tk.autostarted) { tk.autostarted = true; tkStartAuto(); }
  AlphaMap.setData(d); AlphaMap.legend($('mapLegend'));
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
  el.innerHTML = '<div class="st-tabs">' + state.data.stations.map(s => {
    const lv = s.alert.level;
    return `<div class="st-tab ${s.id===state.sel?'active':''}" data-id="${s.id}">
      <span class="dot" style="background:${LCOL[lv]}"></span>${s.name}</div>`;
  }).join('') + '</div>';
  el.querySelectorAll('.st-tab').forEach(t => t.onclick = () => { state.sel = t.dataset.id; renderRealtime(); renderAir(); renderMarine(); renderAstro(); renderGlow(); renderForecast(); renderChart(); });
}

function renderRealtime() {
  const s = selStation(); $('rtStation').textContent = '· ' + s.name;
  const w = s.weather;
  if (!w || !w.ok) { $('realtimeBody').innerHTML = '<div class="muted">气象数据暂不可用</div>'; return; }
  const c = w.current;
  $('realtimeBody').innerHTML = `
    <div class="rt-icon">${ICON[c.icon]||'❓'}</div>
    <div class="rt-temp">${c.temp.toFixed(1)}°</div>
    <div class="rt-grid">
      <div>体感 <b>${c.feels.toFixed(1)}℃</b></div><div>${c.text}</div>
      <div>风 <b>${c.wind.toFixed(1)}</b> m/s</div><div>阵风 <b>${c.gust.toFixed(1)}</b></div>
      <div>湿度 <b>${c.rh}%</b></div><div>降水 <b>${c.precip.toFixed(1)}</b> mm</div>
      <div>气压 <b>${c.pressure.toFixed(0)}</b> hPa</div><div>云量 <b>${c.cloud}%</b></div>
    </div>`;
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

function renderMarine() {
  const m = selStation().marine;
  if (!m || !m.ok) { $('marineBody').innerHTML = '<div class="muted">海洋数据暂不可用</div>'; return; }
  $('marineBody').innerHTML = `
    <div>浪高 <b style="color:var(--accent);font-size:18px">${m.waveHeight?.toFixed(2)} m</b></div>
    <div>风浪高 <b>${m.windWaveHeight?.toFixed(2)} m</b> · 周期 ${m.wavePeriod?.toFixed(1)} s</div>
    <div>海表温度 <b>${m.seaTemp?.toFixed(1)} ℃</b></div>
    <div class="muted" style="font-size:11px">风力等级参考（蒲福）：浪高 0.5m≈3级，1.0m≈4级，2.0m≈5级</div>`;
}

function renderAstro() {
  const w = selStation().weather;
  if (!w || !w.ok) { $('astroBody').innerHTML = '<div class="muted">天文数据暂不可用</div>'; return; }
  const d0 = w.daily[0];
  $('astroBody').innerHTML = `
    <div>🌅 日出 <b>${fmt(d0.sunrise)}</b> · 🌇 日落 <b>${fmt(d0.sunset)}</b></div>
    <div>🌒 月出 <b>${fmt(d0.moonrise)}</b> · 🌕 月落 <b>${fmt(d0.moonset)}</b></div>
    <div>月相 <b>${moonPhase(d0.moonPhase)}</b>（值 ${d0.moonPhase?.toFixed(2)}）</div>`;
}
function moonPhase(p){ const D=['新月','蛾眉月','上弦月','盈凸月','满月','亏凸月','下弦月','残月']; if(p==null)return'—'; if(p<0.06||p>0.94)return'新月'; if(p<0.19)return'蛾眉月'; if(p<0.31)return'上弦月'; if(p<0.44)return'盈凸月'; if(p<0.56)return'满月'; if(p<0.69)return'亏凸月'; if(p<0.81)return'下弦月'; return'残月'; }

function renderGlow() {
  const g = selStation().glow;
  if (!g) { $('glowBody').innerHTML = '<div class="muted">霞光概率暂不可用</div>'; return; }
  const col = g.grade==='高'?'#ffd166':g.grade==='中'?'#fb8500':'#8b949e';
  $('glowBody').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:24px;font-weight:700;color:${col}">${g.score}<span style="font-size:13px">/100</span></div>
      <div>等级 <b style="color:${col}">${g.grade}</b></div></div>
    <div class="glow-meter"><div class="glow-fill" style="width:${g.score}%"></div></div>
    <div class="muted" style="font-size:11px">最佳观赏：日落 ${fmt(g.bestTime)} 前后</div>
    <div style="font-size:11px;color:#9fd3ff">${g.factors.join('；')}</div>`;
}

function renderTides() {
  $('tideBody').innerHTML = state.data.tides.map(t => `
    <div class="tide-st">
      <div class="nm">${t.name} <span class="muted" style="font-size:11px">（${t.source}）</span></div>
      <div>当前潮位 <b>${t.current} m</b> · 警戒 ${t.warnLevel} m</div>
      <div class="tide-ext">${t.extremes.map(e=>`<span>${e.type==='high'?'▲高':'▼低'} ${fmt(e.time)} ${e.h}m</span>`).join('')}</div>
    </div>`).join('');
}

function renderForecast() {
  const w = selStation().weather;
  if (!w || !w.ok) { $('forecastBody').innerHTML = '<div class="muted">预报暂不可用</div>'; return; }
  const wk = ['日','一','二','三','四','五','六'];
  $('forecastBody').innerHTML = w.daily.map(d => {
    const dt = new Date(d.date); const ic = ICON[wmoIcon(d.code)] || '❓';
    return `<div class="fc-day"><div class="d">${dt.getMonth()+1}/${dt.getDate()} 周${wk[dt.getDay()]}</div>
      <div class="ic">${ic}</div><div class="t">${d.tmax.toFixed(0)}°/${d.tmin.toFixed(0)}°</div>
      <div class="p">💧${d.precipProb.toFixed(0)}%</div></div>`;
  }).join('');
}
function wmoIcon(code){ const M={0:'sunny',1:'sunny',2:'partly',3:'cloudy',45:'fog',48:'fog',51:'drizzle',53:'drizzle',55:'drizzle',56:'drizzle',57:'drizzle',61:'rain',63:'rain',65:'rain',66:'rain',67:'rain',71:'snow',73:'snow',75:'snow',77:'snow',80:'rain',81:'rain',82:'rain',85:'snow',86:'snow',95:'storm',96:'storm',99:'storm'}; return M[code]||'unknown'; }

function renderAlerts() {
  const list = state.data.globalAlerts;
  $('alertCount').textContent = list.length;
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
  $('climateBody').innerHTML = `
    <div class="cl-narr">${narrative}</div>
    <div class="cl-stats">${stats.map(([k, v]) => `<div class="cl-stat"><span class="cl-k">${k}</span><b class="cl-v">${v}</b></div>`).join('')}</div>
    <div class="cl-note muted">注：气候特征为长期统计概况；下方数据为本次加载的实时/近期值，仅供参考。涉及北海的告警已在上方情报条与告警卡中标注。</div>`;
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
  const meteors = e.meteors.map(m => `<div class="ev-row"><span class="n">${m.name}</span><span class="c">${m.peak[0]}/${m.peak[1]} · ${m.inDays}天后 · ${m.note}</span></div>`).join('');
  const supers = e.supermoons.map(s => `<div class="ev-row"><span class="n">${s.name}</span><span class="c">${s.date}</span></div>`).join('');
  $('eventBody').innerHTML = `
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

function renderChart() {
  const w = selStation().weather;
  if (!w || !w.ok) return;
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
  if (state.chart) state.chart.destroy();
  const ctx = $('hourlyChart').getContext('2d');
  state.chart = new Chart(ctx, {
    type: 'line', data: { labels, datasets },
    options: {
      responsive: true, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#e6edf3', boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => {
          const d = DIMS[selected[c.datasetIndex]];
          return `${d.label}: ${c.parsed.y == null ? '—' : c.parsed.y.toFixed(d.dec)}${d.unit}`;
        } } },
      },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 8 }, grid: { color: '#1c2330' } },
        y: { ticks: { color: '#fb8500' }, grid: { color: '#1c2330' }, title: { display: true, text: '气温/体感 ℃', color: '#fb8500', font: { size: 10 } } },
        y1: { position: 'right', ticks: { color: '#8b949e' }, grid: { drawOnChartArea: false }, title: { display: true, text: '强度/百分比/指数', color: '#8b949e', font: { size: 10 } } },
      },
    },
  });
}

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

// 活跃告警（globalAlerts）详情弹窗：与情报弹窗共用容器
function openAlertModal(a) {
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
  `;
  $('intelModal').classList.remove('hidden');
}
$('modalClose').onclick = () => $('intelModal').classList.add('hidden');
$('intelModal').onclick = (e) => { if (e.target === $('intelModal')) $('intelModal').classList.add('hidden'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('intelModal').classList.add('hidden'); });
$('tkPrev').onclick = () => tkGo(-1);
$('tkNext').onclick = () => tkGo(1);
$('tkPlay').onclick = tkTogglePlay;

// 图层开关
['Station', 'Quake', 'Fire', 'Tide', 'Boundary', 'Typhoon', 'Conv', 'Rain', 'Geo'].forEach(n => {
  const box = $('lyr' + n);
  if (box) box.onchange = () => AlphaMap.toggle(n.toLowerCase(), box.checked);
});

$('refreshBtn').onclick = () => load();
setInterval(() => { load(); setTimeout(renderChart, 300); }, 10 * 60 * 1000);

AlphaMap.init();
AlphaMap.buildOverlayUI($('overlayPanel'));
load().then(renderChart);
