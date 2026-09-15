import fs from 'fs';
const content = fs.readFileSync(new URL('../src/data/sr-bios.ts', import.meta.url), 'utf8');
const orig = '大崩解那年，零号月台的邮差队在沙暴里捡回一台仍在运转的突击单元。她醒来后不记得编制编号，只记得「把路打开」这条残余指令。此后她习惯走在队伍最前，用最短的话确认风向与威胁——不是勇敢，而是认定有人必须先踏入未知。锈带纪元里，她把「抵达」当成信仰。';
const re = /ashcrow:\s*\{[\s\S]*?detailedBio:\s*`([\s\S]*?)`,\s*homeRegion/m;
const m = content.match(re);
const fp = m[1].split(/\n\n/)[0].replace(/\r/g, '').trim();
console.log('equal', fp === orig);
console.log('fp len', fp.length, 'orig len', orig.length);
for (let i = 0; i < Math.max(fp.length, orig.length); i++) {
  if (fp[i] !== orig[i]) {
    console.log('diff at', i, fp.charCodeAt(i), orig.charCodeAt(i));
    console.log('fp snippet', JSON.stringify(fp.slice(i, i + 20)));
    console.log('orig snippet', JSON.stringify(orig.slice(i, i + 20)));
    break;
  }
}
