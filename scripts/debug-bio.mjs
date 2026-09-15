import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const content = fs.readFileSync(path.join(__dirname, '../src/data/sr-bios.ts'), 'utf8');

const key = 'ashcrow';
const blockRe = new RegExp(`${key}:\\s*\\{[\\s\\S]*?detailedBio:\\s*\`([\\s\\S]*?)\`,\\s*homeRegion`, 'm');
const m = content.match(blockRe);
console.log('captured length', m[1].length);
console.log('double newline count', (m[1].match(/\n\n/g) || []).length);
console.log('ends with', JSON.stringify(m[1].slice(-80)));
console.log('first 130 chars', JSON.stringify(m[1].slice(0, 130)));
