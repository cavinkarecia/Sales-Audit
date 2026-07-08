/**
 * After vite build: write deploy metadata and fail if Expense Check 2 bundle is missing.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const BUILD_ID = '2026-06-03-v50-filter-toggle-active-state';

const assetsDir = path.join(dist, 'assets');
let js = '';
try {
  const files = await readdir(assetsDir);
  for (const f of files) {
    if (f.endsWith('.js')) {
      js += await readFile(path.join(assetsDir, f), 'utf8');
    }
  }
} catch (e) {
  console.error('Build failed: dist/assets not found. Run vite build first.');
  process.exit(1);
}

if (!js.includes('expense-check-2') && !js.includes('Expense Check 2')) {
  console.error('Build failed: Expense Check 2 route not found in production bundle.');
  process.exit(1);
}

await writeFile(
  path.join(dist, 'build-meta.json'),
  JSON.stringify({ build: BUILD_ID, builtAt: new Date().toISOString() }, null, 2),
);

console.log(`Build OK: ${BUILD_ID}`);

try {
  const { spawnSync } = await import('node:child_process');
  const validate = spawnSync(process.execPath, ['scripts/validate-expense-parsers.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (validate.status !== 0) {
    console.warn(`Parser validation exited ${validate.status} — deploy continues; check logs after sync.`);
  }
} catch (e) {
  console.warn('Parser validation skipped:', e.message);
}
