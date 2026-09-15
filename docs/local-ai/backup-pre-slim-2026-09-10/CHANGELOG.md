# 本次落地变更摘要（相对本目录备份）

## 已做
1. **拆分**：`systemStatic`（唯一 system）+ `systemDynamic`（并入本轮 user）。ChatML 禁止双 system。
2. **羁绊去重**：动态层不再整段复读 `COMMANDER_BOND_RULES`，只保留指挥官本体 canon。
3. **换装去重**：删除人设里重复的「世界同步·换装完成」四条；`skin_change`/`skin_clip` 权威段保留。
4. **深场去重**：assembler 长「深场输出加料」→短「深场提醒」；权威仍在人设【深场字段】。好感动态只留深场一处。
5. **洗浴门控**：人设静态移除协议；浴室时注入 `BATH_INTIMATE_CONSENT_PROTOCOL`（同文）。
6. **经济门控**：非买/卖/送/吃/修/商店/仓库/递物时不注入经济块。

## 未做
- 不砍 VOICE/档案；不开 deepField 短版；不降记忆条数。

## 回滚
将本目录 `src__ai__*.ts` 拷回 `src/ai/` 对应文件名。
