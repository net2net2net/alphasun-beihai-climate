# AlphaSun · 北海极端气候全景系统 — 单文件 exe 使用说明

> 构建版本标注：**v8.2.0** ｜ 作者：阳光 net2net2net（Vx: net2net）｜ 许可：MIT

本说明对应仓库 **GitHub Release** 中发布的单文件可执行程序。该文件由本项目源码构建，内置 Node.js 运行时与全部前端资源，**无需安装 Node.js、无需任何外部文件**，一个 exe 即可运行整套系统。

> 说明：因 GitHub 仓库单文件 100MB 上限，三平台 exe（约 84–120MB）统一发布到 **GitHub Release**，不再入库 `downloads/`；安卓 APK（约 4MB）仍走仓库 `downloads/`。

## 一、文件信息

| 项目 | 内容 |
|------|------|
| 文件名 | `alphasun-beihai-climate.exe`（Windows）／`alphasun-beihai-climate-linux`（Linux）／`alphasun-beihai-climate-macos`（macOS） |
| 构建版本 | v8.2.0（与 `version.json` 一致，页脚与 `/api/version` 可见） |
| 大小 | Windows 约 84MB ／ Linux 约 120MB ／ macOS 约 108MB（内置 Node 运行时 + 全部前端资源） |
| 格式 | 各平台 64 位单文件可执行（**Node.js SEA** 方案，esbuild 单文件 bundle + postject 注入官方 Node 二进制） |
| 下载 | 见 GitHub Release（始终最新）：https://github.com/net2net2net/alphasun-beihai-climate/releases/latest/download/alphasun-beihai-climate.exe |

## 二、运行方式（最简单）

### Windows
1. 从 **GitHub Release（最新版）** 下载 `alphasun-beihai-climate.exe`：
   https://github.com/net2net2net/alphasun-beihai-climate/releases/latest/download/alphasun-beihai-climate.exe
2. **双击**该 exe 文件。
3. 程序会自动启动内置服务，并**自动打开浏览器**访问：
   ```
   http://localhost:8765
   ```
4. 若浏览器未自动打开，请手动在浏览器地址栏输入上述地址。
5. 关闭：直接关闭浏览器标签页，并结束该 exe 进程（黑色控制台窗口）即可。

### Linux / macOS
```bash
# 赋予可执行权限后运行
chmod +x alphasun-beihai-climate-linux        # 或 alphasun-beihai-climate-macos
./alphasun-beihai-climate-linux               # 浏览器自动打开 http://localhost:8765
```
> macOS 为 ad-hoc 签名：首次运行若被「无法验证开发者」拦截，请到「系统设置 → 隐私与安全性」中点击「仍要打开」。

> 说明：程序默认监听本机 `8765` 端口。如端口被占用，可用环境变量 `PORT=新端口` 覆盖（见下文），或重新构建。

## 三、使用前提

- **需要联网**：系统实时天气、地震、台风、卫星云图等数据来自 Open-Meteo、USGS、中央气象台等公开数据源，运行 exe 的机器需可访问外网。
- **操作系统**：Windows 64 位（10 / 11 及以上）；Linux x64；macOS 12+（Intel / Apple Silicon 均支持，Apple Silicon 走 Rosetta 或原生 arm64 镜像）。
- **防火墙**：首次运行如提示「是否允许访问网络」，请选择**允许**（否则无法获取数据）。

## 四、可选环境变量

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `PORT` | 服务监听端口 | `8765` |
| `OPEN` | 启动后是否自动打开浏览器 | `1`（开；设 `0` 禁止） |

示例（Windows PowerShell）：
```powershell
$env:PORT=9000; $env:OPEN=0; .\alphasun-beihai-climate.exe
```

## 五、关于杀毒软件误报

单文件 exe 由 **Node.js SEA** 将运行时与脚本注入官方 Node 二进制而成，部分杀毒软件可能对其**误报**。这属于已知现象，并非程序含恶意代码：

- 如遇拦截，可将本 exe 加入杀软**白名单 / 信任区**后重试；
- 或参照下方「六、如需自行重新构建 exe」从源码重新构建；
- 本程序源码完全开源（GitHub / Gitee），可审阅后自行构建以彻底消除疑虑。

## 六、如需自行重新构建 exe（Node SEA）

仓库已提供一键重建脚本 `app/build-exe.js`（跨平台通用，无需 `pkg`）：

```bash
cd app
npm install esbuild postject   # 构建期依赖（仅打包用，运行时零依赖）
npm run build:assets           # 将 public/ 内联为 embedded-assets.js
npm run build:exe              # 输出 app/dist/（三平台：alphasun-beihai-climate.exe / -linux / -macos）
```

- 原理：`esbuild` 把 `server.js` + `lib/*` + `embedded-assets.js` 打成单文件 CJS bundle → `node --experimental-sea-config` 生成 blob → 复制对应平台官方 Node 二进制 → `postject` 注入 blob。
- 产物 `app/dist/` 与 `*.exe` 默认不纳入 git（见 `.gitignore`），由 CI 自动构建并发布到 GitHub Release。
- 旧方案 `pkg` / `@yao-pkg/pkg` 的上游基础 Node 二进制已 404 失效，故迁移至 Node SEA（详见 `app/build-exe.js` 与 `.github/workflows/build-exe.yml`）。

## 七、数据来源与免责

- 陆地 / 海洋 / 空气质量 / 洪涝：**Open-Meteo**
- 地震：**USGS** GeoJSON
- 台风与气象预警：**中央气象台（nmc）**
- 中国气象局实况校核（多源交叉验证）：**和风天气 QWeather**（配置 KEY 后作为 `cma` 源，可选）
- 天文与晚霞概率：**服务端本地计算**
- 卫星云图 / 雷达：经中央气象台代理叠加

本系统仅供北海防风防汛、防灾应急、海岛作业窗口判断与夜巡排班**参考**，不构成官方预警；关键决策请以权威部门发布信息为准。
