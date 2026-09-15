# 对话永久保存 & 省 Token 策略

## 原则

**全量永久存本地，进模型只带「薄上下文 + 相关召回」。**  
本地磁盘/IndexedDB 不按 token 计费；只有每次请求塞进 Prompt 的字才花钱。

## 四层结构

| 层 | 存在哪 | 是否进 LLM | 作用 |
|----|--------|------------|------|
| **Archive** | IndexedDB（失败则 localStorage） | **按需检索** | 玩家↔角色、角色↔角色全文永久记录；关键词命中或跨天备份注入 |
| **chatDigests** | 存档 `aiLiving` | 是（短要点，约 10～12 条） | 旧对话本地压成一行摘要，0 API 费 |
| **memories** | 存档 `aiLiving` | 是（talk/event 分槽） | 对话事实与营地事件记忆点分开保护 |
| **recentChats** | 存档 `aiLiving` | 是（最近约 8 句） | 当场接着聊、防复读 |

```
每次对话：
  全文 → Archive（永久，不删）
  最近句 → recentChats
  溢出旧句 → 本地滚成 digest（不调 API）
  本轮玩家话 → searchDialogueArchive → 【相关旧对话】
发给模型 = system人设 + 实时身份卡 + 相关旧对话 + digests + memories + 最近8句 + 本轮
```

## 营地事件记忆

- 事件激活时：参与/知情者写入短期事件记忆  
- 事件结算时：**到场 / 同屏 / 出力 / 旁观**者写入结局记忆点（`pushMemory` kind=event）  
- ignore 且未到场者不写结局记忆（不知情）

## 关游戏再开会丢吗？

不会（只要浏览器没清站点数据）：

1. **全文**在 IndexedDB 永久档案里  
2. 每次打开对话 / 发言前，会 **0 token** 从档案灌回 digests + 近窗 + memories  
3. 跨天再问相关话题时，会从 Archive **检索命中条**注入 Prompt  
4. 身份卡每次从存档现算  

## 为何以前会「昨天忘了」

工作记忆有条数上限，且 Archive **曾不进 Prompt**，模型只能看见极薄近窗。  
现已接入相关召回 + 分槽保护 + 事件结算记忆。
