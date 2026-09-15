# 手机登不上 Tailscale？外地用 Cloudflare

国内手机常见：登录按钮无反应 / Google 打不开。

## 方案 A（外地主路径）：Cloudflare 临时隧道

电脑：

```powershell
npm run start:remote-gpu
```

桌面会生成 `rust-belt-era-apk\remote-url.txt`，地址同时进剪贴板。

手机游戏 → 家里云端 → 高级 → Base URL 粘贴 → 测试连接。

电脑勿休眠；关掉 cloudflared 即断。每次重跑地址会变。

## 方案 B：同 WiFi（在家时）

手机连与电脑同一 WiFi → 点「同 WiFi · 局域网」。

## 方案 C：Tailscale Auth Key（可选）

1. 电脑浏览器打开 [login.tailscale.com](https://login.tailscale.com)（微软/GitHub）  
2. [Auth keys](https://login.tailscale.com/admin/settings/keys) 生成密钥  
3. 手机 Tailscale → Accounts → Add auth key  

仍打不开就放弃，用方案 A。
