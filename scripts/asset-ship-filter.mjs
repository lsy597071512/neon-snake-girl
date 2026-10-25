/**
 * P0 打包过滤：决定哪些 tex 源文件进入 dist（ship）。
 * 规则：永不修改 / 删除 tex/ 源文件；只影响拷贝到 dist 的集合。
 *
 * 排除类：母带、废稿目录、未引用分镜弧线、切图母版、绿幕中间件、AI 流水线中间件。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** tex/ 根目录（本模块位于 scripts/ 下） */
const TEX_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tex');

/** @type {Map<string, boolean>} dama 打码版存在性缓存（rel → 是否有打码对应物） */
const stickerCounterpartCache = new Map();

/**
 * 判断 juese/pifu/** 下的未打码 webm 是否存在 dama/<名>_sticker.webm 打码对应物。
 * 命名规则：原版 X.webm ↔ 打码版 dama/X_sticker.webm（同目录 dama 子文件夹）。
 */
function hasStickerCounterpart(rel) {
  const cached = stickerCounterpartCache.get(rel);
  if (cached !== undefined) return cached;
  const abs = path.join(TEX_ROOT, ...rel.split('/'));
  const stem = path.basename(abs).replace(/\.webm$/i, '');
  const hit = fs.existsSync(path.join(path.dirname(abs), 'dama', `${stem}_sticker.webm`));
  stickerCounterpartCache.set(rel, hit);
  return hit;
}

/**
 * 路径统一为正斜杠、小写，便于匹配 */
export function normRel(rel) {
  return rel.replace(/\\/g, '/');
}

/**
 * 硬规则 v3.1：没有任何 src/ 文件（含 .ts/.tsx/.js/.cjs/.mjs/.json/.html）静态引用
 * 的 tex/ 资源不应进入进包集。
 *
 * 用法：
 *   const refs = buildSrcReferenceSet(projectRoot); // 一次性扫描
 *   if (!isReferencedBySrc(rel, refs)) skip...
 *
 * 命中策略：
 *   1) 直接前缀匹配（精确文件路径，如 'juese/SR01_2.png'）
 *   2) 路径模板前缀匹配：
 *      - `juese/pifu/{X}` 命中 tex/juese/pifu/<something>（泳池皮目录）
 *      - `juese/pifu/shuiyi/{X}` 命中 tex/juese/pifu/shuiyi/<something>
 *      - `juese/pifu/chongzao/{X}` 命中 ...
 *      - `juese/pifu/shenghuoshizhuang01/{X}`
 *      - `juese/pifu/teshufuzhuang01/{X}`
 *      - `juese/pifu/tiaojiao/{X}`
 *      - `juese/emotion-poses/{X}` / `juese/avatars/{X}` / `juese/combat-back/{X}`
 *   3) `juese/<Stem>.{png|webm|glb}`（立绘/视频/战斗模型，Stem = 字母数字下划线，5~10 字符）
 */

/** @type {RegExp[]} */
const SRC_REF_PATTERNS = [
  // 角色立绘/视频/战斗模型（characters.ts）
  /^juese\/[A-Za-z][A-Za-z0-9_]{2,15}\.(png|webm|glb)$/i,
  // 头像
  /^juese\/avatars\//i,
  // 战斗待机
  /^juese\/combat-back\//i,
  // 表情 pose
  /^juese\/emotion-poses\//i,
  // 皮肤（含 5 个子目录；tiaojiao 已下线，不再进包）
  /^juese\/pifu(\/|$)/i,
  /^juese\/pifu\/shuiyi(\/|$)/i,
  /^juese\/pifu\/chongzao(\/|$)/i,
  /^juese\/pifu\/shenghuoshizhuang01(\/|$)/i,
  /^juese\/pifu\/teshufuzhuang01(\/|$)/i,
];

/** 任意 src 静态引用路径前缀是否命中给定 tex 相对路径 */
export function isReferencedBySrc(rel) {
  const r = normRel(rel);
  return SRC_REF_PATTERNS.some((rx) => rx.test(r));
}

/**
 * 在项目根目录下扫描 src/ 中所有静态文本出现的 tex 资源路径前缀集合。
 * 仅作调试/日志用——主判定由 isReferencedBySrc() 用模板完成。
 * @param {string} projectRoot
 * @returns {Set<string>}
 */
export function buildSrcReferenceSet(projectRoot) {
  /** @type {Set<string>} */
  const set = new Set();
  const srcDir = path.join(projectRoot, 'src');
  if (!fs.existsSync(srcDir)) return set;
  const rx = /tex\/juese\/([A-Za-z0-9_\-/]+)/g;
  function walk(dir) {
    for (const n of fs.readdirSync(dir)) {
      const abs = path.join(dir, n);
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx|js|cjs|mjs|json|html)$/i.test(n)) continue;
      let text = '';
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      let m;
      while ((m = rx.exec(text))) set.add(`juese/${m[1]}`);
    }
  }
  walk(srcDir);
  return set;
}


/**
 * @param {string} relPath 相对 tex/ 的路径，如 `juese/pifu/foo.webm`
 * @returns {{ skip: boolean, reason?: string }}
 */
export function shouldSkipTexShip(relPath) {
  const rel = normRel(relPath);
  const base = path.posix.basename(rel);
  const lower = rel.toLowerCase();

  // —— 成人向资产硬拦截（市场版绝不打进 dist；本地快照 _adult-local 保留）——
  // 说明：只拦角色皮肤/音频类成人资产，不影响 Indoor/shinei01_tiaojiaoshi.png 等普通背景图。
  const isJuese = /(^|\/)juese\//i.test(rel);
  if (
    /(^|\/)tiaojiao(\/|$)/i.test(rel) ||
    (isJuese && /tiaojiao/i.test(base)) ||
    // 卸甲皮（xiejia，原象棋 wuziqi 失败稿目录）：抠像成品 webm 走云端 P1 分发
    // （P1 不进 APK 首包，市场合规；玩家登录后按需下载）。
    // 绿幕母带（YZ-H3 原始 mp4）与中间产物不进任何通道。
    ((/(^|\/)(wuziqi|xiejia)(\/|$)/i.test(rel) || /YZ-H3/i.test(base)) && !/\.webm$/i.test(base)) ||
    /luoti/i.test(rel) ||
    /(^|\/)moan(\/|$)/i.test(rel) ||
    /(_moan_|jiaochuan|jiaochuan)/i.test(base) ||
    /tiaojiaoqidong/i.test(base)
  ) {
    return { skip: true, reason: 'adult-asset-blocked' };
  }

  // —— 打码原版硬拦截（市场版只用 dama/ 打码资源；未打码原版留 tex/ 本地备份，不进包）——
  // 判定：juese/pifu/** 下的 X.webm，若同目录 dama/X_sticker.webm 存在，则 X.webm 不进包。
  // 覆盖 chongzao / anfu / chongzao02 / chongzao02/solo 四个 dama 目录及后续新增。
  if (
    /^juese\/pifu\//i.test(rel) &&
    /\.webm$/i.test(base) &&
    !/(^|\/)dama(\/|$)/i.test(rel) &&
    hasStickerCounterpart(rel)
  ) {
    return { skip: true, reason: 'uncensored-original-has-sticker' };
  }

  // —— 母带 / 未使用大视频 ——
  if (lower.endsWith('.mov')) {
    return { skip: true, reason: 'master-mov' };
  }
  // —— 小游戏切图集原件：运行时只引用 parts/ 切件，2048 原件/原画不进包 ——
  if (/^small_game\//i.test(rel) && !/(^|\/)parts(\/|$)/i.test(rel)) {
    return { skip: true, reason: 'minigame-source-sheet' };
  }
  if (base === 'pv01.mp4') {
    return { skip: true, reason: 'unused-pv01' };
  }
  if (base === 'Asset-x1178zv3nj.mp4') {
    return { skip: true, reason: 'unused-asset-video' };
  }

  // —— 绿幕 / 中间生成物（冲澡 / 都市私服 idle / 睡衣睡眠管线） ——
  if (
    /greenscreen/i.test(base) ||
    /_shower_gs/i.test(base) ||
    /_idle_gs/i.test(base) ||
    /_sleep_gs/i.test(base) ||
    /_sleep_stand_gs/i.test(base) ||
    /_sleep_pose_gs/i.test(base) ||
    /_sleep_morph/i.test(base)
  ) {
    return { skip: true, reason: 'greenscreen-intermediate' };
  }

  // —— 废稿 / 候选 / 旧版 / QA 目录 ——
  if (
    /(^|\/)_candidates(\/|$)/i.test(rel) ||
    /(^|\/)_old_[^/]+(\/|$)/i.test(rel) ||
    /(^|\/)_pre_upscale/i.test(rel) ||
    /(^|\/)_likeness_test(\/|$)/i.test(rel) ||
    /(^|\/)_trim_qa(\/|$)/i.test(rel) ||
    /(^|\/)luoti_daiji(\/|$)/i.test(rel) ||
    /(^|\/)_qa(\/|$)/i.test(rel) ||
    /(^|\/)_qa_/i.test(rel) ||
    /(^|\/)_key_qa(\/|$)/i.test(rel) ||
    /(^|\/)_id_qa(\/|$)/i.test(rel) ||
    /(^|\/)_qa_tease(\/|$)/i.test(rel) ||
    /(^|\/)_rekey(\/|$)/i.test(rel) ||
    /(^|\/)_webm_out(\/|$)/i.test(rel) ||
    /(^|\/)_first(\/|$)/i.test(rel) ||
    /(^|\/)_first_/i.test(rel) ||
    /(^|\/)beifen(\/|$)/i.test(rel) ||
    /(^|\/)_h3_out(\/|$)/i.test(rel)
  ) {
    return { skip: true, reason: 'authoring-junk-dir' };
  }

  // —— 角色皮肤 MP4 母带（运行时只用透明 webm；mp4 为 H3/抠绿中间件）——
  // 白名单：根目录 pv_720p / pv_20261024 / beijing01 / shop（src 有引用）+ 抽卡页视频
  // + 开始页过场动画 poster-candidates/{diyici,jinru,xunhuan,chuqu}.mp4（P0 首屏必须进包）。
  if (/\.mp4$/i.test(base)) {
    const allowRootMp4 =
      base === 'pv_720p.mp4' ||
      base === 'pv_20261024.mp4' ||
      base === 'beijing01.mp4' ||
      base === 'shop.mp4';
    const isPosterCutscene =
      /(^|\/)poster-candidates(\/|$)/i.test(rel) &&
      (base === 'diyici.mp4' || base === 'jinru.mp4' || base === 'xunhuan.mp4' || base === 'chuqu.mp4');
    if (
      !allowRootMp4 &&
      !isPosterCutscene &&
      base !== 'juesechoukajiemian_dong.mp4' &&
      base !== 'juesechoukajiemian.mp4'
    ) {
      return { skip: true, reason: 'juese-or-intermediate-mp4' };
    }
  }

  // —— AI 流水线中间产物（v3.1：按"运行时无引用"硬规则排除）——
  // 这些目录是 emotion-pose-pipeline / pifu04-idle-pipeline / pifu02-sleep-pipeline
  // / chroma-key-to-webm / shuiyi-luoti-pipeline 的临时产物，运行时 src/ 中没有任何
  // 代码路径会 load 它们；进包会无意义膨胀 APK（实测贡献 ~700MB）。
  // 若将来真有运行时引用，必须先在 src/ 中出现对应路径模板再放开。
  if (
    /(^|\/)pifu_weizhi(\/|$)/i.test(rel) ||         // 触手循环 / 位置装饰（chroma-key-to-webm 输出）
    /(^|\/)pifu\/shenghuoshizhuang01\/new(\/|$)/i.test(rel) ||  // 生活时装 AI 生成原图
    /(^|\/)pifu\/tiaojiao\/new(\/|$)/i.test(rel) || // 调教源 MP4/WebM 与抠像 QA 中间目录
    /(^|\/)pifu\/shenghuoshizhuang01\/_key_qa(\/|$)/i.test(rel) || // 关键帧 QA 中间
    /(^|\/)pifu\/shenghuoshizhuang01\/_tent/i.test(rel) ||       // tentacle key/inventory
    /(^|\/)webm_tentacle_loop(\/|$)/i.test(rel) ||   // 触手循环 webm 库
    /(^|\/)greenscreen/i.test(rel) ||                // greenscreen 母版
    /(^|\/)chroma[_-]?key/i.test(rel) ||             // chroma-key 母版
    /(^|\/)luoti[_-]?pipeline/i.test(rel) ||         // shuiyi-luoti-pipeline 输出
    /(^|\/)_tent/i.test(rel) ||                      // _tent_stem_match.json / _tent_inventory.json
    /(^|\/)pifu\/shuiyi\/pifu_weizhi(\/|$)/i.test(rel)
  ) {
    return { skip: true, reason: 'ai-pipeline-intermediate' };
  }

  if (/\.bak/i.test(base)) {
    return { skip: true, reason: 'backup-file' };
  }

  // —— 海报候选（运行时不用） ——
  // 例外：开始页入场/循环/点击/退场过场动画（P0 首屏，必须进包）
  // + 过场首帧垫底图 still_{diyici,xunhuan}.png（视频首帧渲染前的无缝垫底，防黑屏）
  if (/(^|\/)poster-candidates(\/|$)/i.test(rel)) {
    const allowed =
      base === 'diyici.mp4' || base === 'jinru.mp4' || base === 'xunhuan.mp4' || base === 'chuqu.mp4' ||
      base === 'still_diyici.png' || base === 'still_xunhuan.png';
    if (!allowed) return { skip: true, reason: 'poster-candidates' };
  }

  // —— 未引用分镜弧线（保留 char-posters） ——
  if (/(^|\/)storyboards\/arc/i.test(rel)) {
    return { skip: true, reason: 'unused-storyboard-arc' };
  }

  // —— UI 切图母版（运行时用 wasteland-ui / sub-ui 切片） ——
  if (
    rel === 'UI01.png' ||
    rel === 'UI02.png' ||
    rel === 'Asset-xho8xde31z.png' ||
    rel === 'Asset-1cha69ueqa5.png'
  ) {
    return { skip: true, reason: 'ui-atlas-master' };
  }

  // —— 非运行时文本/脚本 ——
  if (/\.(py|md|txt)$/i.test(base) && !/(^|\/)lore\//i.test(rel)) {
    // 保留可能被读取的 json；排除 py/md/txt
    return { skip: true, reason: 'authoring-doc' };
  }

  // —— v3.1 硬规则：运行时无引用兜底 ——
  // 仅对 juese/ 子树生效（非角色资源场景/UI 等已在前面规则里精确处理）。
  // 模板清单见 SRC_REF_PATTERNS：枚举了 src/ 中所有静态拼出的 juese/ 路径前缀/模式。
  // 任何不命中 SRC_REF_PATTERNS 的 juese/ 资源 = 运行时不可达，必须排除。
  if (/^juese\//i.test(rel) && !isReferencedBySrc(rel)) {
    return { skip: true, reason: 'no-runtime-reference' };
  }

  return { skip: false };
}

/**
 * 递归收集 tex 下所有文件的相对路径，并分类。
 * @param {import('node:fs')} fs
 * @param {string} texRoot
 */
export function scanTexShipPlan(fs, texRoot) {
  /** @type {{ rel: string, bytes: number, reason?: string }[]} */
  const included = [];
  /** @type {{ rel: string, bytes: number, reason: string }[]} */
  const excluded = [];

  function walk(absDir, relDir) {
    for (const name of fs.readdirSync(absDir)) {
      if (name === '.' || name === '..') continue;
      const abs = path.join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      const decision = shouldSkipTexShip(rel);
      if (decision.skip) {
        excluded.push({ rel: normRel(rel), bytes: st.size, reason: decision.reason ?? 'skip' });
      } else {
        included.push({ rel: normRel(rel), bytes: st.size });
      }
    }
  }

  if (fs.existsSync(texRoot)) walk(texRoot, '');
  return { included, excluded };
}

export function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}
