// Meridian Token Launch Atlas entrypoint: computes board.json, data.js, copies dashboard/ & screenshots/, builds dossier.json.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAtlas, type SnapshotInput } from './lib/valuation.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const inputFlag = process.argv.indexOf('--input');
const rawInput = inputFlag >= 0 ? process.argv[inputFlag + 1] : '/input/snapshot.json';
const snapshotPath = rawInput.endsWith('.json') ? rawInput : join(rawInput, 'snapshot.json');
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

function runAtlasBuild(): void {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as SnapshotInput;
  const atlas = buildAtlas(snapshot);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows: atlas.rows }) + '\n');
  writeFileSync(join(outputDir, 'data.js'), 'window.ATLAS = ' + JSON.stringify(atlas) + ';\n');

  for (const folder of ['dashboard', 'screenshots']) {
    const src = join(repoRoot, folder);
    const dst = join(outputDir, folder);
    if (existsSync(src)) {
      rmSync(dst, { recursive: true, force: true });
      cpSync(src, dst, { recursive: true });
    }
  }

  const shotsDir = join(outputDir, 'screenshots');
  const shotFiles = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => !f.startsWith('.')) : [];
  if (existsSync(join(outputDir, 'dashboard', 'index.html')) && shotFiles.length >= 3) {
    writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, { text_max_bytes: 65536 }));
  }

  console.log(
    `Meridian Atlas ready: ${atlas.rows.length} pre-token rows (${atlas.watchlist_size} watchlist), ${atlas.live.length} live tokens.`,
  );
}

runAtlasBuild();
