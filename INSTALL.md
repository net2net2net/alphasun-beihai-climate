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

#### A-1. exe 同目录放 config.json（启用和风天气 / NMDIS 权威潮汐）
把 `app/config.example.json` 复制一份为 **`config.json`**，与 `.exe` **放在同一目录**，填入密钥后重启 exe 即可生效：

```jsonc
{
  "qweatherKey": "和风天气 KEY",          // 可选：CMA 实况校核源
  "nmdisAppId": "NMDIS AppID",            // 启用权威潮汐预报（见 A-2）
  "nmdisAppSecret": "NMDIS AppSecret",
  "tideSiteCodes": { "bhg": "", "tsg": "", "wzd": "" }  // 可选：显式指定各港站点代码
}
```
启动日志会打印确认行：
- `[cfg] 已加载和风天气 KEY…` → 生效
- `[cfg] 已加载国家海洋信息中心(NMDIS) 潮汐凭证…` → 生效
- `[cfg] 未配置…` → 未读到，请确认 `config.json` 与 exe **同目录**（不是 `app/` 子目录）

exe 运行时的落盘位置（已适配 SEA 单文件包）：
| 内容 | 位置 |
|---|---|
| 配置文件 | `.exe` 同目录 `config.json` |
| 实况校核审计快照 | `.exe` 同目录 `data/realtime-check.json` |

#### A-2. NMDIS 权威潮汐：三港站点代码怎么填
北海三港（北海港 / 铁山港 / 涠洲岛）在国家海洋信息中心(NMDIS) 的**真实 SiteCode 需注册订购后由接口返回**（电子潮汐表 500 元/站/年），无法从公开网页查到，**不要凭猜测硬编码**。

本系统提供两条路，二选一：
- **推荐（零手工）**：只在 `config.json` 填 `nmdisAppId` / `nmdisAppSecret`。程序首次取数时自动调用 NMDIS「获取站点列表」接口，按站名别名（中文/英文/简称）匹配三港，同名时用坐标消歧（防止匹配到辽宁铁山港等外省同名港），结果缓存 24h。启动日志会打印 `[tide] 已从 NMDIS 解析站点代码：bhg=xxx(站名匹配) …`。
- **手工兜底**：用查询工具一条命令拿到代码并自动回填 `config.json`：

```bash
node tools/nmdis-portlist.js --appid <ID> --secret <SECRET> --write
# 只看不写：去掉 --write ；导出全部站点人工挑选：加 --all
```

`tools/nmdis-portlist.js` 会打印三港的真实 SiteCode 及匹配依据（站名命中 / 坐标消歧 / 坐标兜底）与到标称点的距离，便于人工复核。

#### A-3. 排障
| 现象 | 原因与处理 |
|---|---|
| 双击无反应 / 浏览器打不开 http://localhost:8765 | **Windows 防火墙拦截**：exe 换目录后，Windows 可能为新路径自动生成「阻止」入站规则。需**以管理员身份**运行 PowerShell 执行 `netsh advfirewall firewall add rule name="AlphaSun" dir=in action=allow program="<exe完整路径>" enable=yes`，并删除同名「阻止」规则（Windows 规则中阻止优先于允许）。 |
| 控制台打印 `[tide] NMDIS 站点列表解析失败（凭证无效或网络不可达）` | ① 凭证无效/未订购该接口；② 本机 DNS 解析不到 `service-tide.nmdis.org.cn`（部分国内 DNS 会返回 NXDOMAIN）。②本系统已内置 **DoH 兜底**（阿里 / 腾讯），会自动直连解析出的 IP，日志出现 `[nmdis] 本机 DNS 无法解析…已通过 DoH 直连 <IP> 完成请求` 即为兜底生效；仍失败请检查网络或改用公共 DNS。 |
| 潮汐卡片显示「调和模型估算(演示)」 | 未读到凭证或官方接口失败，属预期降级（不影响其他模块）。 |
| 8765 端口被占用 | 设环境变量 `PORT=9000` 后再运行。 |

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
- **iOS（ipa）**：Sideloadly + 免费 Apple ID 自签安装（证书 7 天有效，到期重签）；已签名版（需配置 Apple 开发者密钥）可 AltStore/企业/App Store 分发。
- **网页 / PWA**：服务端资源更新后刷新即生效。
- 检测机制：前端每 30 分钟请求服务端 `/api/latest`（代理 GitHub raw 的 `version.json`）比对版本；页脚「检查更新」可手动触发；无外网静默跳过。

## 自然语言调用
按 SKILL.md 的 `description` / `When to Use` 触发，例如：
「运行北海气候全景系统」「部署北海极端气候监测面板」「把这个气候系统打包分发给其他智能体」。
