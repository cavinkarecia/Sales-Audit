/**
 * Downloads upstream Sales-Audit assets from GitHub.
 * Run: node scripts/download-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const base =
  'https://raw.githubusercontent.com/cavinkarecia/Sales-Audit/master';

const files = [
  'src/data/cities.json',
  'src/data/auditors.json',
  'src/data/asm_mapping.json',
  'src/data/asm_territory.json',
  'src/data/india_topo.json',
  'src/utils/geoUtils.js',
  'src/utils/travelMapUtils.js',
  'src/components/LeafletTravelMap.jsx',
  'src/components/AttendanceDashboard.jsx',
  'src/components/ExcelUpload.jsx',
  'src/components/IndiaLiveMap.jsx',
  'src/components/IndiaMap.jsx',
  'src/components/SalesAuditDashboard.jsx',
  'src/components/analytics/AbsenteeismRCA.jsx',
  'src/components/analytics/AsmCoverageMap.jsx',
  'src/components/analytics/ReasonAnalysis.jsx',
  'public/icons.svg',
  'eslint.config.js',
  '.npmrc',
];

for (const rel of files) {
  const url = `${base}/${rel}`;
  const out = path.join(root, rel);
  await mkdir(path.dirname(out), { recursive: true });
  process.stdout.write(`Fetching ${rel} … `);
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`SKIP (${res.status})`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  console.log(`${buf.length} bytes`);
}

console.log('\nDone.');
