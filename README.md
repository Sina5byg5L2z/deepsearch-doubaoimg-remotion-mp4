# deepsearch-doubaoimg-remotion-mp4

**一条从「深度调研」到「B 站成片」的全自动流水线**：AI Agent 深度调研 → 撰写文案与分镜 → 豆包批量生成插画 → Remotion 代码合成视频 → 看门狗渲染 + 抽帧 QA → 发布包交付。

> 整套流程已在真实项目（RADWIMPS 乐队专题视频，31 个场景、31000+ 帧、5.5 分钟成片）中完整跑通并多次迭代，每个环节的规则都来自实战踩坑后的复盘，不是理论方法论。

## 流水线总览

```
┌─────────┐   ┌─────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────────────┐
│ 01 调研  │ → │ 02 文案  │ → │ 03 豆包插画    │ → │ 04 Remotion    │ → │ 05 渲染·QA·发布   │
│ 8步法    │   │ 分镜+字幕 │   │ CDP 自动化     │   │ 代码合成        │   │ 看门狗+监控+发布包 │
│ 事实纪律  │   │ TTS 时长表│   │ 提示词模板     │   │ 剪辑手法纪律     │   │ ffmpeg 混音封装   │
└─────────┘   └─────────┘   └──────────────┘   └───────────────┘   └──────────────────┘
```

## 包含的 Skills

| 目录 | 阶段 | 核心内容 |
|---|---|---|
| [`skills/01-research`](skills/01-research/SKILL.md) | 深度调研 | 8 步法、事实卡片、子 Agent 并行调研（按子问题分工，主线程只收摘要）、独立 Agent 校验、专名零容忍、三层确定性标注 |
| [`skills/02-script`](skills/02-script/SKILL.md) | 文案与分镜 | 视频文案结构、分镜表、字幕稿、TTS 时长表、场景提示词规划 |
| [`skills/03-doubao-images`](skills/03-doubao-images/SKILL.md) | 插画生成 | 豆包 CDP 自动化脚本、批量重试、插画提示词模板、水印裁剪 |
| [`skills/04-remotion-film`](skills/04-remotion-film/SKILL.md) | 视频合成 | 工程结构、timeline 构建器、12 种风格样板（7 基础 + 5 个开源项目衍生：Geist/Neo-Brutalism/Aceternity/roughjs/ECharts）、剪辑手法强化指南 |
| [`skills/05-render-delivery`](skills/05-render-delivery/SKILL.md) | 渲染交付 | 渲染前检查清单、日志看门狗、监控网页、ffmpeg 混音封装坑、抽帧 QA、发布包 |

每个 skill 目录里的 `SKILL.md` 都是独立可用的 Agent skill（含 frontmatter），既可以在一个 Agent 会话里按 01→05 串成完整流水线，也可以单独取用某一环。

## 亮点：实战沉淀的硬规则（踩坑换来的）

- **调研侧**：专名零容忍（译名必须回查原语逐字源）、「比如 X、Y」= 全集指令、下否定结论前必须验证假设的时间/范围限定词
- **插画侧**：豆包免费生图 + 常驻 Chrome CDP 全自动（登录一次、后续零人工）、提示词强制「画面无文字」、ffmpeg 裁水印
- **合成侧**：反 AI 味剪辑纪律（每 1.5–3s 一个视觉事件、3 层视差、禁 linear、stagger 进场、声画同步）
- **渲染侧**：TEMP 指持久目录防白跑、日志看门狗自动 kill 挂起的 node（Windows 下 Remotion 渲完不退出）、pre-encode.mp4 失败回收、渲染监控网页、抽帧 QA 硬环节
- **音频侧**：ffmpeg `adelay` 替代 `amix` 的 itsoffset 陷阱、两遍 loudnorm、TTS 音色漂移的根治方案

## 快速开始

```bash
git clone https://github.com/Sina5byg5L2z/deepsearch-doubaoimg-remotion-mp4.git
```

1. 把 `skills/` 下的各目录复制到你的 Agent 的 skills 目录（如 Claude Code 的 `~/.claude/skills/`）
2. 按 [`SKILL.md`](SKILL.md)（总入口）的流程编排：给出一个选题 → **Agent 先展示 7 风格样板页，用户手动选风格或让 AI 按调研内容自动匹配（Step 0，BLOCKING）** → 再自动走完 5 个阶段 → 产出成片 + 发布包
3. 豆包插画需要一次性准备：本机 Chrome + playwright-core，首次扫码登录豆包后登录态存在持久 profile 里，之后全自动

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
- 分镜与文案示例见 [`examples/`](examples/)

## License

MIT
