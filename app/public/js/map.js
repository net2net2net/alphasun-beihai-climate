// AlphaSun · 地图展示（Leaflet）
// 底图：高德(Amap) 栅格瓦片（GCJ-02，国内直连稳定，免密钥）。
// 所有经纬度数据(Open-Meteo/USGS/nmc 等)均为 WGS-84，绘制前统一纠偏到 GCJ-02 与底图对齐。
// 叠加层：RainViewer(雷达/卫星, 全球免密钥) · NASA GIBS(真彩/海温) · 中央气象台(nmc)官方产品图(代理)。
window.AlphaMap = (function () {
  let map, layers = {}, overlays = {}, inited = false, lastData = null, currentSys = 'gcj';
  let geojsonPromise = null;
  const LCOL = ['#3fb950', '#d29922', '#fb8500', '#e5484d', '#bc1a1a'];
  const CENTER_WGS = [21.48, 109.11]; // 北海 [lat, lon] WGS-84

  const TY_COLORS = { TD: '#56a0ff', TS: '#2ecc71', STS: '#f1c40f', TY: '#e67e22', STY: '#e74c3c', SuperTY: '#c0392b', SUPER: '#c0392b' };
  const TY_NAMES = { TD: '热带低压', TS: '热带风暴', STS: '强热带风暴', TY: '台风', STY: '强台风', SuperTY: '超强台风', SUPER: '超强台风' };
  function tyColor(c) { return TY_COLORS[c] || '#888'; }
  function tyName(c) { return TY_NAMES[c] || (c || '未知'); }

  // ===== 距离工具 =====
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function distBH(lat, lon) { return (lat == null || lon == null) ? null : haversine(CENTER_WGS[0], CENTER_WGS[1], lat, lon); }
  function fmtDist(d) { return d == null ? '—' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km'; }

  // 瓦片源降级链
  const TILES = [
    { url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', sub: '1234', sys: 'gcj', attr: '© 高德地图 GS(2023) | 演示底图，生产须注册天地图/高德 Key(GCJ-02)' },
    { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', sub: 'abcd', sys: 'wgs', attr: '© OpenStreetMap © CARTO' },
    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', sub: 'abc', sys: 'wgs', attr: '© OpenStreetMap' },
  ];

  // ===== WGS-84 → GCJ-02 坐标纠偏 =====
  const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;
  function outOfChina(lat, lon) { return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55); }
  function tLat(x, y) { let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x)); r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3; r += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3; r += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3; return r; }
  function tLon(x, y) { let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x)); r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3; r += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3; r += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3; return r; }
  function wgs2gcj(lat, lon) {
    if (outOfChina(lat, lon)) return [lat, lon];
    let dLat = tLat(lon - 105.0, lat - 35.0), dLon = tLon(lon - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * PI, magic = Math.sin(radLat), magic2 = 1 - EE * magic * magic, sqrtMagic = Math.sqrt(magic2);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic2 * sqrtMagic) * PI);
    dLon = (dLon * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
    return [lat + dLat, lon + dLon];
  }
  function coord(lat, lon) { return currentSys === 'gcj' ? wgs2gcj(lat, lon) : [lat, lon]; }

  function showMapError(msg) {
    const el = document.getElementById('map'); if (!el) return;
    let d = document.getElementById('mapErr');
    if (!d) { d = document.createElement('div'); d.id = 'mapErr'; d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8b949e;font-size:12px;text-align:center;padding:16px;line-height:1.6'; el.appendChild(d); }
    d.textContent = msg || '底图瓦片加载失败：当前网络无法访问外部地图服务。';
  }

  function addTiles(idx) {
    if (!map || idx >= TILES.length) { showMapError(); return; }
    const t = TILES[idx];
    const layer = L.tileLayer(t.url, { subdomains: t.sub, maxZoom: 18, attribution: t.attr });
    let failed = false;
    layer.on('tileerror', function () { if (failed) return; failed = true; try { map.removeLayer(layer); } catch (e) {} currentSys = TILES[idx + 1] ? TILES[idx + 1].sys : 'wgs'; addTiles(idx + 1); if (lastData) setData(lastData); });
    layer.addTo(map);
  }
  function invalidate() { try { if (map) map.invalidateSize(); } catch (e) {} }

  function init() {
    if (inited) return;
    if (typeof L === 'undefined') { showMapError('地图组件(Leaflet)未加载，请检查网络后刷新。'); return; }
    map = L.map('map', { center: coord(21.48, 109.11), zoom: 9, attributionControl: true, preferCanvas: true });
    addTiles(0);
    layers.station = L.layerGroup().addTo(map);
    layers.quake = L.layerGroup().addTo(map);
    layers.fire = L.layerGroup().addTo(map);
    layers.tide = L.layerGroup().addTo(map);
    layers.boundary = L.layerGroup().addTo(map);
    layers.typhoon = L.layerGroup().addTo(map);
    layers.conv = L.layerGroup().addTo(map);
    layers.rain = L.layerGroup().addTo(map);
    layers.geo = L.layerGroup().addTo(map);
    inited = true;
    setTimeout(invalidate, 300);
  }
  function clear(g) { if (g) g.clearLayers(); }

  function getBoundary() {
    if (geojsonPromise) return geojsonPromise;
    geojsonPromise = fetch('/data/beihai.geojson').then(r => r.ok ? r.json() : null).catch(() => null);
    return geojsonPromise;
  }
  // 真实 GeoJSON 边界（DataV 450500，[lon,lat] → 纠偏）
  function drawBoundaryGeoJSON(gj) {
    (gj.features || []).forEach(f => {
      const geom = f.geometry; if (!geom) return;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.coordinates || []);
      polys.forEach(poly => poly.forEach(ring => {
        const ll = ring.map(([lo, la]) => coord(la, lo));
        L.polygon(ll, { color: '#58a6ff', weight: 2, fillColor: '#58a6ff', fillOpacity: 0.06, dashArray: '4 3' }).addTo(layers.boundary);
      }));
    });
    // 城市标签（北海中心，永久）
    L.marker(coord(21.48, 109.11), { interactive: false, opacity: 0.95 })
      .setIcon(L.divIcon({ className: 'bd-label', html: '北海市', iconSize: [54, 18] })).addTo(layers.boundary);
  }
  function drawBoundaryFallback(bd) {
    if (!bd || !bd.rings) return;
    bd.rings.forEach(ring => { L.polygon(ring.map(([la, lo]) => coord(la, lo)), { color: '#58a6ff', weight: 2, fillColor: '#58a6ff', fillOpacity: 0.07, dashArray: '4 3' }).addTo(layers.boundary); });
  }

  function drawTyphoon(list) {
    (list || []).forEach(t => {
      const pts = (t.points || []).map(p => coord(p.lat, p.lon));
      if (pts.length > 1) L.polyline(pts, { color: tyColor(t.current && t.current.intensity), weight: 2, dashArray: '5 4', opacity: 0.85 }).addTo(layers.typhoon);
      const cur = t.current;
      if (cur && cur.lat) {
        const c = coord(cur.lat, cur.lon), col = tyColor(cur.intensity), d = distBH(cur.lat, cur.lon);
        if (cur.radius) L.circle(c, { radius: cur.radius * 1000, color: col, weight: 1, fillColor: col, fillOpacity: 0.08 }).addTo(layers.typhoon);
        L.circleMarker(c, { radius: 8, color: col, weight: 2, fillColor: col, fillOpacity: 0.7 }).addTo(layers.typhoon)
          .bindPopup(`<b>${t.cnName || ''}（${t.enName || ''}）${tyName(cur.intensity)}</b><br>` +
            `中心 ${cur.lat.toFixed(1)}°N ${cur.lon.toFixed(1)}°E<br>` +
            `风速 ${cur.wind != null ? cur.wind : '—'} m/s · 气压 ${cur.pressure != null ? cur.pressure : '—'} hPa<br>` +
            `风圈半径 ${cur.radius != null ? cur.radius : '—'} km · 移向 ${cur.moveDir || '—'} ${cur.moveSpeed != null ? cur.moveSpeed : '—'} km/h<br>` +
            `<b style="color:${col}">距北海约 ${fmtDist(d)}</b>`);
      }
    });
  }

  function drawWarn(arr) {
    (arr || []).forEach(w => {
      if (!w.lat || !w.lon) return;
      const lg = w.cat === 'convective' ? layers.conv : w.cat === 'rainstorm' ? layers.rain : w.cat === 'geological' ? layers.geo : null;
      if (!lg) return;
      const c = coord(w.lat, w.lon), d = distBH(w.lat, w.lon);
      L.circleMarker(c, { radius: 5 + (w.levelNum || 1) * 1.5, color: w.color, weight: 1.5, fillColor: w.color, fillOpacity: 0.55 }).addTo(lg)
        .bindPopup(`<b>${w.title}</b><br>${w.level} ${w.catLabel}预警<br>发布 ${w.time || ''}<br><b>距北海约 ${fmtDist(d)}</b><br>来源：地方气象台` +
          (w.url ? `<br><a href="${w.url}" target="_blank" style="color:#58a6ff">查看官方详情 ↗</a>` : ''));
    });
  }

  function setData(d) {
    init(); if (!map) return;
    lastData = d;
    clear(layers.station); clear(layers.quake); clear(layers.fire); clear(layers.tide);
    clear(layers.boundary); clear(layers.typhoon); clear(layers.conv); clear(layers.rain); clear(layers.geo);

    getBoundary().then(gj => { clear(layers.boundary); if (gj) drawBoundaryGeoJSON(gj); else drawBoundaryFallback(d.boundary); });

    (d.stations || []).forEach(s => {
      const lv = s.alert ? s.alert.level : 0, col = LCOL[lv] || LCOL[0], p = coord(s.lat, s.lon);
      const m = L.circleMarker(p, { radius: 9 + lv * 2, color: col, weight: 2, fillColor: col, fillOpacity: 0.55 }).addTo(layers.station);
      const w = s.weather && s.weather.ok ? s.weather.current : null;
      m.bindPopup(`<b>${s.name}</b> <span style="color:${col}">[${s.alert ? s.alert.levelName : '正常'}]</span><br>气温 ${w ? w.temp.toFixed(1) : '—'}℃ ${w ? w.text : ''}<br>风 ${w ? w.wind.toFixed(1) : '—'} m/s · 阵风 ${w ? w.gust.toFixed(1) : '—'}<br>气压 ${w ? w.pressure.toFixed(0) : '—'} hPa · 湿度 ${w ? w.rh : '—'}%`);
    });

    (d.tides || []).forEach(t => {
      const p = coord(t.lat, t.lon);
      L.circleMarker(p, { radius: 6, color: '#58a6ff', weight: 1, fillColor: '#58a6ff', fillOpacity: 0.4 }).addTo(layers.tide)
        .bindPopup(`<b>${t.name}</b> 验潮站<br>当前潮位 ${t.current} m<br>来源：${t.source}`);
    });

    if (d.earthquakes && d.earthquakes.ok) d.earthquakes.events.forEach(q => {
      const r = Math.max(3, q.mag * 2.5), p = coord(q.lat, q.lon), d2 = distBH(q.lat, q.lon);
      L.circleMarker(p, { radius: r, color: '#ff4d4f', weight: 1, fillColor: '#ff4d4f', fillOpacity: 0.3 }).addTo(layers.quake)
        .bindPopup(`<b>地震 M${q.mag}</b><br>${q.place}<br>深度 ${q.depth} km<br><b>距北海约 ${fmtDist(d2)}</b>`);
    });

    if (d.fires && d.fires.ok && d.fires.fires) d.fires.fires.forEach(f => {
      const p = coord(f.lat, f.lon), d2 = distBH(f.lat, f.lon);
      L.circleMarker(p, { radius: 4, color: '#ff8c00', weight: 0, fillColor: '#ff8c00', fillOpacity: 0.8 }).addTo(layers.fire)
        .bindPopup(`活跃火点 FRP ${f.frp}<br>置信度 ${f.conf}<br>距北海约 ${fmtDist(d2)}`);
    });

    if (d.typhoon && d.typhoon.ok) drawTyphoon(d.typhoon.typhoons);
    if (d.warnings && d.warnings.ok) { drawWarn(d.warnings.convective); drawWarn(d.warnings.rainstorm); drawWarn(d.warnings.geological); drawWarn(d.warnings.typhoon); }

    renderHazardInfo(d);
    setTimeout(invalidate, 200);
  }

  // 地图底部"灾害距离概览"
  function renderHazardInfo(d) {
    const el = document.getElementById('mapHazardInfo'); if (!el) return;
    const near = arr => (arr || []).map(x => distBH(x.lat, x.lon)).filter(v => v != null);
    const minOf = a => a.length ? Math.min(...a) : null;
    const tyD = (d.typhoon && d.typhoon.ok) ? minOf(d.typhoon.typhoons.map(t => t.current && t.current.lat ? distBH(t.current.lat, t.current.lon) : null).filter(v => v != null)) : null;
    const qD = (d.earthquakes && d.earthquakes.ok) ? minOf(near(d.earthquakes.events)) : null;
    const fD = (d.fires && d.fires.ok) ? minOf(near(d.fires.fires)) : null;
    const wD = minOf((d.warnings && d.warnings.ok) ? [...(d.warnings.convective || []), ...(d.warnings.rainstorm || []), ...(d.warnings.geological || []), ...(d.warnings.typhoon || [])].map(w => distBH(w.lat, w.lon)) : []);
    const tyN = (d.typhoon && d.typhoon.ok) ? d.typhoon.count : 0;
    const wN = (d.warnings && d.warnings.ok) ? d.warnings.count : 0;
    el.innerHTML = `<span>🌀 台风 <b>${tyN}</b> 个（最近 <b>${fmtDist(tyD)}</b>）</span>` +
      `<span>⚠ 预警 <b>${wN}</b> 条（最近 <b>${fmtDist(wD)}</b>）</span>` +
      `<span>🌐 地震最近 <b>${fmtDist(qD)}</b></span>` +
      `<span>🔥 火点最近 <b>${fmtDist(fD)}</b></span>` +
      `<span class="muted">· 距北海直线距离</span>`;
  }

  function toggle(name, on) { if (map && layers[name]) on ? layers[name].addTo(map) : map.removeLayer(layers[name]); }
  function legend(el) {
    el.innerHTML = [
      '<span><i style="background:#3fb950"></i>正常</span>', '<span><i style="background:#d29922"></i>注意</span>',
      '<span><i style="background:#fb8500"></i>预警</span>', '<span><i style="background:#e5484d"></i>警报</span>',
      '<span><i style="background:#bc1a1a"></i>紧急</span>', '<span><i style="background:#58a6ff"></i>潮汐站</span>',
      '<span><i style="background:#ff4d4f"></i>地震</span>', '<span><i style="background:#ff8c00"></i>火点</span>',
      '<span><i style="background:#9b59b6"></i>台风</span>', '<span><i style="background:#f1c40f"></i>龙卷·强对流</span>',
      '<span><i style="background:#3498db"></i>暴雨·汛情</span>', '<span><i style="background:#a0522d"></i>地质灾害</span>',
      '<span><i style="background:#58a6ff;border:1px dashed #58a6ff"></i>北海边界</span>',
    ].join('');
  }

  // ===================== 叠加层（卫星/雷达/降水/风力/温度/扰动/风场/海浪/副高）=====================
  const CHINA_BOUNDS = [[3, 73], [54, 135]]; // [southWest, northEast] WGS-84
  const OVERLAY_DEFS = [
    { id: 'nmc_sat', label: '卫星云图·风云（中央台）', cat: '实况', type: 'nmc', p: 'satellite', link: 'https://www.nmc.cn/publish/satellite/fy2.htm', opacity: 0.85 },
    { id: 'nmc_radar', label: '雷达拼图（中央台）', cat: '实况', type: 'nmc', p: 'radar', link: 'https://www.nmc.cn/publish/radar/chinaall.html', opacity: 0.85 },
    { id: 'rv_radar', label: '雷达·降水（RainViewer）', cat: '实况', type: 'rainviewer', kind: 'radar', sub: 'past', opacity: 0.75 },
    { id: 'rv_radar_fc', label: '雷达·降水预报（RainViewer）', cat: '预报', type: 'rainviewer', kind: 'radar', sub: 'nowcast', opacity: 0.75 },
    { id: 'rv_ir', label: '卫星云图·红外（RainViewer）', cat: '实况', type: 'rainviewer', kind: 'satellite', band: 'infrared', opacity: 0.8 },
    { id: 'rv_vis', label: '卫星云图·可见光（RainViewer）', cat: '实况', type: 'rainviewer', kind: 'satellite', band: 'visible', opacity: 0.8 },
    { id: 'rv_wv', label: '卫星云图·水汽（RainViewer）', cat: '实况', type: 'rainviewer', kind: 'satellite', band: 'water_vapor', opacity: 0.8 },
    { id: 'gibs_true', label: '卫星真彩（NASA GIBS）', cat: '实况', type: 'gibs', layer: 'MODIS_Terra_TrueColor', ext: 'jpg', opacity: 0.7 },
    { id: 'gibs_sst', label: '海表温度（NASA GIBS）', cat: '温度', type: 'gibs', layer: 'MODIS_Aqua_Sea_Surface_Temp', ext: 'png', opacity: 0.75 },
    { id: 'gibs_lst', label: '地表温度（NASA GIBS）', cat: '温度', type: 'gibs', layer: 'MODIS_Terra_Land_Surface_Temp', ext: 'png', opacity: 0.75 },
    { id: 'nmc_precip', label: '降水预报（中央台）', cat: '预报', type: 'nmc', p: 'precip', link: 'https://www.nmc.cn/publish/precipitation/', opacity: 0.85 },
    { id: 'nmc_wind', label: '风力·风场（中央台）', cat: '实况', type: 'nmc', p: 'wind', link: 'https://www.nmc.cn/publish/diagnose/wind/', opacity: 0.85 },
    { id: 'nmc_wave', label: '海浪（中央台）', cat: '实况', type: 'nmc', p: 'wave', link: 'https://www.nmc.cn/publish/marine/wave/', opacity: 0.85 },
    { id: 'nmc_subhigh', label: '副高·环流（中央台）', cat: '预报', type: 'nmc', p: 'subhigh', link: 'https://www.nmc.cn/publish/diagnose/', opacity: 0.85 },
    { id: 'nmc_disturb', label: '扰动分布（中央台）', cat: '实况', type: 'nmc', p: 'disturb', link: 'https://www.nmc.cn/publish/typhoon/', opacity: 0.85 },
  ];

  let rvPromise = null;
  function getRainViewer() {
    if (rvPromise) return rvPromise;
    rvPromise = fetch('https://api.rainviewer.com/public/weather-maps.json').then(r => r.json()).catch(() => null);
    return rvPromise;
  }
  function buildRainViewerLayer(def) {
    return getRainViewer().then(rv => {
      if (!rv) return null;
      if (def.kind === 'radar') {
        const arr = (def.sub === 'nowcast' ? (rv.radar.nowcast || []) : (rv.radar.past || []));
        if (!arr.length) return null;
        const f = arr[arr.length - 1];
        const tile = rv.host + f.path + (def.sub === 'nowcast' ? '/512/' : '/256/') + '{z}/{x}/{y}.png';
        return L.tileLayer(tile, { opacity: def.opacity, attribution: '© RainViewer' });
      } else {
        const arr = (rv.satellite && rv.satellite[def.band]) || [];
        if (!arr.length) return null;
        const f = arr[arr.length - 1];
        const tile = rv.host + f.path + '/256/{z}/{x}/{y}.png';
        return L.tileLayer(tile, { opacity: def.opacity, attribution: '© RainViewer' });
      }
    });
  }
  function buildGibsLayer(def) {
    const date = new Date().toISOString().slice(0, 10);
    const t = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${def.layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.${def.ext}`;
    const layer = L.tileLayer(t, { tms: true, opacity: def.opacity, attribution: '© NASA GIBS' });
    layer.on('tileerror', () => { try { map.removeLayer(layer); } catch (e) {} });
    return layer;
  }
  function buildNmcLayer(def) {
    // 先探测代理是否可取图，避免坏图
    return fetch(`/api/nmc-img?p=${def.p}&meta=1`).then(r => r.json()).then(meta => {
      if (!meta || !meta.ok) return null;
      const img = L.imageOverlay(`/api/nmc-img?p=${encodeURIComponent(def.p)}`, CHINA_BOUNDS, { opacity: def.opacity, attribution: '© 中央气象台 nmc.cn', crossOrigin: true });
      img._nmcLink = meta.link || def.link;
      return img;
    }).catch(() => null);
  }

  function overlayLayer(def) {
    if (def.type === 'rainviewer') return buildRainViewerLayer(def);
    if (def.type === 'gibs') return Promise.resolve(buildGibsLayer(def));
    if (def.type === 'nmc') return buildNmcLayer(def);
    return Promise.resolve(null);
  }
  function toggleOverlay(def, on) {
    if (!map) return;
    const key = 'ov_' + def.id;
    if (on) {
      if (overlays[key]) { try { map.addLayer(overlays[key]); } catch (e) {} return; }
      overlayLayer(def).then(ly => {
        if (!ly) { document.dispatchEvent(new CustomEvent('ov-fail', { detail: def })); return; }
        overlays[key] = ly; map.addLayer(ly);
      });
    } else {
      if (overlays[key]) { try { map.removeLayer(overlays[key]); } catch (e) {} }
    }
  }
  // 构建叠加层控制 UI（在 index.html 的 #overlayPanel 中）
  function buildOverlayUI(container) {
    if (!container) return;
    const cats = ['实况', '预报', '温度'];
    container.innerHTML = cats.map(cat => {
      const items = OVERLAY_DEFS.filter(d => d.cat === cat);
      if (!items.length) return '';
      return `<div class="ov-group"><div class="ov-gt">${cat}</div>` + items.map(d =>
        `<label class="ov-row"><input type="checkbox" id="ov_${d.id}"> ${d.label}` +
        (d.link ? ` <a href="${d.link}" target="_blank" class="ov-link" title="查看官方原图">↗</a>` : '') +
        `</label>`).join('') + `</div>`;
    }).join('');
    OVERLAY_DEFS.forEach(d => {
      const box = container.querySelector('#ov_' + d.id);
      if (box) box.onchange = () => toggleOverlay(d, box.checked);
    });
    // 取图失败提示（区分"有官方链接"与"数据源本身不可用"）
    document.addEventListener('ov-fail', e => {
      const d = e.detail; const box = container.querySelector('#ov_' + d.id);
      if (box) { box.checked = false; }
      const hint = document.getElementById('overlayHint');
      if (hint) {
        if (d.link) hint.textContent = `「${d.label}」官方产品图暂不可叠加（JS 渲染/防盗链），点 ↗ 查看中央台原图`;
        else hint.textContent = `「${d.label}」数据源暂不可用（需外网连接或当前无可用帧）`;
      }
    });
  }

  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', invalidate);
  return { init, setData, toggle, legend, OVERLAY_DEFS, buildOverlayUI, distBH, fmtDist };
})();
