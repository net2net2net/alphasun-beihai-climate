# AlphaSun · 北海极端气候全景系统 — 单文件 exe 使用说明

> 构建版本标注：**v8.0.2** ｜ 作者：阳光 net2net2net（Vx: net2net）｜ 许可：MIT

本说明对应仓库 Release 中的单文件可执行程序 **`alphasun-beihai-climate8.0.2.exe`**。该文件由本项目源码构建，内置 Node.js 运行时与全部前端资源，**无需安装 Node.js、无需任何外部文件**，一个 exe 即可运行整套系统。

## 一、文件信息

| 项目 | 内容 |
|------|------|
| 文件名 | `alphasun-beihai-climate8.0.2.exe` |
| 构建版本标注 | v8.0.2（系统源文档版本为 v8.0.5，二进制构建标签以本文件名为准） |
| 大小 | 87,420,928 字节（约 83.4 MB） |
| **MD5** | **`c7f3433bb7d5675c59fc52dde34e8afe`** |
| 格式 | Windows 64 位单文件可执行（pkg 打包，target node22-win-x64） |
| 下载 | 见仓库 Release：`alphasun-exe-8.0.2` |

## 二、运行方式（最简单）

1. 从仓库 **Release（`alphasun-exe-8.0.2`）** 下载 `alphasun-beihai-climate8.0.2.exe`。
2. **双击**该 exe 文件。
3. 程序会自动启动内置服务，并**自动打开浏览器**访问：
   ```
   http://localhost:8765
   ```
4. 若浏览器未自动打开，请手动在浏览器地址栏输入上述地址。
5. 关闭：直接关闭浏览器标签页，并在系统托盘/任务管理器结束该 exe 进程即可。

> 说明：程序默认监听本机 `8765` 端口。如端口被占用，可改源码后重新构建（见知识库文档）。

## 三、使用前提

- **需要联网**：系统实时天气、地震、台风、卫星云图等数据来自 Open-Meteo、USGS、中央气象台等公开数据源，运行 exe 的机器需可访问外网。
- **操作系统**：Windows 64 位（Windows 10 / 11 及以上）。
- **防火墙**：首次运行如提示「是否允许访问网络」，请选择**允许**（否则无法获取数据）。

## 四、关于杀毒软件误报

单文件 exe 由 `pkg` 将 Node.js 运行时与脚本打包而成，部分杀毒软件可能对其**误报**。这属于已知现象，并非程序含恶意代码：

- 如遇拦截，可将本 exe 加入杀软**白名单 / 信任区**后重试；
- 或参照仓库 `knowledge-base/` 文档，自行从源码重新构建（构建命令见下方）；
- 下载后请先按下方方法**校验 MD5**，一致即可放心使用。

## 五、MD5 校验方法（下载后务必核对）

### Windows
打开命令提示符（CMD）或 PowerShell，执行：
```bat
certutil -hashfile alphasun-beihai-climate8.0.2.exe MD5
```
将输出与上方 MD5 `c7f3433bb7d5675c59fc52dde34e8afe` 比对，一致即文件完整未被篡改。

### Linux / macOS
```bash
md5sum alphasun-beihai-climate8.0.2.exe
# 或 macOS：
md5 alphasun-beihai-climate8.0.2.exe
```

## 六、如需自行重新构建 exe

仓库已提供一键重建脚本（详见 PR #1 / `app/rebuild-exe.bat`、`app/rebuild-exe.sh`）：
```bash
cd app
npm run build:assets      # 将 public/ 内联为 embedded-assets.js
npm i -g pkg              # 安装打包器（首次）
npm run build:exe         # 输出 app/dist/alphasun-beihai-climate8.0.2.exe
```
> 产物 `dist/` 与 `*.exe` 默认不纳入 git（见 `.gitignore`）；本 Release 中的 exe 为单独发布。

## 七、数据来源与免责

- 陆地 / 海洋 / 空气质量 / 洪涝：**Open-Meteo**
- 地震：**USGS** GeoJSON
- 台风与气象预警：**中央气象台（nmc）**
- 天文与晚霞概率：**服务端本地计算**
- 卫星云图 / 雷达：经中央气象台代理叠加

本系统仅供北海防风防汛、防灾应急、海岛作业窗口判断与夜巡排班**参考**，不构成官方预警；关键决策请以权威部门发布信息为准。
