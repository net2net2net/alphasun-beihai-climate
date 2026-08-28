# 安装说明 — alphasun-beihai-climate

AlphaSun 北海极端气候全景系统。可作为**独立软件**运行，也可作为**技能**被其它智能体安装调用。

## 目录
```
alphasun-beihai-climate/
├── SKILL.md         # 技能定义（触发 + 运行流程）
├── README.md        # 软件总览
├── INSTALL.md       # 本文件
├── CHANGELOG.md     # 版本变更总览
├── LICENSE          # MIT 许可
├── app/             # 可独立运行的完整系统（含内置 node 运行时）
└── knowledge-base/  # 完整文档（设计 / 使用 / API / 分发）
```

## 方式一：作为独立软件（人类用户）
### 方式 A：单文件 exe（最简单）
1. 取最新单文件 exe：Windows / Linux / macOS 由 CI 在推送 `main` 后自动发布到 **GitHub Release（releases/latest/download/）**（见 README「下载 / 安装」段），或本地 `npm run build:exe` 生成（输出 `app/dist/`，三平台）。单文件约 84–120MB（各平台），内置 Node 运行时与全部前端资源。
2. **双击运行**（Linux / macOS 赋可执行权限后 `./alphasun-beihai-climate-linux`）→ 浏览器自动打开 http://localhost:8765。
3. 关闭弹出的黑色控制台窗口即停止服务。
> 无需安装 Node.js、无需任何外部文件；可直接拷贝到任意 Windows 机器运行。
> 可选环境变量：`PORT=9000` 修改端口；`OPEN=0` 禁止自动打开浏览器。

### 方式 B：完整目录运行
1. 拷贝整个 `alphasun-beihai-climate` 文件夹到任意位置（或解压 `alphasun-beihai-climate.zip`）。
2. Windows：双击 `app/start.bat`。macOS / Linux：终端执行 `bash app/start.sh`。
3. 浏览器自动打开 http://localhost:8765。
> 单文件 exe 已内置 Node 运行时，**无需安装 Node.js**；完整目录运行（方式 B）需系统具备 Node.js。

## 方式二：WorkBuddy 智能体安装
```bash
cp -r D:/SynologyDrive/Skills/alphasun-beihai-climate ~/.workbuddy/skills/
```
对话中按 SKILL.md 的 `description` 触发；技能会指示智能体在 `app/` 目录执行 `node server.js`。

## 方式三：Hermes / OpenClaw / 小虾 / ClawHub 兼容
```bash
cp -r D:/SynologyDrive/Skills/alphasun-beihai-climate <目标技能根>/skills/
# 或: clawhub install alphasun-beihai-climate
```
读取 SKILL.md 的 `description` 作触发信号。

## 方式四：源代码运行（开发者）
```bash
cd alphasun-beihai-climate/app
PORT=8765 node server.js      # 直接运行，实时改 public/ 刷新即生效（磁盘优先）
```

## 依赖
- 独立运行：**零依赖**（内置 Node 运行时；或单文件 exe）。
- 作为技能由智能体运行：智能体侧具备 Node.js 16+。
- 可选密钥（非必需）：`FIRMS_MAP_KEY`（火点）、`NMDIS_APPID` / `NMDIS_APPSECRET`（权威潮汐）。

## 自动更新（多端）
- **智能体（技能）**：`git pull` 或重新安装技能即更新。
- **Windows / Linux / macOS（exe）**：页脚检测到新版本 → 点「下载 X 版」→ 覆盖原 exe 文件。
- **安卓 Android（APK）**：页脚提示 → 下载最新 APK → 安装覆盖（版本号自增，无需卸载）。
- **iOS（ipa）**：TestFlight 推送或 Sideloadly 重签安装。
- **网页 / PWA**：服务端资源更新后刷新即生效。
- 检测机制：前端每 30 分钟请求服务端 `/api/latest`（代理 GitHub raw 的 `version.json`）比对版本；页脚「检查更新」可手动触发；无外网静默跳过。

## 自然语言调用
按 SKILL.md 的 `description` / `When to Use` 触发，例如：
「运行北海气候全景系统」「部署北海极端气候监测面板」「把这个气候系统打包分发给其他智能体」。
