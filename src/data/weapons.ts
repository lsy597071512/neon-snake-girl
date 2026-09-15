import type { WeaponDef } from '../types';

export const WEAPONS: WeaponDef[] = [
  { id: 'w01', name: '锈管手枪', rarity: 'N', power: 15, icon: '🔧', sellPrice: 35, desc: '邮差队制式，几乎人手一把' },
  { id: 'w02', name: '沙暴切割刃', rarity: 'N', power: 18, icon: '🗡️', sellPrice: 35, desc: '载具弹簧磨成的近战刃' },
  { id: 'w03', name: '拾荒者钉枪', rarity: 'N', power: 20, icon: '📌', sellPrice: 40, desc: '建筑废墟最常见防身工具' },
  { id: 'w04', name: '辐射标枪', rarity: 'R', power: 35, icon: '☢️', sellPrice: 90, desc: '勘探队遗留的标记武器' },
  { id: 'w05', name: '齿轮左轮', rarity: 'R', power: 38, icon: '⚙️', sellPrice: 90, desc: '熔炉城警备队配枪' },
  { id: 'w06', name: '脉冲短弓', rarity: 'R', power: 40, icon: '🏹', sellPrice: 95, desc: '电磁弦实验武器' },
  { id: 'w07', name: '废铁霰弹', rarity: 'R', power: 42, icon: '💥', sellPrice: 100, desc: '管道工自制清场利器' },
  { id: 'w08', name: '霜线刺针', rarity: 'E', power: 65, icon: '❄️', sellPrice: 240, desc: '白棺谷极寒注射弹头' },
  { id: 'w09', name: '熔心焊枪改', rarity: 'E', power: 68, icon: '🔥', sellPrice: 240, desc: '工业焊枪军用改装版' },
  { id: 'w10', name: '灰鸦信号枪', rarity: 'E', power: 70, icon: '📡', sellPrice: 250, desc: '可发射干扰弹的求救武器' },
  { id: 'w11', name: '机兵拆解锯', rarity: 'E', power: 72, icon: '🪚', sellPrice: 260, desc: '从机兵身上拆下再装回去' },
  { id: 'w12', name: '谐振冲锋枪', rarity: 'E', power: 75, icon: '📻', sellPrice: 270, desc: '频谱校准过的连射武器' },
  { id: 'w13', name: '星核碎片炮', rarity: 'L', power: 110, icon: '✨', sellPrice: 650, desc: '星核外装甲锻造小型炮' },
  { id: 'w14', name: '零号月台防卫者', rarity: 'L', power: 115, icon: '🚂', sellPrice: 650, desc: '移动指挥车标配武器' },
  { id: 'w15', name: '大崩解纪念铳', rarity: 'L', power: 120, icon: '💀', sellPrice: 680, desc: '大崩解最后一批制式步枪' },
  { id: 'w16', name: '白棺谷冻结弹', rarity: 'L', power: 125, icon: '🧊', sellPrice: 700, desc: '冻结机兵关节的特种弹' },
  { id: 'w17', name: '锈带审判者', rarity: 'L', power: 130, icon: '⚖️', sellPrice: 720, desc: '聚落法庭没收的改装重武' },
  { id: 'w18', name: '纪元重启协议', rarity: 'L', power: 140, icon: '🔮', sellPrice: 750, desc: '枪身刻有一行乱码 REBOOT_00' },
  { id: 'w19', name: '锻渣倾泻者', rarity: 'L', power: 145, icon: '🧡', sellPrice: 780, desc: '橙铠机体热平衡炮改型' },
  { id: 'w20', name: '终末方舟主炮', rarity: 'L', power: 160, icon: '🚀', sellPrice: 800, desc: '旧世界方舟计划残留火力' },
];

export const WEAPON_MAP = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

export const ARMORY_WEIGHTS: Record<number, Record<string, number>> = {
  1: { N: 70, R: 28, E: 2, L: 0 },
  2: { N: 55, R: 38, E: 7, L: 0 },
  3: { N: 42, R: 43, E: 14, L: 1 },
  4: { N: 30, R: 42, E: 24, L: 4 },
  5: { N: 20, R: 38, E: 32, L: 10 },
  6: { N: 12, R: 35, E: 35, L: 18 },
  7: { N: 8, R: 30, E: 37, L: 25 },
  8: { N: 5, R: 25, E: 35, L: 35 },
};

export const ARMORY_UPGRADE_COST = [0, 600, 1400, 3200, 7500, 16000, 35000, 75000];
export const ARMORY_UPGRADE_MINUTES = [0, 5, 12, 30, 60, 120, 240, 480];

export function openCost(level: number): number {
  if (level <= 2) return 80;
  if (level <= 5) return 120;
  return 160;
}

export const PACK_PRICES = {
  normal: 600,
  advanced: 1800,
  legendary: 4500,
};

export const GIFT_PRICES = [50, 120, 300];
