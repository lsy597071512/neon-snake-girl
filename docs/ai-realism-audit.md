# AI 现实逻辑审计（2026-10-21）

> 依据：[ai-first-principle.md](./ai-first-principle.md)（第一宗旨 · 活人定律）。
> 本文记录：本轮修掉的「无过程硬切/瞬移/死锁」类问题，以及仍然存在、需要排期处理的违背点。

---

## 一、本轮已修复

| # | 问题 | 修复方式 | 关键代码 |
|---|---|---|---|
| 1 | 营地群体事件（泳池派对/睡衣派对/娱乐夜等）临时外覆**瞬间切皮** | 新增「事件临时皮换装队列」：先播换装过程皮，到点才写入 `eventTempSkins`；事件结束取消未完成队列并排一次「换回日常」 | `outfitChangeProcess.scheduleEventTempSkinChange` / `campEventEffects.applyEventTempSkins` / `clearEventTempSkinsForInstance` |
| 2 | 出征清临时外覆**瞬间剥皮** | 清皮后排一次换装过程（战斗页不可见，回营状态自洽） | `emotionOutfit.prepareSquadDefaultArmor` |
| 3 | 浴室毛巾/泡澡/帮洗准备**瞬间挂洗浴皮** | 进浴、离浴、帮洗 prepare 全部改走临时皮换装队列；离浴换回日常也走过程 | `campEventEffects.applyBatheShowerSkins` / `bathAssistSession` / `dialogueWorldSync` 洗浴分支 |
| 4 | 舞蹈「待机 → 独舞/共舞皮」**瞬间切换** | 新增 `unveil`（换演出服）过渡相位 2.4s：先换装中，到点才进入 `dancing`；BGM 仍以"正视起舞"为准 | `danceSession.beginUnveil/finishDanceUnveil`、`livingService.finishDanceUnveilNow`、UI 相位 |
| 5 | 同屏赴约统一外覆瞬间切皮 | 同屏成员也走换装队列；已被其它会话独占的角色不被覆盖 | `campEvents/coScreenSync` |
| 6 | 睡太沉的人被事件/按钮**瞬移+瞬醒** | 舞蹈/安抚/浴室入口都按 `sleepWakeDifficulty` 判定：叫不醒就拒绝进入；同屏赴约叫不醒则退出同屏 | `danceSession` / `anfuSession` / `bathAssistSession` / `coScreenSync` |
| 7 | 事件进行中可以被「睡吧」塞回床上 | `tryCommitSleepFromDialogue` 在舞蹈/安抚/浴室进行中直接拒绝 | `sleepSystem` |
| 8 | 营地/Hub 里排队换装要等 2 分钟心跳才显形 | 新增 1.5s 轻量泵 `tickDueOutfitChanges()`（无到期不写盘） | `livingService` / `App.ts` |

---

## 二、第二轮：P0/P1-F/G/I/J 落地状态

### 已修复（2026-10-21 第二轮）

| 项 | 结论 |
|---|---|
| **A/B/C · 移动必须有路程** | 新增 `src/ai/travel.ts`：登记行程（`travelPlans`）→ **按途经点实时换景**（起点 → 楼梯/大厅 → 目的地，对话背景 1s 内跟着脚步切换）→ 到点落点 + 写身体锚点；对话/营地/Hub 都有结算泵（1.5s 泵 + 对话 1s 心跳 + 世界心跳）。已替换：对白 `move_to`、乐观同步、`settleCharacterForDialogue` 议程路径、同屏赴约、舞蹈进/出场、安抚进/出场、浴室进/出场、帮洗准备 |
| **F · 帮洗准备一致性** | 准备阶段人在原地「换浴巾/收拾」，不再提前声称在浴室；7s 后进入会话→登记浴室行程→到点才落点泡澡；已存在 `bath_entry` 行程时不重置计时 |
| **G · 离线规则模拟（0 token）** | 新增 `src/ai/offlineSim.ts`：按真实 20 分钟步长模拟离线窗口——睡眠/作息推进（含「准备入睡」的时间补偿）、营地事件生成与结算（好感 ±）、主动留言（规则模板）；摘要**在睡眠/消息结算之后**生成，状态与日志一致。离线期间到期的旧留言**不扣好感**（记「你不在，她等了很久」）。同步给 AI：横幅 + 营地日志 + 生活档案 + 每个角色的个人记忆 + Prompt 注入（`buildOfflineDigestPromptBlock`，有效期 6 现实小时、700 字截断） |
| **I · 同屏剔除沉睡者** | 事件结束是**时间驱动**（`endsAtGameMin` → `resolve`），不等待缺席者；结算逻辑对 `joiners.length===0` 有「几乎没人理会」兜底。剔除沉睡者不会卡事件（已核对 `tickCampEvents` / `resolveEvent`） |
| **J · 姿态过渡** | Prompt 新增「姿态过渡」与「正在赶路」两条：躺/窝 → 起身时必须先写起身动作；反之亦然；赶路时禁止声称已到目的地 |

### 按你的决定保留现状（已记录，不再改）

| 项 | 决定 |
|---|---|
| **D · 安抚阶段皮** | 不需要额外过程：现有相位计时与过渡已足够 |
| **E · 共舞结束回待机皮** | 视为**同套舞装的动作切换**，允许瞬时换皮 |

---

## 三、仍存在的差距（非"必须修"，属于模拟粒度）

1. **离线事件是轻量合成**：按事件目录与标签结算好感/记忆，不逐条跑完整事件引擎（不生成同屏背景、不产生逐条营地日志），避免离线一周撑爆存档与记忆；醒来/事件数量有上限（每人 3 次睡眠、全局 8 起事件、2 条留言）。
2. **走路是"途经点"粒度**：跨层会经过出发层楼梯→目标层楼梯口，同层经过本层大厅/中庭；但同层两点之间没有逐门逐走廊的细分（楼梯/大厅场景共用 `indoor_stairs`/`indoor_dating` 等图）。
3. **姿态/表情（emotion_pose）仍是瞬时**：瞬时的表情合理；躺坐站之间的切换已用 Prompt 强制过场描述，但没有专属过渡皮。
4. **关系演化只做单点好感**：离线事件不做两两关系链、不做人生目标推进（这些仍只在在线心跳里跑）。

---

## 五、2026-10-22 对话一致性修复（截图反馈）

| 问题 | 根因 | 修复 |
|---|---|---|
| 人在卧室睡衣，嘴里却说"正守在厅口"/"去武器库" | `resolvePresence` 的议程分支在"身体不在议程目标房"时读了 **agent 的旧行为**（在厅口值守），把过期现场当此刻；议程文案又被当成现状 | 议程分支改为：身体与目标不一致时用**作息/锚点推导的 base 行为**，不再用 agent 旧行为；`describeAgendaForPrompt` 明确"这是打算，尚未发生"；Prompt 新增【意图≠现状】硬规则（计划不得说成正在/已经在） |
| 同一理由反复说（"风向…"），逻辑不自洽 | 人设口癖 + 历史对白复读；缺少跨轮去重与理由自洽约束 | Prompt 新增【禁止复读】【理由自洽】：最近两轮说过的句子/理由不得原样重复；室内/睡衣/深夜不得拿"外面风大"当主要理由 |
| 安抚邀请「去安抚室」按钮点了没反应 | `syncAnfuChrome`/`syncDanceChrome` 每 1s 重建邀请条 `innerHTML`，点击落在被替换的旧按钮上（mousedown/mouseup 节点不同 → click 丢失）；另外回复流式输出期间点击被静默 return | 邀请条按 `pending` 标识做 key 复用 DOM，内容不变不重建；流式输出中点确认改为给系统提示而不是静默丢弃 |
| 确认安抚后"像没进安抚室" | 会话改为"原地换装（7s）→ 走路（~14s）→ 到安抚室待机"，但文案还写"已在安抚室换装"，玩家以为失败 | 系统行/近期对话事实/Prompt 换装块统一改为"在自己房间换装，还没到安抚室"；到达后由行程结算写"已到安抚室待机" |
| 语音莫名中断："Model not exist. (仍可看文字)" | ①`qwen3-tts-instruct-flash` / `qwen3-tts-vc-*` 已不在官方支持模型列表（2026-10 只列 `qwen3-tts-flash`），按路径切模型会 400；②一旦路径锁定，后续失败**不再回退**，整段对话永久静音；③每句失败都往聊天里刷错误 | 全部路径统一 `qwen3-tts-flash`（不再发送未文档化的 instructions）；复刻音色失败自动回退该角色系统音色，云端全挂再回退系统朗读；失败**解锁**下一轮重试；UI 错误提示改为 2 分钟一次"语音暂时不可用，先用文字" |
| 语音音色不再"按我设定"（instruction/rate/pitch 不生效） | 旧 `qwen3-tts-instruct-flash`/`vc` 模型已不在支持列表；flash 通道无 instruction 参数 | **方案 A 已执行**：主通道切 `qwen-audio-3.1-tts-flash`（支持 instruction/rate/pitch/volume），逐角色重映射为 Audio 系统音色；旧通道 `qwen3-tts-flash` + `legacyVoice` 作为兜底；复刻音色（夜爪/冰华）暂用最接近的系统音色，需按 Audio 模型重建后可换回。营地生活面板新增"百炼业务空间 ID"（可选，专属域名用） |
| 离开安抚室瞬间切皮、没有换装过程 | 散场时 `forceScheduleOutfitChange` 被 `anfuHoldsOutfit` 守卫拦下（会话仍是 active），且 `prevEventTemp` 被**立即**恢复覆盖，等于硬切 | 先置 `anfuSession.active=false` 再排队 4.8s 换装过程；优先换回进安抚室前的临时外观（`applyAsTempInstanceId`），否则换回日常服；文案改为"正在换回原来的衣服（换装中）"，读档恢复不演换装 |



## 六、审计方法（可复跑）

1. `rg "setCampWornSkin\(|setEventTempSkin\(|eventTempSkins\[" src/ai` —— 找所有直接写皮的地方，逐个确认是否在"换装完成"时机。
2. `rg "snapAgentToRoom\(" src/ai` —— 找所有瞬移点；除事件结算/恢复外应走 `planTravel`。
3. `rg "phase === 'dressing'|phase === 'travel'|phase === 'unveil'" src` —— 相位分支是否覆盖 Prompt/立绘/按钮/BGM 四处。
4. `rg "adjustAffinity\(" src/ai` —— 打扰/离开/失败是否都有代价。
5. 每次新增事件会话：必须补齐相位表（含 travel）、拒绝路径、互斥矩阵、散场动作、恢复路径（见 `bath-assist-events.md` §5）。

## 七、音色映射（Qwen-Audio-TTS·方案 A）

主通道 `qwen-audio-3.1-tts-flash`，全部音色支持 instruction（人设/语气）+ rate/pitch/volume：

角色与新音色的对应关系由**自动匹配**得出：把旧通道 10 个音色 + 新通道 36 个音色用同一条台词各合成一遍，提取 F0 中位/跨度、19 维 MFCC 均值与方差、谱质心/滚降/平坦度、动态与语速，做稳健标准化后加权求距离，再用匈牙利算法保证 13 个角色拿到**互不相同**的候选，最后按旧音色的 F0/时长反算 `pitch`/`rate` 补偿值。

| 角色 | 音色（用户在试听页手调确认） | rate | pitch | volume |
|---|---|---|---|---|
| 苍羽·澪 | `longyingtao_v3.1` | 0.95 | 1.03 | 54 |
| 白楠·芹奈 | `longwan_v3.1` | 1.01 | 1.01 | 54 |
| 银绯·玲 | `yezhiqing_v3.1` | 1.03 | 1 | 50 |
| 苍斩·凛 | `yuxiaoyun_v3.1` | 0.98 | 1.04 | 46 |
| 焰甲·朱里 | `anruorou_v3.1` | 0.93 | 0.95 | 55 |
| 黄狐·萤 | `yunhuanhuan_v3.1` | 0.95 | 1.03 | 58 |
| 夜爪·黑织 | `baianran_v3.1` | 1.13 | 1.06 | 48 |
| 翠翼·铃 | `xuxiaoqiao_v3.1` | 0.96 | 0.96 | 54 |
| 绯尾·椿 | `longxing_v3.1` | 0.93 | 0.99 | 53 |
| 橙铠·琥珀 | `wenhuaiqing_v3.1` | 0.86 | 0.98 | 52 |
| 冰华·雫 | `longanlingxi_v3.1` | 0.97 | 1.06 | 52 |
| 光轮·天音 | `longanwen_v3.1` | 0.85 | 0.98 | 48 |
| 橙兔·美羽 | `longhua_v3.1` | 1.03 | 1 | 58 |

> 以上为用户在 `voice-audition.html` 试听页手调后的最终值（2026-10-22），已写回 `src/ai/voice/characterVoices.ts`（`voice` / `base.rate` / `base.pitch` / `base.volume` / `instruction`）与试听页。

匹配脚本与样本缓存在 `tmp/voice-match/`（`match.py` 合成+特征、`factors.py` / `final_factors.py` 补偿换算、`validate_params.py` / `test_combo.py` 参数验证）。所有样本统一固定 `seed=42`——不固定种子时同一音色每次合成的基频会差 ±20%，A/B 对比和自动匹配都会被噪声带偏。

### 音色身份锁（防跳变）

同一角色在整局游戏内声音**绝不跳变**。历史上出现过"角色音色混乱/跳变"，根因有 4 个，全部已堵死：

| 跳变来源 | 以前 | 现在 |
|---|---|---|
| 合成通道切换 | 云端失败就改走旧通道(qwen3)或系统朗读 → 直接换人 | `voiceIdentities` 身份锁：角色第一次出声后锁死 (通道, 音色)，之后只允许"同通道同音色重试"；宁可这一句静音也不换声线 |
| 情绪改音高 | 情绪/句型带来 ±0.02~0.04 音高偏移 → 同一角色每句音高不同 | 音高固定为角色基线（`resolveQwenProsody` 不再叠情绪 pitch），情绪只走语速/音量/instruction |
| 云端随机渲染 | 同音色不同 seed 渲染细节会飘 | 每个角色用 `seedForCharacter(characterId)` 派生的固定 seed → 同一角色每次渲染一致 |
| 失败降级策略 | 任何失败都退旧通道/系统朗读 | 区分**永久性失败**（音色/模型/鉴权不被支持）与**临时故障**（限流/超时/网络）：临时故障只重试同一声线，不降级；永久性失败允许**一次性**迁移并把新声线锁死，不在多声线之间横跳 |

辅助保障：instruction 里把"保持同一嗓音身份"放在最后一句；`resetVoiceIdentities()` 供换整套音色时手动解锁。

### 关键实测结论（Qwen-Audio-TTS 参数行为）

| 参数 | 实测行为 |
|---|---|
| `seed` | 同文本+同音色+同 seed 可复现；不固定时基频抖动可达 ±20% |
| `rate` | 只改语速（F0 基本不变），时长 ≈ 原时长 / rate；**一旦 rate≠1，同一请求里的 `pitch` 会被完全忽略**（这是"音高滑块没反应"的真正原因） |
| `pitch` | 改基频与时长（时长 ≈ 原时长 × pitch^-1.85），rate=1 时才生效 |
| `instruction` 调音高 | "明显偏低"有效（F0 −24%），"明显偏高"几乎无效（模型上限） |
| SSML `<prosody>` | 结果不稳定（同样参数两次基频差 10%+），不采用 |

**因此最终方案：音高走云端 `pitch`，语速走本地 `playbackRate` + `preservesPitch`**（浏览器变速不变调），两者不再互相覆盖；`player.ts` 里按 `rate × pitch^-1.85` 抵消云端 pitch 带来的时长变化，保证"调音高不变语速"。游戏内与试听页共用这套逻辑。

旧复刻音色 `qwen-tts-vc-*` 经 API 验证已不可用（`Invalid voice specified ... not licensed`），需要用 Audio 模型重新创建后才能填回 `voice`。

复刻音色说明：旧 `qwen-tts-vc-*` 音色必须在 Audio 模型下重新创建才能继续使用；重建后把新 ID 填回对应角色的 `voice` 即可。
