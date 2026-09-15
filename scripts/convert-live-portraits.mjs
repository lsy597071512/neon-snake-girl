/**
 * 清理动态立绘历史衍生格式（WebP / APNG / GIF 等）。
 * 主资源仅保留 tex/juese/*.webm，无需再运行转换。
 *
 * 用法: npm run convert-live-portraits
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'tex', 'juese');
if (!fs.existsSync(dir)) {
  console.log('tex/juese 不存在，跳过');
  process.exit(0);
}

const legacy = /\.(webp|gif|mp4|mov)$/i;
const livePng = /_live\.png$/i;
let removed = 0;

for (const name of fs.readdirSync(dir)) {
  if (!legacy.test(name) && !livePng.test(name)) continue;
  fs.unlinkSync(path.join(dir, name));
  console.log(`已删除: ${name}`);
  removed++;
}

const webmCount = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.webm')).length;
console.log(`\n完成。删除 ${removed} 个旧衍生文件，保留 ${webmCount} 个 webm 主资源。`);
