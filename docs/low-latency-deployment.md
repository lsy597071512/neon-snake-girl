# 锈带纪元 · 本地模型低延迟部署方案

> **适用**：RTX PRO 4500 Blackwell 32GB + Tailscale / Cloudflare + 手机异地访问  
> **文档状态**：v1.1 · 2026-09-10  
> **现行本机后端**：见 [`local-ai/README.md`](./local-ai/README.md)（**Fable Q4 + llama.cpp ± MTP**）。下文仍有历史 Violet/Ollama 叙述，仅作隧道/回落思路参考，**勿再拉 violet-lotus**。

---

## 一、硬件能力（RTX PRO 4500 Blackwell）

| 规格 | 数值 | 意义 |
|------|------|------|
| 架构 | Blackwell | 最新代，第五代 Tensor Core |
| 算力 | FP8 **811 TFLOPS** / FP16 406 TFLOPS | 推理速度远超消费级 |
| 显存 | **32 GB GDDR7** ECC | 可完整加载 12B Q8 + KV Cache |
| 带宽 | **896 GB/s** | 出字速度有保障 |
| PCIe | **PCIe 5.0 x16** | 低延迟数据传输 |

**结论**：Blackwell 的 12B Q8 推理 ≈ 35-55 token/s，与 H100 80% 持平。
真正的延迟瓶颈是**网络**，不是推理速度。

---

## 二、延迟拆解

```
手机点击 → [公网 30-200ms] → [Ollama 预填充 ~300-500ms] → [生成 80-150 token ≈ 2-3s] → 显示
```

| 场景 | 延迟预期 | 说明 |
|------|---------|------|
| **本机 PC（开发）** | < 1 秒 | 无网络 |
| **同 WiFi（营地测试）** | 1-2 秒 | 局域网直连 |
| **Tailscale（同城异地）** | 2-3 秒 | WireGuard P2P，NAT 穿透 |
| **Tailscale（跨省异地）** | 3-5 秒 | 跨地域 DERP 中转 |
| **trycloudflare（临时）** | 5-8 秒 | 不稳定，URL 会变 |
| **千问云端（基准）** | 1-3 秒 | 阿里云 H800 专用卡 |

**本地 + Tailscale 已经接近千问云端延迟**，且完全免费。

---

## 三、5 步优化（对玩家体验零影响）

### 步骤 1：Ollama 常驻显存（消除冷启动）

**目标**：模型永不卸载，消除 30-60 秒冷加载

```powershell
# 环境变量（已设置）
OLLAMA_HOST        = 0.0.0.0:11434   # 监听所有网卡（手机访问必需）
OLLAMA_KEEP_ALIVE  = -1               # 永不卸载模型
OLLAMA_MODELS      = F:\Ollama\models
OLLAMA_NUM_PARALLEL = 1               # 一次只跑一个请求（稳定）
OLLAMA_MAX_LOADED_MODELS = 1          # 显存 32GB 够用一个
OLLAMA_FLASH_ATTENTION = 1            # 加速 attention 计算
OLLAMA_GPU_OVERHEAD = 200              # 显存余量（MB）
```

> **设置后需完全退出 Ollama 托盘，重新打开** `F:\Ollama\ollama app.exe`

**对玩家**：模型常驻 → 随时点开随时有，无等待。

### 步骤 2：会话级 SYSTEM 缓存（砍 50% prefill）

**目标**：同一角色多轮对话时，跳过已计算的 Prompt 部分

**原理**：Ollama 有 KV Cache，同一 SYSTEM 的计算结果可复用。
当前代码每次都重拼 200 行 SYSTEM，加缓存后第 2 句起只需发送 `对话历史 + 当前消息`。

**改动文件**：`src/ai/promptAssembler.ts`
**对玩家**：第 2 句起快 2-3 倍，内容完全不变。

### 步骤 3：Tailscale 替代 trycloudflare（网络稳定 +30%）

**目标**：固定 IP（100.x.x.x），不换 URL，不掉线

| 对比 | Tailscale | trycloudflare |
|------|-----------|---------------|
| 地址 | 固定（100.x.x.x） | 每次变 |
| 稳定性 | ✅ WireGuard P2P | ❌ 临时中转 |
| 延迟 | 30-80ms（同城） | 100-300ms |
| 依赖 | 需要同一账号登录 | 无需账号 |
| 成本 | **免费（100 设备）** | 免费 |
| 需要 VPN？ | **不需要** | 不需要 |

**Tailscale 工作原理**：
- NAT 穿透（STUN/ICE）建立直连（80% 情况）
- 不通时自动走 DERP relay（中转延迟 50-200ms）
- **完全不需要公网 IP / 路由器配置**

**对玩家**：外地玩几乎不断线，地址不变。

### 步骤 4：Modelfile SYSTEM 精简（已达标）

当前 13 个 Modelfile 的 SYSTEM 已是精简版（每角色约 20 行），包含：
- 角色定义（必须）
- 世界观（必须）
- 性格（必须）
- 说话方式（必须）
- JSON 输出格式（必须）
- 示例输出（必须）

**已无需再砍。** LoRA 训练已经把角色刻进权重，SYSTEM 只起提醒和格式规范作用。

**对玩家**：体验不变。

### 步骤 5：自动回落到千问（容错）

**目标**：violet-lotus 请求失败 / 超时 5 秒 → 自动切千问

**改动文件**：`src/ai/llmRouter.ts`
**对玩家**：violet 挂了完全无感知，自动切回千问继续玩。

---

## 四、网络架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      外地手机                               │
│   游戏 → Camp Living → 营地生活 → 家里云端（手动切）         │
└──────────────────────┬──────────────────────────────────────┘
                       │ Tailscale WireGuard（固定 100.x.x.x）
                       │ 不需要 VPN / 公网 IP / 端口转发
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                     家里 PC                                  │
│  RTX PRO 4500 Blackwell 32GB                               │
│  Ollama（监听 0.0.0.0:11434）                              │
│  violet-lotus-q8:latest 常驻显存                            │
│  13 角色 Modelfile                                          │
│                                                             │
│  Tailscale IP: 100.x.x.x  ← 固定，异地手机填这里             │
└──────────────────────────────────────────────────────────────┘

默认路径（不切）：千问 dashscope → 1-3 秒 → 玩家
手动切本地路径：Tailscale → 2-5 秒 → 玩家
自动回落：      violet 失败 → 千问 → 玩家无感
```

---

## 五、游戏配置步骤

### 5.1 电脑端（一次性配置）

1. **Ollama 环境变量**（已由 `setup-home-gpu.ps1` 设置）

2. **运行 setup 脚本**（生成游戏可读配置）：
   ```powershell
   cd f:\AI\neon-snake-girl_zhen\neon-snake-girl
   powershell -ExecutionPolicy Bypass -File scripts/setup-home-gpu.ps1
   ```
   输出 `public/home-gpu-config.json`（营地生活 UI 可直接读）

3. **安装并登录 Tailscale**（如果异地手机要连）：
   - 下载：https://tailscale.com/download/windows
   - 登录同一账号
   - 记录本机 Tailscale IP：`tailscale ip -4`

### 5.2 手机端（异地访问）

1. 应用商店搜 `Tailscale`，安装
2. 同账号登录（手机端无需 VPN）
3. 连上后，手机浏览器测试：
   ```
   http://100.x.x.x:11434/api/tags
   ```
   应返回模型列表

4. **营地生活配置**：
   - Camp Living → 模型/API → **家里云端**（勾选高级）
   - Base URL：`http://100.x.x.x:11434/v1/chat/completions`
   - 模型：`rustbelt-ashcrow:latest`（或其他角色模型）
   - Bearer：`ollama`
   - **测试连接** → 成功后进角色对话

### 5.3 同 WiFi（家里测试，无需 Tailscale）

营地生活 → **同 WiFi · 局域网**
- Base URL：`http://192.160.12.193:11434/v1/chat/completions`

---

## 六、当前配置快照

```json
{
  "version": 1,
  "provider": "openai_compatible",
  "model": "violet-lotus-q8:latest",
  "apiKey": "ollama",
  "baseUrlLocal": "http://127.0.0.1:11434/v1/chat/completions",
  "baseUrlLan": "http://192.160.12.193:11434/v1/chat/completions",
  "preferredMode": "tailscale",
  "ollamaHost": "0.0.0.0:11434"
}
```

---

## 七、推荐使用场景

| 场景 | 推荐路径 | 延迟 | 成本 |
|------|---------|------|------|
| **线上正式玩** | 千问 dashscope | 1-3 秒 | DashScope Key |
| **家里 PC 开发** | 本机 localhost | < 1 秒 | 免费 |
| **同 WiFi 测** | 局域网 | 1-2 秒 | 免费 |
| **外地手机自测** | Tailscale + PC | 2-5 秒 | 免费 |
| **violet 挂了** | 自动切回千问 | 1-3 秒 | 千问 |

---

## 八、相关文档索引

| 文档 | 内容 |
|------|------|
| `docs/ai-dialogue-pipeline.md` §0 | 主规范（千问是默认，Violet 是测试旁路）|
| `docs/model-config-status.md` | 模型配置 + 迁移检查清单 |
| `scripts/setup-home-gpu.ps1` | 一键生成 home-gpu-config.json |
| `scripts/lora-modelfiles/` | 13 角色 Modelfile |
| `docs/violet-lotus/` | Violet 测试文档目录 |
| `public/home-gpu-config.json` | 游戏营地生活 UI 可读配置 |
| `docs/local-model-deployment-plan.md` | 模型选型分析（Kimini K3 / Qwen3 MoE 等）|

---

## 九、迁移检查清单（换电脑 / 换 GPU / 换模型）

> 完整清单见 `docs/model-config-status.md` §七

### 硬件变更时

| 变更 | 需要的操作 |
|------|-----------|
| 换 PC | 重装 Ollama + 拉模型 + 重配 Tailscale |
| 换显卡 | 更新 `OLLAMA_*` 环境变量 + 重拉量化版本（如 Q8→Q4） |
| 换模型 | 修改 `from violet-lotus-q8:latest` → 新模型 + 验证 Modelfile |

### 软件变更时

| 变更 | 需要的操作 |
|------|-----------|
| 升级 Ollama | 重装 + `ollama pull violet-lotus-q8:latest` |
| 换网络方案 | Tailscale → Cloudflare Tunnel / 反之，重配 Base URL |
| 换角色 LoRA | 更新 `scripts/lora-modelfiles/Modelfile.<id>` → `ollama create` |

### 快速验证

```powershell
# 1. Ollama 正常
ollama list
# 应看到 violet-lotus-q8:latest

# 2. 网络可达（手机连 Tailscale 后）
curl http://100.x.x.x:11434/api/tags

# 3. 模型响应
ollama run violet-lotus-q8:latest "你好"

# 4. 角色 Modelfile 正常
ollama run rustbelt-ashcrow:latest "澪早"
# 应返回 JSON 格式角色对话
```
