#!/usr/bin/env node
'use strict';
/**
 * 本地重建单文件 exe —— Node Single Executable Application (SEA)
 * ------------------------------------------------------------
 * 替代已失效的 pkg / @yao-pkg-pkg（其基础 Node 运行时二进制已从上游下线，404）。
 * 流程：
 *   1) esbuild 把 server.js(+lib/* + embedded-assets) 打成单文件 CJS bundle
 *   2) node --experimental-sea-config 生成 blob
 *   3) 复制本机 Node 二进制为 exe
 *   4) postject 把 blob 注入 exe
 * 需 Node 22+；构建期依赖 esbuild + postject（已列入 devDependencies）。
 */
const { buildSync } = require('esbuild');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP = __dirname;
const DIST = path.join(APP, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const BASE = 'alphasun-beihai-climate';
const ARTIFACT =
  os.platform() === 'win32' ? BASE + '.exe' :
  os.platform() === 'darwin' ? BASE + '-macos' :
  BASE + '-linux';
const DEST = path.join(DIST, ARTIFACT);

function run(cmd, args, opts = {}) {
  console.log('▶', cmd, args.join(' '));
  execFileSync(cmd, args, { stdio: 'inherit', cwd: APP, ...opts });
}

// 0) 重新生成内联资源（确保 public/ 已打进 exe）
console.log('==> 0) 重新生成内联资源 node build-assets.js');
run(process.execPath, ['build-assets.js']);

// 1) esbuild 打包
console.log('==> 1) esbuild 打包 server.js → dist/bundle.js');
buildSync({
  entryPoints: [path.join(APP, 'server.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(DIST, 'bundle.js'),
  logLevel: 'info',
});

// 2) SEA blob
console.log('==> 2) node --experimental-sea-config');
run(process.execPath, ['--experimental-sea-config', path.join(APP, 'sea-config.json')]);

// 3) 复制 Node 二进制
console.log('==> 3) 复制 Node 二进制 →', ARTIFACT);
fs.copyFileSync(process.execPath, DEST);
if (os.platform() !== 'win32') fs.chmodSync(DEST, 0o755);

// 4) postject 注入
console.log('==> 4) postject 注入 SEA blob');
let postject;
try { postject = require.resolve('postject/bin/postject.js'); } catch (_) { postject = null; }
const pjArgs = [DEST, 'NODE_SEA_BLOB', path.join(DIST, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (postject) run(process.execPath, [postject, ...pjArgs]);
else run('npx', ['postject', ...pjArgs], { shell: true });

// 5) macOS 即席签名（绕过 Gatekeeper）
if (os.platform() === 'darwin') {
  try { run('codesign', ['--force', '--sign', '-', DEST]); }
  catch (e) { console.warn('codesign 跳过:', e.message); }
}

const mb = (fs.statSync(DEST).size / 1048576).toFixed(1);
console.log('✅ 构建完成:', DEST, `(约 ${mb} MB)`);
console.log('   双击运行（Linux/macOS 需可执行权限），浏览器自动打开 http://localhost:8765');
