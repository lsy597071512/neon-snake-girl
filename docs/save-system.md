# 存档与数据持久化系统

> **源文件**：`src/core/SaveManager.ts`、`src/ai/types.ts`、`src/ai/livingState.ts`  
> **最新更新**：2026-09-06

---

## 概述

游戏使用 **localStorage** 作为主要持久化方案，AI 生活数据通过 `companionSync` 桥接。

**核心设计原则**：
- 游戏存档 + AI 生活存档 分离存储
- 存档自动保存（关键节点 + 定时）
- 存档可导出/导入（JSON）
- AI 对话档案存储在 IndexedDB

---

## 存档结构

### 游戏存档（SaveManager）

```typescript
type GameSave = {
  // 版本控制
  version: number;

  // 玩家数据
  player: {
    name: string;
    level: number;
    xp: number;
    rustCoins: number;  // 锈币
  };

  // 角色数据
  squad: string[];           // 当前队伍
  ownedCharacters: OwnedCharacter[];
  weapons: WeaponData[];

  // 进度
  currentStage: number;       // 当前关卡
  clearedStages: number[];    // 已通关关卡

  // AI 生活数据（引用）
  aiLiving: AiLivingSave;    // 详见下节
};
```

### AI 生活存档（AiLivingSave）

```typescript
type AiLivingSave = {
  // 时间
  gameMinutes: number;        // 累计游戏分钟
  dayIndex: number;          // 游戏日索引

  // 关系
  affinities: Record<string, number>;   // 玩家好感（0-100）
  relationships: Record<string, number>; // 角色间关系（-100~100）

  // 记忆
  memories: Record<string, AiMemoryEntry[]>;
  campLog: CampLogEntry[];
  recentChats: Record<string, string[]>;     // 最近对话
  chatDigests: Record<string, ChatDigest[]>; // 对话摘要

  // 结构化事实
  structuredFacts: Record<string, StructuredFact[]>;

  // 角色状态
  characterStatus: Record<string, LightStatusTag[]>;
  characterSleep: Record<string, CharacterSleepState>;

  // 议程与活动
  agendas: Record<string, CharacterAgenda>;
  activeCampEvents: CampEventInstance[];

  // 人物状态
  personas: Record<string, CharacterPersonaLive>;  // 动态人设
  campWornSkins: Record<string, string>;           // 营地穿搭
  lifeGoals: Record<string, LifeGoalState>;         // 人生目标

  // 对话档案引用
  dialogueArchiveId?: string;
};
```

---

## 存储位置

| 数据 | 存储位置 | 键名 |
|---|---|---|
| 游戏存档 | localStorage | `rust-belt-save` |
| AI 生活存档 | localStorage | `rust-belt-ai-living` |
| 对话档案 | IndexedDB | `rust-belt-dialogue-archive` |
| 许可证 token | localStorage | `rb-license-token` |
| 设备 ID | localStorage | `rb-device-id` |
| AI API Key | localStorage | `rust-belt-ai-api-key` |

---

## 保存时机

| 时机 | 保存内容 | 是否阻塞 |
|---|---|---|
| 对话结束 | AI 生活存档 | 异步 |
| 战斗结束 | 游戏存档 | 同步 |
| 购买道具 | 游戏存档 | 同步 |
| 切换页面 | 全部存档 | 异步 |
| 每 30 秒 | 全部存档 | 异步 |
| 页面卸载 | 全部存档 | 同步（beforeunload） |

---

## 存档管理命令

```typescript
// 保存
SaveManager.save(save: GameSave): void
saveManager.saveGame(): void       // 保存游戏存档
saveManager.saveAiLiving(): void   // 保存 AI 生活存档

// 读取
saveManager.loadGame(): GameSave | null
saveManager.loadAiLiving(): AiLivingSave

// 导出/导入
saveManager.exportSave(): string   // 导出为 JSON 字符串
saveManager.importSave(json: string): boolean  // 导入存档

// 重置
saveManager.resetGame(): void       // 重置游戏（保留 AI 生活）
saveManager.resetAll(): void       // 重置全部
```

---

## companionSync 桥

`companionSync` 是游戏存档和 AI 生活存档之间的桥接机制。

```typescript
// 战斗胜利 → 更新 AI 生活
companionSync.recordCombatReturn(living, characterIds, chapterResult);

// 皮肤购买 → 更新 AI 生活
companionSync.syncSkinUnlock(living, characterId, skinId);

// 礼物送出 → 更新关系
companionSync.recordGiftGiven(living, characterId, giftId);
```

---

## 对话档案（IndexedDB）

对话档案存储在 IndexedDB，支持全文检索。

```typescript
// 存储
dialogueArchive.addEntry(characterId, entry: DialogueEntry);

// 检索
dialogueArchive.search(keyword: string): DialogueEntry[];

// 读取
dialogueArchive.getByCharacter(characterId): DialogueEntry[];

// 清理（超过容量时）
dialogueArchive.prune(keepCount: number);
```

---

## 存档版本迁移

```typescript
// SaveManager 检测版本号，执行迁移
if (save.version < CURRENT_VERSION) {
  migrate(oldSave);
}
```

当前版本：`SAVE_VERSION = 1`

---

## 存档容量

| 数据 | 估计大小 | 说明 |
|---|---|---|
| 游戏存档 | ~10 KB | 很小 |
| AI 生活存档 | ~100-500 KB | 取决于对话量 |
| 对话档案 | ~1-10 MB | 长期游戏后可能增长 |
| 全部 localStorage | < 10 MB | 通常足够 |

---

## 故障处理

| 问题 | 处理 |
|---|---|
| localStorage 满 | 清理旧对话档案 |
| 存档损坏 | 回退到上一个存档（如果有多版本） |
| IndexedDB 不可用 | 回落到 localStorage（容量有限） |

---

## 代码入口

| 文件 | 作用 |
|---|---|
| `src/core/SaveManager.ts` | 存档管理主类 |
| `src/ai/livingState.ts` | AI 生活状态读写 |
| `src/ai/dialogueArchive.ts` | 对话档案管理 |
| `src/bridge/companionSync.ts` | 游戏↔AI 桥接 |
