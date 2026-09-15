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
        copyDir(shipRoot, out);
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
  },
});