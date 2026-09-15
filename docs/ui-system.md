# UI 系统文档

> **源文件**：`src/ui/`、`src/ui/aiLiving.css`、`src/ui/cc-ui.css`  
> **最新更新**：2026-09-06

---

## 概述

游戏 UI 分为两套：
- **cc-ui.css**：通用组件（主页/仓库/成就等）
- **aiLiving.css**：AI 生活相关组件（对话/营地/立绘）

---

## 页面结构（App.ts 路由）

```typescript
// src/ui/App.ts
type Screen = 'hub' | 'camp' | 'combat' | 'warehouse' | 'gallery' | 'settings';

// 主页（hub）
renderHub() → .wl-hub

// 营地（camp）
renderCamp() → .camp-hub

// 战斗（combat）
renderCombat() → .combat-screen

// 仓库（warehouse）
renderWarehouse() → .warehouse-screen

// 图鉴（gallery）
renderGallery() → .gallery-screen
```

---

## 营地页面布局（camp-hub）

```
┌────────────────────────────────────────────┐
│ [返回主城]  [第240日 15:17 · 正午]  [仓库 商店 武器库] │ ← top bar
├────────────────────────────────────────────┤
│                                            │
│            营地平面地图                      │
│         （1F/2F 可切换）                   │
│                                            │
│    [角色立绘] [角色立绘] [角色立绘]         │ ← 角色在地图上
│                                            │
├────────────────────────────────────────────┤
│ [营地生活]  [出征]  [其他导航]              │ ← 底部导航
└────────────────────────────────────────────┘
```

### 营地 CSS 类

| 类 | 说明 |
|---|---|
| `.camp-hub` | 营地主容器 |
| `.hub-stage` | 舞台区域（含背景图） |
| `.hub-clock-chip` | 顶部时钟芯片（2026-09-06 移到顶部居中） |
| `.camp-hub-loc-chip` | 位置提示芯片 |
| `.camp-hub-sys-bar` | 系统按钮栏（仓库/商店/武器库） |
| `.camp-hub-back` | 返回主城按钮 |
| `.hub-living-fab` | 营地生活浮动按钮 |
| `.camp-event-banner` | 事件横幅 |

---

## AI 对话 Overlay（aiDialogueOverlay）

```
┌────────────────────────────────────────────┐
│ [×]  [角色名 · 位置 · 好感 72]              │ ← top bar
├────────────────────────────────────────────┤
│                                            │
│            立绘区域                         │
│      （WebM 动态/PNG 静态）                  │
│                                            │
├────────────────────────────────────────────┤
│            对话日志区域                      │
│    [角色气泡]  [玩家气泡]                   │
├────────────────────────────────────────────┤
│ [📦] [🎤] [___输入框___________] [发送]    │ ← 输入区
│ [小黑屋]                                         │
└────────────────────────────────────────────┘
```

### 对话 CSS 类

| 类 | 说明 |
|---|---|
| `.ai-dialogue-overlay` | 对话 overlay 容器 |
| `.ai-dialogue-overlay.ai-immersive` | 沉浸模式（全屏） |
| `.ai-dialogue-overlay.ai-coscreen` | 同屏多角色模式 |
| `.ai-immersive-chip` | 顶部信息芯片（2026-09-06 移除时间显示） |
| `.ai-immersive-char` | 立绘区域 |
| `.ai-immersive-log` | 对话日志 |
| `.ai-immersive-bubble` | 对话气泡 |
| `.ai-immersive-form` | 输入表单 |
| `.ai-immersive-close` | 关闭按钮 |
| `.ai-immersive-discipline` | 小黑屋按钮 |

---

## 营地生活面板（campLivingPanel）

营地生活 = 角色选择 + 对话入口

```
┌────────────────────────────────────────────┐
│ [×]  营地生活                        [设置] │
├────────────────────────────────────────────┤
│  [角色1] [角色2] [角色3] ...              │ ← 角色网格
│  点击角色 → 进入对话                        │
├────────────────────────────────────────────┤
│  [全部] [一楼] [二楼] [外出]               │ ← 筛选
└────────────────────────────────────────────┘
```

### 营地生活 CSS 类

| 类 | 说明 |
|---|---|
| `.camp-living-overlay` | 营地生活 overlay |
| `.camp-living-header` | 头部（标题/关闭） |
| `.camp-living-grid` | 角色网格 |
| `.camp-living-char-card` | 角色卡片 |

---

## 立绘舞台（Portrait Stage）

| 文件 | 说明 |
|---|---|
| `hubPortraitStage.ts` | 主页立绘（展示用） |
| `dialoguePortraitStage.ts` | 对话立绘（可交互） |
| `livePortrait.ts` | 实时立绘运行时（WebM 播放） |
| `characterSkinRuntime.ts` | 皮肤切换运行时 |

### 立绘 CSS 类

| 类 | 说明 |
|---|---|
| `.hub-char-zone` | 主页角色区域 |
| `.hub-char-zone.is-swipeable` | 可滑动模式 |
| `.ai-immersive-portrait` | 对话立绘容器 |
| `.live-portrait` | 实时立绘容器 |
| `.live-portrait video` | WebM 视频 |

---

## 样式文件

| 文件 | 说明 |
|---|---|
| `aiLiving.css` | AI 生活相关样式（对话/营地/立绘/小黑屋） |
| `cc-ui.css` | 通用游戏 UI（主页/仓库/战斗 HUD/成就等） |

### aiLiving.css 关键类

| 类 | 说明 |
|---|---|
| `.hub-clock-chip` | 时钟芯片 |
| `.camp-hub .hub-clock-chip` | 营地模式时钟（2026-09-06 顶部居中） |
| `.ai-immersive-chip` | 对话顶部信息芯片 |
| `.ai-immersive-bubble` | 对话气泡 |
| `.camp-hub-back` | 返回主城按钮 |
| `.camp-hub-sys-bar` | 系统按钮栏 |
| `.discipline-overlay` | 小黑屋 overlay |

---

## 登录门禁（loginGate.ts）

```
┌────────────────────────────────────────────┐
│         锈带纪元                            │
│                                            │
│  兑换码/订单号: [________________]         │
│  千问 API Key:   [________________]         │
│                                            │
│         [开始游戏]                          │
│                                            │
│  已有账号？直接输入兑换码/订单号            │
└────────────────────────────────────────────┘
```

详见 `docs/激活与账号系统.md`

---

## 响应式设计

| 断点 | 说明 |
|---|---|
| `< 360px` | 超小屏（部分折叠） |
| `360-480px` | 小屏（手机竖屏） |
| `480-768px` | 中屏（手机横屏/小平板） |
| `> 768px` | 大屏（平板/桌面） |

关键变量：
```css
--wl-top-h: clamp(92px, 14vw, 128px);     /* 顶栏高度 */
--wl-bottom-nav-h: clamp(50px, 7.8vw, 68px); /* 底栏高度 */
```

---

## 主题变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `--safe-top` | 顶部安全区 | `env(safe-area-inset-top)` |
| `--safe-bottom` | 底部安全区 | `env(safe-area-inset-bottom)` |
| `--hud-footer-h` | 底部导航高度 | `var(--wl-bottom-nav-h)` |
