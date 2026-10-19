---
name: remotion-render-delivery
description: Remotion 长片渲染防白跑清单、日志看门狗、渲染监控网页、ffmpeg 混音与封装坑、抽帧 QA、发布包。当需要渲染任何超过 2 分钟的 Remotion 工程，或要做 ffmpeg 混音封装、抽帧 QA、发布包时使用，必须执行本 skill。触发词：渲染、白跑、渲染监控、混音封装、抽帧 QA、发布包。
license: MIT
metadata:
  version: "2.2"
  stage: "5-render-delivery"
---

# 阶段 5 · 渲染 · QA · 交付

> 输入：Remotion 工程 + `timeline.json`（[`remotion-film`](../remotion-film/SKILL.md) 产出）+ TTS wav ｜ 产出：`成片.mp4`、`cover.png`、`发布信息包.md`、`qa/` 抽帧 ｜ 依赖：系统 ffmpeg/ffprobe、Node ≥ 18；本 skill 的 `watch-bg.mjs` 也是其他阶段后台任务的通用看护工具。

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
6. **GPU 必查（开局就要定的参数）**：渲染前现场跑 `nvidia-smi`，有卡则在 remotion.config.js 写
   `setChromiumOpenGlRenderer('angle-egl')` + `setHardwareAcceleration('if-possible')`
   （参数传字符串，4.0.x 没有那个枚举），硬编开启后禁传 `--x264-preset`。
   **这是开局定的参数，渲染中途换 config = 进度全废。**
   实测：同一工程全片渲染，无 GPU 2 小时 → 开硬件加速 15 分钟（2026-10-11，RTX 3050）。

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

## 后台任务标准流程（唯一方式，2026-10-12 修订：不依赖任何推送通知）

继续 = 前台跑一条命令阻塞到日志出现退出标记才退出——前台命令 + 退出码是所有工具
都有的能力，能否接收推送通知都能接力：

```
① 提交     run_in_background（或任何可用的后台方式）跑任务，日志重定向到唯一文件；
           任务收尾必须输出标记：成功 echo "BG_SUCCESS <任务> output=<路径>"
                               失败 echo "BG_FAIL <任务> reason=<一句话>"
② 健康门   前台跑一次 watcher 确认"正常运行"，通过才允许下一步：
           node scripts/watch-bg.mjs --log task.log --gate --check-every 5 \
             --progress "Rendered ([0-9]+)/"
           输出 BG_HEALTHY gate-passed（exit 0）→ 才进入下一步；
           BG_FAIL / BG_HANG → 立即读日志尾部定位处理，不许带病继续
③ 继续     需要结果时前台跑同一条命令（不加 --gate），阻塞到出定论：
           node scripts/watch-bg.mjs --log task.log --timeout 3600 \
             --progress "Rendered ([0-9]+)/"
           出口只有四种，永远不会"不知道"：
           BG_SUCCESS（exit 0）/ BG_FAIL（exit 1）/ BG_HANG（exit 2：日志停摆或始终未出现——
           后者多半是重定向目录不存在或任务没起来，见渲染前清单第 5 条）/
           BG_RUNNING（exit 4，到 --timeout 还在跑 → 重跑同一条命令继续等）
④ 渲染类   照旧同时开监控网页（见上节）
```

规则：

- **watcher 无状态**：每次启动从头扫一遍日志（代价可忽略），所以接力 = 重跑同一条命令。
  工具前台时限短就把 `--timeout` 调小于自己的前台时限，BG_RUNNING 后重跑即可；
  已出定论的任务重跑会立即返回（标记在日志里）。
- **所有后台任务必须带收尾标记**——没有 BG_SUCCESS/BG_FAIL 的后台任务 = 违规，不许提交。
- **全程禁止**：向对话转述过程信息、sleep 循环轮询。watcher 本身就是阻塞式单命令，不算轮询。
- watcher 检测的都是事实：日志新增行（标记/进度计数）+ 日志是否在增长。
  默认参数 `--check-every 15 --hang-seconds 90 --stall-limit 2`（渲染建议
  `--progress "Rendered ([0-9]+)/"`）；健康门建议 `--check-every 5 --timeout 300`。
- **不做 PID 检测**（Windows 下 bash/Node/PowerShell 的 PID 语义互不兼容，坑大于收益）：
  存活 = 日志仍在增长；静默死亡会判 BG_HANG，处理动作与失败相同。
- Remotion 渲染链的 `rend()` 看门狗保留（它就是前台检测日志标记的阻塞函数）；
  其余一切后台任务一律走 watch-bg.mjs。

## 失败恢复（禁止直接重渲）

- 报 `remotion-stitch-temp-dir ... No such file or directory`：帧/编码其实已完成。
  找 `<tmp>/react-motion-render*/pre-encode.mp4` 直接封装：
  `ffmpeg -i pre-encode.mp4 -i audio.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -shortest out.mp4`
- pre-encode.mp4 会随编码进度增长，存在即说明大部分工作可回收。
- 前台调用 remotion render 会被 SIGTERM 杀掉——所有 render 一律后台提交。

## 提速（先测试片验证，再全片只跑一次）

- **流程**：`--frames=0-300` 測試片逐项对比 → 保留实测有效项 → 全片只跑一次。
  **禁止中途停掉全片渲染换参数**（每次停 = 进度全废）。
- 实测有效：并发数不传走 Remotion 默认（`--concurrency=10` 实测反而更慢，
  12 更慢）、`setJpegQuality(85)`、
  `--x264-preset=faster`、TEMP→大容量盘。1080p30 约 0.08–0.11 s/帧是正常速度，不是"没走 GPU"。
- 禁止在一个循环里连续多次调用 remotion render 抽帧（连续重启 Chrome 会压死机器）；
  抽帧用系统 ffmpeg 从成片截。

## 混音与封装（ffmpeg 硬坑）

- **偏移单一来源**：多段 TTS 的定位偏移必须直接读 timeline.json 的
  `segments[].audioOffsetMs`（整数帧换算，与视频 Sequence 同源）。
  **禁止用 durations.json 重新累加**——漏片头留白 = 全片恒定偏移，
  段间呼吸取值不一致 = 逐段累计漂移。
  混音脚本用 [`scripts/build-audio-mix.mjs`](scripts/build-audio-mix.mjs)：
  自动校验偏移与帧对齐、adelay 定位、补静音到视频总长 +1s、可选 BGM 闪避、
  两遍 loudnorm，输出前自带时长校验（`SYNC_CHECK_OK` 才算过）。
- `amix` 会忽略 `-itsoffset`（所有输入被对齐到 0）——多段音频定位用
  `[i:a]adelay=毫秒:all=1[n_i]` 再 amix（`normalize=0`，各段不重叠时保原电平）。
- **音频必须补静音到比视频长**（`apad=whole_dur=总长+1s`），否则 `-shortest`
  会把视频结尾裁掉——语音结束在总长前 GAP+尾巴 秒，这是设计好的尾部留白，不能被截。
- 分段拼接：每段单独 `-ss/-t` 切割重编码 → 多输入 filter_complex concat 流式重编码。
  **concat demuxer -c copy 对 Remotion 输出时长会虚标**；单输入多 trim 分支会爆内存。
- 封装后必须 `ffprobe -show_entries format=duration` 核对总时长 == timeline.total（±0.2s）；
  偏了先查混音时长（应 == audio.padToSec）再查视频渲染帧数。
- 成片响度两遍 loudnorm（先测 input_i/tp/lra，再带 measured 参数 `linear=true`，目标 I=−16 LUFS）；
  配乐在人声段自动闪避可用 `sidechaincompress`。
- 渲染时 `--muted` 出无声视频，最后 `ffmpeg -i muted.mp4 -i mix_full.wav -map 0:v -map 1:a
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

## 本 skill 资源

| 路径 | 用途 |
|---|---|
| [`scripts/watch-bg.mjs`](scripts/watch-bg.mjs) | 后台任务看护（`BG_SUCCESS`/`BG_FAIL`/`BG_HANG`/`BG_RUNNING` + `--gate` 健康门），其他阶段的后台任务也统一用它 |
| [`scripts/finish-chain.sh`](scripts/finish-chain.sh) | 渲染链封装：`rend()` 看门狗 + 混音 + 封装，一条龙跑完 |
| [`scripts/build-audio-mix.mjs`](scripts/build-audio-mix.mjs) | 混音：偏移读 timeline.json、`adelay` 定位、补静音、两遍 loudnorm、输出前 `SYNC_CHECK` |
| [`scripts/post.sh`](scripts/post.sh) | 成片封装：`--muted` 视频 + 混音 wav → final.mp4 |
| [`render-monitor/server.mjs`](render-monitor/server.mjs) | 渲染进度监控网页（`node render-monitor/server.mjs --dir <日志目录> --port 8788`） |
