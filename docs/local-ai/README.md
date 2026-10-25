# 锈带纪元 · 本机 AI 方案（Fable Q4）

> **状态**：2026-09-10 定案并已进游戏接线（取代 Remnant / Violet）  
> **产品默认**：仍是 DashScope **`qwen-plus-character`**（不可改）。  
> **本机唯一旁路基座**：**Qwen3.8-27B TURBO Fable-Cold-Fusion Heretic · Q4_K_M**  
> **本机推理后端**：**llama.cpp server**（ctx 16K · KV q8 · reasoning off · **推荐 MTP**）  
> **已废弃**：MN-Violet-Lotus / rustbelt-* / Remnant-glm4-32b / 一切角色 LoRA。

---

## 0. 方向判断（相对「完整方案-单文件版」）

| 项 | 判断 |
|--|--|
| 基座选 Fable-Cold-Fusion Heretic | ✅ 中文 RP / 情感 / 祛审查 |
| 量化 **Q4_K_M** | ✅ RTX PRO 4500 32GB |
| SillyTavern 原文照搬 | ❌ 游戏要 OpenAI `/v1/chat/completions` + 严格 JSON |
| llama.cpp（FA / KV q8 / cache-reuse） | ✅ `scripts/start-fable-llamacpp.ps1` |
| **MTP 投机**（`--spec-type draft-mtp`） | ✅ 实测接受率 ~58–80%；关思考缓存命中 **~3.8s**，可快于千问 |
| 13 角色 LoRA | ❌ 单基座 + `aiProfiles` |
| Prompt 一比一瘦身/拆分 | ✅ 已落地（见下） |

---

## 1. 权重与服务

| 项 | 值 |
|--|--|
| HF 仓 | `DavidAU/...-NEO-CODER-MAX-MTP-GGUF` |
| **主权重（推荐）** | `...-MTP-Q4_K_M.gguf`（内含 MTP 头，~17.2GB） |
| 备选权重 | `...-Q4_K_M.gguf`（无 MTP，~16.8GB） |
| 本地目录 | `F:/Ollama/gguf/fable-q4/` |
| 兼容模型名 | `fable-q4:latest`（`-a` 别名） |
| **主 API** | `http://127.0.0.1:8080/v1/chat/completions` |
| Ollama 备胎 | `:11434`（需改 config；非推荐） |
| 二进制 | `F:\llama-cpp-cuda\llama-server.exe`（**不要**用 Ollama 自带 CPU stub） |
| 启动 | `pwsh scripts/start-fable-llamacpp.ps1`（默认：有 MTP 文件则开 MTP） |
| 强制 MTP | `... -Mtp` |
| 关 MTP | `... -NoMtp` |
| 停止 | `pwsh scripts/stop-fable-llamacpp.ps1` |
| **开机自启 + 闪退/断线重连** | `pwsh scripts/install-fable-autostart.ps1` |
| 固定安装目录 | **`F:\Ollama\fable-home-gpu\`**（无 F:\Ollama 则 `%LOCALAPPDATA%\RustBelt-Fable-HomeGpu`） |
| 探活间隔 | 默认 **60s**（进程没了 / 端口没了 / `/health` 失败 → 重启；Tailscale 掉线 → `up`） |
| 计划任务 | `RustBelt-Fable-HomeGpu-Watchdog`：**登录触发** + **每 15 分钟兜底**（任务本身 RestartCount=999） |
| 与游戏仓库 | **无关**。挪仓库、换盘装游戏都不会让自启失效；任务只指向固定目录 |
| 卸载自启 | `... -Uninstall` |
| 看门狗日志 | `F:\Ollama\fable-home-gpu\logs\watchdog.log` |
| 上下文 | **16384** |
| KV | **q8_0** + Flash Attention + cache-reuse 256 |
| Thinking | **low**（服务端 `--reasoning auto` + 客户端 `reasoning_effort: low`；预算帽 256） |
| max_tokens | **720**（think 占额度；过低易空 content） |
| MTP 参数 | `--spec-type draft-mtp --spec-draft-n-max 2` |

### 开机自启行为（2026-09-23 定案）

1. 在游戏仓库执行一次：`pwsh scripts/install-fable-autostart.ps1`  
   → 把 `scripts/fable-home-gpu/*` **复制**到固定目录，并注册计划任务 `RustBelt-Fable-HomeGpu-Watchdog`。
2. **重启电脑后**：需用安装时的 Windows 用户（当前为交互登录用户）**登录进桌面**；约 45s 后看门狗启动，再拉起 `:8080`。  
   停在登录界面不登入 → 不会启动（非系统服务，需 GPU 用户会话）。
3. 运行中进程闪退、端口掉了、`/health` 失败 → 最多约 60s 内自动重启；Tailscale 掉线会 `tailscale up`。
4. 挪/换游戏仓库路径 **不必再装**；只有换机器、或要更新看门狗脚本内容时，再跑一次 `install-fable-autostart.ps1`。
5. 卸载：`... -Uninstall`（任务去掉；固定目录文件可手动删）。

---

### 延迟实测摘要（2026-09-10 · 同游戏 Prompt ~5772 tokens）

| 场景 | 无 MTP | MTP | qwen-plus-character |
|--|--:|--:|--:|
| 关思考 · 冷 | ~10.8s | ~9.0s | — |
| 关思考 · 缓存 | ~6.2s | **~3.8s** | **~6.8–7.2s** |
| 思考 low · 缓存 | ~8.4s | ~5.6s | — |

明细：`tmp/latency_mtp_compare_summary.json`。

---

## 2. 与千问 / 游戏接线

| 层 | 状态 |
|--|--|
| 默认 Provider | `dashscope` + `qwen-plus-character` |
| 营地「一键启用本机」 | → `openai_compatible` + `fable-q4:latest` + `:8080` |
| `public/home-gpu-config.json` | 进 APK；`shipId` 变化强制覆盖手机旧配置 |
| Prompt 拆分 | 整包 system（static+dynamic 同布局）＋短 user（**2026-09-12 结构硬规则**：禁止再把快照拆进 user） |
| 本机钳制 | `localHomeGpuClamp` / `localHomeGpuPrompt` 短锁 |
| life / TTS / ASR | **仍只走千问** |

硬规则：[`../ai-dialogue-pipeline.md`](../ai-dialogue-pipeline.md) §0。

### 相关源码

- `src/ai/providerConfig.ts` — `DEFAULT_LOCAL_MODEL` / `DEFAULT_COMPAT_BASE_URL`
- `src/ai/dialogueEngine.ts` — 拆分消息 + 本地请求 maxTokens clamp 560（`Math.min(LOCAL_HOME_GPU_MAX_TOKENS, 560)`；千问对话通道默认 500）
- `src/ai/llmClient.ts` — 兼容口 `reasoning_effort: none`
- `src/ai/promptAssembler.ts` / `aiProfiles.ts` — 一比一去重与门控
- `src/ui/campLivingPanel.ts` — 营地切换 UI

---

## 3. Prompt 瘦身（已落地）

对照与勾选：[`prompt-slim-split-review.md`](./prompt-slim-split-review.md)  
备份：`docs/local-ai/backup-pre-slim-2026-09-10/`

---

## 4. 盲测 / 延迟脚本

- `scripts/ab_fable_vs_qwen_100.py` · `scripts/ab_fable_rp_full_50.py`
- `tmp/bench_mtp_vs_qwen.py` · `tmp/latency_*_vs_qwen.json`

---

## 5. 换电脑清单（进 git）

- 本文件 + `prompt-slim-split-review.md`
- `public/home-gpu-config.json`
- `ollama/Modelfile.fable-q4`（Ollama 备胎）
- `scripts/start-fable-llamacpp.ps1` · `stop-fable-llamacpp.ps1` · `setup-fable-q4.ps1`
- `scripts/install-fable-autostart.ps1` + `scripts/fable-home-gpu/*`（部署到固定目录的开机自启 / 看门狗）
- 人设：`src/ai/aiProfiles.ts`

GGUF **不进 git**。

### 延迟：玩家回复 vs 角色连说（2026-09-10 实测）

服务端日志：玩家回复轮常见 **~10s** = prefill ~5.5s（~6k tokens）+ decode ~4s（~180 token）。  
根因之一：旧 `normalizeChatMessages` 把「角色先开口」并进 **system**，每轮改写静态前缀 → KV 缓存失效（对照实验：改写 system 时 `cached=0`；固定 system 时第二轮 `cached≈5100`、墙钟 **8.5s→4.9s**）。  
已修：先开口改为短 user 占位；本机路径改 **SSE 流式**（失败回落非流式）。

### 手机异地（Cloudflare）

```powershell
# 1) 已开 llama.cpp 后：
powershell -File scripts/start-fable-cloudflare.ps1
# 2) 写入 public/home-gpu-config.json（preferredMode=cloudflare）后重打 APK
npm run build:apk
```

PC 保持醒着；`cloudflared` 与 llama.cpp 勿关。Quick tunnel **每次重启 URL 会变**，需重跑脚本并重打 APK（或把新 URL 写进包内 config）。
