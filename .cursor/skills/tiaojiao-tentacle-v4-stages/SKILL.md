---
name: tiaojiao-tentacle-v4-stages
description: >-
  MiniMax H3 多姿势×三强度触手调教（绿幕→透明 WebM）全角色可断点续跑。
  静帧来自 webm_tentacle_loop 全部 *_tentacle_first.png；禁止一图三阶段。
  r9 允许露点，但乳头/性器官必须符合女性解剖位置；倒序 UR04→SR01。
  Use when 调教/触手/露点/解剖准确/绿幕 webm/resume after disconnect.
---

# 调教触手 v4 — 多姿势 × 三强度（r9 NSFW 解剖锁）

**源静帧（只读）：** `tex/juese/pifu/pifu_weizhi/webm_tentacle_loop/`  
**成品（隔离写入）：** `tex/juese/pifu/pifu_weizhi/webm_tentacle_loop_v4_stages/`

## 用户硬规则（照做）

1. **停干净再全量重跑**；不要在旧队列上叠任务  
2. **不要**用一张静帧刷三个阶段；同角色有几张调教静帧就跑几套姿势  
3. **本版可以露点**；乳头、性器官必须在正确女性生理位置（见解剖锁）  
4. 背景必须 **纯绿 `#00b140`**，抠干净后出规范透明 `.webm`  
5. 生成前对照该角色其他皮肤锁脸/身材/义体（`_identity_bible.json`）  
6. **倒序**：从最后一个角色 `UR04_1` 开始 → `SR01_2`  
7. 断线后续跑，避免无故 `--force` 全量重来  
8. **角色图只认** `tex/juese/pifu/pifu_weizhi/tiaojiao/*_服装_gs.png`（映射见 `E:/MiniMaxH3/_tiaojiao_char_refs.py`）；**禁止** `shenghuofuzhuang00` 或其他皮肤作图1

## 解剖锁（露点时强制）

| 部位 | 要求 |
|------|------|
| 乳头 | 每侧乳房中央一枚；乳晕自然大小；禁止跑到腹/肩/臂 |
| 乳房 | 女性软组织+下乳线；晃动时乳头仍贴在乳丘上 |
| 外阴 | 仅在两腿之间会阴/胯缝；**软糊柔和粉缝**（略虚焦、简化，勿高清解剖）；禁止马赛克打码、禁止糊成乱肉块 |
| 肛门 | 若可见仅在臀缝，与外阴分离 |
| 禁止 | 错性器官、错位漂移、插入/抽插、高潮喷溅收尾 |

### 身材比例硬锁

- 体型只跟角色身份图（参考图1）：纤细运动型、腿长偏细、胸臀适中  
- 姿势参考只借骨架/机位，**禁止**吸收其粗大腿、巨臀、巨乳、短躯干  
- 构图用中近景平衡头身，禁止胯间鱼眼特写把下半身放大一圈

1. **爆衣露出**：衣料胸口撕开/扯裂，清晰布料边缘，乳房从开口里露出；或肩带滑落、整件卷到锁骨以上  
2. **上半身裸体**：上衣褪到腰际或脱掉，上半身无遮挡  

**严禁**：完整衣料表面再长出乳房/乳头；隔着未撕开布料透点；乳肉叠在未撕开衣料上。

S1 轻露 → S2 明确露乳（短裤仍盖下体）→ S3 峰值暴露（可露阴）；**全程禁止插入**。

## 命名

`{CHAR}_p{pose}_s{stage}_tentacle_loop.webm`  
例：`UR04_1_p1_s1`、`SR05_1_p8_s3`  
当前后缀：`_r9`

## 文件

| 路径 | 作用 |
|------|------|
| `scripts/_build_tiaojiao_pose_inventory.py` | 扫描静帧 → `_pose_inventory.json` + `_src/` |
| `scripts/run_minimax_h3_tiaojiao_stages_v4_trial.py` | H3 批处理（resume / inflight） |
| `scripts/watch_tiaojiao_v4_pipeline.ps1` | 看门狗（默认倒序角色表） |
| `_identity_bible.json` | 形象/身材/面貌锁 |
| `_pose_inventory.json` | 多姿势清单 |
| `_pipeline_state.json` / `_inflight.json` | 断点 |

## 姿势库存（约 102 jobs）

UR04×3、UR03×2、SSR05×2、SSR04×2、SSR03×2、SSR02×2、SSR01×2、SR05×8（含 renwu1–6）、SR04×3、SR03×1、SR02×2、SR01_3×1、SR01_2×4；每姿势 × S1/S2/S3。

## Non-negotiables

1. 只写 `webm_tentacle_loop_v4_stages/`；不覆盖上架目录  
2. 每姿势独立首帧；POSE LOCK：强度可变、姿势不变  
3. 绿幕 QA + 相机锁 + 反僵硬大动  
4. 768×1344，144f→120f；`last_frame` 关  
5. Comfy：Minimized、禁 stdout redirect、单实例 8188  
6. 默认 resume；解剖错位/绿幕脏 → `_reject_*` 再对该 stem `--force`

## 一键

```powershell
# 停旧任务后：
& "E:\MiniMaxH3\venv\Scripts\python.exe" -u `
  "...\scripts\_build_tiaojiao_pose_inventory.py"

powershell -ExecutionPolicy Bypass -File `
  "...\scripts\watch_tiaojiao_v4_pipeline.ps1"
```

看门狗默认角色序：`UR04_1,…,SR01_2`。

## Agent「继续」清单

```
1. 停残留 batch/watch；确认 queue 空
2. 读 inventory + state + 已有 *_p*_s*_tentacle_loop.webm
3. 预览查：绿幕、身份、乳头/外阴位置
4. 有 _inflight 则续等；否则无 --force 开看门狗
5. 勿关最小化 Comfy
```

## Checklist

```
- [ ] 多姿势静帧已入库（非一图三阶段）
- [ ] 身份圣经已对照其他皮肤
- [ ] 露点时解剖位置正确；无插入
- [ ] 纯绿底、webm 抠干净
- [ ] 倒序全量 + 断点文件在推进
```
