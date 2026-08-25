#!/usr/bin/env bash
# =====================================================================
#  AlphaSun · 北海极端气候全景系统 — 单文件 exe 一键重建 (Linux/macOS)
#  用法: bash rebuild-exe.sh   (在 app/ 目录执行)
#  产物: app/dist/alphasun-beihai-climate.exe (node22-win-x64, 跨平台)
#  说明: dist/ 与 *.exe 已被 .gitignore 排除，不入库。
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "============================================================"
echo " AlphaSun 单文件 exe 重建向导 (Linux/macOS)"
echo "============================================================"
echo

# --- [0] 环境检查 ---
if ! command -v node >/dev/null 2>&1; then
  echo "[X] 未检测到 Node.js，请先安装 Node 16+。"
  exit 1
fi
echo "[OK] 检测到 Node: $(node -v)"

# --- [1/4] 生成内联静态资源 ---
echo
echo "[1/4] 生成内联静态资源 (embedded-assets.js) ..."
npm run build:assets

# --- [2/4] 确保 pkg 就绪 (本地安装优先) ---
echo
echo "[2/4] 检查 pkg 构建工具 ..."
if [ -x "node_modules/.bin/pkg" ]; then
  echo "  pkg 已在本地 node_modules，跳过安装。"
elif command -v pkg >/dev/null 2>&1; then
  echo "  检测到全局 pkg，直接使用。"
else
  echo "  pkg 未安装，本地安装中 (--no-save) ..."
  npm install pkg --no-save
fi

# --- [3/4] 构建单文件 exe (带重试) ---
echo
echo "[3/4] 构建单文件 exe (node22-win-x64) ..."
MAX_TRY=3
TRY=1
while [ "$TRY" -le "$MAX_TRY" ]; do
  echo "  尝试 $TRY/$MAX_TRY ..."
  if npm run build:exe; then
    break
  fi
  TRY=$((TRY + 1))
  if [ "$TRY" -le "$MAX_TRY" ]; then
    echo "  构建失败，3 秒后重试 ..."
    sleep 3
  else
    echo "[X] 构建失败。常见原因与解决:"
    echo "  1. 杀毒软件/防火墙拦截了 pkg 下载 Node 运行时二进制 -> 临时关闭后重试"
    echo "  2. 网络无法访问 GitHub 下载 node 二进制 -> 配置代理或手动放置"
    echo "  3. 权限不足 -> 使用有写权限的目录执行"
    exit 1
  fi
done

# --- [4/4] 完成 ---
echo
echo "[4/4] 构建完成！"
echo "  产物路径: $(pwd)/dist/alphasun-beihai-climate.exe"
echo "  说明:     dist/ 与 *.exe 已被 .gitignore 排除，不入库。"
echo "  运行:     将 exe 拷至 Windows 双击即可启动 (默认端口 8765)"
echo
