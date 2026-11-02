# AlphaSun · 北海极端气候全景系统 — 版本变更总览

> 本地运行地址：**http://localhost:8765**（改完刷新即生效）
> 启动方式：`node server.js`（位于 `app/` 目录，纯 Node 零依赖，端口 8765）
> 版本：v7.0.0 → v8.3

---

## v8.3 — 版本号统一与发布链路单源化（首个两段式版本号）（2026-11-02）
> 本条为**首个正式发布的两段式版本号**（`8.3`）。此前 `v8.2.2` / `v8.2.3` 为内部迭代、尚未对外发布，其成果整体并入本条发布记录，下文保留各自技术细节备查。

- **版本号统一为 `8.3`（发布链路单源化）**：`app/package.json` 与 `app-android/package.json` **同步为 `8.3`** —— 二者分别是 `build-exe.yml`（Windows / Linux / macOS 单文件 exe）与 `build-android.yml` / `build-ios.yml`（APK + IPA）推导 GitHub Release TAG 的唯一依据，一旦不一致，5 个产物就会散落到不同 Release。同步刷新 `app/package-lock.json`（2 处）、双端 `data/version.json`（`version` 字段 + `released` + `notes` + `downloads.*` 5 个 URL 的 TAG 段）与双端 `index.html`（h1 版本徽标 + 页脚 `footVer`），并按新 `public/` 重新内联生成 `app/embedded-assets.js`（单文件 exe 的内联资源）。
- **EXE 单文件实测加固（v8.2.3 迭代成果，随本版发布）**：用 Node SEA 实际构建并运行 `alphasun-beihai-climate.exe`（84.1MB），在独立部署目录中逐项验证 —— ① **`.exe` 同目录 `config.json` 确实被读取**（日志 `[cfg] 已加载国家海洋信息中心(NMDIS) 潮汐凭证…`）；② 首页与全部静态资源（css/js/geojson/version.json）由内联资源正常提供；③ `/api/tides`、`/api/overview` 返回完整数据；④ 潮汐卡片按新字段（`meanLevel/range/tidalType/springNeap/typicalRange`）输出。
- **修复 SEA 下审计快照污染上级目录（真 bug）**：SEA 中 `__dirname` 指向 **`.exe` 所在目录**（非打包 blob 内部），原 `path.join(__dirname,'..','data')` 会把 `realtime-check.json` 写到 **exe 的上级目录**（实测写到了 `%TEMP%\data`）。新增 `app/lib/paths.js` 收敛运行形态路径（`isSea()` 走 `node:sea`，`dataRoot()` → exe 同目录 / 开发态项目根），`server.js` 改用 `dataPath('data','realtime-check.json')`；实测快照已正确落在 `.exe` 同目录 `data/`，上级目录不再被污染。
- **Windows 防火墙拦截排障（EXE 部署必踩坑，已写入 INSTALL 排障表）**：exe 换目录运行后，Windows 会为新路径自动生成**入站「阻止」规则**（实测 6 条 Block 规则，且 Block 优先于 Allow），表现为「双击无反应 / 浏览器打不开 localhost:8765」；INSTALL.md 已给出管理员 `netsh advfirewall` 放行与删阻止规则的具体命令。
- **NMDIS 三港站点代码查询 / 回填工具（新增 `tools/nmdis-portlist.js`）**：实测确认 NMDIS「获取站点列表」接口**全量鉴权**（`GetPortList` / `GetPortTideData` 未授权均返回 `{"code":"1000.1","message":"用户未授权"}`），三港真实 SiteCode 属付费订购内容（500 元/站/年），**公开渠道不可得、不可凭猜测硬编码**。故提供工具替代人工抄码：`--appid/--secret` 或环境变量或 `config.json` 取凭证 → 查询 → 按站名别名匹配三港 → 打印真实 SiteCode 与匹配依据 → `--write` 自动回填 `config.json` 的 `tideSiteCodes`（`--all` 可导出全量站点人工挑选）。
- **站点匹配从「朴素子串」升级为「别名 + 坐标消歧」（新增 `app/lib/tideSites.js`）**：原 `nameMatch` 仅按站名子串匹配，**会命中辽宁铁山港等外省同名港**。新逻辑：① 站名别名命中（中文 / 英文 / 简称，如 `铁山港`/`TIESHANGANG`/`铁山`、`涠洲岛`/`WEIZHOU`/`涠洲`）；② 同名多候选 → 按 `Coordinate` 就近消歧；③ 站名完全未命中 → 30km 内坐标兜底（结果标注 `via`）。`app/lib/tides.js`（Node / EXE）、`tools/nmdis-portlist.js`、`app-android/www/js/data.js`（安卓内联副本）三处共用同一套规则。
- **DoH DNS 兜底直连（新增 `app/lib/nmdisHttp.js`）**：实测本机 DNS（114DNS）对 `service-tide.nmdis.org.cn` 返回 **NXDOMAIN**，而 8.8.8.8 / 阿里 DoH 可正常解析（221.239.0.155）—— 即便用户配好凭证也会**静默降级为演示模型**且无提示。新增访问层：标准 DNS 失败（ENOTFOUND / EAI_AGAIN）时自动经**阿里 / 腾讯 DoH** 解析并以显式 `Host` 头直连 IP（NMDIS 为明文 HTTP，故可行），日志打印 `[nmdis] 本机 DNS 无法解析…已通过 DoH 直连 <IP> 完成请求`。已在 EXE 内实测生效。
- **回归门禁扩容**：`tools/smoke.js` 由 **73 项扩至 122 项**（新增第 4 组「NMDIS 站点代码解析」：坐标格式解析 7 例、别名 / 坐标消歧 / 兜底匹配、4 种返回结构兼容、以及 EXE 路径与 DNS 兜底层的接入断言；第 5 组「二进制资产完整性」：magic bytes + PNG chunk 长度 / CRC32 / IDAT zlib 解压，可抓出「签名被改写」这类 git 不报错的静默损坏；第 6 组「内联资源新鲜度」；第 7 组「发布归档目录 git 隔离」：`_releases/` 必须被 git 忽略、且其下不得有任何被 git 跟踪的文件 —— 守住 317MB 发布产物「永不入库」这条底线，无 git 环境时优雅跳过而非误报），全绿 122/0。新增断言固化：`parseCoord` 必能解析十进制度 + 方位（此前因度符号被设为必需而整体失配）、纯十进制对不得误把第二数当「分」、`nameMatch` 不得回归、SEA 落盘路径不得回退、`.gitattributes` 的 binary 规则必须排在 text 规则之后。
- **修复二进制门禁对发布归档目录的「盲区」（P0）**：`tools/check-binary-assets.js` 此前把 `_releases/` 按**目录名无条件**加入扫描跳过集合 —— 而该目录正是 `.gitignore` 里 `_releases/` 规则守护的对象（317MB / 5 个发布产物）。一旦那条规则被误删 / 改名 / 失效，二进制产物就会静默进入 git，而门禁因跳过该目录**完全看不见它们**（既不报「未受 binary 规则保护」，也不报体积异常）—— 门禁在恰恰需要它报警的那个场景里失明。现改为**条件跳过**：只有 `git check-ignore` 确认该目录确实被忽略时才跳过；未被忽略（或内部存在被跟踪文件）则重新纳入扫描，由既有的 binary 规则覆盖断言直接失败（门禁自愈），把「归档即将入库」从隐性风险变成显性失败。非 git 环境（不在仓库内 / git 不可用）维持无条件跳过（避免 317MB 被读进内存找 NUL 字节），且新增的两条断言标记为「已跳过（无 git 环境）」而非失败。
- **随本版一并发布（v8.2.2 迭代成果）**：潮汐调和模型升级为**六分潮** `M2/S2/N2/K1/O1/P1` 并按站点 `tideScale` / `tidePhase` 差异化，基准面改为 `offset = Σ振幅 × scale` 使天文潮下限 ≈ LAT、彻底消除低潮钳平假象；新增 `tidalType`（半日潮 / 混合半日潮）、`springNeap`（大 / 中 / 小潮，由窗口潮差相对站点理论最大潮差判定）与 `typicalRange`；潮汐卡片新增今日 / 明日日期标签、「潮型 · 大潮」一行与均值基准线，`app/lib/tides.js` 与 `app-android/www/js/data.js` 双端一致。
- **CI 修复（本次发布实测暴露）**：
  - **`build-android.yml` SDK 安装失败**：Google 已下架旧版 SDK `tools` 包（被 cmdline-tools 取代），而 `android-actions/setup-android@v3` 的 `packages` 默认值为 `'tools platform-tools'`，导致 `sdkmanager` 报 `Failed to find package 'tools'` 并以退出码 1 终止，整个 workflow 在 SDK 安装阶段失败（后续 gradle / 版本号逻辑全部 skipped）。已显式指定 `packages: 'platform-tools platforms;android-34 build-tools;34.0.0'` 覆盖默认值，**不再请求已下架包**；cmdline-tools 仍由该 action 自行准备（v3 默认 12266719 → 16.0，runner 已预装则复用），`ANDROID_HOME` / `ANDROID_SDK_ROOT` 与 `sdkmanager` 仍由该 action 导出，后续流程不变。
  - **Android `versionCode` 计算公式（两段式版本号下的覆盖安装隐患）**：原公式 `version.split('.').reduce((a,b)=>a*100+(+b),0)` 在 `8.3` 这种两段式版本号下会算得 **803**，**低于已发布 v8.2.0 的 80200**，Android 将拒绝覆盖安装（旧 APK 反而装不上）。现改为「版本号先零填充到 3 段（主.次.修）再按 1000 进制累加」，`8.3 → 8003000`，随 `8.0.3 → 8.0.4 → … → 8.2.1 → 8.3` 序列**严格单调递增**，且高于历史任一已发布版本。
  - **EOL 一致性（消除整文件 diff 噪声）**：`app/public/data/version.json`、`app-android/www/data/version.json`、`app-android/www/js/data.js` 三处曾因行尾从 CRLF 变为 LF 而产生整文件级 diff（`js/data.js` 一度显示 1718 增 / 1510 删，实为噪声掩盖真实改动），已恢复仓库既有的 CRLF 约定，使 diff 收敛为真实改动（`js/data.js` 降至 258 增 / 50 删）。
- **修复 9 个 PNG 二进制资源损坏（静默破坏，需随本版重新发布 APK/IPA）**：`app-android/www/icons/*`（4 个 PWA 安装图标）与 `vendor/images/*`（5 个 Leaflet 地图标记）的文件头被替换为 UTF-8 替换字符（签名 `EF BF BD 50 4E 47…` 而非 `89 50 4E 47 0D 0A 1A 0A`）—— 这是某次工具以**文本模式**读写二进制文件造成的，**git 不报错、文件能打开、但浏览器/系统无法解码**。影响面：PWA 安装图标与地图标记全坏，且 `npx cap sync` 会把 `app-android/www` 拷进 APK 资产 → **此前发布的 APK/IPA 图标是坏的**。修复：从历史提交 `04146e7` 恢复原始二进制；新增 `.gitattributes`（`*.png` / `*.jpg` / `*.jpeg` / `*.gif` / `*.ico` / `*.webp` / 字体 / 音视频统一 `binary` 宏 = `-text -diff`，并置于 `text eol=lf` 规则**之后**——git 多规则命中时最后一条生效，若 binary 规则在前会被 `app-android/www/**` 的 `text eol=lf` 重新覆盖，而 PNG 签名本身含 `0D 0A`，会被改写而二次损坏）；同时新增 `tools/check-binary-assets.js` 门禁（magic bytes + PNG chunk 长度/CRC32/IDAT zlib 解压，可抓出「签名被改写」这类静默损坏），并接入 `tools/smoke.js`（102 → **122** 项）。
- **构建可复现性（EOL 语义收敛）**：新增 `.gitattributes` 的 `app/public/**`、`app-android/www/**`、`app/embedded-assets.js` → `text eol=lf`，覆盖 `core.autocrlf`，使 Windows / Linux 工作树形态一致 —— 否则 Windows 提交 CRLF 载荷、CI 重建 LF 载荷，**同一份源码在两端产出两个不同的构建产物**（`app/embedded-assets.js` 内联的是字节载荷，该差异会直接进入单文件 exe）。



## v8.2.3 — EXE 环境实测加固 · 站点代码查询工具 · DNS 兜底（2026-11-02）
- **EXE 单文件实测（首次完整验证）**：用 Node SEA 实际构建并运行 `alphasun-beihai-climate.exe`（84.1MB），在独立部署目录中逐项验证 —— ① **`.exe` 同目录 `config.json` 确实被读取**（日志 `[cfg] 已加载国家海洋信息中心(NMDIS) 潮汐凭证…`）；② 首页与全部静态资源（css/js/geojson/version.json）由内联资源正常提供；③ `/api/tides`、`/api/overview` 返回完整数据；④ 潮汐卡片按新字段（`meanLevel/range/tidalType/springNeap/typicalRange`）输出。
- **修复 EXE 下审计快照污染上级目录（真 bug）**：SEA 中 `__dirname` 指向 **`.exe` 所在目录**（非打包 blob 内部），原 `path.join(__dirname,'..','data')` 会把 `realtime-check.json` 写到 **exe 的上级目录**（实测写到了 `%TEMP%\data`）。新增 `app/lib/paths.js` 收敛运行形态路径（`isSea()` 走 `node:sea`，`dataRoot()` → exe 同目录 / 开发态项目根），`server.js` 改用 `dataPath('data','realtime-check.json')`；实测快照已正确落在 `.exe` 同目录 `data/`，上级目录不再被污染。
- **Windows 防火墙拦截（EXE 部署必踩坑，已写入 INSTALL 排障表）**：exe 换目录运行后，Windows 会为新路径自动生成**入站「阻止」规则**（实测 6 条 Block 规则，且 Block 优先于 Allow），表现为「双击无反应 / 浏览器打不开 localhost:8765」。INSTALL.md 已给出管理员 `netsh advfirewall` 放行与删阻止规则的具体命令。
- **NMDIS 站点代码查询/回填工具（新增 `tools/nmdis-portlist.js`）**：实测确认 NMDIS「获取站点列表」接口**全量鉴权**（`GetPortList`/`GetPortTideData` 未授权均返回 `{"code":"1000.1","message":"用户未授权"}`），三港真实 SiteCode 属付费订购内容（500 元/站/年），**公开渠道不可得、不可凭猜测硬编码**。故提供工具替代人工抄码：`--appid/--secret` 或环境变量或 `config.json` 取凭证 → 查询 → 按站名别名匹配三港 → 打印真实 SiteCode 与匹配依据 → `--write` 自动回填 `config.json` 的 `tideSiteCodes`（`--all` 可导出全量站点人工挑选）。
- **站点匹配从「朴素子串」升级为「别名 + 坐标消歧」（新增 `app/lib/tideSites.js`）**：原 `nameMatch` 仅按站名子串匹配，**会命中辽宁铁山港等外省同名港**。新逻辑：① 站名别名命中（中文/英文/简称，如 `铁山港`/`TIESHANGANG`/`铁山`、`涠洲岛`/`WEIZHOU`/`涠洲`）；② 同名多候选 → 按 `Coordinate` 就近消歧；③ 站名完全未命中 → 30km 内坐标兜底（结果标注 `via`）。`app/lib/tides.js`（Node/EXE）、`tools/nmdis-portlist.js`、`app-android/www/js/data.js`（安卓内联副本）三处共用同一套规则。
- **DNS 兜底直连（新增 `app/lib/nmdisHttp.js`）**：实测本机 DNS（114DNS）对 `service-tide.nmdis.org.cn` 返回 **NXDOMAIN**，而 8.8.8.8 / 阿里 DoH 可正常解析（221.239.0.155）—— 即便用户配好凭证也会**静默降级为演示模型**且无提示。新增访问层：标准 DNS 失败（ENOTFOUND/EAI_AGAIN）时自动经**阿里 / 腾讯 DoH** 解析并以显式 `Host` 头直连 IP（NMDIS 为明文 HTTP，故可行），日志打印 `[nmdis] 本机 DNS 无法解析…已通过 DoH 直连 <IP> 完成请求`。已在 EXE 内实测生效。
- **回归门禁扩容**：`tools/smoke.js` 由 **73 项扩至 102 项**（新增第 4 组「NMDIS 站点代码解析」：坐标格式解析 7 例、别名/坐标消歧/兜底匹配、4 种返回结构兼容、以及 EXE 路径与 DNS 兜底层的接入断言），全绿 102/0。新增断言固化：`parseCoord` 必能解析十进制度+方位（此前因度符号被设为必需而整体失配）、纯十进制对不得误把第二数当「分」、`nameMatch` 不得回归、SEA 落盘路径不得回退。
- **文档**：INSTALL.md 新增「exe 同目录 config.json」「站点代码怎么填」「排障表」三节；`app/config.example.json` 注释同步；`package.json` 版本号 8.2.1 → 8.2.3。

## v8.2.2 — 潮汐调和模型真实化 · 卡片展示增强（2026-11-02）
- **潮汐调和模型真实化（无凭证时的 EXE 展示基础）**：原模型（`M2+S2+K1+O1`，均值 1.6、低潮被 `Math.max(0,h)` 钳平）存在低潮平底假象与站点无差异问题。现升级为**六分潮** `M2/S2/N2/K1/O1/P1`，并按站点 `tideScale`/`tidePhase` 差异化（北海港/铁山港/涠洲岛形态有别），基准面改为 `offset = Σ振幅 × scale` 使天文潮下限≈LAT、彻底消除钳平；`app/lib/tides.js` 与 `app-android/www/js/data.js` 双端一致。
- **朔望大潮/小潮自动判别**：`finalizeTide` 新增 `tidalType`(半日潮/混合半日潮)、`springNeap`(大潮/中潮/小潮，由窗口潮差相对站点理论最大潮差判定) 与 `typicalRange`；因 M2–S2/N2 拍频，标签随农历朔望自然在「大潮→中潮→小潮」间约 14–15 天摆动（实测：大潮峰值潮差≈3.4m、小潮谷值≈1.0–1.6m），符合北部湾潮情。
- **极值检测净化**：模型连续波形上的 15min 插值微抖与近均值次要拐点曾被误标为「低潮 3.5m」；`modelExtremes` 现加入显著起伏阈值(PROM=0.18m)与最小间隔(MIN_GAP_H=2.5h)、强制高/低交替（保留离均值更远者），并改由模型路径**直接采用其自带的正确高/低类型**（不再经 `classifyExtremes` 的严格交替重分类，避免误标）；双端一致。
- **潮汐卡片展示增强**：`renderTides` 高低潮表日期列改为**今日/明日**本地化标签（跨日回退 M/D），新增「潮型 `<半日潮>` · `<大潮>`」一行；`tideWaveSVG` 在曲线内新增**均值基准线**（虚线灰）与既有警戒线并列，便于判断当前潮位相对均值/警戒的位置；Web 与安卓 `app.js` 同步。
- **凭证注入已就位（上一轮）延续**：EXE 双击运行时 `server.js` 从 `config.json`(含 `.exe` 同目录回退) 注入 `NMDIS_APPID/APPSECRET`，`tides.js` 改为**懒读取** `process.env`，使「已配置却仍显示模型估算」的问题根除；安卓端 `data.js` 凭证来自 `window.ALPHASUN_CONFIG`（加载期即就绪，平台正确，保持不变）。仍须用户注册 NMDIS 并填入真实 `siteCode`(`tideSiteCodes`) 方切换官方预报。
- 回归门禁 `tools/smoke.js` 维持 73/0 全绿（语法/双端一致/render/历法），潮汐改动均落在非字节同步文件集内，不触发前端镜像漂移。

## v8.2.1 — 性能与代码质量优化（已发布 · 2026-11-01）
- **概览响应短期缓存（性能·韧性）**：`/api/overview` 单次触发 40+ 外部请求（气象/空气/海洋/地震/台风/预警/7 源实况/区域/气候…），新增 60s 内存 TTL 缓存，显著降低上游负载与首屏延迟，并对上游瞬时抖动更具韧性；缓存对象只读复用，不引入状态风险。
- **实况覆盖补全彩云源（一致性）**：`applyRealtimeOverride` 原先把 `caiyunRes` 当死参数丢弃；配置 `CAIYUN_TOKEN` 时现将其纳入实时覆盖优先级（中国气象局 > 中国天气网 > 和风天气 > 彩云天气 > wttr.in），使彩云实况不仅参与交叉校核、也参与实时天气静默覆盖。
- **霞光概率去重（可维护性）**：`sunsetGlow`/`sunriseGlow` 合并为 `evaluateGlow(station, isMorning)`，去除约 80% 重复代码，原因子文案逐字保留、行为零变化（黄昏=`色彩/霞光`、早晨=`朝霞`、冬春清晨雾削弱仅作用于早晨）。
- **野火采集清理（健壮性）**：`fetchFires` 去掉冗余 `AbortController ?` 三元判断，直接使用原生 `AbortController`。
- **实况归一化去重（可维护性）**：新增 `buildCurrent(spec)` 统一实况 `current` 归一化（类型规整 + WMO 文本/图标兜底 + feels 缺省回退 temp + 气压≤0 归零 + 云量缺失归 100 + uv 一位小数 + vis 容错），7 个实时源 fetcher（和风天气/中国天气网/中国气象局/彩云/wttr.in/yr.no 及 Open-Meteo 区域）统一复用，去除 7 处重复的 `current` 对象构造；Web 端 `app/lib/sources.js` 与安卓端 `app-android/www/js/data.js` 双端保持一致。
- 回归门禁 `tools/smoke.js` 维持 73/0 全绿（语法/双端一致/render/历法）。

## v8.2.0 — 页脚开源地址 · 多端自动更新 · EXE 构建纳入 CI · 文档梳理
- **页脚版本与开源地址（需求①）**：页面底部新增版本号展示 + **GitHub / Gitee 开源地址链接** + 「检查更新」入口；`version.json` 升级为统一更新清单（含 `github`/`gitee`/`releases` 与 `downloads` 各平台稳定下载 URL）。
- **多端自动更新（需求②）**：新增前端更新检查器 `checkUpdate()`——启动后及每 30 分钟请求服务端 `/api/latest`（服务端代理 GitHub raw 的 `version.json`），与当前版本比较；发现新版本按运行平台（智能体 / Windows / Linux / macOS / Android / iOS / 网页）给出对应下载或重载指引，页脚「检查更新」可手动触发；无外网时静默跳过。后端新增 `/api/version`（返回当前版本清单）与 `/api/latest`（服务端代理上游最新清单）接口。
- **打包与发布（需求③）**：新增 `.github/workflows/build-exe.yml`——推送 `main` 后自动构建 Windows / Linux / macOS 三平台单文件 exe 并发布到 **GitHub Release**（因 GitHub 仓库单文件 100MB 上限，`pkg`/`@yao-pkg/pkg` 上游基础二进制已 404 失效，故改用 **Node.js SEA** 方案：`esbuild` 单文件 bundle + `postject` 注入官方 Node 二进制，运行时零依赖）。`app/package.json` 的 `build:exe` 改为调用 `build-exe.js`；Android `build-android.yml` 增加原生版本号注入（与 web 版本一致）。iOS IPA 由 `build-ios.yml` 在 macOS runner 构建并发布到同一 GitHub Release（资产 `alphasun-beihai-climate-ios.ipa`——免签版用 Sideloadly + 免费 Apple ID 自装，配置 Apple 开发者密钥则为签名版）。
- **下载入口统一（全平台 Release）**：exe / linux / macos / ipa / **apk** 五类产物统一发布到 **GitHub Release**（资产名 `alphasun-beihai-climate.{exe,linux,macos,ipa,apk}`），下载入口统一为 `releases/latest/download/`；`build-android.yml` 改为发布 APK 到 Release（不再写回 `downloads/`）。双端 `version.json` 的 `downloads.*` 全部指向 Release；README 新增「文档导航」串联设计 / 实施 / 安装 / 说明等子文档。
- **文档梳理（需求④）**：刷新 README / SKILL / INSTALL / CHANGELOG 至 v8.2.0 并纠正旧下载链接；`knowledge-base/` 设计 / 使用 / 分发文档补充自动更新章节；项目技能包同步至共享技能目录 `~/.workbuddy/skills/alphasun-beihai-climate/`，并推送 GitHub + Gitee。
- 门禁 `tools/smoke.js` 扩至 54 项（新增断言：页脚含 GitHub/Gitee 链接、更新接口、下载面板右移等），双端一致性保持。

## v8.1.4 — 实时气候态势三要素单行 · 世界时钟对时右移 · 顶部时钟3D外框 · 链接面板右移
- **实时气候态势与建议三要素合并单行**：「实时气候态势与建议」每条告警的「官方发布来源 / 简要事项内容 / 建议处置」由三段分行改为一行（`.cl-al-line` 横向 flex，自动换行），信息更紧凑；建议处置仍可被点击弹出详细处置建议弹窗，官方源链接保留。
- **世界时钟对时区右移**：「🌐 世界时钟」面板的「🕒 对时」按钮与对时信息（偏差/往返）由下方独立行改为置于机械钟 + 电子钟右侧（`.wc-top` 行布局，`wc-sync` 用 `margin-left:auto` 推到右侧并加虚线分隔），视觉上"对时"紧邻时钟。
- **顶部电子时钟 3D 外框 + 毫秒弱化**：顶栏居中数字时钟整体加 3D 立体边框（渐变背景 + 内外阴影 + `perspective` 凸起感）；时分秒后的毫秒部分拆出 `.clk-ms` 独立样式——字号缩小（19px→11px）、颜色转为暗淡（`--muted` + 透明度 0.6），不再抢眼。
- **推荐天气/数据源网站面板右移**：「推荐天气 / 数据源网站」面板从中间列移入右侧列、置于「📅 日历」模块之后，右侧信息流更聚合（日历 → 推荐网站）。
- 门禁 `tools/smoke.js` 扩至 48 项（新增断言固化：实时态势单行、世界时钟对时右置、链接面板右移、顶部时钟毫秒/3D 外框）；双端一致性保持（sync-frontend 镜像 3 文件）。

## v8.1.3 — 告警可点击官方源 · 实时气候态势重排 · 多源校核更名
- **告警可点击原始链接（需求①）**：「活跃告警」与「极端天气告警」点开具体告警后，新增「🔗 查看官方发布详情 ↗」链接（`target=_blank` 打开权威源页面）；外部源（USGS 地震事件页、nmc.cn 预警、台风 id 详情）使用真实 url，无原生 url 的灾种（大风/高温/强降水/野火/风暴潮等）按灾种映射权威源（CMA 广西 / 12379.cn / nmc.cn / FIRMS 等）。
- **实时气候态势与建议重排（需求②）**：「实时气候态势与建议（针对当前极端气候告警）」展开格式调整为：保留告警事项 → 增加告警官方来源链接 → 简要事项内容 → 简要建议处置（**取消「▶ 」前缀**）；简要建议处置变为可点击链接，点击弹出「详细处置建议」弹窗（`ADVICE_DETAIL`，灾种×等级多句），覆盖 13 灾种。
- **多源校核更名 + 综合判定突出（需求③）**：「多源实况校核」模块更名为「🛰 多源气候数据校核」；模块内「综合判定」改为高亮卡片（渐变边框 + accent 标签 + 加粗），文字显著度提升。
- 后端 `alerts.js` 新增 `srcUrlFor(type)`（灾种→权威源映射）、`ADVICE_DETAIL`/`detailFor(type,lv)`（详细处置建议双层）、告警 `push()` 补齐 `url`+`adviceDetail`；门禁 `tools/smoke.js` 扩至 42 项（覆盖三需求断言），双端一致性保持。

## v8.1.2 — 预报去置信标注 · 多源校核扩至7源(新增国内CMA) · 日历融合黄历干支
- **「7日/15日周期预报」移除「预测置信」展示**：两个预报模块不再显示「🛰 预测置信：多源实况一致度 高 · 预测可信」信息（去除 `fcConfHtml` 注入），界面更聚焦预报本身。
- **多源实况校核新增国内权威源（扩至 7 源）**：在原有 Open-Meteo / wttr.in / 彩云 / 和风天气(QWeather) / 挪威气象局(yr.no) 基础上，新增 **中国天气网（国家气象中心，城市级·北海 101301301）** 与 **中国气象局(CMA，北海国家基本气象站 59644)** 两个免密钥国内官方源；`verifyRealtime` 交叉校核矩阵现覆盖 7 源。`fetchCmaLive` 历史城市码 bug（101300501 实为桂林）已修正为北海 101301301。
- **校验结果静默应用到看板（不改变展示）**：扩展 `applyRealtimeOverride`，将多源优选实况（优先级 中国气象局 > 中国天气网 > 和风天气 > wttr.in）静默 `Object.assign` 到实时天气 `current`，仅改数据、不做应用标注、不新增可见元素，满足"结果应用到其他模块但不改变原有展示效果"。
- **「农历日历」改名「日历」并融合黄历 + 干支历**：模块标题改为「📅 日历」；由 vendored `lunar-javascript`（`vendor/lunar.js`，零依赖静态资产）驱动，每日格新增「宜X」小标且可点击查看详情弹窗，弹窗含 **干支历（年/月/日柱）+ 农历 + 宜/忌 + 冲煞 + 二十八宿(吉凶) + 彭祖百忌 + 值神 + 喜神方位**；顶栏数字时钟日期处同步显示干支年。黄历为传统历法推算，界面已注明"趋避仅供参考"。
- 门禁增强：`tools/smoke.js` 校核 mock 扩至 7 源（新标签 中国天气网(国家气象中心)/和风天气(QWeather)/中国气象局(CMA)），断言"预测置信"不再出现、日历改名、黄历库干支/宜忌/冲煞/星宿/彭祖百忌可用；双端一致性保持。

## v8.1.1 — 多源校验增强 · 移除顶栏可信度 · 校验结果联动全板
- **移除顶部「🛰 数据可信度」芯片**：顶栏不再常驻展示「数据可信度 高 · N%（M/N 源可达）」（避免与实况模块信息冗余）；相关结论统一保留在「多源实况校核」模块内。
- **多源实况校核新增独立数据源（yr.no / 挪威气象局）**：`fetchMetNoLive` 免费免密钥，与 Open-Meteo、wttr.in 构成 3 个独立实时源；配置 `QWEATHER_KEY` / `CAIYUN_TOKEN` 后还可纳入中国天气网(CMA)、彩云天气，共 5 源。默认可达 3/5（不再显示尴尬的 2/4）。
- **逐字段交叉校验矩阵**：`verifyRealtime` 新增 `fields`（气温/湿度/风速/气压/降水），按字段列出各源读数与离散度，模块以「源×字段」表格可视化校验；差异较大的字段标注不一致（如 wttr.in 与 Open-Meteo/yr.no 气温差 >1.5℃ 时高亮）。
- **校验结果联动全板（数据共享）**：① 实时天气模块顶部显示「✓ 实况多源校验一致（N 源）」徽标；② 预报模块显示「预测置信：多源实况一致度 …」提示；③ 气候模块新增「气候距平」（当前实况 vs 1991–2020 月均态，如 8 月均温 28.8℃、当前 29℃，距平 +0.2℃），将校验结论应用到气候数据。
- 门禁同步增强：`tools/smoke.js` 移除 dqChip 断言、新增 yr.no / 交叉校验表 / 三处联动断言（25 项全绿）。

## v8.1.0 — 跨模块联动 · 单源同步 · 日常可用性（持续迭代）
- **顶部「🛰 数据可信度」芯片（模块联动 / 数据共享）**：由「多源实况校核」结论一次性派生（一致度 · 置信度 · 可达源数），顶部常驻可见；点击平滑滚动并高亮「多源实况校核」模块，实现模块间真实联动。结论同时沉淀为 `state.dataQuality`，供其它模块复用，避免重复计算。
- **刷新可用性（日常可用）**：刷新按钮增加「刷新中…」忙碌态（禁用+降透明度）；顶部新增「下次自动刷新 N 分 N 秒」实时倒计时；自动刷新（10 分钟）改为复用同一刷新逻辑并重绘 24h 曲线。
- **告警 → 实时天气 / 地图 跨模块定位（模块联动）**：告警详情与「涉北海」列表中新增「📍 在实时天气 / 地图中定位」按钮，点击即切换监测站、重绘实时/空气/海洋/天文/霞光/预报与曲线，并滚动高亮实时卡、聚焦地图，使告警情报与地理/站测上下文联动。
- **前端单源同步工具 `tools/sync-frontend.js`**：以 `app/public` 为权威源，将 5 个共享文件镜像到 `app-android/www`，固化 Web 端与 Android 端一致，杜绝双端漂移（Android 专属文件 vendor/sw.js/manifest/icons/js/data.js 保留不动）。
- **回归测试门禁 `tools/smoke.js`**：语法检查（web/android app.js、map.js、server.js）+ 双端一致性 + vm 沙箱全量 render 运行时（完整 mock state）+ 农历/节气/干支历断言（2026 丙午年、正月初一、中秋、2033 闰月不抛错），作为「每轮迭代不可回退」护栏。
- 版本号统一升至 **v8.1.0**（两处 index.html + 两个 package.json）。

---


## v8.0.5 — 江河水文 · 水库水情模块（合并主分支，对齐已发布 APK v8.0.5）
- **版本对齐**：版本号由 v8.0.3 统一升至 **v8.0.5**，与已发布的 Android APK v8.0.5 对齐；默认分支（main）经合并 fix-android-alerts 后现已包含江河/水库模块。
- **江河水文面板**：列出北海主要江河档案——南流江（广西最大独流入海河，经合浦入廉州湾）、洪潮江（南流江支流）、西门江、白沙河、公馆河、南康江、福成河、三合口江；含河流类型、入海口/归属、说明。
- **水库水情面板**：列出北海主要水库档案——洪潮江水库（大(2)型·总库容约7.03亿m³·北海重要饮用水源地）、牛尾岭水库（中型·2550万m³·市区唯一在用湖库型饮用水水源地）、鲤鱼地、石康、闸口；含规模、位置、总库容、功能、饮用水源属性。
- **实现**：config.js 新增 RIVER_PROFILE / RESERVOIR_PROFILE 档案常量；sources.js 新增 fetchRiverReservoir() 接入 buildOverview 顶层 riverReservoir 字段；前端 index.html 新增两面板容器、app.js 新增 renderRiverReservoir() 渲染。
- **数据性质（重要）**：北海本地江河实测站与水库的实时源（广西水文中心、水利部）当前网络不可程序化对接，fetchRiverReservoir 内置 5s 实时可用性探测（实测 unreachable）；界面明确标注“数据性质：档案（实时源不可达）”，依据广西水文中心/北海市政府/北海新闻网等公开资料整理，非实时站测，绝不冒充实时。
- 鲤鱼地/石康/闸口水库精确参数待核实（条目已标注待核实）。
- **Android APK 自动发布**：CI（`build-android.yml`）增强为构建后自动发布 APK（v8.0.5，含江河/水库模块）；工作流改动经 GitHub Actions 重建并写回仓库，无需本地 Android SDK。（注：v8.0.5 当时发布到 `downloads/`；**v8.2.0 起统一改发 GitHub Release**，资产名 `alphasun-beihai-climate.apk`。）
## v8.0.3 — 世界时钟模块
- 在「推荐天气 / 数据源网站」面板下方新增**世界时钟**模块：
  - 精美圆形传统**机械钟**（SVG 表盘 / 60 刻度 / 阿拉伯数字 / 时分秒三针 + 毫秒平滑扫秒）。
  - 大字号**数字钟**（`HH:MM:SS.mmm`，毫秒高亮）。
  - 时间列表：设备时间、**北京时间**、UTC、纽约、伦敦、东京、巴黎、洛杉矶、悉尼、莫斯科、迪拜、新加坡（自动夏令时，`Intl.DateTimeFormat` IANA）。
  - **对时功能**：顶栏「🕒 对时」调用新增 `GET /api/time`（SNTP-lite：测往返时延估算服务器时刻、计算设备偏差并校准显示）；状态行显示偏差与往返时延；默认未对时使用设备时间。
  - 精度：`performance.now()` 亚毫秒平滑 + `Date` 毫秒显示，机械针随毫秒连续扫动；`requestAnimationFrame` 走时。
- 主题适配：表盘 / 指针 / 秒针色改用 CSS 变量，深浅色均清晰。

## v8.0.2 — 实时天气「区域概况」合并 + 声音警报 + 单一警报指示
- 实时天气：将「区域数据」（覆盖面积 / 覆盖人口）移入「区域形状」组内、置于形状右侧，整组更名为**「区域概况」**。
- **声音警报**：顶栏「警报」旁新增 🔇 按钮（默认关闭）；Web Audio 双音报警（零外部文件），仅在有活跃告警且开启时每 4s 循环播放；点击即用户手势创建音频上下文（满足自动播放策略）。
- **单一警报指示**：仅保留顶部 `#alertStatus`（⚠ 警报闪烁 / ✅ 无警报绿色）为唯一「警报」；原等级徽标改为「涉北海 N」关系标签，消除顶部两个「警报」重复。

## v8.0.1 — 实时天气三栏并列
- 实时天气卡重构为「实时天气 ∥ 区域概况」两栏并列：实时天气指标卡片 +「区域概况」（区域形状左、覆盖面积/覆盖人口右），窄栏自动换行、放大模态下并排完整呈现。

## v8.0.0 — 界面重构 + 深/浅色主题
- **实时天气布局重构**：大温标 + 天气文字 + 体感头部，6 项指标改为等宽卡片网格，留白合理不再拥挤。
- **极端天气告警标题去括号**：标题后直接分隔显示红色数量徽标，数量为 0 时弱化。
- **顶部警报 / 无警报指示器**：有告警红色闪烁「⚠ 警报」，无告警绿色「✅ 无警报」。
- **版本升级至 8.0.0** + 引入**深 / 浅色主题**（CSS 变量），顶栏按钮切换，默认深色，localStorage 持久化；图表 / 地图 / SVG 随主题联动。

## v7.0.3 — 地理区域联动 + 模块点击放大
- 地理区域选择后，「实时天气」卡展示**区域概况**：覆盖面积（km²）、覆盖人口（万）、真实行政区轮廓缩略图（`regionShapeSVG`，DataV 边界简化，5 区）。
- **点击任意模块标题 → 页面中央放大**展示该板块与数据（`openFocus`/`closeFocus`）；地图移动 Leaflet 容器、曲线重绘 Chart、其余面板克隆 HTML 放大。
- 行政区面积/人口（2020 普查）与边界轮廓写入 `lib/config.js`，`lib/sources.js` 透传 `area/pop/poly`。

## v7.0.2 — 六项 UI 改进 + 单文件化
1. 右列新增「早晨霞光概率」。
2. 地理区域选择（5 区）迁至右列置顶，选中态图标（✓）。
3. 顶部情报可点击查看全部情报。
4. 左列新增「15 日周期预报」，24h 曲线移至 7 日预报之前。
5. 气候分析动态化（针对当前涉北海告警给结论与处置建议）。
6. 顶部等级徽标涉/可能涉及北海时变红脉冲，点击看北海相关告警。
7. **单文件 exe**（Node SEA + 打包）双击即运行；作者署名更新。

## v7.0.1 — 三项交互增强
1. 顶部活跃告警情报可点击查看详情。
2. 极端气候告警情报改进为自动滚动播报（每 6s，带「自动播报中」状态）。
3. 极端天气告警移至左栏顶部 + 标题标红（`.danger-h`）。

## v7.0.0 — 七项核心增强
1. 真实 GeoJSON 边界（DataV 450500，含涠洲岛）。
2. 情报条自动滚动播报 + 手动/暂停 + 点击详情。
3. 活跃告警标注区域 + 北海关联（涉及北海 / 可能涉及北海）。
4. 全景地图灾害带「距北海」数据。
5. 标题带版本 + 作者署名。
6. 地图下方：气候解说 + 数据分析 + 推荐天气/数据源网站。
7. 地图叠加图层（卫星/雷达/降水/风力/温度/扰动/风场/海浪/副高 · 实况+预报）。

## v8.1.0 — 江河水文表格化 · 版本自升级 · 黄历日历
- **江河水文/水库水情表格化**：原两面板改为美观的**可滚动表格**（斑马纹 + 悬停高亮 + 表头吸附），新增长度、流域面积、兴利库容等字段，数据来源/性质/更新时间常驻表头上方。
- **版本自检与一键升级**：新增 `APP_VERSION` 常量与 `checkUpdate()`，启动即自检并每 30 分钟轮询；更新源为 GitHub Pages（`data/version.json`，CORS 开放，Android 经 CapacitorHttp 原生请求无跨域限制），失败自动回退 raw.githubusercontent。
  - **Web / PWA**：发现新版本点击「立即升级」即刷新页面（并尝试更新 Service Worker 缓存）。
  - **Android APK**：点击「立即升级」打开最新 APK 下载（若 App 注入 `window.__alphasunInstall` 桥则走应用内下载安装），下载后允许“未知来源”安装即可。
  - 顶栏新增「🔄 更新」按钮可手动检查；后端新增 `GET /api/version` 返回当前版本。
- **日历模块（原“农历日历”）升级**：
  - 融合**黄历**：每日宜/忌（建除十二神推算）、冲煞（三合局煞方）、二十八宿（含吉凶）、彭祖百忌（日干+日支）。
  - 融合**干支历**：年柱/月柱/日柱/时柱（五虎遁+五鼠遁）；顶部时钟农历处同步显示干支年。
  - 交互：日历格点日期弹出**黄历详情**（公历/农历/干支历/建除/宜忌/冲煞/星宿/彭祖百忌/法定节假日），保留翻月/回到今天。
  - 标注：黄历/干支历为传统推算，仅供文化参考。
