# AlphaSun · 北海极端气候全景系统（技能安装包）

**版本 v8.0.3 ｜ 作者：阳光 net2net2net（ Vx: net2net ）｜ 许可：MIT**

一套以**北海为中心**的极端气候全景监测仪表盘：实时天气、周期预报、多灾种极端告警、全景地图、世界时钟与可叠加卫星 / 雷达图层。纯 Node.js、零第三方依赖、内置便携运行时，**开箱即运行**。

## 适用设备及方式
智能体（技能）、Windows（含exe方式）、Linux/macOS、安卓Android（APK）
下载/安装：
Windows exe： https://github.com/net2net2net/alphasun-beihai-climate/releases/download/alphasun-exe-8.0.2/alphasun-beihai-climate8.0.2.exe
安卓Android Apk： https://github.com/net2net2net/alphasun-beihai-climate/releases/download/android-v8.0.3-debug/alphasun-beihai-climate-debug.apk
   
## 建设目标
构建覆盖北海全域（海城 / 银海 / 铁山港 / 合浦 / 涠洲岛）的极端气候全景系统，实现：
1. **全方位权威实时天气**：陆地气象 + 空气质量（AQI/六项污染物）+ 海洋（潮汐/水位/海浪/风暴潮）+ 卫星（云图/红外）+ 天文（日出日落/月出月落/月相/晚霞概率/天文景观）。
2. **周期预报**：7 日 + 15 日趋势 + 24 小时逐时曲线。
3. **极端天气告警**：地震、汛情、干旱、高温、台风、野火等多灾种分级告警与处置建议。
4. **地图全景**：以地图为底座，按风险等级着色，叠加卫星云图、火点、台风路径。
5. **世界时钟**：机械钟 + 数字钟（毫秒精度）+ 多时区 + 对时，支撑跨时区应急协同。

## 快速开始
- **单文件 exe（推荐，最简单）**：从 [Release `alphasun-exe-8.0.2`](https://github.com/net2net2net/alphasun-beihai-climate/releases/tag/alphasun-exe-8.0.2) 下载 `alphasun-beihai-climate8.0.2.exe` → 双击运行 → 浏览器自动打开 http://localhost:8765。无需安装 Node.js、零外部文件。
- **独立运行（完整目录）**：双击 `app/start.bat`（Windows）或 `bash app/start.sh`（Linux / macOS）→ 打开 http://localhost:8765
- **由智能体运行**：见 `INSTALL.md`；技能加载后执行 `node app/server.js`

## 包内容
- **单文件 exe（Release 发布）**：Windows 64 位单文件 `alphasun-beihai-climate8.0.2.exe`（约 83 MB，内置 Node 运行时 + 全部前端资源），见下方「单文件 exe 下载」段落与 Release `alphasun-exe-8.0.2`。
- `app/`：完整可运行系统源码（server.js + lib + public + 内置 node），用于二次开发或 `node app/server.js` 直接运行。
- `app-android/`：移动端 APP 版（Capacitor 纯前端封装，一套 `www/` 同时生成 **iOS + Android**，直连数据源，可在手机独立运行；APK 可由 GitHub Actions 云端自动构建）
- `SKILL.md`：技能定义（触发 + 运行流程）
- `INSTALL.md`：跨智能体 / 独立安装说明
- `CHANGELOG.md`：版本变更总览
- `knowledge-base/`：完整文档（设计 / 使用 / API / 分发）

## 核心功能
- **实时天气**：大温标 + 体感 + 风/阵风/湿度/降水/气压/云量指标卡片；地理区域选择后展示「区域概况」（覆盖面积、覆盖人口、真实行政区轮廓）。
- **周期预报**：7 日 + 15 日趋势、24h 逐时曲线（可增删维度）。
- **多灾种告警**：5 级规则引擎（正常/注意/预警/警报/紧急），地震/汛情/台风/野火/风暴潮等，标注「涉及北海 / 可能涉及北海」与「距北海」距离。
- **全景地图**：真实北海边界 + 风险着色 + 台风/地震/火点/预警图层 + 卫星云图/雷达叠加。
- **模块点击放大**：点任意面板标题 → 页面中央放大该板块与数据。
- **警报指示 + 声音报警**：有告警红色闪烁「⚠ 警报」，无告警绿色「✅ 无警报」；🔇 按钮开启声音报警（默认关）。
- **深 / 浅色主题**：顶栏一键切换，默认深色，localStorage 记忆。
- **世界时钟**：机械钟（毫秒扫秒）+ 数字钟（毫秒）+ 设备/北京/国际时区 + 对时功能。
- **情报播报**：顶部告警情报自动滚动播报，可暂停 / 翻页 / 查看详情。

## 数据来源
- 陆地 / 海洋 / 空气质量 / 洪涝：**Open-Meteo** 全系（免费、免密钥）
- 地震：**USGS** GeoJSON
- 台风与气象预警：**中央气象台（nmc）**
- 天文与晚霞概率：**服务端本地计算**（免额外数据源）
- 卫星云图 / 雷达：经中央气象台代理叠加（绕开防盗链 / CORS）

## 重建单文件 exe（可选）
exe 因体积未纳入 git，需要时可自行构建：
```bash
cd app
npm run build:assets          # 将 public/ 内联为 embedded-assets.js
npm i -g pkg                  # 安装打包器（首次）
npm run build:exe             # 输出 app/dist/AlphaSun.exe
```
> 说明：`app/node/`（便携 Node 运行时，约 87MB）与 `app/dist/`（构建产物）均被 `.gitignore` 排除，故 git 仓库为**源码 + 文档**形态；本地运行也可直接 `node app/server.js`（无需 exe）。

## 单文件 exe 下载（Release 发布）

为方便直接使用，已发布 Windows 64 位**单文件 exe**（内置 Node 运行时 + 全部前端资源，双击即运行，零依赖）：

- **下载**：[alphasun-beihai-climate8.0.2.exe（Release `alphasun-exe-8.0.2`）](https://github.com/net2net2net/alphasun-beihai-climate/releases/download/alphasun-exe-8.0.2/alphasun-beihai-climate8.0.2.exe)
- **大小**：87,420,928 字节（约 83.4 MB）
- **MD5**：`c7f3433bb7d5675c59fc52dde34e8afe`（下载后请校验）
- **使用说明 / MD5 校验方法**：[docs/EXE使用说明.md](docs/EXE使用说明.md)
- **系统运行效果图**：

![AlphaSun 北海极端气候全景系统](docs/screenshot.jpg)

> 运行：双击 exe → 浏览器自动打开 http://localhost:8765。需联网获取实时数据；如被杀软误报，校验 MD5 一致后可加入白名单。详细见使用说明文档。

## 移动端 APP（iOS + Android）

把系统打包为可在手机独立运行的 APP（Capacitor 纯前端封装，一套 `www/` 同时生成 iOS 与 Android）：

- **项目目录**：[`app-android/`](app-android/)（含完整 `www/` 前端 + Capacitor 配置 + 双端构建文档 [README](app-android/README.md)）
- **数据源**：由 `www/js/data.js` 直连 Open-Meteo / USGS / 中央气象台，无需 Node 后端
- **降级项**：中央气象台卫星/雷达产品图在手机端无法跨域抓取，地图叠加层提示「点 ↗ 看官方原图」；野火 / 潮汐缺省降级（可在 `www/index.html` 填 key 增强）
- **获取安卓 APK（无需本机装 Android Studio）**：仓库内置 GitHub Actions 工作流，推送到 `main` 后自动在云端编译出 APK 并作为构建产物提供下载。步骤：进入 [Actions](https://github.com/net2net2net/alphasun-beihai-climate/actions) → 找 **Build Android APK** 运行 → 下载 Artifact `alphasun-beihai-apk` → 解压 `app-debug.apk` 安装。未自动触发时可手动 **Run workflow**。
- **本机构建（安卓）**：装 Android Studio + Node 18+ 后，`cd app-android && npm install && npx cap add android && npx cap build android` 生成 APK（详见 [app-android/README.md](app-android/README.md)）。
- **本机构建（iOS，需 Mac + Xcode）**：`cd app-android && npm install && npx cap add ios && npx cap open ios`，Xcode 中 Run / Archive。

## 说明
- 部分中央气象台产品页为 JS 动态渲染，叠加失败时保留官方原图链接（不伪造坏图）。
- 生产化建议：注册天地图 / 高德 Key（GCJ-02 合规底图）、密钥服务端托管、对接权威海洋 / 台风 / 干旱源、等保加固。
