#!/bin/bash
# AlphaSun · 北海极端气候全景系统 — 独立启动脚本 (Linux / macOS)
cd "$(dirname "$0")"
PORT=${PORT:-8765}
if [ -x node/node ]; then NODE=node/node; else NODE=node; fi
"$NODE" server.js > /tmp/alphasun.log 2>&1 &
sleep 3
URL="http://localhost:$PORT"
(xdg-open "$URL" || open "$URL" || python3 -m webbrowser -t "$URL") >/dev/null 2>&1 &
echo "AlphaSun 已启动: $URL   (日志: /tmp/alphasun.log)"
