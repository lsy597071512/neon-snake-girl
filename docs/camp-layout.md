# 家园营地平面

美术源（横屏 2386×1590）：

- `tex/Indoor/shinei01_1lou.jpg` / `shinei01_2lou.jpg`（白天平面）
- `tex/Indoor/shinei01_1lou_luxian.jpg` / `shinei01_2lou_luxian.png`（白线路线）

路线提取：`npm run extract-camp-routes` → `src/data/campRouteGraph.generated.ts`。

## 结构

- **院落（一楼图）**：营地大门、警卫塔、泳池、商店（含商店卧室）、武器库；白线连通沙地。
- **一楼主楼**：大厅大门 → **大厅1**（连通卧室1/2、浴室、机房、楼梯、仓库、大厅2）
- **一楼南区**：大厅2 ↔ 卧室3、机械区、仓库
- **垂直**：楼梯（一楼 ↔ 二楼楼梯口）
- **二楼环线**：厅1中庭回廊 ↔ 西大厅 / 娱乐间 / 南大厅；卧室4–7、厕所、储物间挂环线

数据：`src/data/campLayout.ts`（房间、邻接）、`src/data/campNav.ts`（锚点/门洞/墙）。

## UI

- 底栏 **营地**：全屏平面图；横屏图在竖屏中 **拖拽平移**（上滑→地图下移，左滑→地图右移）
- 点头像进入沉浸对话；楼层切换一楼/二楼

## 院落地标与户外事件

地标功能（AI 共享）：`src/data/campLandmarks.ts` → Prompt【营地院落地标·功能与硬规则】。

对话背景（`scene_cards.json`）：户外地标有昼夜两套图（傍晚/深夜切 `imageNight`）；商店/店卧/武器库为专用室内图。

| 地标 | 场景 id | 背景资源 | 要点 |
|------|---------|----------|------|
| 营地大门 | `outdoor_gate` | `shinei01_outdoor_gate_{day,night}.png` | 日常不得走出大门；可外出思考（不离营）、修门、逛耍闲聊 |
| 警卫塔 | `outdoor_tower` | `shinei01_outdoor_tower_{day,night}.png` | 安静远眺、叙情、读天气 |
| 泳池 | `outdoor_pool` | `shinei01_outdoor_pool_{day,night}.png` | 游泳/玩水/清洗；**泳池派对**可换泳装外覆 |
| 商店 | `indoor_shop` | `shinei01_shop.png` | 自助买修理道具每次 **-1 锈币**；可逛可闲聊 |
| 商店卧室 | `indoor_shop_bed` | `shinei01_shop_bed.png` | 店后休息 |
| 武器库 | `indoor_armory` | `shinei01_armory.png` | 查看武装、逛库、战争话题 |

户外事件 id（节选）：`pool_party` `pool_solo_swim` `pool_water_play` `pool_cleaning` `tower_lookout` `tower_quiet_chat` `tower_weather_watch` `shop_browse` `shop_self_repair_buy` `armory_inspect` `armory_war_talk` `gate_outing_thought` `gate_repair` `gate_hangout`。

调试强制刷：营地生活面板 / `spawnCampEventNow('pool_party')`。
