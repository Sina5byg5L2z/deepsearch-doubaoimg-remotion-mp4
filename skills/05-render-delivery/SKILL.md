---
name: remotion-render-delivery
description: |
  Remotion 长片渲染防白跑清单、日志看门狗、渲染监控网页、ffmpeg 混音封装坑、
  抽帧 QA、发布包。凡是渲染超过 2 分钟的 Remotion 工程必须执行本 skill。
  触发词：渲染、白跑、渲染监控、混音、发布。
---

# 阶段 5 · 渲染 · QA · 交付

> 本清单每一条都是实战踩坑换来的硬规则：20 分钟渲染白跑、机器死机、链条假死都发生过。

## 渲染前检查清单（缺一不可）

1. **CLI 入口**：`node node_modules/@remotion/cli/remotion-cli.js render ...`
   （`.bin/remotion` 是 sh 包装脚本，用 node 跑会报 SyntaxError；npx 会丢环境变量）。
2. **TEMP 指向持久目录 + 空间足够的盘**：
   `export TEMP="D:/remotion-tmp" TMP="D:/remotion-tmp"`，先建目录并确认盘 ≥20G
   （31k 帧 1080p jpeg 临时帧要 15G+）。系统临时目录会被清理，长渲染必炸。
3. **remotion.config.js 必须在 workspace 根**；多工程共享时渲染前核对 publicDir 没被改走
   （被改走 = 全图 404 白跑）。
4. **冒烟测试覆盖全链路**：先渲 `--frames=0-90` 出完整 mp4（含封装/faststart 步），
   只看浏览器不报错不算数。
5. **输出目录必须已存在**：`> 目录/log.txt` 重定向时目录不存在会静默失败、任务却显示完成。

## 日志看门狗（所有 remotion 调用必须带）

本机 Remotion 渲完 node 挂起不退出 → 后台任务永不结束、链条卡死。
**渲染命令一律不要裸跑**，用日志看门狗包一层（完整脚本见
[`scripts/finish-chain.sh`](scripts/finish-chain.sh)）：

```bash
rend() {  # rend TAG 完成标记正则 日志文件 命令...
  local tag="$1" marker="$2" logf="$3"; shift 3
  "$@" > "$logf" 2>&1 &
  local np=$!
  ( for i in $(seq 1 720); do grep -qE "$marker" "$logf" 2>/dev/null && break; sleep 5; done; sleep 8; kill -9 $np 2>/dev/null ) &
  local wd=$!
  wait $np
  if grep -qE "$marker" "$logf" 2>/dev/null; then echo "${tag}_EXIT=0"; else echo "${tag}_EXIT=FAIL"; fi
  kill $wd 2>/dev/null
}
```

- 完成标记 = 日志里 `○ <path> <size>` 输出行。**行首带 ANSI 颜色转义符，正则不能用 `^` 锚定**
  （否则永不匹配、看门狗空转）；横幅 `Output <path>` 行也含文件名，裸文件名当标记会
  10 秒内误杀 node 出残缺 mp4。用 `○.*<path> [0-9]` 精确匹配。
- kill 后 `wait` 返回 137 属正常；**成功以日志标记为准，不是 task-notification**。
- 渲染超时无 EXIT 行时主动查日志尾部 + 停掉僵尸任务接力，不等用户催。
- **严禁手动轮询进度**：渲染进度由监控网页实时展示，聊天里轮播进度 = 烧用户额度。

## 渲染监控网页（渲染必开）

```bash
node render-monitor/server.mjs --dir <渲染日志目录> --port 8788
# 打开 http://localhost:8788：大字百分比/进度条/速度曲线/阶段流水灯/失败横幅，1s 自动刷新
```
自动发现目录里最新 render*.log，解析 "Rendered N/M, time remaining" 与 *_EXIT 标记。

## 失败恢复（禁止直接重渲）

- 报 `remotion-stitch-temp-dir ... No such file or directory`：帧/编码其实已完成。
  找 `<tmp>/react-motion-render*/pre-encode.mp4` 直接封装：
  `ffmpeg -i pre-encode.mp4 -i audio.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -shortest out.mp4`
- pre-encode.mp4 会随编码进度增长，存在即说明大部分工作可回收。
- 前台调用 remotion render 会被 SIGTERM 杀掉——所有 render 一律后台提交。

## 提速（先测试片验证，再全片只跑一次）

- **流程**：`--frames=0-300` 測試片逐项对比 → 保留实测有效项 → 全片只跑一次。
  **禁止中途停掉全片渲染换参数**（每次停 = 进度全废）。
- 实测有效：`--concurrency=10`（12 反而更慢）、`setJpegQuality(85)`、
  `--x264-preset=faster`、TEMP→大容量盘。1080p30 约 0.08–0.11 s/帧是正常速度，不是"没走 GPU"。
- 禁止在一个循环里连续多次调用 remotion render 抽帧（连续重启 Chrome 会压死机器）；
  抽帧用系统 ffmpeg 从成片截。

## 混音与封装（ffmpeg 硬坑）

- `amix` 会忽略 `-itsoffset`（所有输入被对齐到 0）——多段音频定位用
  `[i:a]adelay=毫秒[n_i]` 再 amix。
- 分段拼接：每段单独 `-ss/-t` 切割重编码 → 多输入 filter_complex concat 流式重编码。
  **concat demuxer -c copy 对 Remotion 输出时长会虚标**；单输入多 trim 分支会爆内存。
- `-shortest` 按探测时长截断，可能悄悄切掉视频尾——封装后必须
  `ffprobe -show_entries format=duration` 核对总时长 == timeline 时长。
- 成片响度两遍 loudnorm（先测 input_i/tp/lra，再带 measured 参数 `linear=true`，目标 I=−16 LUFS）；
  配乐在人声段自动闪避可用 `sidechaincompress`。
- 渲染时 `--muted` 出无声视频，最后 `ffmpeg -i muted.mp4 -i mix.wav -map 0:v -map 1:a
  -c:v copy -c:a aac -b:a 192k -shortest final.mp4` 封装（见 `scripts/post.sh`）。

## 抽帧 QA（硬环节，改完重渲再交付）

```bash
while IFS= read -r t; do
  ffmpeg -y -ss $t -i final.mp4 -frames:v 1 -q:v 3 qa/f_$t.jpg
done < qa_times.txt   # 覆盖每个场景中段 + 字幕密集段
```

目检：文字压插画/元素重叠/错字/字幕被裁/画面空洞。发现问题 → 改 → 重渲受影响分段
（`--frames=起-止`）→ 拼接 → 再 QA。

## 发布包（随成片一起交付）

- **标题**：悬念/反直觉，禁标题党；**简介**：核心结论 + 时间轴章节；**标签**：5–10 个；
  **发布时段**：目标受众活跃时间。完整模板见 `发布信息包.md` 示例。
- 封面：`remotion still src/index.js Cover cover.png --frame=90`，单独出。
- 结尾页固定文案（如适用）：「推测性内容已在片中明确标注 · 如有错误或补充，欢迎在评论区指出」。
