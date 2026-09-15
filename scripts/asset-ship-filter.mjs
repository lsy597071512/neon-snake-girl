/**
 * P0 打包过滤：决定哪些 tex 源文件进入 dist（ship）。
 * 规则：永不修改 / 删除 tex/ 源文件；只影响拷贝到 dist 的集合。
 *
 * 排除类：母带、废稿目录、未引用分镜弧线、切图母版、绿幕中间件、AI 流水线中间件。
 */

import fs from 'node:fs';
import path from 'node:path';

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
  // 皮肤（含 6 个子目录）
  /^juese\/pifu(\/|$)/i,
  /^juese\/pifu\/shuiyi(\/|$)/i,
  /^juese\/pifu\/chongzao(\/|$)/i,
  /^juese\/pifu\/shenghuoshizhuang01(\/|$)/i,
  /^juese\/pifu\/teshufuzhuang01(\/|$)/i,
  /^juese\/pifu\/tiaojiao(\/|$)/i,
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

  // —— 母带 / 未使用大视频 ——
  if (lower.endsWith('.mov')) {
    return { skip: true, reason: 'master-mov' };
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
    /(^|\/)_qa_tease(\/|$)/i.test(rel) ||
    /(^|\/)_rekey(\/|$)/i.test(rel) ||
    /(^|\/)_webm_out(\/|$)/i.test(rel) ||
    /(^|\/)_first(\/|$)/i.test(rel) ||
    /(^|\/)_first_/i.test(rel)
  ) {
    return { skip: true, reason: 'authoring-junk-dir' };
  }

  // —— AI 流水线中间产物（v3.1：按"运行时无引用"硬规则排除）——
  // 这些目录是 emotion-pose-pipeline / pifu04-idle-pipeline / pifu02-sleep-pipeline
  // / chroma-key-to-webm / shuiyi-luoti-pipeline 的临时产物，运行时 src/ 中没有任何
  // 代码路径会 load 它们；进包会无意义膨胀 APK（实测贡献 ~700MB）。
  // 若将来真有运行时引用，必须先在 src/ 中出现对应路径模板再放开。
  if (
    /(^|\/)pifu_weizhi(\/|$)/i.test(rel) ||         // 触手循环 / 位置装饰（chroma-key-to-webm 输出）
    /(^|\/)pifu\/shenghuoshizhuang01\/new(\/|$)/i.test(rel) ||  // 生活时装 AI 生成原图
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
  if (/(^|\/)poster-candidates(\/|$)/i.test(rel)) {
    return { skip: true, reason: 'poster-candidates' };
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
