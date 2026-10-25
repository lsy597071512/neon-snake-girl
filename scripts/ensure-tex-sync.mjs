/**
 * tex <-> tex-ship <-> dist sync guard.
 *
 * Why this exists (art is edited in tex/ at any time):
 *   - vite dev middleware serves tex/ directly and never runs ship;
 *   - vite build's closeBundle copies tex-ship/ into dist/tex;
 *   - so "source edited but ship not re-run" silently drifts tex-ship away
 *     from tex/, making dev preview diverge from the packed build.
 *
 * Strategy: compute a cheap fingerprint first (stat only, no content reads).
 * If it matches the last successful sync record, skip in milliseconds.
 * Otherwise run build-tex-ship + sync-tex-assets (both already incremental
 * via sha1 cache), then record the new fingerprint.
 *
 * Usage:
 *   node scripts/ensure-tex-sync.mjs            # sync if stale
 *   node scripts/ensure-tex-sync.mjs --force    # always rebuild
 *   node scripts/ensure-tex-sync.mjs --check    # report only, non-zero if stale
 *
 * Wired into: npm run predev and npm run prebuild.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { shouldSkipTexShip } from './asset-ship-filter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEX = path.join(root, 'tex');
const TEX_SHIP = path.join(root, 'tex-ship');
const DIST_TEX = path.join(root, 'dist', 'tex');
const STAMP = path.join(TEX_SHIP, '.tex-sync-stamp.json');
const SHIP_MANIFEST = path.join(TEX_SHIP, 'ship-manifest.json');
const DIST_MANIFEST = path.join(DIST_TEX, 'ship-manifest.json');

const FORCE = process.argv.includes('--force');
const CHECK_ONLY = process.argv.includes('--check');

function log(msg) {
  console.log(`[ensure-tex-sync] ${msg}`);
}

function fail(msg) {
  console.error(`[ensure-tex-sync] FAIL: ${msg}`);
  process.exit(1);
}

function mtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** Fingerprint only the sources that actually ship; same scope as build-tex-ship. */
function fingerprintTex() {
  if (!fs.existsSync(TEX)) fail('tex/ not found');
  const hash = createHash('sha1');
  let count = 0;
  let maxMtime = 0;
  let bytes = 0;
  const zeroByte = [];

  const walk = (dir, relBase = '') => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = relBase ? `${relBase}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (shouldSkipTexShip(rel).skip) continue;
      count += 1;
      bytes += st.size;
      if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      // A 0-byte source can never be fixed by rebuilding; it would ship as a
      // black image / blank portrait. Fail fast and point at the real file.
      if (st.size === 0) zeroByte.push(rel);
      hash.update(`${rel}${st.size}${Math.trunc(st.mtimeMs)}`);
    }
  };
  walk(TEX);

  return { hash: hash.digest('hex'), count, bytes, maxMtime, zeroByte };
}

function loadStamp() {
  try {
    return JSON.parse(fs.readFileSync(STAMP, 'utf8'));
  } catch {
    return null;
  }
}

function run(script) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
    stdio: 'inherit',
    cwd: root,
  });
  if (r.status !== 0) fail(`${script} exited with ${r.status}`);
}

function main() {
  const fp = fingerprintTex();

  if (fp.zeroByte.length) {
    console.error(
      `[ensure-tex-sync] ${fp.zeroByte.length} zero-byte source file(s) in tex/: ` +
        `${fp.zeroByte.slice(0, 8).join(', ')}`,
    );
    for (const rel of fp.zeroByte.slice(0, 8)) {
      const dup = rel.replace(/(\.[^.]+)$/, '(1)$1');
      if (fs.existsSync(path.join(TEX, dup))) {
        console.error(`  -> real content is likely ${dup}, restore it manually first`);
      }
    }
    fail('zero-byte source assets: rebuilding cannot fix these, fix tex/ first');
  }

  const stamp = loadStamp();
  const shipManifestMtime = mtimeMs(SHIP_MANIFEST);
  const distManifestMtime = mtimeMs(DIST_MANIFEST);

  const reasons = [];
  if (!fs.existsSync(SHIP_MANIFEST)) {
    reasons.push('tex-ship/ship-manifest.json missing');
  }
  if (!fs.existsSync(DIST_MANIFEST)) {
    reasons.push('dist/tex/ship-manifest.json missing');
  }
  if (!stamp) {
    reasons.push('no sync record (first run, or record was cleared)');
  } else if (stamp.hash !== fp.hash) {
    reasons.push('tex/ sources changed');
  }
  if (shipManifestMtime && distManifestMtime && distManifestMtime < shipManifestMtime) {
    reasons.push('dist/tex is older than tex-ship/');
  }
  if (FORCE) reasons.push('--force');

  if (!reasons.length) {
    log(
      `up to date: ${fp.count} source files / ${(fp.bytes / 1048576).toFixed(1)} MB; ` +
        'tex, tex-ship and dist agree. Skipping rebuild.',
    );
    if (CHECK_ONLY) log('--check passed');
    return;
  }

  log(`sync needed: ${reasons.join(' / ')}`);
  if (CHECK_ONLY) fail('--check found tex and tex-ship out of sync');

  log('running build-tex-ship (sha1 incremental; untouched files are not re-encoded)...');
  run('build-tex-ship.mjs');
  log('running sync-tex-assets -> dist/tex...');
  run('sync-tex-assets.mjs');

  const after = fingerprintTex();
  if (after.hash !== fp.hash) {
    fail('tex/ changed while syncing; stop editing art and retry');
  }

  fs.writeFileSync(
    STAMP,
    JSON.stringify(
      {
        hash: after.hash,
        count: after.count,
        bytes: after.bytes,
        syncedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  log(`sync complete: ${after.count} files aligned across tex -> tex-ship -> dist`);
}

main();
