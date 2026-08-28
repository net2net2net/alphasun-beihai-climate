// AlphaSun · 极端天气告警规则引擎
// 5 级：0 正常 / 1 注意 / 2 预警 / 3 警报 / 4 紧急
const { THRESHOLDS, CENTER, tyIntensity, WARN_LEVEL } = require('./config');

const LEVEL = [
  { lv: 0, name: '正常', color: '#3fb950', bg: 'rgba(63,185,80,.15)' },
  { lv: 1, name: '注意', color: '#d29922', bg: 'rgba(210,153,34,.15)' },
  { lv: 2, name: '预警', color: '#fb8500', bg: 'rgba(251,133,0,.18)' },
  { lv: 3, name: '警报', color: '#e5484d', bg: 'rgba(229,72,77,.20)' },
  { lv: 4, name: '紧急', color: '#bc1a1a', bg: 'rgba(188,26,26,.28)' },
];
const levelName = lv => (LEVEL[lv] || LEVEL[0]).name;
const levelColor = lv => (LEVEL[lv] || LEVEL[0]).color;

// dir 'up'：值越大越危险；'down'：值越小越危险
function levelFor(value, def, dir = 'up') {
  if (value === null || value === undefined || isNaN(value)) return 0;
  let lv = 0;
  def.levels.forEach((th, i) => {
    const hit = dir === 'up' ? value >= th : value <= th;
    if (hit) lv = i + 1;
  });
  return lv;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 单站点综合研判
function evaluateStation(st) {
  const items = [];
  const w = st.weather, a = st.air;
  if (w && w.ok) {
    push(items, '大风', levelFor(w.current.wind, THRESHOLDS.windSpeed, 'up'),
      `平均风速 ${w.current.wind?.toFixed(1)} m/s`, 'w', st);
    push(items, '阵风', levelFor(w.current.gust, THRESHOLDS.windGust, 'up'),
      `阵风 ${w.current.gust?.toFixed(1)} m/s`, 'w', st);
    push(items, '强降水', levelFor(w.current.precip, THRESHOLDS.precipitation, 'up'),
      `小时降水 ${w.current.precip?.toFixed(1)} mm`, 'r', st);
    push(items, '高温', levelFor(w.current.temp, THRESHOLDS.tempHigh, 'up'),
      `气温 ${w.current.temp?.toFixed(1)} ℃`, 'h', st);
    push(items, '低温', levelFor(w.current.temp, THRESHOLDS.tempLow, 'down'),
      `气温 ${w.current.temp?.toFixed(1)} ℃`, 'c', st);
  }
  if (a && a.ok) {
    push(items, '空气污染', levelFor(a.aqi, THRESHOLDS.aqi, 'up'),
      `AQI ${a.aqi}（首要 ${a.primary}）`, 'a', st);
  }
  const max = items.reduce((m, x) => Math.max(m, x.level), 0);
  return { level: max, levelName: levelName(max), color: levelColor(max), items };
}
function push(arr, type, lv, detail, cat, st) {
  if (lv <= 0) return;
  arr.push({
    type, level: lv, levelName: levelName(lv), color: levelColor(lv),
    detail, category: cat, station: st.name, stationId: st.id,
    advice: ADVICE[type]?.[lv] || '',
    adviceDetail: detailFor(type, lv),
    url: srcUrlFor(type),
  });
}

// 处置建议（按灾种+等级，通用应急口径）
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

// 原始发布来源（按灾种映射到权威官方站点；外部源自带 url 时优先用其 url）
function srcUrlFor(type) {
  const M = {
    '大风': 'http://gx.cma.gov.cn/', '阵风': 'http://gx.cma.gov.cn/',
    '强降水': 'http://www.12379.cn/', '高温': 'http://gx.cma.gov.cn/', '低温': 'http://gx.cma.gov.cn/',
    '空气污染': 'https://www.nmc.cn/', '野火': 'https://firms.modaps.eosdis.nasa.gov/',
    '汛情': 'http://www.12379.cn/', '风暴潮': 'http://www.nmdis.org.cn/',
    '台风': 'https://www.nmc.cn/publish/typhoon/', '地质灾害': 'http://www.12379.cn/',
    '龙卷': 'http://www.12379.cn/', '地震': 'https://earthquake.usgs.gov/',
  };
  return M[type] || 'https://www.nmc.cn/';
}

// 详细处置建议（按灾种+等级，可点击展开的更完整处置指引；对应 ADVICE 的简要版）
const ADVICE_DETAIL = {
  '大风': [
    '巡查变电站与杆塔周边高空悬挂物、广告牌，紧固松动部件；户外作业穿戴防风装备，关注阵风突变。',
    '停止高空、临边及吊装作业；加固脚手架、临时围栏与轻质构筑物；清理线路走廊异物与树障，预置清障工具。',
    '预置应急抢修队伍及发电车、照明、沙袋等物资于重点站所；沿海与海岛线路加强监视，做好停运避险准备；门窗孔洞封堵防进水。',
    '启动防风防汛预案，非必要户外作业全部停止；危险区域人员撤离，优先保障医院、水厂、通信等生命线供电；灾中严防倒杆断线。',
  ],
  '阵风': [
    '关注悬挂物与临时设施松动风险，巡检时避开高空坠物区。',
    '清理高空悬挂物与通道异物；加固轻质顶棚与标识牌；户外作业错峰。',
    '暂停海岛渡运及相关带电作业；加固可能受瞬时大风影响的设备与构筑物。',
    '严防高空坠物与设施损毁，准备抢修队伍与物资；达到阈值立即避险。',
  ],
  '强降水': [
    '检查低洼变电站、电缆沟与排涝设施，清理排水口。',
    '预置排水泵与挡水板，巡视易涝站所与地下配电室。',
    '地下空间入口封堵沙袋，停运高风险地下配电点与低洼线路。',
    '果断停运避险，切断受淹区域电源，确保人身安全优先于设备。',
  ],
  '高温': [
    '关注户外作业人员防暑，备足饮水与降温物资。',
    '错峰户外作业；监测主变油温、导线弧垂与接头温度，必要时限负荷。',
    '开放避暑场所；重点设备红外测温，增开通风降温，保障供水。',
    '红色高温预警，非必要不户外；重要负荷转移，严防设备过热损毁。',
  ],
  '低温': [
    '开展防寒防冻检查，关注充油充气设备油位气压。',
    '设备保暖包扎，防凝露与管道冻裂；巡检加热装置。',
    '防冰冻预演，预置融冰与除冰物资，重点监视覆冰区段。',
    '抗冻抢险队伍待命，覆冰超限区段申请融冰或停运避险。',
  ],
  '空气污染': [
    '户外巡检与作业佩戴防护口罩，缩短连续暴露时间。',
    '减少长时间户外巡检，敏感时段改室内；设备积污巡视。',
    '敏感人群避免户外，设备外绝缘污闪巡视加强，清洗作业延后。',
    '红色污染预警，非必要不户外；重点防污闪，必要时带电清洗。',
  ],
  '地震': [
    '关注建筑与设备基础异动、瓷件裂纹，核查通信与应急照明。',
    '巡视重点站所，核查继电保护与通信链路，紧固易位移设备。',
    '启动地震应急预案，优先保障医院、指挥、通信等生命线供电；排查边坡与挡墙。',
    '全力抢险，优先恢复重要用户供电；防余震次生灾害，严禁带病送电。',
  ],
  '野火': [
    '清理站所周边易燃植被与杂物，保持防火隔离带。',
    '加强线路走廊巡查，预置隔离带与灭火器材，关注火点临近。',
    '靠近火点区域预撤避险，必要时停运相关线路，配合消防。',
    '紧急疏散受影响区域人员，配合消防处置，严防火烧断线。',
  ],
  '汛情': [
    '监视河道与水库水位，关注汛情预警。',
    '预置防汛沙袋、挡水板与排水设备于沿江站所。',
    '低洼站所进水防范，入口封堵，转移重要物资与备件。',
    '主动停运避险，切断受淹区域电源，优先保障排涝供电。',
  ],
  '风暴潮': [
    '检查海岸与港口电力设施，关注潮位与风浪。',
    '加固沿海杆塔、箱变与海缆终端，防海水倒灌。',
    '海岛与沿海低洼区域预警，提前转移与停运。',
    '准备离岛避险与应急供电，潮位超警戒果断停运。',
  ],
  '台风': [
    '关注台风动态，检查户外设施紧固，清理悬挂物。',
    '加固高空悬挂物与广告牌，预置防风沙袋与物资；巡视线路走廊。',
    '停止海上与高空作业，准备转移沿海与海岛人员；预置抢修队伍。',
    '启动防风Ⅰ级响应，全面避险；优先保障生命线，灾后先巡后送。',
  ],
  '地质灾害': [
    '关注坡体裂隙、渗水与小规模塌方，巡视沿线边坡。',
    '巡查隐患点，设置警示与监测，清理排水沟。',
    '转移临坡临崖人员，封闭危险区段线路与道路。',
    '紧急撤离，配合专业救援；严禁进入滑坡体下方区域。',
  ],
  '龙卷': [
    '关注强对流云团发展，留意气象预警。',
    '加固轻质构筑物，减少不必要的外出与户外作业。',
    '人员进入坚固建筑底层避险，远离门窗与外墙。',
    '紧急避险，远离门窗外墙；灾后排查倒杆与断线再恢复。',
  ],
};
function detailFor(type, lv) {
  const arr = ADVICE_DETAIL[type];
  if (!arr || !arr.length) return '';
  return arr[lv - 1] || arr[arr.length - 1] || '';
}

// 地震研判
function evaluateEarthquakes(quakes) {
  const out = [];
  (quakes || []).forEach(q => {
    if (q.mag == null) return;
    const dist = haversine(CENTER.lat, CENTER.lon, q.lat, q.lon);
    if (dist > 600) return; // 超出关注范围
    let lv = 0;
    if (q.mag >= 7) lv = 4; else if (q.mag >= 6) lv = 3; else if (q.mag >= 5) lv = 2;
    else if (q.mag >= 4.5 && dist < 400) lv = 1;
    if (lv > 0) out.push({
      type: '地震', level: lv, levelName: levelName(lv), color: levelColor(lv),
      detail: `M${q.mag} · ${q.place} · 距北海约 ${dist.toFixed(0)} km`,
      station: '区域', advice: ADVICE['地震'][lv], adviceDetail: detailFor('地震', lv),
      url: q.url || srcUrlFor('地震'),
      time: q.time, mag: q.mag, dist, lat: q.lat, lon: q.lon,
    });
  });
  return out;
}

// 野火研判
function evaluateFires(fires) {
  if (!fires || !fires.length) return [];
  const near = fires.filter(f => haversine(CENTER.lat, CENTER.lon, f.lat, f.lon) < 120);
  const out = [];
  if (near.length) {
    const lv = near.length > 8 ? 3 : near.length > 3 ? 2 : 1;
    out.push({
        type: '野火', level: lv, levelName: levelName(lv), color: levelColor(lv),
        detail: `监测到 ${near.length} 处活跃火点（北部湾/桂南）`,
        station: '区域', advice: ADVICE['野火'][lv], adviceDetail: detailFor('野火', lv),
        url: srcUrlFor('野火'),
        points: near.slice(0, 20),
      });
  }
  return out;
}

// 潮汐/水位研判
function evaluateTides(tides) {
  const out = [];
  (tides || []).forEach(t => {
    if (t.configured === false) return; // 模型估算不告警
    if (t.exceeded) {
      const lv = t.current >= t.warnLevel + 1 ? 3 : 2;
      out.push({
        type: '风暴潮/高潮位', level: lv, levelName: levelName(lv), color: levelColor(lv),
        detail: `${t.name} 潮位 ${t.current} m ≥ 警戒 ${t.warnLevel} m`,
        station: t.name, advice: ADVICE['风暴潮'][lv], adviceDetail: detailFor('风暴潮', lv),
        url: srcUrlFor('风暴潮'),
      });
    }
  });
  return out;
}

// 台风研判（基于中央气象台实时路径，距北海越近/强度越高等级越高）
function evaluateTyphoon(typhoons) {
  const out = [];
  (typhoons || []).forEach(t => {
    const cur = t.current; if (!cur || !cur.lat) return;
    const dist = haversine(CENTER.lat, CENTER.lon, cur.lat, cur.lon);
    if (dist > 1500) return; // 超出关注范围
    const sInt = { TD: 1, TS: 1, STS: 2, TY: 2, STY: 3, SuperTY: 4, SUPER: 4 }[cur.intensity] || 1;
    let lv = 0;
    if (dist < 300) lv = Math.min(4, sInt + 1);
    else if (dist < 700) lv = Math.min(3, sInt);
    else if (dist < 1200) lv = Math.max(1, sInt - 1);
    else lv = 1;
    if (lv > 0) out.push({
      type: '台风', level: lv, levelName: levelName(lv), color: levelColor(lv),
      detail: `${t.cnName}（${t.enName}）${tyIntensity(cur.intensity).name} 中心 ${cur.lat.toFixed(1)}°N ${cur.lon.toFixed(1)}°E · 距北海约 ${dist.toFixed(0)} km · 风速 ${cur.wind || '—'} m/s`,
      station: '区域', advice: ADVICE['台风'][lv], adviceDetail: detailFor('台风', lv),
      url: (t.id ? 'https://www.nmc.cn/publish/typhoon/data/' + t.id + '.html' : srcUrlFor('台风')),
      id: t.id, lat: cur.lat, lon: cur.lon, dist,
    });
  });
  return out;
}

// 气象预警研判（地灾/汛情·暴雨/龙卷·强对流，仅关注华南周边）
function evaluateWarnings(warnings) {
  const out = [];
  (warnings || []).forEach(w => {
    if (w.cat === 'typhoon') return; // 台风路径类由 evaluateTyphoon 统一处理
    if (!w.lat || !w.lon) return;
    const dist = haversine(CENTER.lat, CENTER.lon, w.lat, w.lon);
    if (dist > 500) return; // 仅关注广西/华南周边
    let type, adviceKey;
    if (w.cat === 'geological') { type = '地质灾害'; adviceKey = '地质灾害'; }
    else if (w.cat === 'rainstorm') { type = '汛情·暴雨'; adviceKey = '汛情'; }
    else if (w.cat === 'convective') { type = '龙卷·强对流'; adviceKey = '龙卷'; }
    else return;
    const lv = w.levelNum || 1;
    out.push({
      type, level: lv, levelName: levelName(lv), color: (WARN_LEVEL[w.level] || {}).color || levelColor(lv),
      detail: `${w.city || ''} ${w.level}${type}预警`,
      station: w.city || '区域', advice: (ADVICE[adviceKey] && ADVICE[adviceKey][lv]) || '关注官方预警，做好防范',
      adviceDetail: detailFor(adviceKey, lv),
      url: w.url || srcUrlFor(adviceKey),
      lat: w.lat, lon: w.lon, time: w.time,
    });
  });
  return out;
}

module.exports = {
  LEVEL, levelName, levelColor, evaluateStation,
  evaluateEarthquakes, evaluateFires, evaluateTides,
  evaluateTyphoon, evaluateWarnings, haversine, ADVICE,
};
