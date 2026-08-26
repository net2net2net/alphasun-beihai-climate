# AlphaSun iOS · 免费 Apple ID 自签装机指南（Sideloadly）

> 适用：没有 Mac、不想买付费开发者账号，仅想把 App 装到**自己的** iPad/iPhone 自用。
> 免费个人 Apple ID 签出的证书 **7 天有效**，到期前重签即可续命。

---

## 〇、原理速览

| 环节 | 说明 |
|------|------|
| 构建 | 仓库内置 GitHub Actions `build-ios.yml`，在 GitHub 云端 macOS 跑卡机完成 `cap add ios → cap sync → archive`，产出 **未签名 IPA** |
| 签名 | 用 **Sideloadly**（Windows/Mac 均可）把 IPA 用你的免费 Apple ID 重签 |
| 安装 | Sideloadly 通过 USB 把签名后的 App 侧载（sideload）到设备 |
| 限制 | 免费证书 7 天过期；一台 Apple ID 同时签名的 App 数量有限（约 3 个） |

为什么要走这条路线：iOS 不像安卓能直接装 APK。免费账号不能上 App Store，唯一自用途径就是「未签名 IPA + 工具自签侧载」。本仓库已把最麻烦的**构建（需要 Mac）**搬到了 GitHub 云端，你本地只需做「下载 → 自签 → 装」。

---

## 一、云端构建，拿到未签名 IPA

1. 打开仓库 **Actions**：https://github.com/net2net2net/alphasun-beihai-climate/actions
2. 左侧 **Build iOS** → 右上角 **Run workflow** → 分支选 `main` → **Run workflow**
3. 等约 **2–3 分钟**，运行状态变绿 ✓
4. 点进该次运行 → 右侧 **Artifacts** 区下载：
   - **`alphasun-ios-unsigned-ipa`** ← 你要的，解压得到 `App.ipa`
   - `alphasun-ios-xcode-project`（可选，有 Mac 时可直接用自己账号在 Xcode 签名）

> 工作流不挂到 `push` 自动触发，避免每次提交都消耗 macOS 额度；需要时手动 Run 一次即可。
> 若你在仓库 Secrets 配了 `APPLE_CERT_P12` 等付费证书，`build-ios.yml` 还会额外产出**签名 IPA**，可跳过自签步骤。

---

## 二、准备（Windows 侧）

- 一台 Windows 电脑 + 数据线
- [Sideloadly](https://sideloadly.io/)（安装时一路下一步；若提示装 Apple 驱动，按提示装）
- 一个 **免费 Apple ID**（普通 Apple 账号即可，无需开发者）
- 让电脑能识别设备：iPad 连电脑后，在 iPad 上点「信任此电脑」；电脑端装好 [Apple Devices](https://apps.apple.com/us/app/apple-devices/id1634458083) 或 iTunes

---

## 三、Sideloadly 重签并安装

1. 打开 Sideloadly，把 `App.ipa` 拖入（或点 Browse 选择）
2. **Apple ID** 填你的免费账号邮箱
3. **Anisette 模式**：务必选 **Local**（默认常常是 Local，但请确认不是「无 Anisette」）
   > ⚠️ **关键坑**：免费账号必须开启 Anisette。若误设为「无 Anisette」（某些版本界面里对应 `2 / No Anisette`），Sideloadly 会报
   > `Guru Meditation Invalid file`，安装失败。改回 **Local** 即可。
4. 点 **Start**
5. 首次会让你输入 Apple ID 密码（以及可能的双重验证码），按提示填；Sideloadly 自动重签并安装到已连接的 iPad
6. 等待进度条完成，iPad 桌面出现 **AlphaSun北海气候**

---

## 四、iPad 上信任与开发者模式

首次打开前必须做两步，否则会闪退/无法验证：

1. `设置 → 通用 → VPN与设备管理` → 在「开发者 App」下找到你的 Apple ID → **信任**
2. `设置 → 隐私与安全性 → 开发者模式` → 打开（会要求重启，重启后确认开启）

完成后即可打开 App。

---

## 五、证书续期（每 7 天）

免费证书 7 天到期，到期 App 打不开。续期很简单：

- **连着电脑时**：重新打开 Sideloadly，载入同一个 `App.ipa`，点 **Start** 重签一次即可。
- **想免电脑自动续期**：可配合 AltServer（在同一 Wi-Fi 下定期自动刷新），但 Sideloadly 路线手动重签最稳。

> 提示：把 `App.ipa` 留在电脑上（例如 `D:\Programs\Sideloadly\alphasun-ipa\App.ipa`），续期时直接拖进去就行。

---

## 六、故障排查

| 现象 | 原因 / 解决 |
|------|------------|
| `Guru Meditation Invalid file` | Anisette 模式误设为「无 Anisette」→ 改回 **Local** 重试 |
| 安装后打开立刻闪退 | 未信任开发者 / 未开开发者模式 → 见「四」两步都做 |
| 提示「无法验证 App」 | 同上，去「VPN与设备管理」信任 |
| 证书过期打不开 | 7 天到了 → Sideloadly 重新 Start 重签 |
| App 里**很多模块空白** | ① 先确认已装**最新 IPA**（含 CapacitorHttp 修复）；② 打开 App，滚到底展开 **「🔧 数据自检」** 面板，看哪个数据源 ❌；③ 多数为网络波动，刷新重试；④ 若「请求通道」显示 `fetch` 而非 `原生 HTTP (CapacitorHttp)`，说明包未含修复，重新跑 `Build iOS` 取新 IPA |
| 地图空白 | 高德底图需联网，确认 iPad 有网 |
| 某模块「暂不可用」 | 该数据源本次拉取失败（超时），属正常降级，刷新即可 |

---

## 七、有 Mac / 付费账号的进阶路径

- **有 Mac**：下载 `alphasun-ios-xcode-project` 工程，Xcode 打开 → 用自己的 Apple ID 在 **Signing & Capabilities** 签名 → Run / Archive 装真机。免费个人证书同样 7 天。
- **付费开发者（$99/年）**：在仓库 Secrets 配置 `APPLE_CERT_P12` / `APPLE_CERT_PASSWORD` / `APPLE_PROVISIONING_PROFILE` / `APPLE_TEAM_ID` / `APPLE_EXPORT_METHOD`，`build-ios.yml` 会直接产出**签名 IPA**（development / ad-hoc / app-store），其中 app-store 可上架。
- **上架 App Store**：付费账号 + Xcode Archive → App Store Connect 提交审核。

---

## 八、相关文件

- `.github/workflows/build-ios.yml` — 云端构建 / 打包未签名 IPA 工作流
- `app-android/capacitor.config.ts` — 已启用 `plugins.CapacitorHttp`（原生 HTTP 绕开 CORS）
- `app-android/www/js/data.js` — 数据源（原生 HTTP 优先，`buildOverview` 返回各源诊断）
- `app-android/www/js/app.js` + `index.html` — 「🔧 数据自检」面板
- `app-android/README.md` — 移动端总文档（含 Android 与 iOS 构建方式）
