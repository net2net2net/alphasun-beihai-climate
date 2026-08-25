// AlphaSun · 浏览器版数据源（替代 Node 后端 server.js）
// 把 lib/ 的聚合逻辑整体移植到浏览器，直连各权威数据源。
// 挂载到全局 window.AlphaData，供 app.js 调用：AlphaData.buildOverview() / AlphaData.now()
// 可选配置（在 index.html 的 <script> 中设置 window.ALPHASUN_CONFIG）：
//   FIRMS_MAP_KEY / NMDIS_APPID / NMDIS_APPSECRET：增强野火/潮汐真实数据（缺省降级）
//   proxy：CORS 代理前缀（如 'https://your-proxy.workers.dev/?url='），用于让 nmc 数据在手机端跨域可用
(function () {
  'use strict';

  const RAW = (typeof window !== 'undefined' && window.ALPHASUN_CONFIG) || {};
  const FIRMS_MAP_KEY = RAW.FIRMS_MAP_KEY || '';
  const NMDIS_APPID = RAW.NMDIS_APPID || '';
  const NMDIS_APPSECRET = RAW.NMDIS_APPSECRET || '';
  const PROXY = RAW.proxy || '';

  // 通过可选 CORS 代理转发（仅当配置了 proxy 时；用于 nmc 等跨域受限源）
  function proxied(u) { return PROXY ? PROXY + encodeURIComponent(u) : u; }

  // ===================== 配置中心 =====================
  const STATIONS = [
    { id: 'beihai',   name: '北海市区', lat: 21.48, lon: 109.11, kind: 'main',   desc: '主城区·海城区',
      area: 140.24, pop: 527789,
      poly: [[21.6016,109.2076],[21.5877,109.1943],[21.5778,109.1784],[21.5669,109.1678],[21.5645,109.1543],[21.5582,109.147],[21.5408,109.152],[21.5237,109.1503],[21.5121,109.1422],[21.4895,109.0744],[21.4707,109.0474],[21.4611,109.0412],[21.4534,109.0595],[21.4505,109.0679],[21.4467,109.0759],[21.4504,109.0831],[21.4476,109.0873],[21.4441,109.0988],[21.4473,109.1138],[21.4512,109.1257],[21.4547,109.1377],[21.45,109.158],[21.444,109.167],[21.4508,109.1664],[21.4565,109.1734],[21.4605,109.1736],[21.4648,109.1687],[21.4685,109.1704],[21.4698,109.1762],[21.4762,109.1842],[21.4794,109.1868],[21.4973,109.1985],[21.5071,109.2053],[21.5115,109.2082],[21.5362,109.2124],[21.5436,109.2104],[21.5495,109.2076],[21.5681,109.2036],[21.5733,109.2033],[21.5864,109.204],[21.5911,109.2037],[21.5987,109.2075],[21.6016,109.2076]] },
    { id: 'yinhai',   name: '银海区',   lat: 21.43, lon: 109.05, kind: 'coast',  desc: '银滩·旅游负荷',
      area: 484, pop: 313911,
      poly: [[21.649,109.3849],[21.6675,109.3752],[21.6809,109.3692],[21.6835,109.3504],[21.6719,109.3203],[21.6634,109.3111],[21.6441,109.2942],[21.6242,109.2864],[21.5937,109.2724],[21.6192,109.2284],[21.5911,109.2037],[21.5681,109.2036],[21.5362,109.2124],[21.4914,109.1948],[21.4685,109.1704],[21.4508,109.1664],[21.4544,109.1362],[21.4476,109.0873],[21.4534,109.0595],[21.4245,109.0466],[21.389,109.1389],[21.4272,109.266],[21.4459,109.3302],[21.4661,109.337],[21.4751,109.3314],[21.4848,109.3318],[21.4915,109.3519],[21.4967,109.375],[21.4985,109.3969],[21.5046,109.3997],[21.515,109.3994],[21.5221,109.3982],[21.5285,109.3982],[21.5348,109.3985],[21.5407,109.3944],[21.5563,109.3905],[21.5612,109.3972],[21.5662,109.3946],[21.572,109.3906],[21.5815,109.3837],[21.5937,109.3846],[21.6035,109.3924],[21.6106,109.3981],[21.6171,109.3896],[21.6289,109.3787],[21.649,109.3849]] },
    { id: 'tieshan',  name: '铁山港区', lat: 21.40, lon: 109.47, kind: 'port',   desc: '工业区·港口大用户',
      area: 394, pop: 143112,
      poly: [[21.5446,109.6075],[21.6407,109.5421],[21.6707,109.4649],[21.6715,109.4462],[21.6704,109.44],[21.6651,109.4312],[21.6632,109.4251],[21.6699,109.4191],[21.6667,109.407],[21.6589,109.4008],[21.6544,109.4065],[21.6432,109.4065],[21.6502,109.3994],[21.6575,109.4],[21.649,109.3879],[21.6362,109.3785],[21.6227,109.3805],[21.6145,109.3893],[21.6102,109.3957],[21.606,109.3978],[21.6028,109.3883],[21.5916,109.3838],[21.5826,109.3836],[21.5747,109.3887],[21.5704,109.3927],[21.5656,109.3953],[21.5622,109.3965],[21.5563,109.3966],[21.5524,109.3909],[21.5408,109.395],[21.5375,109.3987],[21.5319,109.3993],[21.5249,109.3986],[21.5212,109.3984],[21.5155,109.3997],[21.5077,109.4008],[21.502,109.4002],[21.4966,109.3974],[21.4968,109.3752],[21.495,109.3557],[21.4881,109.3436],[21.4838,109.3313],[21.4766,109.3312],[21.4682,109.3349],[21.4587,109.3374],[21.4437,109.3307],[21.4534,109.4852],[21.5235,109.6045],[21.5446,109.6075]] },
    { id: 'hepu',     name: '合浦县',   lat: 21.67, lon: 109.20, kind: 'county', desc: '县域·农业用电',
      area: 2762, pop: 861182,
      poly: [[21.9088,109.6076],[21.9031,109.5823],[21.8973,109.548],[21.887,109.5294],[21.8776,109.5062],[21.8921,109.4732],[21.918,109.435],[21.9074,109.3909],[21.8917,109.362],[21.9009,109.3279],[21.8839,109.3106],[21.9012,109.3035],[21.9129,109.2871],[21.911,109.2673],[21.8897,109.2743],[21.8767,109.2618],[21.8662,109.1198],[21.8375,108.9129],[21.8312,108.9802],[21.8285,108.9758],[21.8168,108.957],[21.7977,108.9673],[21.7847,108.9529],[21.7612,108.9421],[21.7403,108.8869],[21.5874,108.966],[21.5669,109.1678],[21.5995,109.2757],[21.6613,109.3091],[21.6772,109.3751],[21.6484,109.4022],[21.6714,109.4165],[21.6718,109.4528],[21.5256,109.6418],[21.4855,109.7889],[21.5632,109.7551],[21.6002,109.7443],[21.6346,109.7545],[21.6671,109.7581],[21.6588,109.734],[21.6631,109.7085],[21.6988,109.6936],[21.7427,109.6937],[21.8362,109.7075],[21.8665,109.7013],[21.9006,109.6978],[21.9038,109.6277],[21.9088,109.6076]] },
    { id: 'weizhou',  name: '涠洲岛',   lat: 21.05, lon: 109.10, kind: 'island', desc: '火山岛·海岛旅游',
      area: 26.63, pop: 19300,
      poly: [[21.0147,109.0885],[21.0057,109.0999],[21.0075,109.106],[21.0148,109.102],[21.0227,109.1023],[21.025,109.1121],[21.0178,109.1181],[21.0151,109.1258],[21.0158,109.1308],[21.0275,109.137],[21.0413,109.1445],[21.0578,109.145],[21.0716,109.1289],[21.065,109.1068],[21.0528,109.0876],[21.0433,109.0858],[21.0203,109.0858],[21.0147,109.0885]] },
  ];
  const TIDE_STATIONS = [
    { id: 'bhg',   name: '北海港',   lat: 21.48, lon: 109.07, datum: 0.0, warnLevel: 4.0 },
    { id: 'tsg',   name: '铁山港',   lat: 21.40, lon: 109.47, datum: 0.0, warnLevel: 4.2 },
    { id: 'wzd',   name: '涠洲岛',   lat: 21.05, lon: 109.10, datum: 0.0, warnLevel: 3.8 },
  ];
  const CENTER = { lat: 21.48, lon: 109.11, name: '北海' };
  const API = {
    forecast: 'https://api.open-meteo.com/v1/forecast',
    air: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    marine: 'https://marine-api.open-meteo.com/v1/marine',
    flood: 'https://flood-api.open-meteo.com/v1/flood',
    climate: 'https://climate-api.open-meteo.com/v1/climate',
    usgs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    firms: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv',
    nmdis: 'https://service-tide.nmdis.org.cn',
    typhoonList: 'http://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default',
    typhoonView: 'http://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_',
    alarm: 'https://www.nmc.cn/rest/findAlarm',
  };
  const GEO = {
    '北海市': [21.48, 109.11], '海城区': [21.47, 109.12], '银海区': [21.43, 109.05],
    '铁山港区': [21.40, 109.47], '合浦县': [21.67, 109.20],
    '南宁市': [22.82, 108.32], '柳州市': [24.33, 109.42], '桂林市': [25.27, 110.29],
    '梧州市': [23.47, 111.33], '钦州市': [21.98, 108.65], '防城港市': [21.69, 108.35],
    '贵港市': [23.08, 109.60], '玉林市': [22.63, 110.18], '百色市': [23.90, 106.62],
    '贺州市': [24.41, 111.55], '河池市': [24.70, 108.07], '来宾市': [23.74, 109.23],
    '崇左市': [22.40, 107.36],
    '广州市': [23.13, 113.27], '深圳市': [22.54, 114.06], '湛江市': [21.27, 110.36],
    '海口市': [20.04, 110.32], '三亚市': [18.25, 109.51],
    '北京市': [39.90, 116.41], '上海市': [31.23, 121.47], '成都市': [30.67, 104.07],
  };
  const PROV_GEO = {
    '北京市': [39.90, 116.41], '广东省': [23.13, 113.27], '广西壮族自治区': [22.82, 108.32],
    '海南省': [20.04, 110.32], '云南省': [25.04, 102.71], '贵州省': [26.65, 106.63],
    '湖南省': [28.23, 112.94],
  };
  const TY_INTENSITY = {
    TD: { name: '热带低压', color: '#56a0ff' }, TS: { name: '热带风暴', color: '#2ecc71' },
    STS: { name: '强热带风暴', color: '#f1c40f' }, TY: { name: '台风', color: '#e67e22' },
    STY: { name: '强台风', color: '#e74c3c' }, SuperTY: { name: '超强台风', color: '#c0392b' },
    SUPER: { name: '超强台风', color: '#c0392b' },
  };
  function tyIntensity(code) { return TY_INTENSITY[code] || { name: code || '未知', color: '#888' }; }
  const WARN_CAT = {
    '台风': { cat: 'typhoon', color: '#9b59b6', label: '台风' },
    '暴雨': { cat: 'rainstorm', color: '#3498db', label: '暴雨·汛情' },
    '地质灾害': { cat: 'geological', color: '#a0522d', label: '地质灾害' },
    '雷暴大风': { cat: 'convective', color: '#f1c40f', label: '龙卷·强对流' },
    '大风': { cat: 'convective', color: '#f1c40f', label: '龙卷·强对流' },
    '冰雹': { cat: 'convective', color: '#f1c40f', label: '龙卷·强对流' },
    '雷电': { cat: 'convective', color: '#f1c40f', label: '龙卷·强对流' },
  };
  const WARN_LEVEL = {
    '蓝色': { lv: 1, color: '#3498db' }, '黄色': { lv: 2, color: '#f1c40f' },
    '橙色': { lv: 3, color: '#e67e22' }, '红色': { lv: 4, color: '#e74c3c' },
  };
  const BEIHAI_BOUNDARY = {
    name: '北海市',
    rings: [
      [[21.68,109.05],[21.71,109.22],[21.66,109.36],[21.55,109.48],[21.46,109.58],[21.40,109.62],[21.33,109.60],[21.27,109.50],[21.22,109.38],[21.20,109.26],[21.22,109.13],[21.27,109.04],[21.33,108.96],[21.40,108.93],[21.47,108.98],[21.53,109.01],[21.59,109.02],[21.64,109.03],[21.67,109.04]],
      [[21.075,109.085],[21.078,109.115],[21.052,109.138],[21.032,109.110],[21.035,109.085]],
    ],
  };
  const BEIHAI_NAMES = ['北海', '海城', '银海', '铁山港', '合浦', '涠洲'];
  const GUANGXI_CITIES = ['南宁市','柳州市','桂林市','梧州市','钦州市','防城港市','贵港市','玉林市','百色市','贺州市','河池市','来宾市','崇左市'];
  const THRESHOLDS = {
    windSpeed: { unit: 'm/s', note: '10m 平均风速', levels: [10.8, 13.9, 17.2, 24.5] },
    windGust: { unit: 'm/s', note: '阵风', levels: [13.9, 17.2, 20.8, 28.5] },
    precipitation: { unit: 'mm/h', note: '小时降水', levels: [8, 16, 32, 50] },
    tempHigh: { unit: '℃', note: '气温(高)', levels: [35, 37, 39, 40] },
    tempLow: { unit: '℃', note: '气温(低)', levels: [5, 2, -2, -5] },
    aqi: { unit: '', note: 'US AQI', levels: [100, 150, 200, 300] },
  };
  const WMO = {
    0:['晴','sunny'],1:['大致晴朗','sunny'],2:['局部多云','partly'],3:['阴','cloudy'],
    45:['雾','fog'],48:['霜雾','fog'],
    51:['小毛毛雨','drizzle'],53:['毛毛雨','drizzle'],55:['大毛毛雨','drizzle'],
    56:['冻毛毛雨','drizzle'],57:['强冻毛毛雨','drizzle'],
    61:['小雨','rain'],63:['中雨','rain'],65:['大雨','rain'],
    66:['冻雨','rain'],67:['强冻雨','rain'],
    71:['小雪','snow'],73:['中雪','snow'],75:['大雪','snow'],77:['雪粒','snow'],
    80:['阵雨','rain'],81:['强阵雨','rain'],82:['暴雨阵雨','rain'],
    85:['阵雪','snow'],86:['强阵雪','snow'],
    95:['雷阵雨','storm'],96:['雷阵雨伴雹','storm'],99:['强雷暴伴雹','storm'],
  };
  function wmo(code){ return WMO[code] || ['未知','unknown']; }
  function moonPhaseDesc(p){
    if (p === null || p === undefined) return '未知';
    if (p < 0.06 || p > 0.94) return '新月';
    if (p < 0.19) return '蛾眉月';
    if (p < 0.31) return '上弦月';
    if (p < 0.44) return '盈凸月';
    if (p < 0.56) return '满月';
    if (p < 0.69) return '亏凸月';
    if (p < 0.81) return '下弦月';
    return '残月';
  }

  // ===================== 告警引擎 =====================
  const LEVEL = [
    { lv: 0, name: '正常', color: '#3fb950', bg: 'rgba(63,185,80,.15)' },
    { lv: 1, name: '注意', color: '#d29922', bg: 'rgba(210,153,34,.15)' },
    { lv: 2, name: '预警', color: '#fb8500', bg: 'rgba(251,133,0,.18)' },
    { lv: 3, name: '警报', color: '#e5484d', bg: 'rgba(229,72,77,.20)' },
    { lv: 4, name: '紧急', color: '#bc1a1a', bg: 'rgba(188,26,26,.28)' },
  ];
  const levelName = lv => (LEVEL[lv] || LEVEL[0]).name;
  const levelColor = lv => (LEVEL[lv] || LEVEL[0]).color;
  function levelFor(value, def, dir = 'up') {
    if (value === null || value === undefined || isNaN(value)) return 0;
    let lv = 0;
    def.levels.forEach((th, i) => { const hit = dir === 'up' ? value >= th : value <= th; if (hit) lv = i + 1; });
    return lv;
  }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, toR = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const ADVICE = {
    '大风': { 1: '关注高空坠物，加固临时设施', 2: '停止高空户外作业，加固广告牌与脚手架', 3: '预置应急队伍，重点监视沿海与海岛', 4: '启动防风防汛预案，做好避险转移' },
    '阵风': { 1: '关注悬挂物松动风险', 2: '清理高空悬挂物与通道异物', 3: '暂停海岛渡运相关作业', 4: '严防高空坠物与设施损毁，准备抢修' },
    '强降水': { 1: '检查低洼区域排水', 2: '预置排水设备，巡视易涝点', 3: '地下空间封堵，停运风险点', 4: '果断停运避险，确保人身安全' },
    '高温': { 1: '关注户外作业防暑', 2: '错峰户外作业，备防暑物资', 3: '开放避暑场所，保障供水', 4: '红色预警，非必要不户外' },
    '低温': { 1: '防寒防冻检查', 2: '设施保暖，防凝露', 3: '防冰冻预演', 4: '抗冻抢险队伍待命' },
    '空气污染': { 1: '户外作业佩戴防护', 2: '减少长时间户外巡检', 3: '敏感人群避免户外，清洗延后', 4: '红色预警，非必要不户外' },
    '地震': { 1: '关注建筑设施异动', 2: '巡视重点设施，核查通信', 3: '启动地震应急，重点保障生命线', 4: '全力抢险，优先恢复重要功能' },
    '野火': { 1: '清理周边易燃植被', 2: '加强巡查，预备隔离带', 3: '靠近火点区域预撤避险', 4: '紧急疏散，配合消防' },
    '汛情': { 1: '水位监视', 2: '预置防汛物资', 3: '低洼区域进水防范', 4: '主动停运避险' },
    '风暴潮': { 1: '海岸设施检查', 2: '加固沿海设施，防海水倒灌', 3: '海岛预警，提前转移', 4: '准备离岛避险' },
    '台风': { 1: '关注台风动态，检查户外设施', 2: '加固高空悬挂物，预置防风物资', 3: '停止海上与高空作业，准备转移', 4: '启动防风Ⅰ级响应，全面避险' },
    '地质灾害': { 1: '关注坡体裂隙与渗水', 2: '巡查隐患点，设置警示', 3: '转移临坡临崖人员，封闭危险区', 4: '紧急撤离，配合专业救援' },
    '龙卷': { 1: '关注强对流云团发展', 2: '加固轻质构筑物，减少外出', 3: '人员进入坚固建筑底层避险', 4: '紧急避险，远离门窗与外墙' },
  };
  function push(arr, type, lv, detail, cat, st) {
    if (lv <= 0) return;
    arr.push({ type, level: lv, levelName: levelName(lv), color: levelColor(lv), detail, category: cat, station: st.name, stationId: st.id, advice: ADVICE[type]?.[lv] || '' });
  }
  function evaluateStation(st) {
    const items = [];
    const w = st.weather, a = st.air;
    if (w && w.ok) {
      push(items, '大风', levelFor(w.current.wind, THRESHOLDS.windSpeed, 'up'), `平均风速 ${w.current.wind?.toFixed(1)} m/s`, 'w', st);
      push(items, '阵风', levelFor(w.current.gust, THRESHOLDS.windGust, 'up'), `阵风 ${w.current.gust?.toFixed(1)} m/s`, 'w', st);
      push(items, '强降水', levelFor(w.current.precip, THRESHOLDS.precipitation, 'up'), `小时降水 ${w.current.precip?.toFixed(1)} mm`, 'r', st);
      push(items, '高温', levelFor(w.current.temp, THRESHOLDS.tempHigh, 'up'), `气温 ${w.current.temp?.toFixed(1)} ℃`, 'h', st);
      push(items, '低温', levelFor(w.current.temp, THRESHOLDS.tempLow, 'down'), `气温 ${w.current.temp?.toFixed(1)} ℃`, 'c', st);
    }
    if (a && a.ok) {
      push(items, '空气污染', levelFor(a.aqi, THRESHOLDS.aqi, 'up'), `AQI ${a.aqi}（首要 ${a.primary}）`, 'a', st);
    }
    const max = items.reduce((m, x) => Math.max(m, x.level), 0);
    return { level: max, levelName: levelName(max), color: levelColor(max), items };
  }
  function evaluateEarthquakes(quakes) {
    const out = [];
    (quakes || []).forEach(q => {
      if (q.mag == null) return;
      const dist = haversine(CENTER.lat, CENTER.lon, q.lat, q.lon);
      if (dist > 600) return;
      let lv = 0;
      if (q.mag >= 7) lv = 4; else if (q.mag >= 6) lv = 3; else if (q.mag >= 5) lv = 2;
      else if (q.mag >= 4.5 && dist < 400) lv = 1;
      if (lv > 0) out.push({
        type: '地震', level: lv, levelName: levelName(lv), color: levelColor(lv),
        detail: `M${q.mag} · ${q.place} · 距北海约 ${dist.toFixed(0)} km`, station: '区域',
        advice: ADVICE['地震'][lv], time: q.time, mag: q.mag, dist, lat: q.lat, lon: q.lon,
      });
    });
    return out;
  }
  function evaluateFires(fires) {
    if (!fires || !fires.length) return [];
    const near = fires.filter(f => haversine(CENTER.lat, CENTER.lon, f.lat, f.lon) < 120);
    const out = [];
    if (near.length) {
      const lv = near.length > 8 ? 3 : near.length > 3 ? 2 : 1;
      out.push({ type: '野火', level: lv, levelName: levelName(lv), color: levelColor(lv),
        detail: `监测到 ${near.length} 处活跃火点（北部湾/桂南）`, station: '区域', advice: ADVICE['野火'][lv], points: near.slice(0, 20) });
    }
    return out;
  }
  function evaluateTides(tides) {
    const out = [];
    (tides || []).forEach(t => {
      if (t.configured === false) return;
      if (t.exceeded) {
        const lv = t.current >= t.warnLevel + 1 ? 3 : 2;
        out.push({ type: '风暴潮/高潮位', level: lv, levelName: levelName(lv), color: levelColor(lv),
          detail: `${t.name} 潮位 ${t.current} m ≥ 警戒 ${t.warnLevel} m`, station: t.name, advice: ADVICE['风暴潮'][lv] });
      }
    });
    return out;
  }
  function evaluateTyphoon(typhoons) {
    const out = [];
    (typhoons || []).forEach(t => {
      const cur = t.current; if (!cur || !cur.lat) return;
      const dist = haversine(CENTER.lat, CENTER.lon, cur.lat, cur.lon);
      if (dist > 1500) return;
      const sInt = { TD: 1, TS: 1, STS: 2, TY: 2, STY: 3, SuperTY: 4, SUPER: 4 }[cur.intensity] || 1;
      let lv = 0;
      if (dist < 300) lv = Math.min(4, sInt + 1);
      else if (dist < 700) lv = Math.min(3, sInt);
      else if (dist < 1200) lv = Math.max(1, sInt - 1);
      else lv = 1;
      if (lv > 0) out.push({
        type: '台风', level: lv, levelName: levelName(lv), color: levelColor(lv),
        detail: `${t.cnName}（${t.enName}）${tyIntensity(cur.intensity).name} 中心 ${cur.lat.toFixed(1)}°N ${cur.lon.toFixed(1)}°E · 距北海约 ${dist.toFixed(0)} km · 风速 ${cur.wind || '—'} m/s`,
        station: '区域', advice: ADVICE['台风'][lv], id: t.id, lat: cur.lat, lon: cur.lon, dist,
      });
    });
    return out;
  }
  function evaluateWarnings(warnings) {
    const out = [];
    (warnings || []).forEach(w => {
      if (w.cat === 'typhoon') return;
      if (!w.lat || !w.lon) return;
      const dist = haversine(CENTER.lat, CENTER.lon, w.lat, w.lon);
      if (dist > 500) return;
      let type, adviceKey;
      if (w.cat === 'geological') { type = '地质灾害'; adviceKey = '地质灾害'; }
      else if (w.cat === 'rainstorm') { type = '汛情·暴雨'; adviceKey = '汛情'; }
      else if (w.cat === 'convective') { type = '龙卷·强对流'; adviceKey = '龙卷'; }
      else return;
      const lv = w.levelNum || 1;
      out.push({
        type, level: lv, levelName: levelName(lv), color: (WARN_LEVEL[w.level] || {}).color || levelColor(lv),
        detail: `${w.city || ''} ${w.level}${type}预警`, station: w.city || '区域',
        advice: (ADVICE[adviceKey] && ADVICE[adviceKey][lv]) || '关注官方预警，做好防范', lat: w.lat, lon: w.lon, time: w.time,
      });
    });
    return out;
  }

  // ===================== 告警情报（区域分级）=====================
  const BEIHAI_BBOX = { minLat: 21.20, maxLat: 21.90, minLon: 108.85, maxLon: 109.65 };
  const GUANGXI_BBOX = { minLat: 21.40, maxLat: 26.50, minLon: 104.50, maxLon: 112.10 };
  function regionOf(lat, lon, city) {
    if (city && BEIHAI_NAMES.some(n => city.includes(n))) return { region: '北海', rank: 0 };
    if (lat != null && lon != null && lat >= BEIHAI_BBOX.minLat && lat <= BEIHAI_BBOX.maxLat && lon >= BEIHAI_BBOX.minLon && lon <= BEIHAI_BBOX.maxLon) return { region: '北海', rank: 0 };
    if (city && GUANGXI_CITIES.some(n => city.includes(n))) return { region: '广西', rank: 1 };
    if (lat != null && lon != null && lat >= GUANGXI_BBOX.minLat && lat <= GUANGXI_BBOX.maxLat && lon >= GUANGXI_BBOX.minLon && lon <= GUANGXI_BBOX.maxLon) return { region: '广西', rank: 1 };
    return { region: '其他', rank: 2 };
  }
  function beihaiRelationFor(lat, lon, region, opts) {
    opts = opts || {};
    const d = (lat != null && lon != null) ? haversine(CENTER.lat, CENTER.lon, lat, lon) : null;
    const md = (opts.minDistBH != null) ? opts.minDistBH : d;
    if (region === '北海') return 'direct';
    if (opts.kind === '台风') {
      if (md != null && md < 300) return 'direct';
      if (md != null && md < 800) return 'possible';
      return 'none';
    }
    if (region === '广西') return (d != null && d < 250) ? 'possible' : 'none';
    if (d != null && d < 400) return 'possible';
    return 'none';
  }
  const REL_LABEL = { direct: '涉及北海', possible: '可能涉及北海', none: '' };
  function tyLevel(intensity, lat, lon) {
    const sInt = { TD: 1, TS: 1, STS: 2, TY: 2, STY: 3, SuperTY: 4, SUPER: 4 }[intensity] || 1;
    const dist = haversine(CENTER.lat, CENTER.lon, lat, lon);
    if (dist < 300) return Math.min(4, sInt + 1);
    if (dist < 700) return Math.min(3, sInt);
    if (dist < 1200) return Math.max(1, sInt - 1);
    return 1;
  }
  function typhoonMinDistBH(t) {
    const pts = [t.current, ...(t.points || [])].filter(p => p && p.lat != null && p.lon != null);
    if (!pts.length) return null;
    return Math.min(...pts.map(p => haversine(CENTER.lat, CENTER.lon, p.lat, p.lon)));
  }
  function buildAlertIntel({ typhoons = [], warnings = {}, quakes = [] } = {}) {
    const items = [];
    (typhoons || []).forEach(t => {
      const c = t.current; if (!c || !c.lat) return;
      const lv = tyLevel(c.intensity, c.lat, c.lon);
      const reg = regionOf(c.lat, c.lon, null);
      const inten = tyIntensity(c.intensity);
      const md = typhoonMinDistBH(t);
      const rel = beihaiRelationFor(c.lat, c.lon, reg.region, { kind: '台风', minDistBH: md });
      items.push({
        id: 'ty-' + t.id, category: '台风', level: lv, levelName: levelName(lv), color: levelColor(lv),
        title: `${t.cnName || t.enName || '台风'}（${t.enName || ''}）${inten.name}`,
        summary: `中心 ${c.lat.toFixed(2)}°N ${c.lon.toFixed(2)}°E · 风速 ${c.wind || '—'} m/s · 气压 ${c.pressure || '—'} hPa`,
        advice: (ADVICE['台风'] && ADVICE['台风'][lv]) || '', region: reg.region, rank: reg.rank,
        beihaiRelation: rel, relLabel: REL_LABEL[rel], minDistBH: md, source: '中央气象台',
        time: c.ts || '', lat: c.lat, lon: c.lon, url: '',
      });
    });
    const wlist = (warnings && warnings.all) || [];
    wlist.forEach(w => {
      const lv = w.levelNum || 1;
      const reg = regionOf(w.lat, w.lon, w.city);
      let adviceKey = null;
      if (w.cat === 'geological') adviceKey = '地质灾害';
      else if (w.cat === 'rainstorm') adviceKey = '汛情';
      else if (w.cat === 'convective') adviceKey = '龙卷';
      else if (w.cat === 'typhoon') adviceKey = '台风';
      const rel = beihaiRelationFor(w.lat, w.lon, reg.region, { kind: w.cat });
      items.push({
        id: 'w-' + w.id, category: w.catLabel || w.cat, level: lv, levelName: levelName(lv), color: levelColor(lv),
        title: w.title, summary: `${w.city || ''} ${w.level || ''}${w.catLabel || w.cat}预警`,
        advice: (adviceKey && ADVICE[adviceKey] && ADVICE[adviceKey][lv]) || '关注官方预警，做好防范',
        region: reg.region, rank: reg.rank, beihaiRelation: rel, relLabel: REL_LABEL[rel],
        minDistBH: (w.lat != null ? haversine(CENTER.lat, CENTER.lon, w.lat, w.lon) : null),
        source: '地方气象台', time: w.time || '', lat: w.lat, lon: w.lon, url: w.url || '',
      });
    });
    (quakes || []).forEach(q => {
      if (q.mag == null) return;
      const dist = haversine(CENTER.lat, CENTER.lon, q.lat, q.lon);
      if (dist > 600) return;
      let lv = 0;
      if (q.mag >= 7) lv = 4; else if (q.mag >= 6) lv = 3; else if (q.mag >= 5) lv = 2;
      else if (q.mag >= 4.5 && dist < 400) lv = 1;
      if (lv <= 0) return;
      const reg = regionOf(q.lat, q.lon, null);
      const rel = beihaiRelationFor(q.lat, q.lon, reg.region, { kind: '地震' });
      items.push({
        id: 'eq-' + q.time + '-' + q.lat.toFixed(2) + '-' + q.lon.toFixed(2), category: '地震',
        level: lv, levelName: levelName(lv), color: levelColor(lv), title: `地震 M${q.mag}`,
        summary: `${q.place} · 距北海约 ${dist.toFixed(0)} km · 深度 ${q.depth} km`,
        advice: (ADVICE['地震'] && ADVICE['地震'][lv]) || '', region: reg.region, rank: reg.rank,
        beihaiRelation: rel, relLabel: REL_LABEL[rel], minDistBH: dist, source: 'USGS',
        time: new Date(q.time).toISOString().slice(0, 16).replace('T', ' '), lat: q.lat, lon: q.lon, url: q.url || '',
      });
    });
    items.sort((a, b) => (a.rank - b.rank) || (b.level - a.level) || String(b.time || '').localeCompare(String(a.time || '')));
    return { updated: new Date().toISOString(), count: items.length, items };
  }

  // ===================== 数据源适配层 =====================
  function fetchJSON(url, timeout = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    return fetch(proxied(url), { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(t));
  }
  function parseJSONP(text) {
    const m = text.match(/^\s*[\w$]+\s*\(+\s*([\s\S]*?)\s*\)+\s*;?\s*$/);
    if (!m) throw new Error('not JSONP');
    return JSON.parse(m[1]);
  }
  function fetchJSONP(url, timeout = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    return fetch(proxied(url), { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(parseJSONP)
      .finally(() => clearTimeout(t));
  }
  function geoFromTitle(title) {
    if (!title) return null;
    let best = null, bestLen = 0;
    for (const name of Object.keys(GEO)) { if (title.includes(name) && name.length > bestLen) { best = name; bestLen = name.length; } }
    if (best) { const [lat, lon] = GEO[best]; return { city: best.replace(/市$/, ''), lat, lon }; }
    for (const name of Object.keys(PROV_GEO)) { if (title.includes(name) && name.length > bestLen) { best = name; bestLen = name.length; } }
    if (best) { const [lat, lon] = PROV_GEO[best]; return { city: best.replace(/省$|自治区$|市$/, ''), lat, lon, approx: true }; }
    return null;
  }
  function levelFromTitle(title) {
    for (const k of ['红色', '橙色', '黄色', '蓝色']) if (title.includes(k)) return k;
    return '未知';
  }
  function qs(base, params) {
    const u = new URL(base);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  }
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
      return { time: hr.time[k], temp: hr.temperature_2m[k], feels: hr.apparent_temperature[k], precip: hr.precipitation[k], precipProb: hr.precipitation_probability[k], wind: hr.wind_speed_10m[k], gust: hr.wind_gusts_10m[k], code: hr.weather_code[k], rh: hr.relative_humidity_2m[k], cloud: hr.cloud_cover[k], pressure: hr.pressure_msl[k] };
    });
    return {
      ok: true,
      current: { time: cur.time, temp: cur.temperature_2m, feels: cur.apparent_temperature, rh: cur.relative_humidity_2m, precip: cur.precipitation, code: cur.weather_code, text: wmo(cur.weather_code)[0], icon: wmo(cur.weather_code)[1], wind: cur.wind_speed_10m, gust: cur.wind_gusts_10m, windDir: cur.wind_direction_10m, pressure: cur.pressure_msl, cloud: cur.cloud_cover, isDay: cur.is_day },
      daily: daily.time.map((t, i) => ({ date: t, code: daily.weather_code[i], text: wmo(daily.weather_code[i])[0], tmax: daily.temperature_2m_max[i], tmin: daily.temperature_2m_min[i], precip: daily.precipitation_sum[i], precipProb: daily.precipitation_probability_max[i], windMax: daily.wind_speed_10m_max[i], gustMax: daily.wind_gusts_10m_max[i], pressure: daily.pressure_msl_max[i], sunrise: daily.sunrise[i], sunset: daily.sunset[i], moonrise: daily.moonrise[i], moonset: daily.moonset[i], moonPhase: daily.moon_phase[i] })),
      hourly24: next24,
    };
  }
  async function fetchAir(s) {
    const url = qs(API.air, { latitude: s.lat, longitude: s.lon, current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide', hourly: 'us_aqi,pm2_5,ozone', forecast_days: '3', timezone: 'Asia/Shanghai' });
    const d = await fetchJSON(url);
    const c = d.current;
    const aqiByHour = (d.hourly && d.hourly.time) ? d.hourly.time.map((t, i) => ({ time: t, aqi: d.hourly.us_aqi[i] })) : [];
    return { ok: true, aqi: c.us_aqi, pm25: c.pm2_5, pm10: c.pm10, o3: c.ozone, no2: c.nitrogen_dioxide, so2: c.sulphur_dioxide, co: c.carbon_monoxide, primary: aqiPrimary(c), hourlyAqi: aqiByHour };
  }
  function aqiPrimary(c) {
    const arr = [['PM2.5', c.pm2_5], ['PM10', c.pm10], ['O₃', c.ozone], ['NO₂', c.nitrogen_dioxide], ['SO₂', c.sulphur_dioxide], ['CO', c.carbon_monoxide]];
    arr.sort((a, b) => b[1] - a[1]);
    return arr[0][0];
  }
  async function fetchMarine(s) {
    const url = qs(API.marine, { latitude: s.lat, longitude: s.lon, current: 'wave_height,wave_period,wave_direction,sea_surface_temperature,wind_wave_height', hourly: 'wave_height,sea_surface_temperature', timezone: 'Asia/Shanghai' });
    const d = await fetchJSON(url);
    const c = d.current;
    return { ok: true, waveHeight: c.wave_height, wavePeriod: c.wave_period, waveDir: c.wave_direction, windWaveHeight: c.wind_wave_height, seaTemp: c.sea_surface_temperature };
  }
  async function fetchFlood(s) {
    const url = qs(API.flood, { latitude: s.lat, longitude: s.lon, daily: 'river_discharge', forecast_days: '3', timezone: 'Asia/Shanghai' });
    const d = await fetchJSON(url);
    const v = d.daily.river_discharge;
    return { ok: true, discharge: v[0], hasRiver: v.some(x => x !== null && x > 0) };
  }
  async function fetchClimate(s) {
    const url = qs(API.climate, { latitude: s.lat, longitude: s.lon, start_date: '1991-01-01', end_date: '2020-12-31', daily: 'temperature_2m_mean,precipitation_sum', models: 'CMCC_CM2_VHR4', timezone: 'Asia/Shanghai' });
    const d = await fetchJSON(url, 25000);
    const t = d.daily.temperature_2m_mean, p = d.daily.precipitation_sum;
    const monthT = Array(12).fill(0), monthP = Array(12).fill(0), cnt = Array(12).fill(0);
    d.daily.time.forEach((tm, i) => { const m = new Date(tm).getMonth(); if (t[i] != null) { monthT[m] += t[i]; monthP[m] += p[i] || 0; cnt[m]++; } });
    return { ok: true, monthlyTemp: monthT.map((v, i) => +(v / cnt[i]).toFixed(1)), monthlyPrecip: monthP.map((v, i) => +(v / cnt[i]).toFixed(1)) };
  }
  async function fetchEarthquakes() {
    const d = await fetchJSON(API.usgs, 20000);
    return { ok: true, events: d.features.map(f => ({ mag: f.properties.mag, place: f.properties.place, time: f.properties.time, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2], url: f.properties.url })) };
  }
  async function fetchFires() {
    if (!FIRMS_MAP_KEY) return { ok: false, configured: false, reason: '未配置 FIRMS_MAP_KEY' };
    const url = `${API.firms}/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/-1/106,20,112,23/1`;
    const csv = await fetch(proxied(url)).then(r => r.text());
    const lines = csv.trim().split('\n').slice(1);
    const fires = lines.map(l => l.split(',')).filter(a => a.length > 5).map(a => ({ lat: +a[0], lon: +a[1], frp: +a[2], time: a[5], conf: a[6] }));
    return { ok: true, configured: true, fires };
  }
  async function fetchTyphoon() {
    try {
      const list = await fetchJSONP(proxied(API.typhoonList), 20000);
      const items = (list && list.typhoonList) || [];
      const activeIds = items.filter(t => t[7] === 'start').map(t => t[0]);
      const typhoons = [];
      for (const id of activeIds.slice(0, 4)) {
        try {
          const v = await fetchJSONP(proxied(API.typhoonView + id), 20000);
          const arr = v.typhoon; if (!arr || !arr[8]) continue;
          const points = arr[8].filter(p => Array.isArray(p) && p.length >= 8).map(p => ({
            time: p[1], ts: p[2], lon: p[4], lat: p[5], pressure: p[6], wind: p[7], intensity: p[3] || 'TD',
            moveDir: p[8], moveSpeed: p[9],
            radius: (Array.isArray(p[10]) && p[10][0] && Array.isArray(p[10][0])) ? Math.max(...p[10].map(r => Math.max(r[1] || 0, r[2] || 0, r[3] || 0, r[4] || 0))) : 0,
          })).filter(p => p.lat && p.lon);
          if (!points.length) continue;
          const cur = points[points.length - 1];
          typhoons.push({ id, enName: arr[1], cnName: arr[2], number: arr[3], status: arr[7], points, current: cur });
        } catch (e) { /* 单台风失败忽略 */ }
      }
      return { ok: true, count: typhoons.length, typhoons };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  async function fetchWarnings() {
    const CATS = [
      { key: '台风', signaltype: '台风' },
      { key: '暴雨', signaltype: '暴雨' },
      { key: '地质灾害', signaltype: '地质灾害' },
      { key: '强对流', signaltype: '雷暴大风' },
    ];
    const out = { typhoon: [], rainstorm: [], geological: [], convective: [], all: [] };
    await Promise.all(CATS.map(async ({ key, signaltype }) => {
      try {
        const url = `${API.alarm}?pageNo=1&pageSize=60&signaltype=${encodeURIComponent(signaltype)}&signallevel=&province=`;
        const d = await fetchJSON(proxied(url), 20000);
        const list = (d && d.data && d.data.page && d.data.page.list) || [];
        list.forEach(a => {
          const cat = WARN_CAT[signaltype];
          const geo = geoFromTitle(a.title);
          const lvTxt = levelFromTitle(a.title);
          const rec = {
            id: a.alertid, title: a.title, time: a.issuetime, url: a.url ? 'https://www.nmc.cn' + a.url : '',
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
  async function aggregateStation(s) {
    const [wx, air, marine, flood] = await Promise.allSettled([fetchForecast(s), fetchAir(s), fetchMarine(s), fetchFlood(s)]);
    const get = (r, fb) => (r.status === 'fulfilled' ? r.value : fb);
    const wea = get(wx, { ok: false, error: wx.reason });
    const airObj = get(air, { ok: false, error: air.reason });
    if (wea.ok && airObj.ok && wea.hourly24 && airObj.hourlyAqi && airObj.hourlyAqi.length) {
      const aqiByTime = new Map(airObj.hourlyAqi.map(a => [a.time, a.aqi]));
      wea.hourly24.forEach(h => { const v = aqiByTime.get(h.time); h.aqi = (v == null ? null : v); });
    }
    return { id: s.id, name: s.name, kind: s.kind, desc: s.desc, lat: s.lat, lon: s.lon, area: s.area, pop: s.pop, poly: s.poly, weather: wea, air: airObj, marine: get(marine, { ok: false, error: marine.reason }), flood: get(flood, { ok: false, error: flood.reason }) };
  }

  // ===================== 潮汐/水位 =====================
  const CONSTITUENTS = [
    { name: 'M2', amp: 1.9, period: 12.4206, phase: 1.2 },
    { name: 'S2', amp: 0.7, period: 12.0000, phase: 0.4 },
    { name: 'K1', amp: 0.4, period: 23.9345, phase: 3.1 },
    { name: 'O1', amp: 0.3, period: 25.8194, phase: 5.0 },
  ];
  const MEAN_LEVEL = 1.6;
  function tideAt(date) {
    const t = date.getTime() / 1000;
    let h = MEAN_LEVEL;
    for (const c of CONSTITUENTS) h += c.amp * Math.cos((2 * Math.PI * t) / (c.period * 3600) - c.phase);
    return +h.toFixed(2);
  }
  function predictDay(st) {
    const out = [];
    const now = new Date();
    for (let i = 0; i < 24 * 4; i++) {
      const t = new Date(now.getTime() + i * 15 * 60000);
      out.push({ time: t, h: tideAt(t) });
    }
    const ext = [];
    for (let i = 1; i < out.length - 1; i++) {
      if ((out[i].h > out[i - 1].h && out[i].h >= out[i + 1].h) || (out[i].h < out[i - 1].h && out[i].h <= out[i + 1].h)) {
        ext.push({ time: out[i].time, h: out[i].h, type: out[i].h >= MEAN_LEVEL ? 'high' : 'low' });
      }
    }
    return { current: +tideAt(now).toFixed(2), extremes: ext.slice(0, 4) };
  }
  async function getTide(st) {
    if (NMDIS_APPID && NMDIS_APPSECRET) {
      try {
        const res = await fetch(proxied(`${API.nmdis}/GetPortTideData`), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appid: NMDIS_APPID, appsecret: NMDIS_APPSECRET, port: st.name }),
        });
        if (res.ok) {
          const d = await res.json();
          return { ok: true, source: '国家海洋信息中心', current: d.cur, extremes: d.extremes, warnLevel: st.warnLevel };
        }
      } catch (e) { /* fallthrough to model */ }
    }
    const p = predictDay(st);
    return { ok: true, source: '调和模型估算(演示)', configured: false, current: p.current, extremes: p.extremes, warnLevel: st.warnLevel, meanLevel: MEAN_LEVEL, exceeded: p.current >= st.warnLevel };
  }
  async function getAllTides() { return Promise.all(TIDE_STATIONS.map(async st => ({ ...st, ...(await getTide(st)) }))); }

  // ===================== 天文 =====================
  function sunsetGlow(station) {
    const w = station.weather; if (!w || !w.ok) return null;
    const c = w.current; const daily = w.daily[0] || {};
    let score = 0; const factors = [];
    if (c.precip > 0.2) return { score: 0, grade: '低', bestTime: daily.sunset || '', factors: ['当前有降水，霞光概率低'] };
    const cl = c.cloud;
    if (cl >= 30 && cl <= 60) { score += 50; factors.push('云量适中(30–60%)，色彩层次佳'); }
    else if (cl >= 15 && cl < 30) { score += 35; factors.push('云量偏少，霞光较淡'); }
    else if (cl > 60 && cl <= 80) { score += 22; factors.push('云量偏多，地平线或可见'); }
    else if (cl > 80) { score += 8; factors.push('云量过厚，概率低'); }
    else { score += 12; factors.push('晴空少云，霞光较弱'); }
    const rh = c.rh;
    if (rh >= 60 && rh <= 90) { score += 20; factors.push('湿度适宜，透光性好'); }
    else if (rh > 90) { score += 12; factors.push('湿度偏高'); }
    else { score += 10; factors.push('空气偏干'); }
    const wd = c.wind;
    if (wd < 4) { score += 18; factors.push('风力静稳'); }
    else if (wd < 8) { score += 10; factors.push('微风'); }
    else { score += 4; factors.push('风力较大，云层易散'); }
    score = Math.min(100, score);
    const grade = score >= 70 ? '高' : score >= 40 ? '中' : '低';
    return { score, grade, bestTime: daily.sunset || '', factors };
  }
  function sunriseGlow(station) {
    const w = station.weather; if (!w || !w.ok) return null;
    const c = w.current; const daily = w.daily[0] || {};
    let score = 0; const factors = [];
    if (c.precip > 0.2) return { score: 0, grade: '低', bestTime: daily.sunrise || '', factors: ['当前有降水，朝霞概率低'] };
    const cl = c.cloud;
    if (cl >= 30 && cl <= 60) { score += 50; factors.push('云量适中(30–60%)，朝霞层次佳'); }
    else if (cl >= 15 && cl < 30) { score += 35; factors.push('云量偏少，朝霞较淡'); }
    else if (cl > 60 && cl <= 80) { score += 22; factors.push('云量偏多，天际线或可见'); }
    else if (cl > 80) { score += 8; factors.push('云量过厚，概率低'); }
    else { score += 12; factors.push('晴空少云，朝霞较弱'); }
    const rh = c.rh, wd = c.wind; const month = new Date().getMonth() + 1; const fogSeason = (month <= 4 || month >= 11);
    if (fogSeason && rh >= 92 && wd < 3) { score -= 18; factors.push('冬春清晨高湿静风，易起雾削弱朝霞'); }
    else if (rh >= 60 && rh <= 90) { score += 20; factors.push('湿度适宜，透光性好'); }
    else if (rh > 90) { score += 8; factors.push('湿度偏高'); }
    else { score += 10; factors.push('空气偏干'); }
    if (wd < 4) { score += 18; factors.push('风力静稳'); }
    else if (wd < 8) { score += 10; factors.push('微风'); }
    else { score += 4; factors.push('风力较大，云层易散'); }
    score = Math.max(0, Math.min(100, score));
    const grade = score >= 70 ? '高' : score >= 40 ? '中' : '低';
    return { score, grade, bestTime: daily.sunrise || '', factors };
  }
  function daysUntil(month, day) {
    const now = new Date();
    let target = new Date(now.getFullYear(), month - 1, day);
    if (target < now) target = new Date(now.getFullYear() + 1, month - 1, day);
    return Math.ceil((target - now) / 86400000);
  }
  function nextMoonPhase() {
    const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
    const syn = 29.53059;
    const now = Date.now() / 86400000;
    const k = Math.ceil((now - ref) / syn);
    return { nextNew: new Date((ref + k * syn) * 86400000), nextFull: new Date((ref + (k + 0.5) * syn) * 86400000) };
  }
  function astronomicalEvents() {
    const meteor = [
      { name: '象限仪座流星雨', peak: [1, 4], note: '年度开场，ZHR~110' },
      { name: '英仙座流星雨', peak: [8, 13], note: '夏季最佳，ZHR~100' },
      { name: '双子座流星雨', peak: [12, 14], note: '年度最强，ZHR~150' },
      { name: '天龙座流星雨', peak: [10, 9], note: '偶发爆发' },
      { name: '猎户座流星雨', peak: [10, 21], note: '哈雷彗星遗骸' },
      { name: '宝瓶座流星雨', peak: [5, 6], note: '春夜可观' },
    ].map(m => ({ ...m, inDays: daysUntil(m.peak[0], m.peak[1]) }));
    const mn = nextMoonPhase();
    const supermoons = [
      { name: '超级月亮（4月）', date: '2026-04-02' },
      { name: '超级月亮（5月）', date: '2026-05-01' },
      { name: '超级月亮（11月）', date: '2026-11-05' },
      { name: '超级月亮（12月）', date: '2026-12-04' },
    ];
    return {
      meteors: meteor,
      moon: { nextNew: mn.nextNew.toISOString().slice(0, 10), nextFull: mn.nextFull.toISOString().slice(0, 10) },
      supermoons,
      galacticCore: '银河中心季（3–10月，核心可见于南方夜空，需无月夜+低光污染）',
      tips: '观星/银河最佳：新月前后3天、无云、涠洲岛等光污染低区域；北海银滩光污染中等，建议前往冠头岭/涠洲岛。',
    };
  }

  // ===================== 聚合（替代 server.js buildOverview）=====================
  const climateCache = new Map();
  async function getClimate(s) {
    const cached = climateCache.get(s.id);
    if (cached && cached.expire > Date.now()) return cached.data;
    try { const d = await fetchClimate(s); climateCache.set(s.id, { expire: Date.now() + 24 * 3600e3, data: d }); return d; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  async function buildOverview() {
    const results = await Promise.allSettled([
      Promise.all(STATIONS.map(s => aggregateStation(s))),
      getAllTides(),
      fetchEarthquakes().catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchFires().catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchTyphoon().catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchWarnings().catch(e => ({ ok: false, error: String(e.message || e) })),
    ]);
    const [stationsAgg, tideRes, quakeRes, fireRes, tyRes, warnRes] = results;
    const tideList = tideRes.status === 'fulfilled' ? tideRes.value : [];
    const stations = (stationsAgg.status === 'fulfilled' ? stationsAgg.value : []).map(st => {
      const ev = evaluateStation(st);
      const glow = sunsetGlow(st);
      const morningGlow = sunriseGlow(st);
      return { ...st, alert: ev, glow, morningGlow };
    });
    const quakes = quakeRes.status === 'fulfilled' && quakeRes.value.ok ? quakeRes.value.events : [];
    const fires = fireRes.status === 'fulfilled' && fireRes.value.ok ? fireRes.value.fires : [];
    const typhoons = tyRes.status === 'fulfilled' && tyRes.value.ok ? tyRes.value.typhoons : [];
    const warningsAll = warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.all : [];
    const eqAlerts = evaluateEarthquakes(quakes);
    const fireAlerts = evaluateFires(fires);
    const tideAlerts = evaluateTides(tideList);
    const tyAlerts = evaluateTyphoon(typhoons);
    const warnAlerts = evaluateWarnings(warningsAll);
    const rawAlerts = [...stations.flatMap(s => s.alert.items), ...eqAlerts, ...fireAlerts, ...tideAlerts, ...tyAlerts, ...warnAlerts];
    const STATION_NAMES = new Set(STATIONS.map(s => s.name));
    const REL_TXT = { direct: '涉及北海', possible: '可能涉及北海', none: '' };
    const globalAlerts = rawAlerts.map(a => {
      let region = '其他', rel = 'none';
      if (a.station && STATION_NAMES.has(a.station)) { region = '北海'; rel = 'direct'; }
      else if (typeof a.lat === 'number' && typeof a.lon === 'number') {
        const reg = regionOf(a.lat, a.lon, a.station || null);
        region = reg.region;
        rel = beihaiRelationFor(a.lat, a.lon, reg.region, { kind: a.type });
      }
      return { ...a, region, beihaiRelation: rel, relLabel: REL_TXT[rel] || '' };
    }).sort((a, b) => b.level - a.level);
    return {
      updated: new Date().toISOString(),
      center: { name: '北海', lat: 21.48, lon: 109.11 },
      maxLevel: globalAlerts.reduce((m, x) => Math.max(m, x.level), 0),
      maxLevelName: levelName(globalAlerts.reduce((m, x) => Math.max(m, x.level), 0)),
      boundary: BEIHAI_BOUNDARY,
      stations, tides: tideList,
      earthquakes: { ok: quakeRes.status === 'fulfilled' && quakeRes.value.ok, count: quakes.length, events: quakes.slice(0, 12) },
      fires: { ok: fireRes.status === 'fulfilled' && fireRes.value.ok, configured: !!(fireRes.status === 'fulfilled' && fireRes.value.configured), count: fires.length, fires: fires.slice(0, 50) },
      typhoon: { ok: tyRes.status === 'fulfilled' && tyRes.value.ok, count: typhoons.length, typhoons },
      warnings: { ok: warnRes.status === 'fulfilled' && warnRes.value.ok, count: warningsAll.length, all: warningsAll, typhoon: [], rainstorm: [], geological: [], convective: [] },
      astronomy: astronomicalEvents(),
      globalAlerts,
    };
  }

  // 替代 /api/time（毫秒精度，本地时钟）
  function now() { return Promise.resolve({ now: Date.now(), iso: new Date().toISOString() }); }

  // 暴露全局接口
  window.AlphaData = {
    buildOverview, now, getClimate,
    STATIONS, TIDE_STATIONS, CENTER, API, GEO, PROV_GEO, WARN_CAT, WARN_LEVEL,
    THRESHOLDS, WMO, wmo, moonPhaseDesc, BEIHAI_BOUNDARY, BEIHAI_NAMES, GUANGXI_CITIES,
    tyIntensity, tyLevel, regionOf, beihaiRelationFor, buildAlertIntel, levelName, levelColor,
  };
})();
