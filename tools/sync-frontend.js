#!/usr/bin/env node
/**
 * AlphaSun 前端单源同步工具（Single-source sync）
 * ------------------------------------------------------------
 * 以 app/public 为权威源，将共享前端文件镜像到 app-android/www，
 * 保证 Web 端（GitHub Pages）与 Android 端（Capacitor）两份前端逐字节一致。
 * Android 专属文件（vendor/、sw.js、manifest.webmanifest、icons/、js/data.js、.nojekyll）
 * 不参与同步、保留不动。
 *
 * 用法：
 *   node tools/sync-frontend.js         镜像（发现漂移则覆盖 android 端）
 *   node tools/sync-frontend.js --check 仅校验漂移，有漂移则退出码 1（供 CI / 提交前检查）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PUB = path.join(ROOT, 'app/public');
const AND = path.join(ROOT, 'app-android/www');
const SYNC = ['index.html', 'css/styles.css', 'js/app.js', 'js/map.js', 'data/beihai.geojson'];
const CHECK = process.argv.includes('--check');

let drift = 0;
console.log(CHECK ? '== 双端漂移检查 ==' : '== 镜像 public -> android/www ==');
for (const f of SYNC) {
  const a = path.join(PUB, f);
  const b = path.join(AND, f);
  if (!fs.existsSync(a)) { console.error('  ! public 缺失: ' + f); drift++; continue; }
  const ca = fs.readFileSync(a);
  const cb = fs.existsSync(b) ? fs.readFileSync(b) : null;
  if (cb === null || ca.toString() !== cb.toString()) {
    drift++;
    if (CHECK) {
      console.log('  DRIFT  ⚠ ' + f);
    } else {
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.writeFileSync(b, ca);
      console.log('  SYNC   ↳ ' + f);
    }
  } else {
    console.log('  ok     ' + f);
  }
}
if (drift) {
  console.log('\n' + drift + ' 个文件' + (CHECK ? '存在漂移（请先以 public 为准同步）' : '已同步'));
  if (CHECK) process.exit(1);
} else {
  console.log('\n双端已一致，无需同步。');
}
