# AlphaSun · 北海极端气候全景系统 — API 接口文档

> 版本 v8.0.5 ｜ 基础地址：`http://localhost:8765`

所有 JSON 接口均含 `Access-Control-Allow-Origin: *`，便于前端与第三方调用。

## 1. GET /api/overview
全量聚合数据。返回结构（节选）：
```jsonc
{
  "updated": "2026-08-25T04:18:46.725Z",      // 数据更新时间(UTC)
  "center": { "name": "北海", "lat": 21.48, "lon": 109.11 },
  "maxLevel": 3, "maxLevelName": "警报",        // 全局最高风险等级
  "boundary": { "name": "北海市", "rings": [...] }, // 真实边界(可绘)
  "stations": [ { "id","name","lat","lon","level","levelName","detail","advice" } ],
  "globalAlerts": [ /* 见 §5 */ ],
  "alertIntel": { "items": [ /* 见 §6 */ ] },
  "climate": { /* 气候背景(Open-Meteo Climate) */ },
  "tides": [ /* 潮汐站时序 */ ],
  "map": { "typhoons":[...], "quakes":[...], "fires":[...], "warns":[...] }
}
```

## 2. GET /api/alerts
告警情报列表（与 overview.alertIntel.items 同源，独立端点便于轮询）。

## 3. GET /api/climate/:id
气候背景（月均温 / 月降水 / 降水日数，1991–2020 常态）。`:id` 为站点 id。

## 4. GET /api/nmc-img
中央气象台产品图代理（绕开防盗链 / CORS）。
- 参数 `p`：`satellite`(风云 FY2G 云图) | `radar`(雷达拼图) | `precip` | `wind` | `wave` | `subhigh` | `disturb`
- 参数 `meta=1`：返回 JSON `{ ok, link, img }`（link 为官方原图地址，img 为代理地址）
- 不带 `meta`：直接流式返回图片（`image/jpeg` / `image/png`，`Cache-Control: public, max-age=300`）
- 失败（JS 动态渲染页取不到图）：`meta=1` 返回 `{ ok:false }`，前端提示并保留官方原图 `↗` 链接

## 4.1 GET /api/time
对时服务（SNTP-lite 客户端用）。返回服务端高精度时刻，供前端估算设备偏差并校准显示。
```jsonc
{
  "now": 1756100000123.456,   // 服务端当前 UTC 毫秒（Date.now()，亚毫秒截断到 ms）
  "iso": "2026-08-25T04:13:20.123Z"
}
```
- `now`：服务端 `Date.now()`（毫秒整数，亚毫秒部分由 `performance.timeOrigin` 估算附加，用于更平滑的往返估算）。
- 前端用法：记录请求发出 `t0` 与接收 `t1`（`performance.now()`），`RTT = t1 - t0`；客户端接收本地时刻 `clientReceive = Date.now()`；估算服务器时刻 `serverEst = data.now + RTT/2`；偏差 `calibOffset = serverEst - clientReceive`。据此把设备时间映射到真实 UTC 时刻（北京时间 = UTC+8h）。

## 5. globalAlerts 条目结构
```jsonc
{
  "type": "台风",                 // 类型
  "station": "区域",              // 站点/区域名
  "level": 3, "levelName": "警报", "color": "#e5484d",
  "detail": "紫檀（NARRA）热带风暴 中心 19.3°N 108.2°",
  "advice": "密切关注路径",        // 处置建议
  "lat": 19.3, "lon": 108.2,      // 坐标(可选)
  "time": "2026-08-25 09:00",     // 发布时间(可选)
  "region": "其他",               // 北海 / 广西 / 其他
  "beihaiRelation": "direct",     // direct / possible / none
  "relLabel": "涉及北海"           // 涉及北海 / 可能涉及北海 / ""
}
```

## 6. alertIntel.items 条目结构
```jsonc
{
  "title": "台风 紫檀（NARRA）",
  "region": "其他",
  "beihaiRelation": "direct",
  "relLabel": "涉及北海",
  "level": 2, "levelName": "预警",
  "minDistBH": 212,              // 距北海最近距离(km)
  "source": "中央气象台",
  "time": "2026-08-25 09:00",
  "detail": "..."
}
```

## 7. GET /data/beihai.geojson
北海真实行政边界 GeoJSON（DataV `areas_v3/bound/450500_full`），`Content-Type: application/json`，`Content-Length` 显式声明。
- 坐标系：WGS-84，`[lon, lat]` MultiPolygon；前端绘制时做 WGS-84→GCJ-02 纠偏。
- 范围：海城区 450502 / 银海区 450503 / 铁山港区 450512 / 合浦县 450521，含涠洲岛。

## 8. 静态资源
| 路径 | 说明 |
|------|------|
| `/` → `/index.html` | 仪表盘主页 |
| `/css/styles.css` | 样式 |
| `/js/app.js` `/js/map.js` | 前端逻辑 |
| `/data/beihai.geojson` | 边界数据 |

## 9. 错误码
- `403`：`serveStatic` 路径穿越防护
- `404`：文件 / 资源不存在
- 数据源失败：聚合接口以 `Promise.allSettled` 容错，失败项标记降级，不阻塞整体
