# 章节专属 CG 与剧情语音（P3）实施方案

> **状态**：待执行（2026-09-16 定稿 · 交接文档，写给后续开发者/AI Agent）  
> **前置**：P0–P2 已完成（剧情 UI 重排、表情差分、旁白、暗幕挖洞引导、文案重写），见 `docs/story-system.md` 头部 2026-09-16 记录。  
> **美术现状**：开场三连 CG 的文生图构图参考已生成（`generated-images/cg-opening/`，**脸不符，仅占位**）；一比一正式稿工单已备好（`docs/cg-opening-prompts.md` 第一节，Seedream 图生图，多参考图锁脸）。

---

## 〇、 TL;DR

1. 美术：跑 `docs/cg-opening-prompts.md` 的 Seedream 工单 → 产出 `tex/cg/*.png`（9:16 竖幅）。
2. 代码（本方案核心）：`StoryBeatNode` 新增 `cg` 节点类型 → 播放器全屏 CG 模式（Ken Burns）→ 存档记录 `storyCgSeen` → 画廊解锁页签 → ship 白名单加 `tex/cg/`。
3. 语音：剧情关键句接 `qwen3-tts-flash`（复用 `src/ai/voice/qwenTtsClient.ts`），IndexedDB 缓存。
4. 验证：`npm run verify-story-guide` + `npm run assets:verify` + 手动清存档跑一遍开场。

---

## 一、CG 清单（12 张起步）

| CG id | 挂载点 | 内容 | 状态 |
|---|---|---|---|
| `cg_open_wake` | `hub_follow` 第 2 行后 | 唤醒：澪跪沙扶起指挥官，胸口灯亮 | 工单就绪 |
| `cg_open_follow` | `hub_follow` 选项前 | 跟我走：澪伸手名场面 | 工单就绪 |
| `cg_open_road` | `hub_follow` 结尾 | 上路：三人背影大远景 | 工单就绪 |
| `cg_ch{n}_start` ×5 | `s{n}-1` 首行 | 章首氛围+登场角色 | 待写工单 |
| `cg_ch{n}_end` ×5 | `s{n}-12` 选项后 | 章末关键事件定格 | 待写工单 |
| `cg_camp_open` | `g_camp` 确认后 | 营地亮起、老板娘回柜台 | 待写工单 |

**规格**：9:16 竖幅（进游戏全屏铺），源 PNG 放 `tex/cg/{id}.png`；进包走 P2b 场景档（WebP 最长边 2560 / 质量 87，12 张 ≈ 8-12MB）。

---

## 二、数据模型改动

### 2.1 `src/data/storyBeats.ts` — 新增 cg 节点类型

现状节点联合类型（约第 40 行）：

```typescript
export type StoryBeatNode =
  | { type: 'line'; line: StoryLine }
  | { type: 'choice'; options: StoryChoiceOption[]; branches: ...; join?: ... }
  | { type: 'confirm'; label: string; join?: StoryBeatNode[] }
  | { type: 'tapHint'; hints: Record<string, string> };
```

**新增成员**：

```typescript
export type StoryCgDef = {
  /** CG id，同时是 tex/cg/{id}.png 文件名与解锁记录键 */
  id: string;
  /** Ken Burns 推镜方向，默认 'in'（缓慢放大）；'out'=缓慢拉远 */
  pan?: 'in' | 'out';
};

export type StoryBeatNode =
  | { type: 'line'; line: StoryLine }
  | { type: 'choice'; ... }
  | { type: 'confirm'; ... }
  | { type: 'tapHint'; ... }
  | { type: 'cg'; cg: StoryCgDef };        // ← 新增
```

**挂载示例**（`BEAT_HUB_FOLLOW` 中插入，位置见注释）：

```typescript
nodes: [
  L('narration', '沙暴刚停。…', { bubble: 'narration' }),
  { type: 'cg', cg: { id: 'cg_open_wake', pan: 'in' } },   // ← 新增：CG 先铺满，下一句台词叠在底部
  char('ashcrow', '……还亮着。沙也停了。…', { stage: [...], emotion: 'contentment' }),
  ...
],
```

### 2.2 存档 `SaveData.tutorialFlags` — 新增 `storyCgSeen`

`src/types.ts` 的 tutorialFlags 结构 + `src/core/SaveManager.ts` 的 `createDefaultSave()`（约第 55-65 行）与 `migrateSave` 回填各加一处：

```typescript
tutorialFlags: {
  ...
  storyBeatsSeen: string[];
  storyCgSeen: string[];          // ← 新增
}
```

`migrateSave` 里按现有模式补一行：`if (!Array.isArray(tf.storyCgSeen)) tf.storyCgSeen = [];`（在 `applyStoryMigration`，`src/systems/StoryGuideSystem.ts:247-264` 同区）。

同时加标记函数（放 `StoryGuideSystem.ts`，仿 `markStoryBeatSeen:195-203`）：

```typescript
export function markStoryCgSeen(save: SaveData, cgId: string): void {
  const list = save.tutorialFlags.storyCgSeen ?? [];
  if (!list.includes(cgId)) list.push(cgId);
  save.tutorialFlags.storyCgSeen = list;
}
export function hasSeenStoryCg(save: SaveData, cgId: string): boolean {
  return (save.tutorialFlags.storyCgSeen ?? []).includes(cgId);
}
```

> SAVE_VERSION 无需升版本号——`migrateSave` 是「基档 ⊕ 旧档」字段级合并，新增数组字段会被回填逻辑兜底（与 storyBeatsSeen 同模式）。

---

## 三、播放器改动（`src/ui/storyDialogueOverlay.ts`）

### 3.1 结构现状（关键行号，2026-09-16 版本）

- `runNext()`（约 380 行）：节点分发器，`line / choice / confirm / tapHint` 四个分支
- `portraitSig` / `faceSig` 签名机制：内容没变就不重排 DOM（防闪）
- `.story-portraits` 舞台立绘层 + `.story-face` 对话框表情图（P0 已落地）

### 3.2 新增 CG 层

**HTML**（`overlay.innerHTML` 模板中，`.story-portraits` 之后插入）：

```html
<div class="story-cg is-hidden" data-story-cg></div>
```

**状态与逻辑**（在 `portraitToken` 旁新增）：

```typescript
let cgSig = '';

const setCg = (cg: StoryCgDef | null) => {
  const sig = cg?.id ?? '';
  if (sig === cgSig) return;
  cgSig = sig;
  const cgEl = overlay.querySelector('[data-story-cg]') as HTMLElement;
  if (!cg) {
    cgEl.classList.add('is-hidden');
    cgEl.innerHTML = '';
    return;
  }
  cgEl.classList.remove('is-hidden');
  cgEl.innerHTML =
    `<img class="story-cg-img${cg.pan === 'out' ? ' pan-out' : ''}" src="${texUrl(`./tex/cg/${cg.id}.png`)}" alt="" />`;
  // CG 在场时隐藏舞台立绘（立绘会挡住 CG 主体）；表情图保留（对话框内，不冲突）
  portraitsEl.classList.add('is-cg-covered');
};

// runNext() 新增分支（放在 tapHint 分支前）：
if (node.type === 'cg') {
  markStoryCgSeenRef(node.cg.id);   // 见 3.3
  setCg(node.cg);
  runNext();                        // CG 是展示指令，不停顿，直接播下一节点
  return;
}
```

**退场规则**：`setPortraits()`（line 节点触发）开头调用 `setCg(null)` 并移除 `is-cg-covered`——即**下一句有立绘的台词出现时 CG 自动收起**。若希望 CG 持续多句，只在需要收起的那句前手动再插一个隐式节点；推荐默认规则：CG 持续覆盖直到下一个带 `stage` 的 line。

**图片缺失回退**：`<img onerror>` 隐藏 CG 层并继续（工单图未入库时不阻塞剧情）：

```typescript
img.onerror = () => { cgEl.classList.add('is-hidden'); cgEl.innerHTML=''; cgSig=''; };
```

### 3.3 解锁记录回写

`playStoryBeat` 是纯 UI（拿不到 saveManager 写入时机），**不要**在 overlay 里 import saveManager。做法：把 CG 观看记录挂到 `StoryPlayResult`：

```typescript
export type StoryPlayResult = {
  skipped: boolean;
  choices: Record<string, 'A' | 'B' | 'C'>;
  cgsSeen: string[];              // ← 新增
};
```

调用方（`App.ts` 两处：`maybeRunStoryBoot` 约 883 行、关卡战前约 3123 行）在已有 `saveManager.mutate` 里补：

```typescript
for (const cgId of result.cgsSeen ?? []) markStoryCgSeen(d, cgId);
```

### 3.4 CSS（`src/ui/storyOverlay.css` 追加）

```css
/* 全屏 CG 层：盖住立绘舞台，文本框保持最上 */
.story-cg {
  position: absolute; inset: 0; z-index: 2; overflow: hidden;
  background: #07090e;
}
.story-cg.is-hidden { display: none; }
.story-cg-img {
  width: 100%; height: 100%; object-fit: cover; object-position: center 30%;
  animation: story-cg-kenburns-in 12s ease-out both;
}
.story-cg-img.pan-out { animation-name: story-cg-kenburns-out; }
@keyframes story-cg-kenburns-in  { from { transform: scale(1.02); } to { transform: scale(1.12); } }
@keyframes story-cg-kenburns-out { from { transform: scale(1.12); } to { transform: scale(1.02); } }
.story-portraits.is-cg-covered { opacity: 0 !important; }
/* 用户系统开「减少动态」时禁推镜 */
@media (prefers-reduced-motion: reduce) {
  .story-cg-img, .story-cg-img.pan-out { animation: none; transform: none; }
}
```

层级校验：backdrop z0 < veil z1 < portraits z2 = cg z2（cg 后插入故在上）< dock z3 < skip z5 — 文本框始终可读。

---

## 四、画廊解锁（`src/ui/galleryPage.ts` + `src/data/sceneGallery.ts`）

现状：`renderSceneGalleryHtml` 已有场景画廊。新增 CG 页签：

1. `sceneGallery.ts` 加 `CG_GALLERY: { id, title, desc, src }[]`（12 条，与第一节清单一致）；
2. 画廊页渲染时读 `save.tutorialFlags.storyCgSeen`：已解锁显示图，未解锁显示剪影占位（纯 CSS：黑底 + 问号 + 标题「？？？」）；
3. 点击查看大图复用现有画廊 lightbox（若场景画廊有）；没有就先只做网格。

**不要**新建独立系统——CG 画廊就是 sceneGallery 的一个数据源分支。

---

## 五、资产管线（必改，否则打包丢图）

1. **`scripts/asset-ship-filter.mjs`**：白名单数组（约第 44-50 行，`/^juese\/emotion-poses\//i` 附近）加一条：
   ```js
   // 剧情 CG
   /^cg\//i,
   ```
2. **P2b 压缩规格**：`tex/cg/*.png` 按场景档转 WebP（最长边 2560 / q87）。确认 `build-tex-ship.mjs` 的场景规则是否按目录匹配——若是按 `juese` 硬编码，需要在规则表加 `cg/` 条目。
3. 验证：`npm run assets:build-ship && npm run assets:verify`（门禁会校验 ship-manifest 三处一致）。
4. **运行时引用硬规则**：`storyDialogueOverlay.ts` 里 CG 路径是模板字符串 `` `./tex/cg/${cg.id}.png` `` ——动态拼接可能不满足 ship 过滤器的「src 静态引用」扫描。稳妥做法：在 `sceneGallery.ts` 的 `CG_GALLERY` 里把 12 条写成**字面量路径**（`'./tex/cg/cg_open_wake.png'`），过滤器的正则白名单 `^cg/` 也能命中，双保险。

---

## 六、剧情 TTS（第二批，CG 落地后做）

**只配关键句**，不全量配音（成本+包体控制）：

1. `StoryLine` 加可选字段 `voice?: boolean`（或独立清单 `STORY_VOICE_LINES: string[]` 存 line 索引）。
2. 播放 `playLine` 时若 `voice` 且有 Key：调 `src/ai/voice/qwenTtsClient.ts`（`qwen3-tts-flash`，与 AI 对话共用玩家 BYOK；无 Key 静默跳过）。
3. **缓存**：文本 hash → IndexedDB（新开 `rust-belt-story-voice` 库，仿 `dialogueArchive.ts:24-26` 的 IDB+LS 兜底模式），同一句只合成一次。
4. 角色音色映射：qwen TTS 的 voice 参数按角色固定一张表（`data/characters.ts` 加 `ttsVoice?: string` 字段或独立 `storyVoices.ts`）。
5. 打字机节奏：语音就绪前不阻塞打字；语音到达后 `HTMLAudioElement.play()`，下一句开始时 `pause()`。
6. 注意 Android 手势解锁：复用 `main.ts` 现有的多事件解锁音频逻辑，战前剧情在「出战」点击链上，天然有手势。

---

## 七、执行 Checklist（按序）

- [ ] 1. 跑 Seedream 工单 → `tex/cg/cg_open_wake.png / cg_open_follow.png / cg_open_road.png`（先 3 张验证全链路）
- [ ] 2. `asset-ship-filter.mjs` 加 `^cg/` 白名单；`build-tex-ship` 场景规则覆盖 `cg/`
- [ ] 3. `storyBeats.ts`：cg 节点类型 + hub_follow 插 3 个 cg 节点
- [ ] 4. `types.ts` / `SaveManager.ts` / `StoryGuideSystem.ts`：`storyCgSeen` + 标记函数
- [ ] 5. `storyDialogueOverlay.ts`：CG 层 + runNext 分支 + onerror 回退 + `StoryPlayResult.cgsSeen`
- [ ] 6. `App.ts` 两处调用方回写 `markStoryCgSeen`
- [ ] 7. `storyOverlay.css`：CG 层 + Ken Burns + reduced-motion
- [ ] 8. 验证：`npx tsc --noEmit` → `npm run verify-story-guide` → `npm run assets:verify` → 清存档 `localStorage.removeItem('rust-belt-era-save-v1')` 手动跑开场
- [ ] 9. 画廊页签（`sceneGallery.ts` + `galleryPage.ts`）
- [ ] 10. 补其余 9 张 CG 工单 → 入库 → 挂载
- [ ] 11. TTS（第六节）

## 八、风险与注意

- **CG 与立绘互斥**：`is-cg-covered` 只做透明度隐藏，不要卸载 video（卸载再挂载会闪黑）。
- **跳过按钮**：`hub_follow` 不可跳过，CG 也会强制播完——推镜动画控制 ≤12s，可点击文本框快进（现有 tryAdvance 逻辑天然支持：CG 节点不停顿，玩家连点即过）。
- **包体**：12 张 WebP ≈ 10MB，对 1.3GB 包体无感；不要放 PNG 源进 `tex-ship`（P2b 转换是必须的）。
- **老档兼容**：`storyCgSeen` 回填兜底，老玩家回看剧情时自然补解锁。
