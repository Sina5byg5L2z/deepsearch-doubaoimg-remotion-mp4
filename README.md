# deepsearch-doubaoimg-remotion-mp4

**一条从「深度调研」到「B 站成片」的全自动流水线**：AI Agent 深度调研 → 撰写文案与分镜 → 豆包批量生成插画 → Remotion 代码合成视频 → 看门狗渲染 + 抽帧 QA → 发布包交付。

> 整套流程已在真实项目（RADWIMPS 乐队专题视频，31 个场景、31000+ 帧、5.5 分钟成片）中完整跑通并多次迭代，每个环节的规则都来自实战踩坑后的复盘，不是理论方法论。
>
> 当前版本 **v2.2**，含 6 个 skill（1 个编排层 + 5 个阶段 skill）。

## 流水线总览

```
┌─────────┐   ┌─────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────────────┐
│ 01 调研  │ → │ 02 文案  │ → │ 03 豆包插画    │ → │ 04 Remotion    │ → │ 05 渲染·QA·发布   │
│ 8步法    │   │ 分镜+字幕 │   │ CDP 自动化     │   │ 代码合成        │   │ 看门狗+监控+发布包 │
│ 事实纪律  │   │ TTS 时长表│   │ 提示词模板     │   │ 剪辑手法纪律     │   │ ffmpeg 混音封装   │
└─────────┘   └─────────┘   └──────────────┘   └───────────────┘   └──────────────────┘
                    ▲ 编排层 research-to-video 负责调度、验收与 Step 0 风格确认
```

## 包含的 Skills

| 目录 | 阶段 | 核心内容 |
|---|---|---|
| [`skills/research-to-video`](skills/research-to-video/SKILL.md) | 编排层（总入口） | Step 0 风格确认（BLOCKING）、阶段调度与验收标准、上下文纪律（重活下沉子 Agent）、后台任务四步 SOP |
| [`skills/video-research`](skills/video-research/SKILL.md) | 01 深度调研 | 8 步法、事实卡片、子 Agent 并行调研（按子问题分工，主线程只收摘要）、独立 Agent 校验（每轮新增内容都校验）、专名零容忍、三层确定性标注、**初次交付即满维度（十维度清单）** |
| [`skills/video-script`](skills/video-script/SKILL.md) | 02 文案与分镜 | 视频文案结构、钩子五类选型、台词节奏硬指标（4–4.5 字/秒）、三种叙事骨架、写完六项自检、分镜表、字幕稿、TTS 时长表、字幕句级强制对齐（silencedetect 反推真实起点）、场景提示词规划 |
| [`skills/doubao-images`](skills/doubao-images/SKILL.md) | 03 插画生成 | 豆包 CDP 自动化脚本、批量重试与断点续跑、插画提示词模板、水印裁剪 |
| [`skills/remotion-film`](skills/remotion-film/SKILL.md) | 04 视频合成 | 工程结构、timeline 构建器、声画同步硬规则、**12 种风格样板**（7 基础 + 5 个开源项目衍生：Geist/Neo-Brutalism/Aceternity/roughjs/ECharts）、剪辑手法强化指南 |
| [`skills/remotion-render-delivery`](skills/remotion-render-delivery/SKILL.md) | 05 渲染交付 | 渲染前检查清单、日志看门狗、渲染监控网页、ffmpeg 混音封装坑、抽帧 QA、发布包 |

每个 skill 目录里的 `SKILL.md` 都是独立可用的 Agent skill（含 `name` / `description` / `license` frontmatter），既可以在一个 Agent 会话里按 调研→文案→插画→合成→渲染 串成完整流水线，也可以单独取用某一环。

## 目录结构

```
deepsearch-doubaoimg-remotion-mp4/
├── skills/
│   ├── research-to-video/          # 编排层：SKILL.md
│   ├── video-research/             # 01：SKILL.md + references/（issue-tree、report-craft、2 份范本）
│   ├── video-script/               # 02：SKILL.md + scripts/align-subs.mjs
│   ├── doubao-images/              # 03：SKILL.md + scripts/（launch / one / run-illus / 提示词示例）
│   ├── remotion-film/              # 04：SKILL.md + scripts/build-timeline.mjs
│   │                               #     + references/（剪辑手法、7 基础风格、5 开源衍生风格）
│   │                               #     + assets/style-samples.html（12 风格样板选择页）
│   └── remotion-render-delivery/   # 05：SKILL.md + scripts/（watch-bg / finish-chain / 混音 / 封装）
│                                   #     + render-monitor/（渲染进度监控网页）
├── examples/radwimps/              # 真实案例中间产物：文案 / prompts.txt / durations.json / 发布信息包
├── .gitattributes                  # 统一 LF 换行（.sh 必须 LF，否则 Git Bash 下报 $'\r'）
├── .gitignore
├── README.md
└── LICENSE（MIT）
```

## 独立使用与跨 skill 依赖

流水线按整包设计，skill 之间有少量跨目录引用。**单独取用某一环时，请注意下表的外部依赖**：

| Skill | 用到的外部 skill 资源 | 缺失时的降级方式 |
|---|---|---|
| video-research | 无 | — |
| video-script | `remotion-film` 的 `assets/style-samples.html`（Step 0 风格样板页） | 自行确定风格并写进工程约定 |
| doubao-images | `video-script` 的提示词纪律；`remotion-render-delivery` 的 `watch-bg.mjs`（看护） | 自备后台任务看护方式 |
| remotion-film | `video-script` 的 `scripts/align-subs.mjs`（字幕句级对齐） | 用估算 t 出字幕，会有句级早出/晚出偏差 |
| remotion-render-delivery | 无强制依赖（脚本自带完整能力） | — |

## 亮点：实战沉淀的硬规则（踩坑换来的）

- **调研侧**：专名零容忍（译名必须回查原语逐字源）、「比如 X、Y」= 全集指令、下否定结论前必须验证假设的时间/范围限定词、**初次交付即满维度**（十维度清单自查，禁止等用户点名再补）、AI 伪 wiki 源甄别、修正轨迹只进审计档案正文保持干净
- **文案侧**：钩子五类选型 + 台词节奏 4–4.5 字/秒硬指标 + 六项自检 + 反 AI 味清单（禁列表腔/空洞排比）
- **插画侧**：豆包免费生图 + 常驻 Chrome CDP 全自动（登录一次、后续零人工）、提示词强制「画面无文字」、ffmpeg 裁水印
- **合成侧**：反 AI 味剪辑纪律（每 1.5–3s 一个视觉事件、3 层视差、禁 linear、stagger 进场、声画同步）
- **渲染侧**：TEMP 指持久目录防白跑、日志看门狗自动 kill 挂起的 node（Windows 下 Remotion 渲完不退出）、pre-encode.mp4 失败回收、渲染监控网页、抽帧 QA 硬环节
- **音频侧**：帧量化 timeline（视频/音频同一组整数帧，机制上排除漂移）、混音偏移单一来源（直接读 timeline.json，禁止重新累加）、ffmpeg `adelay` 替代 `amix` 的 itsoffset 陷阱、两遍 loudnorm、TTS 音色漂移的根治方案

## 快速开始

```bash
git clone https://github.com/Sina5byg5L2z/deepsearch-doubaoimg-remotion-mp4.git
```

1. 把 `skills/` 下的各目录接入你的 Agent 的 skills 目录（如 Claude Code 的 `~/.claude/skills/`）。
   **推荐建软链/目录联接，一份真实文件多工具共享**（Windows 下 `mklink /J` 目录联接无需管理员权限）：

   ```powershell
   New-Item -ItemType Junction -Path "$HOME\.claude\skills\video-research" `
            -Target "<repo>\skills\video-research"
   ```

   直接复制也可以，但改了主文件不会自动同步到各工具目录。
2. 按[总入口](skills/research-to-video/SKILL.md)的流程编排：给出一个选题 → **Agent 先展示 12 风格样板页，用户手动选风格或让 AI 按调研内容自动匹配（Step 0，BLOCKING）** → 再自动走完 5 个阶段 → 产出成片 + 发布包
3. 豆包插画需要一次性准备：本机 Chrome + `playwright-core`，首次扫码登录豆包后登录态存在持久 profile 里，之后全自动

## 环境依赖

| 工具 | 用途 | 备注 |
|---|---|---|
| Node.js ≥ 18 | 所有脚本 | `playwright-core` 走 npm 安装 |
| Remotion ≥ 4 | 视频合成 | `npm i @remotion/cli remotion` |
| ffmpeg / ffprobe | 混音、拼接、抽帧、封装 | 系统安装 |
| Chrome | 豆包生图自动化 | 需 `--remote-debugging-port=9222` |

## 实战案例

RADWIMPS 专题视频《不是不够红，是红错了坐标系》：

- 调研：乐史坐标、奖项、文本地位、受众闭环等 8 个维度的多源交叉验证
- 插画：30+ 张 Q 版手绘风插画由豆包批量生成、自动下载、自动裁水印
- 成片：31 场景 / 1080p30 / 5.5 分钟，含逐句字幕、章节进度条、TTS 旁白混音

分镜与文案示例见 [`examples/radwimps/`](examples/radwimps/README.md)；
调研报告范本见 [`skills/video-research/references/`](skills/video-research/references/exemplar-调研报告-radwimps.md)（同一内容只保留一份，不重复存放）。

## License

MIT
