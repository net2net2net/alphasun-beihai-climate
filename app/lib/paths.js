// AlphaSun · 北海极端气候全景系统 — 运行时路径解析（Node 端）
// ---------------------------------------------------------------------------
// 为什么需要这个模块：
//   本项目支持三种运行形态，同一路径表达式在三种形态下解析结果不同。
//     1) 开发态：node app/server.js          → __dirname = <root>/app
//     2) 打包态：node app/dist/bundle.js      → __dirname = <root>/app/dist
//     3) 单文件 EXE（Node SEA）：__dirname = <.exe 所在目录>   ← 关键差异
//   SEA 下 __dirname 指向 exe 目录，若沿用 `path.join(__dirname, '..', 'data')`
//   的历史写法，落盘文件会写到 **exe 的上级目录**（污染父目录，甚至因权限失败）。
//   故此处统一收敛「数据根目录」解析：SEA → exe 同目录；其余 → 项目根目录。
//
// 影响面（v8.2.3 起）：
//   - data/realtime-check.json（多源实况校核审计快照）改为写入 exe 同目录/data/
//   - config.json 读取路径本就覆盖了两种形态（app/ 与 exe 同目录），逻辑保持不变

'use strict';
const path = require('path');

/** 是否运行在 Node Single Executable Application（单文件 exe）中 */
function isSea() {
  try { return require('node:sea').isSea(); } catch (e) { return false; }
}

/**
 * 运行时「数据根目录」（可写）。
 * - SEA 单文件 exe：.exe 所在目录（config.json / data/ 都落在这里，随程序搬家）
 * - 开发态 / 打包态：项目根目录（app/ 的上一级）
 */
function dataRoot() {
  if (isSea()) {
    try { return path.dirname(process.execPath); } catch (e) { /* 继续降级 */ }
  }
  // app/lib/paths.js → app/lib → app → 项目根；app/dist/bundle.js → app/dist → app → 项目根
  return path.resolve(__dirname, '..', '..');
}

/** 数据根目录下的子路径（自动确保父目录可写时由调用方处理） */
function dataPath(...parts) {
  return path.join(dataRoot(), ...parts);
}

module.exports = { isSea, dataRoot, dataPath };
