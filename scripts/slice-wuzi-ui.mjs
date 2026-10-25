/**
 * 五子棋切图：从 tex/Small_game/01/wuzi_ui.png（2048×2048 切图集）切出命名件。
 * 坐标为 2048 实际像素（背景透明，带少量余量裁切）。
 * 注意：不要对切件用 sharp.trim()——顶角像素 alpha=0 时 trim 会抛 bad extract area。
 * 产出：tex/Small_game/01/parts/*.png（管线随后转 webp 进 P0 包）。
 * 用法：node scripts/slice-wuzi-ui.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'tex/Small_game/01/wuzi_ui.png');
const OUT_DIR = path.join(root, 'tex/Small_game/01/parts');

/** name → [left, top, width, height]（2048 实际坐标，含余量） */
const SLICES = {
  // 浅色棋盘主框（含 GOMOKU 标题/底部条/网格）；网格线实测 x140→758、y196→806
  board_frame: [46, 50, 812, 868],
  // 独立 GOMOKU 标题条（浅色）
  title_bar: [46, 1466, 540, 148],
  // 棋子（大）：黑 / 白
  stone_black: [824, 944, 194, 202],
  stone_white: [829, 1209, 190, 194],
  // 红色落子标记（准星）
  mark_last: [1169, 1084, 104, 94],
  // 状态药丸行（y≈1860-1935）
  pill_black: [18, 1856, 250, 100],
  pill_white: [246, 1856, 248, 100],
  pill_turn: [478, 1856, 296, 100],
  pill_thinking: [756, 1856, 288, 100],
  pill_win: [1018, 1856, 234, 100],
  pill_draw: [1312, 1856, 210, 100],
  pill_restart: [1522, 1856, 220, 100],
  pill_back: [1752, 1856, 200, 100],
  // X 关闭按钮
  btn_close: [1904, 1334, 104, 88],
  // 深色长面板（状态/奖惩区背景）
  panel_dark: [48, 1626, 536, 190],
  // 红光槽（倒计时条外框）
  timer_frame: [666, 1466, 330, 80],
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const img = sharp(SRC);
  const meta = await img.metadata();
  if (meta.width !== 2048 || meta.height !== 2048) {
    console.warn(`[slice-wuzi-ui] 警告：切图集尺寸 ${meta.width}x${meta.height}，坐标按 2048 标定`);
  }
  for (const [name, [left, top, width, height]] of Object.entries(SLICES)) {
    const out = path.join(OUT_DIR, `${name}.png`);
    await sharp(SRC)
      .extract({ left, top, width, height })
      .png()
      .toFile(out);
    const m = await sharp(out).metadata();
    console.log(`[slice-wuzi-ui] ${name}: ${m.width}x${m.height}`);
  }
  console.log(`[slice-wuzi-ui] 完成 → ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
