---
name: remotion-film
description: |
  Remotion 代码合成视频工程指南：工程结构、timeline 构建器、TTS 时长对齐、
  7 种代码画风方法论、剪辑手法强化指南（反 AI 味纪律）。
  触发词：Remotion、代码画视频、合成视频、视频工程。
---

# 阶段 4 · Remotion 合成工程

## 工程结构

```
film/
├── remotion.config.js        # 必须放 workspace 根（setChromiumOpenGlRenderer 等）
├── package.json              # remotion @remotion/cli @remotion/transitions react
├── public/
│   ├── illus/                # 豆包插画（裁完水印）
│   ├── subs/s01.json…        # 逐句字幕 [{t, text}]
│   ├── fonts/                # 从 google/fonts GitHub 下载，FontFace + delayRender 加载
│   └── data/timeline.json    # 全片时间轴（构建器产出）
├── src/
│   ├── index.js              # registerRoot + Composition 注册（Film / Cover 两个）
│   ├── kit.jsx               # 皮肤层：字体、色板、字幕条、章节进度、质感层（噪点/扫描线/暗角）
│   ├── Film.jsx              # 场景组件：读 timeline，逐段 <Sequence>
│   └── Cover.jsx             # 封面组件（remotion still 单独渲）
└── build-timeline.mjs        # 见 examples/
```

## timeline.json 构建器（核心中间层）

- 输入：`durations.json`（TTS 实测时长）+ 每段字幕 JSON
- 输出：`{ segments: [{id, from, dur, chapter}], subtitles: [{from, to, lines}], chapters, total }`
- **段落时长 = TTS 实测时长 + 固定段间呼吸（如 0.55s）**，总时长据此推算
- 中文字幕自动换行：标点优先断行、数字/小数点/省略号不拆开（完整实现见 `examples/build-timeline.mjs`）

## 渲染入口与基本参数

```bash
node node_modules/@remotion/cli/remotion-cli.js render src/index.js Film out/full.mp4 \
  --concurrency=10 --x264-preset=faster --muted
# .bin/remotion 是 sh 包装脚本，用 node 直接跑 cli 入口
# --muted 渲染无声视频，音轨由 ffmpeg 后期混入（见 05 号 skill）
```

## 剪辑手法纪律（必读）

**动手写任何场景组件前，先读 [`references/editing-craft.md`](references/editing-craft.md)。**
它是「成片简陋」的对症药：节奏密度、3 层视差、摄影机感、in/out+stagger 纪律、
禁 linear、转场轮换、逐字文字动效、声画同步、噪点暗角质感层、渲染前自检清单。
每条都对应 Remotion 具体 API（spring / interpolate / Sequence / TransitionSeries）。

## 风格选择

**用户已在 Step 0 用样板页选定风格**（`assets/style-samples.html`，12 种风格可视样张：
①–⑦ 基础风格 + ⑧–⑫ 开源项目衍生风格，工程约定里有「风格编号 + 主题适配说明」，照此执行，不要再让用户重选）。
基础 7 风格的方法论见 [`references/style-7-methods.md`](references/style-7-methods.md)
（像素风 / 老电视 / 手绘绘本 / 3D / 产品宣传片 / 知识科普 / 自由发挥）；
开源衍生 5 风格的落地手册见 [`references/style-open-source.md`](references/style-open-source.md)
（⑧ Neo-Brutalism ← neobrutalism.dev / ⑨ Geist 暗色极简 ← vercel/geist /
⑩ Aceternity 发光渐变 ← Aceternity UI / ⑪ Rough.js 草图黑板 ← roughjs /
⑫ 数据大屏 ← ECharts 生态，含 Remotion 动效落地要点与混搭规则）。
风格要点：

- **一种风格贯彻全片**，配色 ≤ 4 主色 + 1 强调色，字体 1 标题 + 1 正文
- **质感用叠加层**：画完内容层，上面套扫描线/纸纹/暗角层，两层解耦
- **手机优先**：主体大、字大、元素少，所有自检包含"缩到手机大小还认得出吗"
- 配乐/动效同源：动效切点落在 BPM 网格上

## 外部字体加载（日文/中文字体）

从 google/fonts GitHub 下载 ttf 到 `public/fonts/`，组件里用 `FontFace + delayRender/continueRender`
阻塞加载，**catch 分支里也必须 continueRender**（否则渲染卡死）。

## 冒烟测试

写完工程先渲 `--frames=0-90` 出完整 mp4（含封装步），浏览器预览不报错不算数。
冒烟通过才允许跑全片。渲染与失败恢复的全部硬规则见 05 号 skill。
