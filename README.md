# AlphaSun · 北海极端气候全景系统（技能安装包）

**版本 v7.0.1 ｜ 作者：阳光（net2net2net）｜ 许可：MIT**

一套以**北海为中心**的极端气候全景监测仪表盘：实时天气、周期预报、多灾种极端告警、全景地图与可叠加卫星 / 雷达图层。纯 Node.js、零第三方依赖、内置便携运行时，**开箱即运行**。

## 快速开始
- **独立运行**：双击 `app/start.bat`（Windows）或 `bash app/start.sh`（Linux / macOS）→ 打开 http://localhost:8765
- **由智能体运行**：见 `INSTALL.md`；技能加载后执行 `node app/server.js`

## 包内容
- `app/`：完整可运行系统（server.js + lib + public + 内置 node）
- `SKILL.md`：技能定义（触发 + 运行流程）
- `INSTALL.md`：跨智能体 / 独立安装说明
- 完整文档（设计 / 使用 / API / 分发）：知识库 `D:\SynologyDrive\KnowledgeBase\AlphaSun\beihai-climate-panorama\`

## 数据来源
- 陆地 / 海洋 / 空气质量 / 洪涝：**Open-Meteo** 全系（免费、免密钥）
- 地震：**USGS** GeoJSON
- 台风与气象预警：**中央气象台（nmc）**
- 天文与晚霞概率：**服务端本地计算**（免额外数据源）
- 卫星云图 / 雷达：经中央气象台代理叠加（绕开防盗链 / CORS）

## 说明
- 部分中央气象台产品页为 JS 动态渲染，叠加失败时保留官方原图链接（不伪造坏图）。
- 生产化建议：注册天地图 / 高德 Key（GCJ-02 合规底图）、密钥服务端托管、对接权威海洋 / 台风 / 干旱源、等保加固。
