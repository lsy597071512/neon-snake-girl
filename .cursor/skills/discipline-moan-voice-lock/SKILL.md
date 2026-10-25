# 调教娇喘（音色锁定）

按 `docs/discipline-moan-pipeline.md` 为角色生成三段可循环娇喘。

## 何时用

- 用户要「调教小黑屋娇喘」「按角色音色生成娇喘」
- 扩展到新角色 / 重做某一阶段（尤其 S2 拖长呼吸）

## 强制规则

1. **必须锁** `characterVoices.ts` 已登记音色（VC / instruct / flash）
2. 先合成**说话**参考，禁止用「嗯啊哈」当音色参考
3. MiniMax H3 用 **ReferenceToVideo**：`<Picture 1>` 静帧 + `<Audio 1>` 音色；只演娇喘、不念参考句
4. 禁止纯 TTS 念拟声词当成品；禁止不锁音色的纯 I2V 进包
5. S2 必须短促，禁止拖长呼吸
6. 后处理禁止 dynaudnorm

## 命令

```bash
python -u scripts/run_minimax_h3_discipline_moan_batch.py --all --skip-done
python -u scripts/run_minimax_h3_discipline_moan_batch.py --character frostline
python -u scripts/run_minimax_h3_discipline_moan_batch.py --character skyshard --stage 2 --force
```

花名册：`scripts/discipline_moan_roster.py`  
输出：`tex/audio/discipline-moan/{characterId}/`

## 前置

- ComfyUI MiniMax H3：`http://127.0.0.1:8188`
- `.dashscope_key`
- 静帧 `{stem}_p1_s{1,2,3}_gs.png` 在 `E:\MiniMaxH3\ComfyUI\input\`
