---
name: doubao-images
description: 用豆包（doubao.com）网页版批量生成插画的全自动方案：常驻 Chrome CDP + playwright-core，登录一次后零人工批量生成、轮询、下载，免费且不消耗任何生图 API 额度。当用户要按提示词清单批量出插画/配图，或需要免 API 额度的批量生图方案时使用。触发词：生成插画、批量生图、豆包画图、豆包出图。
license: MIT
metadata:
  version: "2.2"
  stage: "3-images"
---

# 阶段 3 · 豆包批量插画（CDP 自动化）

> 输入：`prompts.txt`（`场景ID|提示词`，来自 [`video-script`](../video-script/SKILL.md)）｜ 产出：`illus/<场景ID>_<n>.jpg`（已裁水印）｜ 依赖：本机 Chrome、`playwright-core`；看护用 [`remotion-render-delivery`](../remotion-render-delivery/SKILL.md) 的 `watch-bg.mjs`。

豆包网页版生图免费且质量足够；通过 Chrome DevTools Protocol 全自动化后可无人值守批量出图。

## 前置条件（BLOCKING）

- `prompts.txt` 已由阶段 2 产出，且**逐条通过"画面无文字"检查**——提示词带文字 = 整批图报废重跑。
- 一次性准备已完成（下方两节），`launch-doubao.mjs` 能输出 `CDP_READY`。
- 风格固定前缀已与 Step 0 定稿风格一致；先跑 1 条人工目检风格统一，再跑全量。

## 一次性准备

1. `npm i playwright-core`（本机已装 Chrome 即可，无需下载浏览器内核）
2. 用持久 profile 启动 Chrome 并登录豆包（登录态会永久保存在 profile 里）：

```bash
chrome.exe --remote-debugging-port=9222 --user-data-dir=./.chrome-doubao \
  --no-first-run --no-default-browser-check https://www.doubao.com/chat/
# 首次手动扫码登录一次，之后不再需要
```

## 批量流程（见 scripts/）

1. **launch-doubao.mjs**：拉起/连接 Chrome，等 CDP 就绪，输出 `CDP_READY`。
   ⚠️ 2026-10-16 实测：沙箱后台任务里 node 的 detached spawn 会 FAIL_LAUNCH、且前台任务结束时
   Chrome 被回收。可靠做法 = **Chrome 与批量脚本放进同一个后台任务**，用 bash 子壳拉起：
   `("/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222
   --user-data-dir=<profile> --no-first-run ... &)` && sleep 12 && bash run-illus.sh
2. **run-illus.sh**：逐行读 `prompts.txt`（格式 `场景ID|完整提示词`——**每行自带风格前缀与
   「无文字」后缀，脚本不再二次拼接**，2026-10-16 起修），已生成的跳过（断点续跑），
   失败或 0 下载自动重试一次，成功后自动裁底部水印；**结尾按硬规则输出独特标记**：
   全部成功 `BG_SUCCESS doubao-illus`，有失败 `BG_FAIL doubao-illus failed=<场景ID列表>`。
3. **doubao-one.mjs**：单条全流程——发送提示词 → 每 5s 轮询「停止生成」字样消失
   → 确认有新图出现 → 用 playwright 的 `ctx.request.get()`（共享 cookie）下载原图 → 退出。
4. **看护（用户硬规则 2026-10-10）**：整批任务日志必须以 BG_SUCCESS/BG_FAIL 收尾，
   用 `../remotion-render-delivery/scripts/watch-bg.mjs` 做前台/后台看护（标记定论 + 卡死检测），
   禁止向对话输出过程信息、禁止 sleep 或手动轮询。

```bash
# 整批无人值守（后台跑）
node launch-doubao.mjs && bash run-illus.sh > gen.log 2>&1 &
```

## 关键坑（实测）

- **常驻进程必须活过工具调用**：脚本框架里 spawn 的 Chrome 会随调用结束被清理。
  把「detached 拉起 Chrome + 批量使用」放进**同一个**后台任务里串行执行。
- **下载必须用 `ctx.request.get()`** 共享浏览器 cookie，直接 `<img>.src` 拿到的可能是缩略图。
- 轮询判据**三条件**：页面文字「停止生成」消失 + 有新图 URL + 新图集连续 3 轮（约 15s）无变化。
  另：发送前 `before` 快照**双拍取并集**（间隔 4s），否则上一轮晚到的图会被算进本轮（串图根因）。
  只看首图就退出，本轮 8 宫格剩余图会晚到、被下一轮误认为自己的新图。
- 每条提示词生成的是 8 宫格大图，**底部有豆包水印**：用 ffmpeg 裁掉
  （1536×1024 → `crop=1536:944:0:0`），裁完再进合成。
- 提示词纪律见 [`video-script`](../video-script/SKILL.md)：**画面中绝不出现文字**（AI 生图文字必乱码）。
- **每张生成约 60 秒**：轮询前 60s 内 `fresh=0` 是正常现象，不要提前判死（2026-10-16 误杀过一批好任务）。
- **下载 abort 必重试**：`ctx.request.get` 偶发连接中断（实测 s21 丢图）——doubao-one 已内置
  3 次重试 + `<50KB` 拒收（防缩略图）+ 0 下载 exit 3，runner 据此重试。
- **出图横竖版混排 + 高度约束**（同一 prompts 随机出 3:4 或 3:2，2026-10-16 实测）：装裱组件
  **禁止固定 width 拉伸 Img**——竖版图会按宽等比放大、下缘溢出画面裁掉图注。正确写法：
  ```jsx
  // 外层 width: 'fit-content'，Img 双向约束，w 只作 maxWidth、maxH 控制视觉高度
  <div style={{ position: 'absolute', left: x, top: y }}>
    <div style={{ width: 'fit-content', border: '2px solid #3a352b', padding: 18 }}>
      <Img src={staticFile(`img/${src}`)} style={{
        display: 'block', maxHeight: maxH,   // 场景按可用竖向空间给值（y=280 时 ~560，
        maxWidth: w, width: 'auto', height: 'auto'  //  底部小图 330），横竖版都不溢出
      }} />
    </div>
  </div>
  ```
  实测：固定 `width:'100%'` 时竖版图（1632 高）在 w=640 下渲染高 ~850px，y=280 起排直接
  越过 1080 底缘；maxH 后同场景横版 453px / 竖版 560px 都完整可见。
- 首图出来后人工目检一次风格是否统一，不统一先调固定前缀再跑全量。

## 产出

`illus/<场景ID>_<n>.jpg`——直接被 [`remotion-film`](../remotion-film/SKILL.md) 的 Remotion 工程引用（放 `public/illus/`）。

## 本 skill 资源

| 路径 | 用途 |
|---|---|
| [`scripts/launch-doubao.mjs`](scripts/launch-doubao.mjs) | 拉起/连接 Chrome CDP（detached），就绪后输出 `CDP_READY` |
| [`scripts/doubao-one.mjs`](scripts/doubao-one.mjs) | 单条提示词全流程：发送 → 轮询判据 → 下载原图 |
| [`scripts/run-illus.sh`](scripts/run-illus.sh) | 整批跑 `prompts.txt`：断点续跑 + 失败重试 + `BG_SUCCESS`/`BG_FAIL` 收尾 |
| [`scripts/prompts.example.txt`](scripts/prompts.example.txt) | `prompts.txt` 格式示例（`场景ID\|提示词`） |
