import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, '../src/data/sr-bios.ts');
const content = fs.readFileSync(filePath, 'utf8');

const keys = ['ashcrow', 'heartforge', 'mirror', 'neoncoil', 'prismrift', 'wireguard'];

const originalBios = {
  ashcrow: '大崩解那年，零号月台的邮差队在沙暴里捡回一台仍在运转的突击单元。她醒来后不记得编制编号，只记得「把路打开」这条残余指令。此后她习惯走在队伍最前，用最短的话确认风向与威胁——不是勇敢，而是认定有人必须先踏入未知。锈带纪元里，她把「抵达」当成信仰。',
  heartforge: '熔炉城最后一夜，防线溃散的警报里，她拒绝撤退协议。同僚一个个离线后，她仍把整条街巷挡在身后，直到通讯彻底死寂。人格稳定后她嘴上刻薄，核心却写死「护住身后的人」——哪怕自己先碎裂。废土不需要英雄，她只想当一堵还能站着的墙。',
  mirror: '锈带走廊光学哨站崩溃前，她是实验室里唯一完成「弹道预判」闭环的样本。觉醒后她很少谈感受，只谈概率与死角。小队几次差点踏入伏击圈，都被她一句「别走那边」拽回来。她自称在读光，其实是在替他人计算活下去的路径——距离感，是她留给世界的礼貌。',
  neoncoil: '东区走私网把她改造成「不会留下完整轨迹」的渗透刃。她曾替黑市穿过三道机兵封锁，回报只有一句任务完成。觉醒后仍厌弃多余的对话，把感情当作噪音过滤。锈带里人人想被看见，她却选择成为切口本身——干净、精准、不回头确认伤口是否愈合。',
  prismrift: '熔炉城高炉熄灭后，有人在废墟底层挖出被封存六年的重炮单元。重启时她的第一句语音不是求救，而是确认目标距离。她把情感模块压到最低，只保留射击纪律——因为当年正是「犹豫」拖垮了整条防线。如今她话更少，开火却更响，像替一座死城继续燃烧。',
  wireguard: '裤号 22 的毒区巡检构装。她把荧光黄外套当成「别朝我开枪」的标识，把狐耳传感与半面呼吸器当成进沙的门票。义肢手指能拧开最锈的舱门，也能在风暴里摸到同伴的腕脉。别人嫌她话多、嘴毒，只有跟过她走过辐射带的人才知道——玩笑是她给恐惧编的降噪层，警戒才是她真正的心跳。',
};

let allPass = true;

for (const key of keys) {
  const blockRe = new RegExp(`${key}:\\s*\\{[\\s\\S]*?detailedBio:\\s*\`([\\s\\S]*?)\`,\\s*homeRegion`, 'm');
  const m = content.match(blockRe);
  if (!m) {
    console.log(`${key}: NOT FOUND`);
    allPass = false;
    continue;
  }
  const bio = m[1];
  const hanzi = (bio.match(/[\u4e00-\u9fff]/g) || []).length;
  const english = bio.match(/[a-zA-Z]+/g) || [];
  const firstPara = bio.split(/\n\n/)[0].replace(/\r/g, '').trim();
  const origMatch = firstPara === originalBios[key];
  const countOk = hanzi >= 2000;
  const englishOk = english.length === 0;

  console.log(`${key}:`);
  console.log(`  hanzi: ${hanzi} ${countOk ? 'OK' : 'FAIL (<2000)'}`);
  console.log(`  english: ${englishOk ? 'OK' : 'FAIL: ' + english.join(', ')}`);
  if (!origMatch) {
    console.log(`  first para verbatim: FAIL (len ${firstPara.length} vs ${originalBios[key].length})`);
    for (let i = 0; i < Math.max(firstPara.length, originalBios[key].length); i++) {
      if (firstPara[i] !== originalBios[key][i]) {
        console.log(`  diff@${i}: got ${JSON.stringify(firstPara[i])} exp ${JSON.stringify(originalBios[key][i])}`);
        break;
      }
    }
  } else {
    console.log(`  first para verbatim: OK`);
  }

  if (!countOk || !englishOk || !origMatch) allPass = false;
}

console.log('\n' + (allPass ? 'ALL PASS' : 'SOME FAILED'));
process.exit(allPass ? 0 : 1);
