import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const root = resolve(web, '..');

const snapshot = join(web, 'public', 'data', 'ccus_public.sqlite');
const builder = join(root, 'tools', 'build_web_db.py');
const venvPython = join(
  root,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const python = existsSync(venvPython)
  ? venvPython
  : process.platform === 'win32'
    ? 'python'
    : 'python3';

if (existsSync(builder)) {
  try {
    execFileSync(python, [builder], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
  } catch (e) {
    if (existsSync(snapshot)) {
      console.warn('[web] 快照重建失败，沿用已有快照：', snapshot);
    } else {
      throw e;
    }
  }
}

// 浏览器加载 sql-wasm-browser.wasm，Node 版加载 sql-wasm.wasm；debug 版不用
const wasmDir = join(web, 'node_modules', 'sql.js', 'dist');
const WASM_FILES = ['sql-wasm-browser.wasm', 'sql-wasm.wasm'];
if (existsSync(wasmDir)) {
  for (const name of WASM_FILES) {
    const src = join(wasmDir, name);
    if (existsSync(src)) copyFileSync(src, join(web, 'public', name));
  }
  for (const stale of readdirSync(join(web, 'public')).filter((f) => f.endsWith('.wasm'))) {
    if (!WASM_FILES.includes(stale)) rmSync(join(web, 'public', stale));
  }
} else {
  console.warn('[web] 未找到 sql.js 的 wasm 文件，先执行 npm install');
}
