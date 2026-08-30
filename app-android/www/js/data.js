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

  // ===================== 原生 HTTP（绕过 WKWebView CORS）=====================
  // 在 Capacitor 原生壳内（iOS/Android），优先用 Capacitor.Http（原生 NSURLSession /
  // HttpURLConnection）发请求，彻底绕过浏览器 CORS。需 capacitor.config 中启用
  // plugins.CapacitorHttp.enabled=true。Web / PWA 环境无原生桥，回退到标准 fetch。
  const IS_NATIVE = !!(typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function getCapHttp() {
    try {
      if (typeof window === 'undefined' || !window.Capacitor) return null;
      if (window.CapacitorHttp) return window.CapacitorHttp;
      if (window.Capacitor.Http) return window.Capacitor.Http;
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) return window.Capacitor.Plugins.CapacitorHttp;
    } catch (e) {}
    return null;
  }
  const CapHttp = IS_NATIVE ? getCapHttp() : null;

  // 原生 GET → 解析后的对象（JSON 自动解析；若返回字符串则原样返回待后续解析）
  async function httpGetParsed(url, timeout = 15000) {
    if (CapHttp) {
      const resp = await CapHttp.get({
        url: proxied(url),
        headers: { 'Accept': 'application/json, text/plain, */*' },
        connectTimeout: timeout,
        readTimeout: timeout,
      });
      if (!resp || resp.status == null || resp.status < 200 || resp.status >= 300) {
        throw new Error('HTTP ' + (resp && resp.status != null ? resp.status : 'no-response'));
      }
      let body = resp.data;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) {} }
      return body;
    }
    // Web / PWA 回退：标准 fetch
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(proxied(url), { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    clearTimeout(t);
    return r.json();
  }
  // 原生 GET → 文本（用于 JSONP / 非 JSON 响应）
  async function httpGetText(url, timeout = 15000) {
    if (CapHttp) {
      const resp = await CapHttp.get({
        url: proxied(url),
        headers: { 'Accept': 'application/javascript, text/plain, */*' },
        connectTimeout: timeout,
        readTimeout: timeout,
        responseType: 'text',
      });
      if (!resp || resp.status == null || resp.status < 200 || resp.status >= 300) {
        throw new Error('HTTP ' + (resp && resp.status != null ? resp.status : 'no-response'));
      }
      return typeof resp.data === 'string' ? resp.data : String(resp.data);
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(proxied(url), { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    clearTimeout(t);
    return r.text();
  }
  // 原生 POST → 解析后的对象（NMDIS 认证头 appid/appsecret + 空 body；原生直连不经代理以绕 CORS）
  async function httpPostParsed(url, headers, bodyObj) {
    if (CapHttp) {
      const resp = await CapHttp.post({ url, headers: headers || {}, data: bodyObj || {} });
      if (!resp || resp.status == null || resp.status < 200 || resp.status >= 300) {
        throw new Error('HTTP ' + (resp && resp.status != null ? resp.status : 'no-response'));
      }
      let body = resp.data;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) {} }
      return body;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(proxied(url), { method: 'POST', signal: ctrl.signal, headers: headers || {}, body: JSON.stringify(bodyObj || {}) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    clearTimeout(t);
    return r.json();
  }

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
  // siteCode：国家海洋信息中心(NMDIS) 站点代码（同 web 端 config.js，留空则降级模型）
  const TIDE_STATIONS = [
    { id: 'bhg',   name: '北海港',   lat: 21.48, lon: 109.07, datum: 0.0, warnLevel: 4.0, siteCode: '' },
    { id: 'tsg',   name: '铁山港',   lat: 21.40, lon: 109.47, datum: 0.0, warnLevel: 4.2, siteCode: '' },
    { id: 'wzd',   name: '涠洲岛',   lat: 21.05, lon: 109.10, datum: 0.0, warnLevel: 3.8, siteCode: '' },
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
    // 必须用 HTTPS（nmc 已支持且返回 Access-Control-Allow-Origin:*）。
    // 之前误用 http:// 明文，Android WebView 默认拦截明文流量，导致台风/区域告警在手机端取不到。
    typhoonList: 'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default',
    typhoonView: 'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_',
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
    return httpGetParsed(url, timeout);
  }
  function parseJSONP(text) {
    const m = text.match(/^\s*[\w$]+\s*\(+\s*([\s\S]*?)\s*\)+\s*;?\s*$/);
    if (!m) throw new Error('not JSONP');
    return JSON.parse(m[1]);
  }
  function fetchJSONP(url, timeout = 15000) {
    return httpGetText(url, timeout).then(parseJSONP);
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
  // 与 web 端 app/lib/tides.js 字段级一致：NMDIS 官方预报优先，缺凭据/站点代码时降级调和模型。
  const CONSTITUENTS = [
    { name: 'M2', amp: 1.9, period: 12.4206, phase: 1.2 },
    { name: 'S2', amp: 0.7, period: 12.0000, phase: 0.4 },
    { name: 'K1', amp: 0.4, period: 23.9345, phase: 3.1 },
    { name: 'O1', amp: 0.3, period: 25.8194, phase: 5.0 },
  ];
  const MEAN_LEVEL = 1.6;
  function tideAt(date, phaseOff) {
    const t = date.getTime() / 1000;
    let h = MEAN_LEVEL;
    for (const c of CONSTITUENTS) h += c.amp * Math.cos((2 * Math.PI * t) / (c.period * 3600) - c.phase + (phaseOff || 0));
    return +Math.max(0, h).toFixed(2); // 相对理论最低潮面(LAT)
  }
  function localDateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function sampleBase(base, startMs, ms) {
    const hr = (ms - startMs) / 3600000;
    if (hr <= 0) return base[0];
    if (hr >= base.length - 1) return base[base.length - 1];
    const i0 = Math.floor(hr), frac = hr - i0;
    return base[i0] + (base[i0 + 1] - base[i0]) * frac;
  }
  function buildSeries(base, startMs, nowMs, STEP_MIN = 15, HORIZON_H = 48) {
    const n = HORIZON_H * 60 / STEP_MIN, series = [];
    for (let i = 0; i <= n; i++) {
      const ms = nowMs + i * STEP_MIN * 60000;
      series.push({ t: new Date(ms).toISOString(), h: +sampleBase(base, startMs, ms).toFixed(2) });
    }
    return series;
  }
  function modelBase(st) {
    const phaseOff = (st.lon - 109.11) * 0.3;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const startMs = start.getTime(), base = [];
    for (let k = 0; k < 48; k++) base.push(tideAt(new Date(startMs + k * 3600000), phaseOff));
    return { base, startMs };
  }
  function modelExtremes(series) {
    const ext = [];
    for (let i = 1; i < series.length - 1; i++) {
      const a = series[i - 1].h, b = series[i].h, c = series[i + 1].h;
      if ((b > a && b >= c) || (b < a && b <= c)) ext.push({ time: series[i].t, h: b, type: b >= MEAN_LEVEL ? 'high' : 'low' });
    }
    return ext;
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
      const d = new Date(dateStr + 'T00:00:00');
      d.setHours(+parts[0], +(parts[1] || 0), 0, 0);
      extremes.push({ time: d.toISOString(), h: +(g / 100).toFixed(2), type: g >= 0 ? 'high' : 'low' });
    }
    return { hourly, extremes, benchmark: data.Benchmark || null };
  }
  function classifyExtremes(exts) {
    return exts.map((e, i) => {
      const prev = exts[i - 1] && exts[i - 1].h, next = exts[i + 1] && exts[i + 1].h;
      const isHigh = (prev == null || e.h > prev) && (next == null || e.h > next);
      return { time: e.time, h: e.h, type: isHigh ? 'high' : 'low' };
    });
  }
  function sampleSeries(series, ms) {
    const t0 = new Date(series[0].t).getTime();
    const f = (ms - t0) / (15 * 60000);
    if (f <= 0) return series[0].h;
    if (f >= series.length - 1) return series[series.length - 1].h;
    const i0 = Math.floor(f), frac = f - i0;
    return series[i0].h + (series[i0 + 1].h - series[i0].h) * frac;
  }
  function finalizeTide(st, series, rawExtremes, meta) {
    const nowMs = new Date(series[0].t).getTime();
    const lastMs = new Date(series[series.length - 1].t).getTime();
    const STEP_MS = 15 * 60000;
    const current = series[0].h;
    const h30 = sampleSeries(series, nowMs + 30 * 60000);
    const rate = +((h30 - current) / 0.5).toFixed(3);
    const trend = Math.abs(rate) < 0.02 ? 'flat' : (rate > 0 ? 'rising' : 'falling');
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
    const perHour = 60 / 15, hourly = [];
    for (let k = 0; k <= 24; k++) hourly.push(series[Math.min(k * perHour, series.length - 1)]);
    return {
      ok: true, source: meta.source, configured: meta.configured, model: !!meta.model, real: !!meta.real, degraded: !!meta.degraded,
      datumLabel: meta.datumLabel || '理论最低潮面 (LAT)',
      meanLevel, current, trend, rate, lowest, highest, range: +(highest - lowest).toFixed(2),
      warnLevel: st.warnLevel, margin: +(current - st.warnLevel).toFixed(2), exceeded: current >= st.warnLevel,
      series, extremes: ext, next, hourly,
    };
  }
  // NMDIS 请求（原生经 CapacitorHttp.post 直连；PWA 经 fetch+代理。认证头 appid/appsecret，空 body）
  // 带 8s 超时(Promise.race) + 单次重试；任意失败返回 null，由 getTide 降级模型
  const NMDIS_TIMEOUT_MS = 8000;
  function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('nmdis-timeout')), ms);
      Promise.resolve(p).then(resolve, reject).finally(() => clearTimeout(t));
    });
  }
  async function nmdisFetch(siteCode, dateStr, attempt = 0) {
    const url = `${API.nmdis}/api/v1/CoreData/GetPortTideData?SiteCode=${encodeURIComponent(siteCode)}&Date=${dateStr}`;
    const headers = { 'Content-Type': 'application/json', appid: NMDIS_APPID, appsecret: NMDIS_APPSECRET };
    try {
      const j = await withTimeout(httpPostParsed(url, headers, {}), NMDIS_TIMEOUT_MS);
      if (!j || j.ResultCode !== '200' || !j.ResultValue || !j.ResultValue.data) {
        if (attempt < 1) return nmdisFetch(siteCode, dateStr, attempt + 1);
        return null;
      }
      return j.ResultValue;
    } catch (e) {
      if (attempt < 1) return nmdisFetch(siteCode, dateStr, attempt + 1);
      return null;
    }
  }
  // 降级/兜底：调和模型估算；degraded=true 表示已配置 NMDIS 但请求失败，仅用于 UI 提示
  function modelFallback(st, degraded) {
    const { base, startMs } = modelBase(st);
    const series = buildSeries(base, startMs, Date.now());
    const rawExtremes = classifyExtremes(modelExtremes(series));
    return finalizeTide(st, series, rawExtremes, {
      source: degraded ? '官方预报不可用·已降级模型' : '调和模型估算(演示)',
      configured: !!degraded, model: true, real: false, degraded: !!degraded,
      datumLabel: '理论最低潮面 (LAT)',
    });
  }
  async function getTide(st) {
    if (NMDIS_APPID && NMDIS_APPSECRET && st.siteCode) {
      try {
        const today = new Date();
        const d0 = localDateStr(today), d1 = localDateStr(new Date(today.getTime() + 86400000));
        const [r0, r1] = await Promise.all([nmdisFetch(st.siteCode, d0), nmdisFetch(st.siteCode, d1)]);
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
              source: '国家海洋信息中心(预报)', configured: true, real: true,
              datumLabel: benchmark ? ('海图基准面：' + benchmark) : '理论最低潮面 (LAT)',
            });
          }
        }
        return modelFallback(st, true); // 已配置但无可用数据
      } catch (e) {
        return modelFallback(st, true); // 请求/超时/解析异常
      }
    }
    return modelFallback(st, false); // 未配置凭证/站点代码
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
      fetchRiverReservoir().catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchRegionalBeihai().catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchClimate(STATIONS[0]).catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchCmaLive({ lat: 21.48, lon: 109.11 }).catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchWttrLive({ lat: 21.48, lon: 109.11 }).catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchCaiyunLive({ lat: 21.48, lon: 109.11 }).catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchMetNoLive({ lat: 21.48, lon: 109.11 }).catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchWeatherCnLive({ lat: 21.48, lon: 109.11 }).catch(e => ({ ok: false, error: String(e.message || e) })),
      fetchCmaGovLive({ lat: 21.48, lon: 109.11 }).catch(e => ({ ok: false, error: String(e.message || e) })),
    ]);
    const [stationsAgg, tideRes, quakeRes, fireRes, tyRes, warnRes, rrRes, regionalRes, climateRes, cmaRes, wttrRes, caiyunRes, metnoRes, weathercnRes, cmagovRes] = results;
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
    // 区域告警情报（台风 + 气象预警 + 地震），供顶部"极端气候告警情报"滚动条与"北海气候解说"使用。
    // 原 Node 后端 server.js 通过 intel.buildAlertIntel 产出，浏览器版移植时漏接，导致情报条永远空白，此处补回。
    const alertIntel = buildAlertIntel({
      typhoons,
      warnings: (warnRes.status === 'fulfilled' && warnRes.value.ok) ? warnRes.value : { all: [] },
      quakes,
    });
    // ===== 对齐 server.js：多源实况交叉校核 + 静默应用覆盖 + 江河水库 / 区域天气 / 气候常年值 =====
    const primaryAgg = (stationsAgg.status === 'fulfilled') ? stationsAgg.value[0] : null;
    const cmaVal = (cmaRes && cmaRes.status === 'fulfilled') ? cmaRes.value : cmaRes;
    const wttrVal = (wttrRes && wttrRes.status === 'fulfilled') ? wttrRes.value : wttrRes;
    const caiyunVal = (caiyunRes && caiyunRes.status === 'fulfilled') ? caiyunRes.value : caiyunRes;
    const metnoVal = (metnoRes && metnoRes.status === 'fulfilled') ? metnoRes.value : metnoRes;
    const weathercnVal = (weathercnRes && weathercnRes.status === 'fulfilled') ? weathercnRes.value : weathercnRes;
    const cmagovVal = (cmagovRes && cmagovRes.status === 'fulfilled') ? cmagovRes.value : cmagovRes;
    const warnCtx = [
      ...((warnRes.status === 'fulfilled' && warnRes.value.ok && warnRes.value.rainstorm) ? warnRes.value.rainstorm : []).map(a => ({ category: a.catLabel || a.cat, level: a.levelNum || 0, levelName: a.level })),
      ...((warnRes.status === 'fulfilled' && warnRes.value.ok && warnRes.value.convective) ? warnRes.value.convective : []).map(a => ({ category: a.catLabel || a.cat, level: a.levelNum || 0, levelName: a.level })),
    ];
    const realtimeCheck = verifyRealtime({
      openMeteo: primaryAgg ? primaryAgg.weather : null,
      weathercn: weathercnVal, cma: cmaVal, wttr: wttrVal, caiyun: caiyunVal, cmagov: cmagovVal, metno: metnoVal,
    }, warnCtx, primaryAgg ? primaryAgg.air : null);
    const regionalWeather = (regionalRes && regionalRes.status === 'fulfilled') ? regionalRes.value : { ok: false, error: (regionalRes && regionalRes.reason) ? String(regionalRes.reason) : '区域天气采集失败' };
    const primaryClimate = (climateRes && climateRes.status === 'fulfilled') ? climateRes.value : null;
    const riverReservoir = (rrRes && rrRes.status === 'fulfilled') ? rrRes.value : { ok: false, error: 'unavailable' };
    applyRealtimeOverride(stations, alertIntel, cmaRes, wttrRes, caiyunRes, cmagovRes, weathercnRes);
    // ===================== 数据自检（diagnostics）=====================
    // 供屏上「数据自检」面板展示每个数据源的成功/失败，便于在 iOS 设备上确认
    // CapacitorHttp 原生 HTTP 修复是否生效，以及快速定位残留问题。
    const diag = [];
    const stationAgg = stationsAgg.status === 'fulfilled' ? stationsAgg.value : [];
    const sx = stationAgg.filter(s => s.weather && s.weather.ok).length;
    const sa = stationAgg.filter(s => s.air && s.air.ok).length;
    const sm = stationAgg.filter(s => s.marine && s.marine.ok).length;
    const sf = stationAgg.filter(s => s.flood && s.flood.ok).length;
    diag.push({
      name: 'Open-Meteo 站点(实时/空气/海洋/洪水)',
      ok: sx > 0,
      detail: `实时 ${sx}/${stationAgg.length} · 空气 ${sa} · 海洋 ${sm} · 洪水 ${sf}`,
    });
    diag.push({
      name: '潮汐/水位',
      ok: tideRes.status === 'fulfilled',
      detail: tideRes.status === 'fulfilled' ? `载入 ${tideList.length} 站` : String(tideRes.reason && (tideRes.reason.message || tideRes.reason)),
    });
    const quakeOk = quakeRes.status === 'fulfilled' && quakeRes.value.ok;
    diag.push({
      name: '地震 (USGS)',
      ok: quakeOk,
      detail: quakeRes.status === 'fulfilled' ? (quakeOk ? `事件 ${quakes.length}` : (quakeRes.value.error || '返回失败')) : String(quakeRes.reason && (quakeRes.reason.message || quakeRes.reason)),
    });
    let fireDetail;
    if (fireRes.status !== 'fulfilled') fireDetail = String(fireRes.reason && (fireRes.reason.message || fireRes.reason));
    else if (!fireRes.value.configured) fireDetail = '未配置 FIRMS_KEY（预期跳过）';
    else if (fireRes.value.ok) fireDetail = `火点 ${fires.length}`;
    else fireDetail = (fireRes.value.error || '返回失败');
    diag.push({ name: '野火 (NASA FIRMS)', ok: fireRes.status === 'fulfilled', detail: fireDetail });
    const tyOk = tyRes.status === 'fulfilled' && tyRes.value.ok;
    diag.push({
      name: '台风 (中央气象台)',
      ok: tyOk,
      detail: tyRes.status === 'fulfilled' ? (tyOk ? `活跃 ${typhoons.length}` : (tyRes.value.error || '返回失败')) : String(tyRes.reason && (tyRes.reason.message || tyRes.reason)),
    });
    const warnOk = warnRes.status === 'fulfilled' && warnRes.value.ok;
    diag.push({
      name: '预警 (中央气象台)',
      ok: warnOk,
      detail: warnRes.status === 'fulfilled' ? (warnOk ? `预警 ${warningsAll.length}` : (warnRes.value.error || '返回失败')) : String(warnRes.reason && (warnRes.reason.message || warnRes.reason)),
    });
    // WebView 来源与请求通道：iOS 源固定为 capacitor://localhost（无法改 https），
    // 但启用 CapacitorHttp 后 fetch 走原生 HTTP，不再受 CORS 限制。
    const origin = (typeof window !== 'undefined' && window.location) ? (window.location.protocol + '//' + window.location.host) : 'unknown';
    const transport = (IS_NATIVE && CapHttp) ? '原生 HTTP (CapacitorHttp)' : (IS_NATIVE ? '原生壳(未启用CapacitorHttp)' : 'WebView fetch (Web/PWA)');
    diag.push({ name: '请求通道', ok: true, info: true, detail: transport + ' ｜ 源 ' + origin });

    return {
      diag,
      updated: new Date().toISOString(),
      center: { name: '北海', lat: 21.48, lon: 109.11 },
      maxLevel: globalAlerts.reduce((m, x) => Math.max(m, x.level), 0),
      maxLevelName: levelName(globalAlerts.reduce((m, x) => Math.max(m, x.level), 0)),
      boundary: BEIHAI_BOUNDARY,
      stations, tides: tideList,
      earthquakes: { ok: quakeRes.status === 'fulfilled' && quakeRes.value.ok, count: quakes.length, events: quakes.slice(0, 12) },
      fires: { ok: fireRes.status === 'fulfilled' && fireRes.value.ok, configured: !!(fireRes.status === 'fulfilled' && fireRes.value.configured), count: fires.length, fires: fires.slice(0, 50) },
      typhoon: { ok: tyRes.status === 'fulfilled' && tyRes.value.ok, count: typhoons.length, typhoons },
      warnings: {
        ok: warnRes.status === 'fulfilled' && warnRes.value.ok, count: warningsAll.length, all: warningsAll,
        typhoon: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.typhoon : [],
        rainstorm: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.rainstorm : [],
        geological: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.geological : [],
        convective: warnRes.status === 'fulfilled' && warnRes.value.ok ? warnRes.value.convective : [],
      },
      riverReservoir,
      astronomy: astronomicalEvents(),
      alertIntel,
      realtimeCheck,
      regionalWeather,
      primaryClimate,
      globalAlerts,
    };
  }

  // ===================== 浏览器版补齐：对齐 server.js 最新聚合（多源实况校核 / 江河水库 / 区域天气 / 气候常年值）=====================
  // 以下函数移植自 app/lib/sources.js 与 app/server.js，改为浏览器原生 HTTP（CapHttp）实现，
  // 与 web 端 server.js 保持字段级一致，使安卓/iOS 端 buildOverview() 返回结构完全对齐。

  // ---- 文本 → WMO 代码 映射 ----
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
  function enToWmo(text) {
    const t = String(text || '').toLowerCase();
    if (/thunder|lightning|storm/.test(t)) return { code: 95, zh: '雷阵雨' };
    if (/rain|drizzle|shower/.test(t)) return { code: 61, zh: '雨' };
    if (/snow|sleet/.test(t)) return { code: 71, zh: '雪' };
    if (/fog|mist|haze/.test(t)) return { code: 45, zh: '雾' };
    if (/clear|sunny/.test(t)) return { code: 0, zh: '晴' };
    if (/cloud|overcast/.test(t)) return { code: 3, zh: '多云' };
    return { code: 3, zh: '多云' };
  }
  // 和风天气 QWeather 实况（CMA 官方分发，需 QWEATHER_KEY；浏览器端取自 window.ALPHASUN_CONFIG）
  async function qweatherNow(s) {
    const key = RAW.QWEATHER_KEY || '';
    if (!key) return null;
    const host = RAW.QWEATHER_HOST || 'devapi.qweather.com';
    const loc = `${s.lon.toFixed(3)},${s.lat.toFixed(3)}`;
    const url = `https://${host}/v7/weather/now?location=${loc}&key=${encodeURIComponent(key)}`;
    const d = await httpGetParsed(url, 12000);
    if (!d || String(d.code) !== '200' || !d.now) throw new Error('qweather: ' + (d && d.code) + ' ' + (d && d.message || ''));
    const n = d.now;
    let uvIdx = null;
    try {
      const uj = await httpGetParsed(`https://${host}/v7/indices/uv?location=${loc}&key=${encodeURIComponent(key)}`, 12000);
      if (uj && String(uj.code) === '200' && uj.now) uvIdx = parseFloat(uj.now.index);
    } catch (e) { /* uv 可选 */ }
    const zh = String(n.text || '').trim();
    const code = zhWeatherToWmo(zh);
    const wind = (parseFloat(n.windSpeed) || 0) / 3.6; // km/h -> m/s
    return {
      ok: true, source: 'cma', label: '和风天气(QWeather)', time: n.obsTime || null,
      current: {
        time: new Date().toISOString().slice(0, 16),
        temp: parseFloat(n.temp), feels: parseFloat(n.feelsLike),
        rh: parseInt(n.humidity, 10) || 0, precip: parseFloat(n.precip) || 0,
        code, text: zh || wmo(code)[0], icon: wmo(code)[1],
        wind, gust: 0, windDir: dirToDeg(n.windDir),
        pressure: parseFloat(n.pressure) || 0, cloud: parseInt(n.cloud, 10) || 100, isDay: 1,
        uv: (typeof uvIdx === 'number' && !isNaN(uvIdx)) ? +uvIdx.toFixed(1) : null,
        vis: (n.vis != null ? parseFloat(n.vis) : null),
      },
    };
  }

  // ===== 多源实况（国内权威源，参与交叉校核；免 key 源失败则优雅跳过）=====
  async function fetchCmaLive(s) {
    const lat = (s && typeof s.lat === 'number') ? s.lat : 21.48;
    const lon = (s && typeof s.lon === 'number') ? s.lon : 109.11;
    const qw = await qweatherNow({ lat, lon }).catch(() => null);
    if (qw) return qw;
    const CITY = '101301301';
    try {
      const text = await httpGetText(`http://d1.weather.com.cn/sk_${CITY}.html`, 12000);
      const m = text.match(/var\s+dataSK\s*=\s*(\{[\s\S]*?\})\s*;?/);
      if (!m) return { ok: false, error: 'cma: 公开接口已停用(需配置 QWEATHER_KEY)', skipped: !RAW.QWEATHER_KEY };
      const j = JSON.parse(m[1]);
      const zh = String(j.weather || '').trim();
      const code = zhWeatherToWmo(zh);
      const wmoPair = wmo(code);
      const rh = parseInt(j.SD, 10);
      const precip = parseFloat(j.rain);
      const wind = parseFloat(String(j.WS || '0').replace(/[^0-9.]/g, ''));
      return {
        ok: true, source: 'cma', city: CITY, time: j.time,
        current: { time: new Date().toISOString().slice(0, 16), temp: parseFloat(j.temp), feels: parseFloat(j.temp), rh: isNaN(rh) ? null : rh, precip: isNaN(precip) ? 0 : precip, code, text: zh || wmoPair[0], icon: wmoPair[1], wind: isNaN(wind) ? 0 : wind, gust: 0, windDir: dirToDeg(j.WD), pressure: 0, cloud: 100, isDay: 1 },
      };
    } catch (e) { return { ok: false, error: 'cma fetch failed: ' + (e.message || e), skipped: !RAW.QWEATHER_KEY }; }
  }
  async function fetchWeatherCnLive(s) {
    const CITY = '101301301';
    try {
      const text = await httpGetText(`https://d1.weather.com.cn/sk_2d/${CITY}.html`, 12000);
      const m = text.match(/var\s+dataSK\s*=\s*(\{[\s\S]*?\})\s*;?/);
      if (!m) return { ok: false, error: 'weathercn: 无 dataSK（接口不可用）' };
      const j = JSON.parse(m[1]);
      const zh = String(j.weather || '').trim();
      const code = zhWeatherToWmo(zh);
      const wmoPair = wmo(code);
      const rh = parseInt(j.SD, 10);
      const precip = parseFloat(j.rain);
      const scale = parseFloat(String(j.WS || '0').replace(/[^0-9.]/g, '')) || 0;
      const wind = windScaleToMs(scale);
      const pressure = parseFloat(j.qy) || 0;
      return {
        ok: true, source: 'weathercn', label: '中国天气网(国家气象中心)', time: j.time,
        current: { time: new Date().toISOString().slice(0, 16), temp: parseFloat(j.temp), feels: parseFloat(j.temp), rh: isNaN(rh) ? null : rh, precip: isNaN(precip) ? 0 : precip, code, text: zh || wmoPair[0], icon: wmoPair[1], wind, gust: 0, windDir: dirToDeg(j.WD), pressure: pressure > 0 ? pressure : 0, cloud: 100, isDay: 1, uv: null, vis: null },
      };
    } catch (e) { return { ok: false, error: 'weathercn fetch: ' + (e.message || e) }; }
  }
  async function fetchCmaGovLive(s) {
    const STATION = '59644';
    try {
      const j = await httpGetParsed(`https://weather.cma.cn/api/weather/view?stationid=${STATION}`, 12000);
      const now = j && j.data && j.data.now;
      if (!now || typeof now.temperature !== 'number') return { ok: false, error: 'cmagov: 无实况 now 字段' };
      const temp = +now.temperature;
      const rh = (typeof now.humidity === 'number') ? Math.round(now.humidity) : null;
      const pressure = (typeof now.pressure === 'number') ? Math.round(now.pressure) : 0;
      const precip = (typeof now.precipitation === 'number') ? now.precipitation : 0;
      const wind = (typeof now.windSpeed === 'number') ? now.windSpeed : 0;
      const windDir = (typeof now.windDirectionDegree === 'number' && now.windDirectionDegree < 900) ? now.windDirectionDegree : 0;
      const code = (precip > 0.1) ? 61 : 3;
      return {
        ok: true, source: 'cmagov', label: '中国气象局(CMA)', time: null,
        current: { time: new Date().toISOString().slice(0, 16), temp, feels: temp, rh, precip: isNaN(precip) ? 0 : precip, code, text: code === 61 ? '雨' : '多云', icon: wmo(code)[1], wind, gust: 0, windDir, pressure: pressure > 0 ? pressure : 0, cloud: 100, isDay: 1, uv: null, vis: null },
      };
    } catch (e) { return { ok: false, error: 'cmagov fetch: ' + (e.message || e) }; }
  }
  async function fetchWttrLive(s) {
    try {
      const text = await httpGetText(`https://wttr.in/${s.lat.toFixed(2)},${s.lon.toFixed(2)}?format=j1`, 12000);
      const d = JSON.parse(text);
      const c = d.current_condition && d.current_condition[0];
      if (!c) return { ok: false, error: 'wttr: no current_condition' };
      const desc = (c.weatherDesc && c.weatherDesc[0] && c.weatherDesc[0].value) || '';
      const m = enToWmo(desc);
      return {
        ok: true, source: 'wttr', label: 'wttr.in', time: c.localObsDateTime || null,
        current: { temp: parseFloat(c.temp_C), feels: parseFloat(c.FeelsLikeC), rh: parseInt(c.humidity, 10) || 0, precip: parseFloat(c.precipMM) || 0, code: m.code, text: m.zh, icon: wmo(m.code)[1], wind: (parseFloat(c.windspeedKmph) || 0) / 3.6, gust: 0, windDir: parseFloat(c.winddirDegree) || 0, pressure: 0, cloud: parseInt(c.cloudcover, 10) || 0, isDay: 1, uv: (c.uvIndex != null ? parseFloat(c.uvIndex) : null), vis: (c.visibility != null ? parseFloat(c.visibility) : null) },
      };
    } catch (e) { return { ok: false, error: 'wttr fetch: ' + (e.message || e) }; }
  }
  async function fetchCaiyunLive(s) {
    const token = RAW.CAIYUN_TOKEN || '';
    if (!token) return { ok: false, error: '未配置 CAIYUN_TOKEN（可选中国源）', skipped: true };
    const lat = (s && typeof s.lat === 'number') ? s.lat : 21.48;
    const lon = (s && typeof s.lon === 'number') ? s.lon : 109.11;
    const url = `https://api.caiyunapp.com/v2.6/${token}/${lon.toFixed(4)},${lat.toFixed(4)}/realtime.json`;
    const d = await httpGetParsed(url, 12000);
    const rt = (d && d.result && d.result.realtime) || {};
    const sky = caiyunSkyconToWmo(rt.skycon);
    const rh = (typeof rt.humidity === 'number') ? Math.round(rt.humidity * 100) : 0;
    const cloud = (typeof rt.cloudrate === 'number') ? Math.round(rt.cloudrate * 100) : 100;
    const windObj = (rt.wind && typeof rt.wind === 'object') ? rt.wind : null;
    const wind = windObj ? (parseFloat(windObj.speed) || 0) : 0;
    const windDir = windObj ? (parseFloat(windObj.direction) || 0) : 0;
    let precip = 0;
    if (rt.precipitation && typeof rt.precipitation === 'object') precip = parseFloat(rt.precipitation.local) || 0;
    else if (typeof rt.precipitation === 'number') precip = rt.precipitation;
    return {
      ok: true, source: 'caiyun', label: '彩云天气(Caiyun)', time: null,
      current: { time: new Date().toISOString().slice(0, 16), temp: parseFloat(rt.temperature), feels: parseFloat(rt.apparent_temperature != null ? rt.apparent_temperature : rt.temperature), rh, precip: isNaN(precip) ? 0 : precip, code: sky.code, text: sky.zh, icon: wmo(sky.code)[1], wind, gust: 0, windDir, pressure: 0, cloud, isDay: 1 },
    };
  }
  async function fetchMetNoLive(s) {
    const lat = (s && typeof s.lat === 'number') ? s.lat : 21.48;
    const lon = (s && typeof s.lon === 'number') ? s.lon : 109.11;
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const d = await httpGetParsed(url, 12000);
    const ts = (d && d.properties && d.properties.timeseries && d.properties.timeseries[0]);
    if (!ts) return { ok: false, error: 'metno: 无 timeseries' };
    const ins = ts.data.instant.details;
    const temp = ins.air_temperature;
    const wind = (ins.wind_speed != null) ? ins.wind_speed : 0;
    const windDir = (ins.wind_from_direction != null) ? ins.wind_from_direction : 0;
    const rh = (ins.relative_humidity != null) ? Math.round(ins.relative_humidity) : null;
    const pressure = (ins.air_pressure_at_sea_level != null) ? +ins.air_pressure_at_sea_level.toFixed(0) : 0;
    const cloud = (ins.cloud_area_fraction != null) ? Math.round(ins.cloud_area_fraction) : 100;
    const gust = (ins.wind_speed_of_gust != null) ? ins.wind_speed_of_gust : 0;
    let code = 3, text = '多云';
    if (cloud < 20) { code = 0; text = '晴'; }
    else if (cloud < 50) { code = 2; text = '局部多云'; }
    else if (cloud >= 85) { code = 3; text = '阴'; }
    const n1 = (ts.data.next_1_hours && ts.data.next_1_hours.details && ts.data.next_1_hours.details.precipitation_amount);
    if (typeof n1 === 'number' && n1 > 0.1) { code = 61; text = '雨'; }
    return {
      ok: true, source: 'metno', label: '挪威气象局(yr.no)', time: ts.time || null,
      current: { time: new Date().toISOString().slice(0, 16), temp, feels: temp, rh, precip: (typeof n1 === 'number' ? n1 : 0), code, text, icon: wmo(code)[1], wind, gust, windDir, pressure, cloud, isDay: 1, uv: null, vis: null, realtimeSource: 'MET Norway (yr.no)' },
    };
  }
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
  function windScaleToMs(scale) {
    const T = [0, 0.9, 2.45, 4.35, 6.7, 9.35, 12.3, 15.5, 19.0, 22.6, 26.5, 29.5, 32.5];
    if (!(scale > 0)) return 0;
    if (scale >= T.length) return 35;
    return T[scale];
  }
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
      uv: (typeof c.uv === 'number' && !isNaN(c.uv)) ? c.uv : null,
      fetchedAt: v.time || null, category: wxCategory(c.code, c.text),
    };
  }
  // 多数据源实况交叉校核（与 server.js verifyRealtime 字段级一致）
  function verifyRealtime(results, warnings, air) {
    const srcs = [
      snapOf(results.openMeteo, 'Open-Meteo', 'openmeteo'),
      snapOf(results.weathercn, '中国天气网(国家气象中心)', 'weathercn'),
      snapOf(results.cma, '和风天气(QWeather)', 'cma'),
      snapOf(results.wttr, 'wttr.in', 'wttr'),
      snapOf(results.caiyun, '彩云天气(Caiyun)', 'caiyun'),
      snapOf(results.cmagov, '中国气象局(CMA)', 'cmagov'),
      snapOf(results.metno, '挪威气象局(yr.no)', 'metno'),
    ];
    const valid = srcs.filter(s => s.ok);
    const uvs = valid.map(s => s.uv).filter(x => typeof x === 'number' && !isNaN(x));
    const uvMean = uvs.length ? +(uvs.reduce((a, b) => a + b, 0) / uvs.length).toFixed(1) : null;
    const uvMin = uvs.length ? +Math.min.apply(null, uvs).toFixed(1) : null;
    const uvMax = uvs.length ? +Math.max.apply(null, uvs).toFixed(1) : null;
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
    const rhSpread = rhs.length > 1 ? Math.max.apply(null, rhs) - Math.min.apply(null, rhs) : 0;
    const winds = valid.map(s => s.wind).filter(x => typeof x === 'number' && !isNaN(x));
    const windSpread = winds.length > 1 ? Math.max.apply(null, winds) - Math.min.apply(null, winds) : 0;
    const presses = valid.map(s => s.pressure).filter(x => typeof x === 'number' && !isNaN(x) && x > 0);
    const presSpread = presses.length > 1 ? Math.max.apply(null, presses) - Math.min.apply(null, presses) : 0;
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
    if (presSpread > 4) {
      discrepancies.push({ field: 'pressure', message: '气压源间差异较大（' + Math.min.apply(null, presses).toFixed(0) + '~' + Math.max.apply(null, presses).toFixed(0) + 'hPa）', severity: 'low' });
      if (agreement === 'high') agreement = 'medium';
    }
    if (uvs.length >= 2) {
      const uspread = uvMax - uvMin;
      if (uspread > 3) { discrepancies.push({ field: 'uv', message: '紫外线指数源间差异较大（' + uvMin.toFixed(1) + '~' + uvMax.toFixed(1) + '）', severity: 'low' }); if (agreement === 'high') agreement = 'medium'; }
    }
    if (warnings && warnings.length) {
      const storm = warnings.find(a => /暴雨|雷雨|强对流|大风/.test(a.category || '') && (a.level || 0) >= 2);
      if (storm && consensusCat !== 'rain' && consensusCat !== 'storm') {
        discrepancies.push({ field: 'warning', message: '官方预警佐证降雨（' + (storm.levelName || '') + '），综合判定上调为降雨', severity: 'low' });
        consensusCat = 'rain'; conf = Math.min(1, conf + 0.1);
        if (agreement === 'low') agreement = 'medium';
      }
    }
    conf = Math.max(0, Math.min(1, +conf.toFixed(2)));
    const fields = [
      { key: 'temp', label: '气温', unit: '℃', vals: valid.map(s => ({ label: s.label, v: (s.temp != null ? +s.temp.toFixed(1) : null) })), spread: +spread.toFixed(1), consistent: spread <= 1.5 },
      { key: 'rh', label: '湿度', unit: '%', vals: valid.map(s => ({ label: s.label, v: (s.rh != null ? s.rh : null) })), spread: +rhSpread.toFixed(0), consistent: rhSpread <= 12 },
      { key: 'wind', label: '风速', unit: 'm/s', vals: valid.map(s => ({ label: s.label, v: (s.wind != null ? +s.wind.toFixed(1) : null) })), spread: +windSpread.toFixed(1), consistent: windSpread <= 2.5 },
      { key: 'pressure', label: '气压', unit: 'hPa', vals: valid.map(s => ({ label: s.label, v: (s.pressure > 0 ? s.pressure : null) })), spread: +presSpread.toFixed(0), consistent: presSpread <= 4 },
      { key: 'precip', label: '降水', unit: 'mm', vals: valid.map(s => ({ label: s.label, v: (s.precip != null ? +s.precip.toFixed(1) : null) })), spread: 0, consistent: true },
    ];
    const rec = valid.find(s => s.source === 'cma') || valid.find(s => s.category === consensusCat) || valid[0];
    const recommended = { temp: +tmean.toFixed(1), rh: rhMean, precip: +precipMax.toFixed(1), code: rec.code, text: rec.text, icon: rec.icon, source: rec.label };
    return {
      ok: true, checkedAt, city: '北海', sources: srcs, fields,
      consensus: { category: consensusCat, tempMin: +tmin.toFixed(1), tempMax: +tmax.toFixed(1), tempMean: +tmean.toFixed(1), tempSpread: +spread.toFixed(1), rhMean, precipAny, precipMax: +precipMax.toFixed(1), uvMean, uvMin, uvMax },
      agreement, confidence: conf, discrepancies, recommended,
      air: (air && air.ok) ? { aqi: air.aqi, primary: air.primary, pm25: air.pm25, pm10: air.pm10, o3: air.o3 } : null,
    };
  }
  function parseAlertTime(t) {
    if (!t) return 0;
    const m = String(t).match(/(\d{4})\D(\d{2})\D(\d{2})\D(\d{2})\D(\d{2})/);
    if (!m) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  }
  // 将多源实况校验结果静默应用到实时天气（不改变展示样式）；与 server.js applyRealtimeOverride 一致
  function applyRealtimeOverride(stations, alertIntel, cmaRes, wttrRes, caiyunRes, cmagovRes, weathercnRes) {
    const cma = (cmaRes && cmaRes.status === 'fulfilled') ? cmaRes.value : null;
    const cmaOk = !!(cma && cma.ok && cma.current);
    const wttr = (wttrRes && wttrRes.status === 'fulfilled') ? wttrRes.value : null;
    const wttrOk = !!(wttr && wttr.ok && wttr.current);
    const cmagov = (cmagovRes && cmagovRes.status === 'fulfilled') ? cmagovRes.value : null;
    const cmagovOk = !!(cmagov && cmagov.ok && cmagov.current);
    const weathercn = (weathercnRes && weathercnRes.status === 'fulfilled') ? weathercnRes.value : null;
    const weathercnOk = !!(weathercn && weathercn.ok && weathercn.current);
    const items = (alertIntel && alertIntel.items) || [];
    const now = Date.now();
    const storm = items.find(a =>
      a.beihaiRelation === 'direct' &&
      /暴雨|雷雨|强对流|大风/.test(a.category || '') &&
      (a.level || 0) >= 2 &&
      parseAlertTime(a.time) && (now - parseAlertTime(a.time)) < 6 * 3600e3
    );
    for (const st of stations) {
      if (!st.weather || !st.weather.ok || !st.weather.current) continue;
      const cur = st.weather.current;
      let live = null, liveSrc = '', liveKey = '';
      if (cmagovOk) { live = cmagov.current; liveSrc = '中国气象局实况'; liveKey = 'cmagov'; }
      else if (weathercnOk) { live = weathercn.current; liveSrc = '中国天气网实况'; liveKey = 'weathercn'; }
      else if (cmaOk) { live = cma.current; liveSrc = '和风天气实况'; liveKey = 'cma'; }
      else if (wttrOk) { live = wttr.current; liveSrc = 'wttr.in 实况'; liveKey = 'wttr'; }
      if (live) {
        Object.assign(cur, {
          temp: live.temp, feels: live.feels, rh: live.rh, precip: live.precip,
          code: live.code, text: live.text, icon: live.icon, wind: live.wind, windDir: live.windDir,
          uv: (live.uv != null ? live.uv : cur.uv), vis: (live.vis != null ? live.vis : cur.vis),
          source: liveKey, realtimeSource: liveSrc,
        });
      }
      if (storm) {
        cur.warningOverride = { title: storm.title, level: storm.levelName, time: storm.time, active: true };
        if (!live) {
          cur.code = 95;
          cur.text = (storm.category || '暴雨').replace('·汛情', '');
          cur.icon = 'storm';
          cur.source = 'warning-override';
          cur.realtimeSource = '预警优先·实况以气象台预警为准(预估)';
        } else {
          cur.realtimeSource = liveSrc + '（预警生效中）';
        }
      }
    }
  }

  // ===== 江河 · 水库 权威档案（与 lib/config.js 一致；实时站测不可达则降级为档案）=====
  const RIVER_PROFILE = [
    { name: '南流江', type: '独流入海河流', lenKm: 287, basinKm2: 8635, outfall: '合浦县廉州湾(北部湾)', basin: '玉林·博白·合浦', stations: ['博白', '合浦'], note: '广西最大独流入海河，北海最重要江河', verified: true, src: '广西水文中心' },
    { name: '洪潮江', type: '南流江支流', outfall: '注入洪潮江水库', basin: '合浦县西北部', note: '南流江支流，上建洪潮江水库', verified: true, src: '北海新闻网' },
    { name: '西门江', type: '独流入海河流', outfall: '合浦县廉州湾', basin: '合浦县城(廉州镇)', note: '合浦县城主要河流', verified: false, src: '北海市水利局' },
    { name: '白沙河', type: '独流入海河流', outfall: '合浦县白沙镇入海', basin: '合浦县', note: '', verified: false, src: '待核实' },
    { name: '公馆河', type: '独流入海河流', outfall: '合浦县公馆镇入海', basin: '合浦县', note: '', verified: false, src: '待核实' },
    { name: '南康江', type: '独流入海河流', outfall: '铁山港区铁山港', basin: '铁山港区', note: '', verified: false, src: '待核实' },
    { name: '福成河', type: '独流入海河流', outfall: '银海区福成镇入海', basin: '银海区', note: '', verified: false, src: '待核实' },
    { name: '三合口江', type: '独流入海河流', outfall: '银海区', basin: '银海区平阳镇', note: '牛尾岭水库所在河流', verified: true, src: '北海市政府' },
  ];
  const RESERVOIR_PROFILE = [
    { name: '洪潮江水库', scale: '大(2)型', county: '合浦县星岛湖镇', river: '南流江支流洪潮江', totalCapM3: 7.03e8, effectiveCapM3: 2.93e8, basinKm2: 402, built: 1964, func: '灌溉/供水/防洪/发电/旅游', drinking: true, note: '北海重要饮用水源地、合浦县城主要供水源；别名星岛湖，国家级水利风景区；2025-12除险加固投运', verified: true, src: '北海新闻网/快懂百科' },
    { name: '牛尾岭水库', scale: '中型', county: '银海区平阳镇孙东村', river: '三合口江上游', totalCapM3: 2550e4, effectiveCapM3: 1755e4, basinKm2: 24.28, built: 1964, func: '灌溉/防洪/供水/发电/养殖', drinking: true, note: '北海市区唯一在用湖库型饮用水水源地(供北郊水厂，约20万人)', verified: true, src: '北海市政府' },
    { name: '鲤鱼地水库', scale: '中型', county: '北海市郊', river: '', totalCapM3: null, note: '城区重要水库(参数待核实)', verified: false, src: '待核实' },
    { name: '石康水库', scale: '中型', county: '合浦县石康镇', river: '', totalCapM3: null, note: '参数待核实', verified: false, src: '待核实' },
    { name: '闸口水库', scale: '中型', county: '合浦县闸口镇', river: '', totalCapM3: null, note: '参数待核实', verified: false, src: '待核实' },
  ];
  async function fetchRiverReservoir() {
    let realtimeStatus = 'unreachable';
    try {
      const r = await httpGetText('http://swzx.gxzf.gov.cn/swfw/sqfw/sssq/', 5000);
      realtimeStatus = (r && r.length) ? 'reachable' : 'blocked';
    } catch (e) { realtimeStatus = 'unreachable'; }
    return {
      ok: true, realtime: false, realtimeStatus,
      source: '广西水文中心 / 北海市政府 / 北海新闻网 等公开资料整理（非实时站测）',
      updated: '2026-08-27',
      rivers: RIVER_PROFILE, reservoirs: RESERVOIR_PROFILE,
    };
  }

  // ===== 北海区域天气（多区县点聚合；与 lib/sources.js fetchRegionalBeihai 一致）=====
  const BEIHAI_REGION = [
    { name: '海城区(市区)', lat: 21.48, lon: 109.11 },
    { name: '银海区', lat: 21.43, lon: 109.07 },
    { name: '铁山港区', lat: 21.58, lon: 109.45 },
    { name: '合浦县', lat: 21.66, lon: 109.20 },
    { name: '涠洲岛', lat: 21.04, lon: 109.10 },
  ];
  async function fetchOneRegionPoint(p) {
    const url = qs(API.forecast, {
      latitude: p.lat, longitude: p.lon,
      current: 'temperature_2m,weather_code,precipitation,wind_speed_10m,relative_humidity_2m',
      timezone: 'Asia/Shanghai',
    });
    const d = await fetchJSON(url);
    const cur = d.current;
    return {
      name: p.name, lat: p.lat, lon: p.lon,
      temp: cur.temperature_2m, code: cur.weather_code,
      text: wmo(cur.weather_code)[0], icon: wmo(cur.weather_code)[1],
      precip: cur.precipitation || 0, wind: cur.wind_speed_10m || 0, rh: cur.relative_humidity_2m,
    };
  }
  async function fetchRegionalBeihai() {
    const pts = await Promise.allSettled(BEIHAI_REGION.map(fetchOneRegionPoint));
    const points = pts.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!points.length) return { ok: false, error: '北海区域天气采集失败（全部点不可达）' };
    const temps = points.map(p => p.temp).filter(x => typeof x === 'number');
    const tmin = Math.min.apply(null, temps), tmax = Math.max.apply(null, temps);
    const catCount = {};
    points.forEach(p => { const cat = wxCategory(p.code, p.text); catCount[cat] = (catCount[cat] || 0) + 1; });
    const dominantCat = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0];
    const precipAny = points.some(p => (p.precip || 0) > 0.3);
    const windMax = Math.max.apply(null, [0].concat(points.map(p => p.wind || 0)));
    return {
      ok: true, count: points.length, points,
      tempMin: +tmin.toFixed(1), tempMax: +tmax.toFixed(1), tempMean: +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1),
      dominantCat, precipAny, windMax: +windMax.toFixed(1),
    };
  }

  // 替代 /api/time（毫秒精度，本地时钟）
  function now() { return Promise.resolve({ now: Date.now(), iso: new Date().toISOString() }); }

  // 暴露全局接口
  window.AlphaData = {
    buildOverview, now, getClimate, getJson: (url, timeout) => httpGetParsed(url, timeout),
    STATIONS, TIDE_STATIONS, CENTER, API, GEO, PROV_GEO, WARN_CAT, WARN_LEVEL,
    THRESHOLDS, WMO, wmo, moonPhaseDesc, BEIHAI_BOUNDARY, BEIHAI_NAMES, GUANGXI_CITIES,
    tyIntensity, tyLevel, regionOf, beihaiRelationFor, buildAlertIntel, levelName, levelColor,
  };
})();
