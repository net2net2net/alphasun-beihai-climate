---
name: alphasun-beihai-climate
target_agent: any
description: "AlphaSun · 北海极端气候全景系统 — 以北海为中心的极端气候/海洋/卫星/天文/空气质量全景监测仪表盘。当用户需要运行、部署、打包、分发或二次开发该气候全景系统，或需要北海实时天气/台风/预警/潮汐/卫星云图/地震等综合监测能力时触发。纯 Node.js 零依赖，已内置便携运行时，支持一键独立运行与跨智能体安装。"
tags: [alphasun, beihai, climate, weather, dashboard, panorama, standalone]
required_commands: ['node (或使用内置 node/node.exe)']
version: 8.0.5
author: 阳光 net2net2net（ Vx: net2net ）
license: MIT
metadata: tags: [alphasun, beihai-climate, panorama]
  related_skills: [alphasun-knowledge-base, alphasun-external-info]
---

# AlphaSun · 北海极端气候全景系统 (alphasun-beihai-climate)

## 核心职责
以**北海（广西北海市，含海城/银海/铁山港/合浦/涠洲岛）**为中心的极端气候全景监测与应急参考系统。整合**陆地 · 海洋 · 卫星 · 天文 · 空气质量**五大数据域，提供实时天气、周期预报、多灾种极端告警（地震/汛情/台风/野火/风暴潮等）、全景地图与可叠加卫星/雷达图层。

## 触发条件 (When to Use)
- 用户要求**运行 / 部署 / 打包 / 分发**北海极端气候全景系统
- 用户需要**北海及周边**的实时天气、台风、预警、潮汐、海浪、卫星云图、地震、空气质量等综合监测
- 用户需要把该系统作为**可独立运行软件**或**可安装技能**分发给其他智能体 / 团队
- 防风防汛、防灾应急、海岛作业窗口、夜巡排班等场景参考

## 目录结构（本技能包）
```
alphasun-beihai-climate/
├── SKILL.md              # 本文件（触发 + 运行流程）
├── README.md             # 软件总览
├── INSTALL.md            # 跨智能体 / 独立安装说明
├── CHANGELOG.md          # 版本变更总览（v7.0.0 → v8.0.5）
├── LICENSE               # MIT 许可
├── app/                  # 可独立运行的完整系统
│   ├── server.js         # 聚合服务入口（纯 Node，零第三方依赖）
│   ├── lib/              # config / sources / tides / alerts / intel / astronomy
│   ├── public/           # 前端（index.html + css + js + data/beihai.geojson）
│   ├── package.json      # 含 build:assets / build:exe 脚本
│   ├── build-assets.js   # 将 public/ 内联为 embedded-assets.js（用于单文件 exe）
│   ├── sea-config.json   # Node SEA 构建配置
│   ├── dist/             # 构建产物：AlphaSun.exe（单文件，约 87MB，git 忽略）
│   ├── node/node.exe     # 内置便携式 Node 运行时（Windows，git 忽略）
│   ├── start.bat         # Windows 一键启动（自动打开浏览器）
│   └── start.sh          # Linux / macOS 启动
└── knowledge-base/       # 完整文档（设计 / 使用 / API / 分发）
    ├── README.md
    ├── 设计文档.md
    ├── 使用手册.md
    ├── API接口文档.md
    └── 技能安装与分发指南.md
```

## 运行方式

### A. 作为软件独立运行（人类用户 / 无 Node 环境）
- **单文件 exe（最简单）**：双击 `app/dist/AlphaSun.exe` → 浏览器自动打开 http://localhost:8765，关闭黑色控制台窗口即停止。无需 Node.js、无需任何外部文件。
- Windows：双击 `app/start.bat` → 自动启动服务并打开 http://localhost:8765
- Linux / macOS：终端执行 `bash app/start.sh`
- 内置 `node/node.exe`，**无需预装 Node**。
- exe 可选环境变量：`PORT=9000` 改端口；`OPEN=0` 禁止自动开浏览器。

### B. 由智能体运行（已安装本技能）
```bash
# 定位技能包内的 app 目录后启动
cd <技能根>/alphasun-beihai-climate/app
PORT=8765 node server.js          # 或：bash start.sh / 双击 start.bat
```
启动后访问 http://localhost:8765 即见全景仪表盘。

## 命令
```bash
# 启动（默认端口 8765，可用 PORT 环境变量覆盖）
PORT=8765 node server.js

# 激活火点图层（NASA FIRMS，需免费 MAP_KEY）
FIRMS_MAP_KEY=xxxx node server.js

# 激活权威潮汐（国家海洋信息中心，需 appid/appsecret）
NMDIS_APPID=xxxx NMDIS_APPSECRET=yyyy node server.js

# 重新生成内联资源（改了 public/ 后重建 exe 前执行）
npm run build:assets

# 重建单文件 exe（需先 npm i -g pkg，输出 app/dist/AlphaSun.exe）
npm run build:exe
```

## 关键能力

- **江河水文 · 水库水情**：内置北海主要江河（南流江等 8 条）与水库（洪潮江、牛尾岭等 5 座）权威档案，看板新增「江河水文」「水库水情」两面板；实时源（广西水文中心/水利部）当前不可达，降级为档案展示并明确标注非实时。
- **实时聚合**：陆地气象 / 空气质量 / 海洋 / 洪涝（Open-Meteo 全系）、地震（USGS）、台风与气象预警（中央气象台）、天文与晚霞概率（服务端计算）。
- **告警引擎**：5 级（正常 / 注意 / 预警 / 警报 / 紧急）规则引擎，覆盖高温 / 大风 / 暴雨 / 低温 / 空气污染 / 地震 / 野火 / 风暴潮 / 台风 / 地质灾害 / 龙卷 / 汛情，每条绑定处置建议。
- **北海关联研判**：每条情报 / 告警标注 `region`（北海 / 广西 / 其他）与 `beihaiRelation`（涉及北海 / 可能涉及北海），并带「距北海」距离；地图台风 / 地震 / 火点 / 预警均显示距北海公里数。
- **全景地图**：真实北海行政边界 GeoJSON（DataV 450500，含涠洲岛）+ 风险着色 + 卫星云图 / 雷达拼图（中央气象台代理，绕开防盗链）+ RainViewer / NASA GIBS 叠加层。
- **实时天气卡**：大温标 + 天气文字 + 体感头部；风/阵风/湿度/降水/气压/云量指标卡片；地理区域选择后展示「区域概况」（覆盖面积 km² / 覆盖人口 万 / 真实行政区轮廓缩略图）。
- **模块点击放大**：点击任意面板标题 → 页面中央放大展示该板块与数据（地图移动 Leaflet 容器、曲线重绘、其余面板克隆同步）。
- **顶部警报指示 + 声音警报**：有活跃告警显示红色闪烁「⚠ 警报」，无告警显示绿色「✅ 无警报」；右侧 🔇 按钮可开启声音报警（Web Audio 双音，默认关闭）。
- **深 / 浅色主题**：顶栏「🌙 浅色 / 🌙 深色」切换，默认深色，localStorage 持久化；图表 / 地图 / SVG 随主题联动。
- **世界时钟模块**：精美圆形传统机械钟（时分秒针 + 毫秒平滑扫秒）+ 大字号数字钟（HH:MM:SS.mmm）+ 设备时间 / 北京时间 / 常用国际时区列表（自动夏令时）+「🕒 对时」功能（SNTP-lite 调用 `/api/time` 估算服务器时刻并校准显示），精度达毫秒；可独立放大查看。
- **情报播报**：顶部极端气候告警情报默认 6s 自动滚动播报，▶⏸ 暂停 / ▲▼ 翻页，点击查看详情；左栏「极端天气告警」标题标红、可点击详情。

## 输出
- 浏览器仪表盘：http://localhost:8765
- 聚合接口：`GET /api/overview`（全量）、`/api/alerts`、`/api/climate/:id`、`/api/nmc-img?p=satellite|radar|...`、`/api/time`（对时：返回毫秒级 `{now, iso}`）
- 完整设计 / 使用 / API 文档：技能包内 `knowledge-base/`

## 与其它系统联动
| 系统 | 联动方式 |
|------|---------|
| 知识库 | 完整文档存放于技能包内 `knowledge-base/` |
| 共享技能 | 安装包存放于 `D:\SynologyDrive\Skills\alphasun-beihai-climate\`（支持 `cp -r` 跨智能体安装） |
| 应急推送 | 预留企微 / 邮件 / 短信接口（见设计方案，待接入） |

## 版本与许可
- 版本：v8.0.5
- 作者：阳光 net2net2net（ Vx: net2net ）
- 许可：MIT
