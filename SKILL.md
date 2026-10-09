---
name: research-to-video
description: |
  全自动视频流水线总入口：深度调研 → 文案分镜 → 豆包插画 → Remotion 合成 → 渲染 QA 发布。
  当用户给出一个选题要做视频（B站/科普/专题）时，按本流程编排 5 个子 skill。
---

# 调研到成片 · 全流程编排

给一个选题，产出一条有事实依据、有插画、有旁白字幕、可直接发布的 MP4 成片。

## 阶段编排（顺序执行，每阶段有硬性交付物）

| 阶段 | Skill | 交付物 | 通过标准 |
|---|---|---|---|
| 1. 调研 | `skills/01-research` | FINAL_调研报告.md + 事实卡片 | 独立 Agent 校验通过；专名全部逐字核实 |
| 2. 文案 | `skills/02-script` | 视频文案.md + 分镜表 + 字幕稿 + 提示词清单 | 每个场景有插画提示词；字幕逐句编号 |
| 3. 插画 | `skills/03-doubao-images` | illus/*.jpg（每场景 1-2 张） | 全部生成成功；无文字水印；裁掉水印区 |
| 4. 合成 | `skills/04-remotion-film` | Remotion 工程 + timeline.json | 冒烟渲染（0-90帧）通过 |
| 5. 渲染 | `skills/05-render-delivery` | 成片.mp4 + cover.png + 发布包 | 抽帧 QA 通过；ffprobe 时长核对 |

## 编排纪律

1. **不许跳阶段**：调研没过校验就不写文案；插画没齐就不启动合成。
2. **每阶段结束向用户展示中间产物**（调研结论、文案、插画九宫格、冒烟渲染片），确认后进入下一阶段。
3. **长任务一律后台 + 自动通知**：豆包批量、TTS 批量、长渲染都是 run_in_background，
   严禁手动轮询（轮询烧用户额度）。
4. **渲染必须带看门狗 + 监控网页**（05 号 skill），渲染前先加载渲染前检查清单。
5. **抽帧 QA 是硬环节**：渲完抽 5–9 帧目检，发现问题改完重渲再交付，不允许"先交了再说"。

## 典型目录约定（工作区）

```
<workspace>/
├── research/          # 阶段1 中间产物
├── 文案/               # 阶段2：视频文案.md、分镜表.md、发布信息包.md
├── prompts.txt        # 场景ID|插画提示词（03 号 skill 的输入）
├── illus/             # 阶段3 产出插画
├── audio/             # TTS 逐段 wav + durations.json 时长表
├── film/              # 阶段4 Remotion 工程（public/illus、public/subs、src/）
└── film/out/          # 阶段5 渲染日志、成片、封面、qa 抽帧
```
