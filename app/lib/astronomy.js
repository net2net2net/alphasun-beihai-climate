// AlphaSun · 天文景观：黄昏霞光概率 + 天文事件日历
const { moonPhaseDesc } = require('./config');

// ===== 黄昏/朝霞 概率模型（基于 Open-Meteo 云量/降水/湿度/风，免额外数据源）=====
// 返回 0–100 评分 + 等级 + 最佳观赏时段
function sunsetGlow(station) {
  const w = station.weather; if (!w || !w.ok) return null;
  const c = w.current;
  const daily = w.daily[0] || {};
  let score = 0; const factors = [];
  // 降水否决
  if (c.precip > 0.2) { return { score: 0, grade: '低', bestTime: daily.sunset || '', factors: ['当前有降水，霞光概率低'] }; }
  // 云量：30–60% 最佳（有云渲染但不遮天）
  const cl = c.cloud;
  if (cl >= 30 && cl <= 60) { score += 50; factors.push('云量适中(30–60%)，色彩层次佳'); }
  else if (cl >= 15 && cl < 30) { score += 35; factors.push('云量偏少，霞光较淡'); }
  else if (cl > 60 && cl <= 80) { score += 22; factors.push('云量偏多，地平线或可见'); }
  else if (cl > 80) { score += 8; factors.push('云量过厚，概率低'); }
  else { score += 12; factors.push('晴空少云，霞光较弱'); }
  // 湿度：60–90% 利于色彩
  const rh = c.rh;
  if (rh >= 60 && rh <= 90) { score += 20; factors.push('湿度适宜，透光性好'); }
  else if (rh > 90) { score += 12; factors.push('湿度偏高'); }
  else { score += 10; factors.push('空气偏干'); }
  // 风力：静稳利于霞光
  const wd = c.wind;
  if (wd < 4) { score += 18; factors.push('风力静稳'); }
  else if (wd < 8) { score += 10; factors.push('微风'); }
  else { score += 4; factors.push('风力较大，云层易散'); }
  score = Math.min(100, score);
  const grade = score >= 70 ? '高' : score >= 40 ? '中' : '低';
  return { score, grade, bestTime: daily.sunset || '', factors };
}

// 早晨霞光概率：与黄昏同模型，最佳观赏时段为日出；冬春清晨北海多雾会拉低评分
function sunriseGlow(station) {
  const w = station.weather; if (!w || !w.ok) return null;
  const c = w.current;
  const daily = w.daily[0] || {};
  let score = 0; const factors = [];
  if (c.precip > 0.2) { return { score: 0, grade: '低', bestTime: daily.sunrise || '', factors: ['当前有降水，朝霞概率低'] }; }
  const cl = c.cloud;
  if (cl >= 30 && cl <= 60) { score += 50; factors.push('云量适中(30–60%)，朝霞层次佳'); }
  else if (cl >= 15 && cl < 30) { score += 35; factors.push('云量偏少，朝霞较淡'); }
  else if (cl > 60 && cl <= 80) { score += 22; factors.push('云量偏多，天际线或可见'); }
  else if (cl > 80) { score += 8; factors.push('云量过厚，概率低'); }
  else { score += 12; factors.push('晴空少云，朝霞较弱'); }
  // 北海冬春清晨多雾（雾日较多），高湿且静风时易成雾，削弱朝霞
  const rh = c.rh, wd = c.wind;
  const month = new Date().getMonth() + 1;
  const fogSeason = (month <= 4 || month >= 11);
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

// ===== 天文事件日历（2026 动态计算距今天数）=====
function daysUntil(month, day) {
  const now = new Date();
  let target = new Date(now.getFullYear(), month - 1, day);
  if (target < now) target = new Date(now.getFullYear() + 1, month - 1, day);
  return Math.ceil((target - now) / 86400000);
}
function nextMoonPhase() {
  // 参考满月 2000-01-06 18:14 UTC，朔望月 29.53059 天
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const syn = 29.53059;
  const now = Date.now() / 86400000;
  const k = Math.ceil((now - ref) / syn);
  const nextNew = new Date((ref + k * syn) * 86400000);
  const nextFull = new Date((ref + (k + 0.5) * syn) * 86400000);
  return { nextNew, nextFull };
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

module.exports = { sunsetGlow, sunriseGlow, astronomicalEvents, moonPhaseDesc };
