# 私测发行：兑换码网关（Cloudflare 免费档 · 卡密自动发货）

> 📐 本系统的完整技术架构/数据流/API 规格/维护规约见 [docs/激活与账号系统.md](../docs/激活与账号系统.md)（改代码必须同步那份文档）。本文件只写部署步骤。

玩家体验：**首屏输入「兑换码 + 自己的千问 API Key」→ 进游戏**。兑换码即账号，购买后自动发货。
你的日常：**零逐人维护**——批量生成码池上传销售平台，只剩偶尔吊销滥用码。

---

## 一、一键部署（开发者，只做一次）

```powershell
.\scripts\deploy-gateway.ps1
```

自动完成：装工具 → 浏览器授权（唯一要你动手的）→ 建库建表 → 自动生成密钥写入 Cloudflare →
部署 → 网关地址自动回填客户端 → 凭据存 `gateway\.secrets.local.json`。

## 二、卖游戏（零人工）

```bash
node scripts\manage-codes.mjs --generate 1000 --out codes-batch1.txt --note "爱发电第一批"
```

1. 到 **爱发电（afdian）** 创建商品，类型选「卡片密钥/自动发货」，把 `codes-batch1.txt` 内容上传
2. 玩家付款 → 平台自动发一个码 → 玩家在游戏输入「码 + 千问Key」→ 开玩
3. 码池见底就再生成一批传上去（`--list` 看库存）

> 其他可选平台：微店/淘宝虚拟商品自动发货均可，本质都是「你供卡密、平台自动发」。

## 三、玩家话术（可直接复制）

> 游戏发你了。第一次打开输入两样东西：
> ① 兑换码：你付款后平台自动发给你的那个（RB-XXXX-XXXX）
> ② 千问 API Key：阿里云搜「百炼」→ 注册 → API-KEY 管理 → 创建（有免费额度）
> 粘贴进去就能玩。Key 只存在你自己手机里。
> 换手机：登录界面点「强制解绑旧设备」（30 天可自助一次）。

## 四、管理命令

```bash
node scripts\manage-codes.mjs --list                          # 库存与绑定情况
node scripts\manage-codes.mjs --revoke RB-XXXX-XXXX           # 吊销（退款/滥用）
node scripts\manage-codes.mjs --unbind RB-XXXX-XXXX           # 手动强制解绑（不受冷却限制）
```

## 五、国内可达性

`*.workers.dev` 默认域名大陆不稳定。部署后先让测试者试；连不上就在 CF 免费版绑自有域名
（Worker → Settings → Domains & Routes），改 `src/platform/license.ts` 的 `GATEWAY_URLS` 重打包。

## 六、安全须知

- `gateway/.secrets.local.json`（含 ADMIN_KEY）**绝不外传、绝不提交 git**（已加 .gitignore）
- token 为 HMAC 签名，客户端无法伪造；吊销在下一次在线校验（≤24h）生效
- 防共享三层：一码限设备（默认 3）→ 自助换绑 30 天冷却 → AI 功能要玩家自己的 DashScope Key
