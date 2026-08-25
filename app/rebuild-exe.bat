@echo off
chcp 65001 >nul
REM =====================================================================
REM  AlphaSun · 北海极端气候全景系统 — 单文件 exe 一键重建 (Windows)
REM  用法: 双击本文件，或在 app/ 目录执行 rebuild-exe.bat
REM  产物: app\dist\alphasun-beihai-climate.exe (node22-win-x64)
REM  说明: dist/ 与 *.exe 已被 .gitignore 排除，不入库。
REM =====================================================================
cd /d "%~dp0"

echo.
echo ============================================================
echo  AlphaSun 单文件 exe 重建向导 (Windows)
echo ============================================================
echo.

REM --- [0] 环境检查 ---
where node >nul 2>nul
if errorlevel 1 (
  echo [X] 未检测到 Node.js，请先安装 Node 16+ 并加入 PATH。
  pause & exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo [OK] 检测到 Node: %%i

REM --- [1/4] 生成内联静态资源 ---
echo.
echo [1/4] 生成内联静态资源 (embedded-assets.js) ...
call npm run build:assets
if errorlevel 1 (
  echo [X] build:assets 失败，请检查 public/ 目录完整性。
  pause & exit /b 1
)

REM --- [2/4] 确保 pkg 就绪 (本地安装优先, 避免全局权限问题) ---
echo.
echo [2/4] 检查 pkg 构建工具 ...
if exist "node_modules\.bin\pkg.cmd" (
  echo   pkg 已在本地 node_modules，跳过安装。
) else (
  where pkg >nul 2>nul
  if not errorlevel 1 (
    echo   检测到全局 pkg，直接使用。
  ) else (
    echo   pkg 未安装，本地安装中 (--no-save) ...
    call npm install pkg --no-save
    if errorlevel 1 (
      echo [X] pkg 安装失败。常见原因: 网络无法访问 npm 源。
      echo       可尝试: npm config set registry https://registry.npmmirror.com 后重试。
      pause & exit /b 1
    )
  )
)

REM --- [3/4] 构建单文件 exe (带重试, 对抗杀软/网络瞬断) ---
echo.
echo [3/4] 构建单文件 exe (node22-win-x64) ...
set MAX_TRY=3
set TRY=1
:build_loop
echo   尝试 %TRY%/%MAX_TRY% ...
call npm run build:exe
if not errorlevel 1 goto build_ok
set /a TRY+=1
if %TRY% leq %MAX_TRY% (
  echo   构建失败，3 秒后重试 ...
  timeout /t 3 >nul
  goto build_loop
)
echo [X] 构建失败。常见原因与解决:
echo   1. 杀毒软件拦截了 pkg 下载 Node 运行时二进制 -> 临时关闭杀软后重试
echo   2. 网络无法访问 GitHub 下载 node 二进制 -> 配置代理或手动放置
echo   3. 权限不足 -> 以管理员身份运行本脚本
pause & exit /b 1

:build_ok
REM --- [4/4] 完成 ---
echo.
echo [4/4] 构建完成！
echo   产物路径: %CD%\dist\alphasun-beihai-climate.exe
echo   说明:     dist/ 与 *.exe 已被 .gitignore 排除，不入库。
echo   运行:     双击 dist\alphasun-beihai-climate.exe 即可启动 (默认端口 8765)
echo.
pause
exit /b 0
