# AlphaSun 北海极端气候全景系统 · 移动端 APP（iOS + Android）

把桌面 Node 版改造成可在**手机独立运行**的 APP。采用 **Capacitor 纯前端封装**：同一套 `www/` 前端代码，同时生成安卓（APK）与 iOS（Xcode 工程）两个原生壳，直连各权威数据源，无需 Node 后端。

> 路线说明：选择「纯前端」而非「内嵌 Node 后端」，是因为中央气象台卫星/雷达图等产品图依赖服务端代理跨域、且 Node 后端无法在 WebView 中直接运行。纯前端方案用浏览器直连**权威数据源**，APK 仅约 10 MB、可正常上架；iOS 同理。

## 与桌面版的区别

| 能力 | 桌面 Node 版 | 移动 APP 版（iOS/Android） |
|------|------------|--------------------------|
| 实时天气/空气/海洋/洪水/气候 | ✅ | ✅ 直连 Open-Meteo |
| 地震（USGS） | ✅ | ✅ 直连 |
| 台风/预警（中央气象台） | ✅ | ✅ 直连（可选代理增强） |
| 潮汐/水位 | ✅ | ✅ 调和模型估算（填凭证可真实） |
| 野火（NASA FIRMS） | 需 KEY | 缺省降级，填 KEY 增强 |
| 卫星/雷达产品图（nmc） | ✅ 服务端代理 | ⚠️ 移动端降级（点 ↗ 看官方原图） |
| 后端依赖 | 需 Node 服务 | **无**，纯静态 |

数据源逻辑全部移植到 `www/js/data.js`（`window.AlphaData`），与桌面 `lib/` 一一对应。

## 方式一：云端自动出 APK（推荐，无需本机装 Android Studio）

仓库已内置 GitHub Actions 工作流 `.github/workflows/build-android.yml`。只要把代码推到 `main`，GitHub 云端（自带 Android SDK + JDK17）会自动编译并把 **APK 作为构建产物（artifact）提供下载**。

获取 APK 步骤：
1. 打开仓库 **Actions** 页：https://github.com/net2net2net/alphasun-beihai-climate/actions
2. 找到名为 **Build Android APK** 的最新运行（绿色 ✓ 表示成功）
3. 进入该运行 → 右侧 **Artifacts** → 下载 `alphasun-beihai-apk`
4. 解压得到 `app-debug.apk`，拷到安卓手机安装即可（允许「未知来源」）

> 若 Actions 未自动触发：进入 Actions 页 → 左侧 **Build Android APK** → **Run workflow** 手动触发一次。
> 提示：APK 为 debug 签名，仅供自用/测试安装；上架 Google Play 需 release 签名（见下方「签名上架」）。

## 方式二：本机 Android Studio 构建 APK

前置环境（安装一次）：
1. **Node.js 18+**（建议 20 LTS）
2. **Android Studio**（含 SDK + 构建工具）
   - SDK Platform：Android 13/14（API 33/34）
   - 安装 Android SDK Build-Tools、Platform-Tools
   - Java 17（Android Gradle 插件要求）
3. 设置环境变量：`ANDROID_HOME` / `ANDROID_SDK_ROOT` 指向 SDK 目录（如 `C:\Users\你\AppData\Local\Android\Sdk`）
4. 安卓手机：开启「开发者选项 → USB 调试」

构建：
```bash
cd app-android
npm install              # 安装 @capacitor/core / android / ios / cli
npx cap add android     # 首次：生成 android/ 原生壳
npx cap sync            # 把 www/ 前端同步进 android 项目
npx cap build android   # 生成 APK
```
生成的 APK：`android/app/build/outputs/apk/debug/app-debug.apk`
或一条命令：`npm run build:android`

安装到手机：
- **方式 A（推荐调试）**：`npx cap open android` 打开 Android Studio → Run ▶ 选已连接设备
- **方式 B（直接装）**：把 `app-debug.apk` 拷到手机，允许「未知来源」后安装

## 方式三：iOS 云端构建 + 免费 Apple ID 自签装机（推荐，无需 Mac）

iOS 构建需要 macOS，但**本仓库已内置 GitHub Actions 工作流** `.github/workflows/build-ios.yml`，在 GitHub 云端（macOS 跑卡机）自动完成 `cap add ios → cap sync → archive → 打包未签名 IPA`，**无需你本地有 Mac / Xcode**。产物是**未签名 IPA**，拿到后用 **Sideloadly + 免费 Apple ID** 在 Windows 上自行签名并装进 iPad/iPhone。

> 为什么是「未签名 IPA + 自签」：免费个人 Apple ID 无法走 App Store，只能通过 Sideloadly（AltStore 系）把 IPA 重签后侧载到自己的设备，证书 **7 天有效**，到期前在 Sideloadly 点一下重签即可续命。详细步骤见 [docs/iOS-Sideload-Guide.md](docs/iOS-Sideload-Guide.md)。

### 第一步：触发云端构建，下载未签名 IPA
1. 打开仓库 **Actions** 页：https://github.com/net2net2net/alphasun-beihai-climate/actions
2. 左侧选择 **Build iOS** → 右上 **Run workflow** → 选分支（默认 `main`）→ **Run**
3. 等待约 2–3 分钟，运行变绿 ✓
4. 进入该运行 → 右侧 **Artifacts** → 下载 `alphasun-ios-unsigned-ipa`（解压得到 `App.ipa`）
   - 同次构建还提供 `alphasun-ios-xcode-project`（完整 Xcode 工程，供有 Mac 的用户直接用自己账号签名）

### 第二步：Sideloadly 自签装机（Windows）
1. 下载安装 [Sideloadly](https://sideloadly.io/)；iPad 用数据线连电脑，信任该电脑
2. Sideloadly 载入 `App.ipa`；Apple ID 填你的**免费个人账号**；**Anisette 模式务必选「Local」**（默认或 GUI 里选 Local）
   > ⚠️ 坑：若 Anisette 误设为无 Anisette（部分版本对应的是 `2`/No Anisette），Sideloadly 会报 `Guru Meditation Invalid file`。免费账号必须开 Anisette（Local 模式）。
3. 点 **Start** → 自动重签并安装到设备
4. iPad 上：
   - `设置 → 通用 → VPN与设备管理` → 信任该开发者
   - `设置 → 隐私与安全性 → 开发者模式` → 打开（重启后生效）
5. 桌面出现 **AlphaSun北海气候**，打开即可。iOS 证书 7 天有效，到期前在 Sideloadly 重新 Start 即可续签。

### 关于「iOS 很多模块没结果」已根治
早期 iOS 版装好后大量模块空白，根因是 **WKWebView 以 `capacitor://localhost` 不透明源发起 `fetch` 被 CORS 拦截**（Open-Meteo / USGS / 中央气象台等一整片同时失败）。已修复：
- `capacitor.config.ts` 启用 **`plugins.CapacitorHttp`（原生 HTTP）**：WebView 内 `fetch` 改走原生 `NSURLSession`，**彻底绕开浏览器 CORS**，与安卓行为一致；
- 未采用 `iosScheme:'https'`（iOS 的 WKWebView 无法接管 `http(s)`，官方明确禁止，设了会破坏构建）；
- `build-ios.yml` 额外注入 `NSAppTransportSecurity: NSAllowsArbitraryLoads=true` 作双保险（数据源全 HTTPS，本不应触发 ATS）。
- App 底部新增 **「🔧 数据自检」** 折叠面板，逐源显示 ✅/❌ 与请求通道（应为「原生 HTTP (CapacitorHttp)」），便于一眼确认修复或定位残留问题。

## 方式四：本机 Mac + Xcode（可选）

有 Mac 的用户也可本地构建：

```bash
cd app-android
npm install
npx cap add ios         # 生成 ios/ 原生工程
npx cap sync
npx cap open ios        # 打开 Xcode
```
在 Xcode 中：选设备/模拟器 → ▶ Run 调试；真机安装需在 **Signing & Capabilities** 配置 Apple 开发者证书（免费个人证书可装到自己的设备，7 天有效；上架 App Store 需付费开发者账号）。

## 可选：增强数据

编辑 `www/index.html` 里的 `window.ALPHASUN_CONFIG`：

```js
window.ALPHASUN_CONFIG = {
  FIRMS_MAP_KEY: '',        // NASA FIRMS 火点 key → 火点图层有数据
  NMDIS_APPID: '',          // 国家海洋信息中心潮汐凭证 → 真实潮位
  NMDIS_APPSECRET: '',
  proxy: ''                 // CORS 代理前缀，如 'https://your-proxy.workers.dev/?url='
                            // → 让中央气象台台风/预警数据在手机端更稳定
};
```
改完 `www/` 后需重新 `npx cap sync` 再 `build`。

## 签名上架（可选）

- **Android**：在 `android/` 工程中配置 `signingConfigs`（release keystore），或将 `build:android` 改为 `cd android && ./gradlew assembleRelease`。也可在 GitHub Actions 里用 `r0adkll/sign-android-release` 自动签名后发布到 Release。
- **iOS**：Xcode → Archive → 通过 App Store Connect 上架（需付费 Apple Developer）。也可在仓库 Secrets 配置 `APPLE_CERT_P12` 等密钥，让 `build-ios.yml` 直接产出**签名 IPA**（ad-hoc / development / app-store）。

## 常见问题

- **白屏/模块空白**：**已修复** —— Leaflet / Chart.js 及其图标已随包内置到 `www/vendor/`（不再依赖 unpkg/jsdelivr 等 CDN），消除中国移动网络屏蔽 CDN 导致整页阻塞的风险。渲染层亦已加固：任一子模块（天气/空气/海洋/图表/地图等）渲染失败都会被隔离，不再连累其它模块变空白；24h 曲线面板改为初始即绘制。
- **某模块显示「暂不可用」**：表示该数据源本次拉取失败（网络波动或接口超时），属正常降级；刷新即可重试。中央气象台（台风/预警）接口实测支持 CORS，手机端可直连；NASA FIRMS 野火需填 `FIRMS_MAP_KEY`，否则降级。iOS 端如仍有模块空白，展开底部「🔧 数据自检」面板看哪个源 ❌。
- **地图空白**：高德底图需联网；确认手机有网。
- **数据不刷新**：`npx cap sync` 后重装 APP（或 Android Studio 里 Clean Project）。
- **打包体积**：纯前端约 10 MB；若改为内嵌 Node 后端（nodejs-mobile）会到 100 MB+，本仓库未采用。
- **云端构建失败**：进 Actions 运行看日志；多为首次拉取 Gradle / SDK 包较慢，重试即可；iOS 构建若报签名相关，多半是 Secrets 未配，走「未签名 IPA + 自签」路线即可。

## 目录结构

```
app-android/
├── package.json          # Capacitor 依赖与脚本（android/ios 双端）
├── capacitor.config.ts   # appId / appName / webDir=www / 双端配置（已启用 CapacitorHttp）
├── tsconfig.json
├── .gitignore            # 排除 node_modules/ android/ ios/ *.apk
├── README.md             # 本文件
├── docs/
│   └── iOS-Sideload-Guide.md   # iOS 免费 Apple ID 自签装机详细指南
└── www/                  # 前端（已改造为纯前端）
    ├── index.html        # 加载 data.js（直连数据源）+ 标记 ALPHASUN_APP + 数据自检面板
    ├── css/
    └── js/
        ├── data.js       # 浏览器版数据源（替代 Node 后端，全局 AlphaData；原生 HTTP 优先）
        ├── map.js        # 地图（nmc 产品图在 APP 模式降级）
        └── app.js        # 界面（/api 调用已替换为 AlphaData）+ 数据自检渲染
```
