# 存档与数据持久化系统

> **源文件**：`src/core/SaveManager.ts`、`src/ai/types.ts`、`src/ai/livingState.ts`  
> **最新更新**：2026-10-18（补充签名/热更约束与「存档导入导出」待办）

---

## ⚠️ 第一约束：存档安全依赖 Android 签名稳定

当前存档**只存在于设备本地**（localStorage + IndexedDB），位于应用私有目录
`/data/data/com.rustbelt.era/`。**卸载应用 = 存档立即物理删除，无任何找回可能。**

因此"玩家能否热更（覆盖安装）"直接决定"玩家会不会丢档"。二者是同一件事：

| 情况 | 存档结果 |
|---|---|
| 签名一致 → 覆盖安装升级 | 存档完整保留 ✅ |
| 签名变化 → 被迫卸载重装 | 存档全丢 ❌ 不可恢复 |

> 签名规范见 `docs/asset-ship-pipeline.md` 的「Android 签名与热更（强制）」章节。

**当前状态（2026-10-18）**：已启用固定 keystore，此后所有打包均走同一签名。
唯一一次历史性签名切换（首次启用）造成的旧档损失不可逆。

---

## 待办：存档导入 / 导出（低优先级，正式发售前再做）

**定位：兜底措施，不是主线。** 主线保障是「签名稳定 → 覆盖安装热更」，
导入导出只是在签名被迫更换、或玩家误操作/换机时的人工补救手段。

**优先级：低。** 正式发售前评估实现，当前阶段不阻塞开发。

拟采用方案（无后端依赖，纯本地方案）：

- **导出**：把 `SaveManager` 的 JSON 落盘到公共存储
  （Android `Documents/` 或 `Download/`，通过 Capacitor Filesystem 插件），
  生成带时间戳的存档文件，如 `rust-belt-era-save-20261018.json`。
- **导入**：读取该目录下的存档文件 → 走既有 `migrateSave` 版本迁移链 → 覆盖写入。
- **UI**：设置页内两个入口即可，不需要独立页面。
- **注意**：公共存储对玩家可见，需提示"请勿分享存档文件"；
  IndexedDB 中的对话/生活全量档案需一并导出才有完整恢复效果，
  体量可能较大，需评估是否只导出主存档。

**待评估问题**（实现前需确认）：
1. 仅导出主存档（localStorage）还是含 IndexedDB 全量档案？
2. 存档文件是否需要加密（防修改数值）？
3. 版本不兼容的旧档导入如何提示与降级？

---

## 概述

游戏使用 **localStorage 单一存档键**持久化：**游戏数据与 AI 生活数据（`aiLiving`）同存于一个 JSON 对象**，不再分键存储。AI 对话/生活档案的**全量历史**存 IndexedDB（按需检索），存档内只带薄摘要。

**核心设计原则**：
- 游戏 + AI 生活一体存档，`mutate()` 即改即存
- 存档版本迁移链（`migrateSave`，当前 **version 8**）+ 启动回填钩子
- 每次落盘自动推 `companionSync` 实时角色快照（外部陪伴端未启动则静默失败）
- 对话/生活全量档案存 IndexedDB（localStorage 兜底）

---

## 存档结构（以 `createDefaultSave()` 为准）

```typescript
type SaveData = {
  version: number;            // SAVE_VERSION = 8

  // 经济
  gold: number;               // 锈币
  tickets: number;            // 抽卡券
  gachaPity: number;          // 保底计数

  // 军械箱
  armoryLevel: number;
  armoryUpgradeEnd: number | null;

  // 角色与武器
  ownedCharacters: OwnedCharacter[];  // { characterId, weaponId, giftCount, shardPowerBonus, unlockedSkins, activeSkinId }
  ownedWeaponIds: string[];
  squad: string[];            // 出战队伍（1~3 人）

  // 进度
  clearedStages: number[];

  // 领取记录
  achievementsClaimed: string[];
  tasksClaimed: string[];

  // 碎片/强化
  characterShards: Record<string, number>;
  weaponShards: Record<string, number>;
  characterShardUses: Record<string, number>;
  weaponShardUses: Record<string, number>;
  weaponEnhanceBonus: Record<string, number>;

  // 统计
  stats: {
    stagesCleared: number; totalKills: number; charactersOwned: number;
    giftsSent: number; legendariesEquipped: number; highestStage: number;
    playTimeSeconds: number;
  };

  // 扫荡
  sweepCharges: number;
  sweepRecoverAnchorAt: number;   // 恢复锚点（时间戳）

  // 教学/剧情标记
  tutorialFlags: {
    combatDone: boolean; armoryVideoSeen: boolean; worldIntroSeen: boolean;
    storyHubFollowSeen: boolean; storyGuideStep: string; storyGuideDone: boolean;
    storyGuideArmoryOpened: boolean; storyBeatsSeen: string[]; storyChoiceLog: Record<string, unknown>;
  };

  // 设置
  settings: {
    useLivePortrait: boolean; hubFeaturedCharId: string | null;
    hubMidUiVisible: boolean; debugInfiniteGold: boolean; disciplineEnabled: boolean;
  };

  // AI 生活存档（内嵌，结构详见 src/ai/types.ts 的 AiLivingSave：
  // gameMinutes/dayIndex/affinities/memories/recentChats/chatDigests/structuredFacts/
  // characterSleep/agendas/personas/campWornSkins/lifeGoals/lifeArchive 引用…）
  aiLiving: AiLivingSave;

  // 营地仓库/商店
  campWarehouse: Record<string, number>;
  campShop: { dayIndex: number; offers: { propId: string; sold: boolean }[] };
};
```

---

## 存储位置

### 主存档

| 数据 | 存储位置 | 键名 |
|---|---|---|
| **游戏存档 + AI 生活存档（一体）** | localStorage | `rust-belt-era-save-v1` |

### 许可/账号（`src/platform/license.ts`）

| 键名 | 用途 |
|---|---|
| `rb-license-token` | HMAC 签名许可 token |
| `rb-device-id` | 设备 ID（Android ID 绑定） |
| `rb-license-validated-at` | 上次在线校验时间（24h 间隔） |
| `rb-gateway-urls` | 网关备用域名覆盖（调试用） |

### AI 配置（`src/ai/llmClient.ts` / `providerConfig.ts` / `modelConfig.ts`）

| 键名 | 用途 |
|---|---|
| `rust-belt-ai-api-key` | 玩家 DashScope API Key |
| `rust-belt-ai-chat-provider` | 对话 Provider（dashscope / openai_compatible） |
| `rust-belt-ai-compat-base-url` / `-api-key` / `-model` | OpenAI 兼容口配置（本机 Fable 旁路） |
| `rust-belt-ai-model` | 模型选择 |
| `rust-belt-ai-shipped-gpu-cfg-id` | 包内置 home-GPU 配置 shipId |
| `rust-belt-qwen-model-exhausted-v2` | 千问模型耗尽降级标记 |

### 全量档案（IndexedDB + localStorage 兜底）

| 数据 | IndexedDB 库名 | localStorage 兜底键 |
|---|---|---|
| 对话档案（`dialogueArchive.ts`） | `rust-belt-ai-archive` | `rust-belt-ai-dialogue-archive-v1` |
| 生活档案（`lifeArchive.ts`） | `rust-belt-ai-life` | `rust-belt-ai-life-archive-v1` |
| 生活时间线（`lifeTimeline.ts`） | `rust-belt-ai-timeline` | `rust-belt-ai-life-timeline-v1` |

---

## 保存时机

| 时机 | 行为 |
|---|---|
| 任何 `saveManager.mutate(fn)` | 修改 → 统计同步 → 皮肤运行时同步 → **立即落盘** → `pushCompanionSync`（800ms 节流） |
| 读档（构造/启动） | `migrateSave` 归一化，若 JSON 有变化则**立即回写** |
| 退后台 / 页面卸载 | UI 层强制结算（调教会话 `settleDisciplineForLifecycle` 等）后落盘 |
| 战斗结束 / 购买 / 送礼 | 走 `mutate`，即改即存 |

---

## SaveManager API（以源码为准）

```typescript
export class SaveManager {
  get(): SaveData;                 // 读（含 sweepRecovery / debugInfiniteGold 同步）
  mutate(fn: (d: SaveData) => void): void;  // 改 + 落盘 + companionSync（主入口）
  save(): void;                    // 落盘 + pushCompanionSync
  reset(): void;                   // 重置为默认存档并落盘
  getRevision(): number;           // 存档修订号（异步任务一致性检查）
  updateStats(partial: Partial<PlayerStats>): void;
}

export const saveManager: SaveManager;
export function createDefaultSave(): SaveData;
```

> 注意：早期文档中的 `saveGame()/loadAiLiving()/exportSave()/importSave()` 等方法**在源码中不存在**，实际 API 以上表为准。

---

## 存档版本迁移（`migrateSave`）

```typescript
const SAVE_VERSION = 8;  // src/core/SaveManager.ts:16

// 读取时：base(默认档) ⊕ raw(旧档) → 字段级过滤/归一化 → version 强制置 8
```

迁移时顺带执行**启动回填钩子**：

| 钩子 | 作用 |
|---|---|
| `applyCharacterPersonaResets` | 动态人设异常重置 |
| `applyPoolPartySkinRollout` / `applySpecialOutfitSkinRollout` / `applyLifewearCampDefaultRollout` | 皮肤发放/默认穿搭回填 |
| `seedCampEconomy` | 营地仓库经济种子 |
| `recoverStaleDisciplineSession` | 读档若卡在调教态 → 自动结算，防永久锁皮/锁房 |
| `applyStoryMigration` | 老档剧情引导状态迁移（有进度则跳过教学） |
| 编队/看板校验 | 看板娘必须在编队内，空编队则清空 |
| 武器装备一致性 | 装备中的武器若未持有则自动补入 |

---

## companionSync 桥

`saveManager.save()` 末尾调用 `pushCompanionSync(saveData)`：把角色实时快照（身高/皮肤/武装/好感/状态/最近对话）节流 POST 到 `VITE_COMPANION_SYNC_URL`（默认 `http://127.0.0.1:8787/api/sync/ingest`），对接外部「赛博陪伴」桌面应用。未启动则静默失败。

---

## 存档容量

| 数据 | 估计大小 | 说明 |
|---|---|---|
| 主存档（游戏+AI 生活） | ~100-500 KB | 取决于对话量（薄摘要进存档，全量在 IndexedDB） |
| IndexedDB 对话/生活档案 | ~1-10 MB | 长期游戏后增长 |

---

## 故障处理

| 问题 | 处理 |
|---|---|
| 存档损坏（JSON 解析失败） | `load()` 捕获异常 → 回退到默认存档 |
| 字段缺失/类型错误 | `migrateSave` 逐字段过滤归一化（基档兜底） |
| 读档卡在调教态 | `recoverStaleDisciplineSession` 自动结算 |
| IndexedDB 不可用 | 回落 localStorage（`*-v1` 兜底键） |

---

## 代码入口

| 文件 | 作用 |
|---|---|
| `src/core/SaveManager.ts` | 存档管理（单例 `saveManager`） |
| `src/ai/types.ts` | `AiLivingSave` 类型定义 |
| `src/ai/livingState.ts` | AI 生活状态读写 |
| `src/ai/dialogueArchive.ts` / `lifeArchive.ts` / `lifeTimeline.ts` | IndexedDB 全量档案 |
| `src/bridge/companionSync.ts` | 游戏 ↔ 外部陪伴端桥 |
