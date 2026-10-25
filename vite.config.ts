import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { shouldSkipTexShip } from './scripts/asset-ship-filter.mjs';

const TEX_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.fbx': 'application/octet-stream',
};

/**
 * P3：dist/tex 只拷 P0 首包资源（远端层走 CDN），这是**默认且唯一合法**的打包行为。
 * 历史事故：漏设开关走 copyDir 全量拷贝，P1 皮肤 2.5GB 全进包 → APK 3GB。
 * 仅本地排障可显式设 SHIP_FULL_TEX=1 全量，禁止用于发布。
 */
const SHIP_FULL_TEX = process.env.SHIP_FULL_TEX === '1';
const SHIP_P0_ONLY = !SHIP_FULL_TEX;

/** 按 ship-manifest-cdn.json 分层清单，只拷 tier=P0 的产物 + 两份清单 */
function copyShipP0Only(shipRoot: string, out: string): void {
  const cdnManifestPath = path.join(shipRoot, 'ship-manifest-cdn.json');
  const manifest = JSON.parse(fs.readFileSync(cdnManifestPath, 'utf8')) as {
    files: Record<string, { tier: string }>;
  };
  let copied = 0;
  for (const [rel, meta] of Object.entries(manifest.files)) {
    if (meta.tier !== 'P0') continue;
    const from = path.join(shipRoot, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(out, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied += 1;
  }
  // 两份清单都必须进 dist：rename map（texUrl 用）+ 分层清单（版本门/下载管理器用）
  fs.copyFileSync(path.join(shipRoot, 'ship-manifest.json'), path.join(out, 'ship-manifest.json'));
  fs.copyFileSync(cdnManifestPath, path.join(out, 'ship-manifest-cdn.json'));
  console.log(`[vite] SHIP_P0_ONLY: ${copied} P0 files + 2 manifests → dist/tex`);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === '.ship-cache.json') continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/** P0 回退：从源 tex 过滤拷贝 */
function copyTexFiltered(src: string, dest: string, relBase = ''): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      copyTexFiltered(from, to, rel);
      try {
        if (fs.existsSync(to) && fs.readdirSync(to).length === 0) fs.rmdirSync(to);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (shouldSkipTexShip(rel).skip) continue;
    fs.copyFileSync(from, to);
  }
}

function staticDirPlugin(route: string, dirName: string): Plugin {
  const root = path.resolve(__dirname, dirName);
  const shipRoot = path.resolve(__dirname, 'tex-ship');

  return {
    name: `${dirName}-assets`,
    configureServer(server) {
      // 开发默认读源 tex/，便于美术改源即时预览（不走 ship）
      server.middlewares.use(`/${route}`, (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] || '/');
        const rel = urlPath.replace(/^\/+/, '');
        const filePath = path.normalize(path.join(root, rel));
        if (!filePath.startsWith(root)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        fs.readFile(filePath, (err, data) => {
          if (err) {
            next();
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          res.setHeader('Content-Type', TEX_MIME[ext] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.end(data);
        });
      });
    },
    closeBundle() {
      if (dirName !== 'tex') {
        if (!fs.existsSync(root)) return;
        copyDir(root, path.resolve(__dirname, 'dist', route));
        return;
      }

      const out = path.resolve(__dirname, 'dist', 'tex');
      if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });

      const shipManifest = path.join(shipRoot, 'ship-manifest.json');
      if (fs.existsSync(shipManifest)) {
        // P1：打包用压缩产物，源 tex/ 不动
        // P3：默认只拷 P0 首包；SHIP_FULL_TEX=1 才是全量（仅排障，禁止发布）
        const cdnManifest = path.join(shipRoot, 'ship-manifest-cdn.json');
        if (SHIP_P0_ONLY && fs.existsSync(cdnManifest)) {
          copyShipP0Only(shipRoot, out);
        } else if (SHIP_FULL_TEX) {
          console.warn('[vite] SHIP_FULL_TEX=1 全量拷贝 tex-ship → APK 会膨胀到数 GB，仅限本地排障！');
          copyDir(shipRoot, out);
        } else if (fs.existsSync(cdnManifest)) {
          throw new Error('缺少 tex-ship/ship-manifest-cdn.json 的分层数据，无法做 P0 瘦身打包。请先运行 npm run assets:build-ship');
        } else {
          copyShipP0Only(shipRoot, out);
        }
      } else if (fs.existsSync(root)) {
        copyTexFiltered(root, out);
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [staticDirPlugin('tex', 'tex'), staticDirPlugin('music', 'music')],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2018',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        stellarSkillPreview: path.resolve(__dirname, 'stellar-skill-preview.html'),
        combatStellarLive: path.resolve(__dirname, 'combat-stellar-live.html'),
      },
    },
  },
});