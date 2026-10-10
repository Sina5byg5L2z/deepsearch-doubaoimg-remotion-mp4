---
name: doubao-images
description: |
  用豆包（doubao.com）批量生成插画的全自动方案：常驻 Chrome CDP + playwright-core，
  登录一次后零人工批量生成、轮询、下载。免费，不消耗任何生图 API 额度。
  触发词：生成插画、批量生图、豆包画图。
---

# 阶段 3 · 豆包批量插画（CDP 自动化）

豆包网页版生图免费且质量足够；通过 Chrome DevTools Protocol 全自动化后可无人值守批量出图。

## 一次性准备

1. `npm i playwright-core`（本机已装 Chrome 即可，无需下载浏览器内核）
2. 用持久 profile 启动 Chrome 并登录豆包（登录态会永久保存在 profile 里）：

```bash
chrome.exe --remote-debugging-port=9222 --user-data-dir=./.chrome-doubao \
  --no-first-run --no-default-browser-check https://www.doubao.com/chat/
# 首次手动扫码登录一次，之后不再需要
```

## 批量流程（见 scripts/）

1. **launch-doubao.mjs**：拉起/连接 Chrome（detached 拉起保证父进程退出后 Chrome 存活），
   等 CDP 就绪，输出 `CDP_READY`。
2. **run-illus.sh**：逐行读 `prompts.txt`（格式 `场景ID|提示词`），
   已生成的跳过（断点续跑），失败自动重试一次；**结尾按硬规则输出独特标记**：
   全部成功 `BG_SUCCESS doubao-illus`，有失败 `BG_FAIL doubao-illus failed=<场景ID列表>`。
3. **doubao-one.mjs**：单条全流程——发送提示词 → 每 5s 轮询「停止生成」字样消失
   → 确认有新图出现 → 用 playwright 的 `ctx.request.get()`（共享 cookie）下载原图 → 退出。
4. **看护（用户硬规则 2026-10-10）**：整批任务日志必须以 BG_SUCCESS/BG_FAIL 收尾，
   用 `../05-render-delivery/scripts/watch-bg.mjs` 做前台/后台看护（标记定论 + 卡死检测），
   禁止向对话输出过程信息、禁止 sleep 或手动轮询。

```bash
# 整批无人值守（后台跑）
node launch-doubao.mjs && bash run-illus.sh > gen.log 2>&1 &
```

## 关键坑（实测）

- **常驻进程必须活过工具调用**：脚本框架里 spawn 的 Chrome 会随调用结束被清理。
  把「detached 拉起 Chrome + 批量使用」放进**同一个**后台任务里串行执行。
- **下载必须用 `ctx.request.get()`** 共享浏览器 cookie，直接 `<img>.src` 拿到的可能是缩略图。
- 轮询判据用**页面文字「停止生成」消失 + 新图 URL 出现**双条件，单条件会误判。
- 每条提示词生成的是 8 宫格大图，**底部有豆包水印**：用 ffmpeg 裁掉
  （1536×1024 → `crop=1536:944:0:0`），裁完再进合成。
- 提示词纪律见 02 号 skill：**画面中绝不出现文字**（AI 生图文字必乱码）。
- 首图出来后人工目检一次风格是否统一，不统一先调固定前缀再跑全量。

## 产出

`illus/<场景ID>_<n>.jpg`——直接被 04 号 skill 的 Remotion 工程引用（放 `public/illus/`）。
