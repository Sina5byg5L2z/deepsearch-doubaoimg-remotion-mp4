---
name: research-to-video
description: 全自动视频流水线总入口：深度调研 → 文案分镜 → 豆包插画 → Remotion 合成 → 渲染 QA 发布。当用户给出一个选题要做视频（B站/科普/专题）时使用，按阶段编排 video-research、video-script、doubao-images、remotion-film、remotion-render-delivery 五个子 skill。触发词：做视频、选题成片、全自动视频流水线。
license: MIT
metadata:
  version: "2.1"
  stage: orchestrator
---

# 调研到成片 · 全流程编排

给一个选题，产出一条有事实依据、有插画、有旁白字幕、可直接发布的 MP4 成片。

本 skill 是编排层，只做阶段调度与验收；具体执行规则在各子 skill 里：

| 阶段 | Skill | 交付物 | 通过标准 |
|---|---|---|---|
| 1. 调研 | [`video-research`](../video-research/SKILL.md) | FINAL_调研报告.md + 事实卡片 | **初次交付即满维度（十维度清单自查通过）**；独立 Agent 校验通过且校验员指出的遗漏已当场闭合；专名全部逐字核实 |
| 2. 文案 | [`video-script`](../video-script/SKILL.md) | 视频文案.md + 分镜表 + 字幕稿 + prompts.txt | 钩子选型完成；六项自检全过；字幕逐句编号 |
| 3. 插画 | [`doubao-images`](../doubao-images/SKILL.md) | illus/*.jpg（每场景 1-2 张） | 全部生成成功；无文字水印；裁掉水印区 |
| 4. 合成 | [`remotion-film`](../remotion-film/SKILL.md) | Remotion 工程 + timeline.json | 冒烟渲染（0-90 帧）通过 |
| 5. 渲染 | [`remotion-render-delivery`](../remotion-render-delivery/SKILL.md) | 成片.mp4 + cover.png + 发布包 | 抽帧 QA 通过；ffprobe 时长核对 |

## Step 0 · 风格确认（BLOCKING，最先执行）

**开工前把 [`remotion-film/assets/style-samples.html`](../remotion-film/assets/style-samples.html)
（样板选择页）present 给用户，让用户在两种模式里二选一**：

- **手动指定**：用户点选 12 种风格卡之一 → 立即定稿，写进工程约定再动工。
- **AI 自动匹配（默认推荐）**：用户点首屏深色卡（或说「自动」）→ 在**阶段 1 调研结束时**
  按样板页里的匹配矩阵选定风格 + 一句话理由（题材年代感/数据密度/情感温度/节奏），
  直接进入阶段 2；用户可否决一次（说「换一个」则取矩阵第二候选）。
  混合题材允许主风格 + 副风格点缀（如主叙事复古电视 + 数据幕印刷排版）。

- **禁止先开工、中途再问风格**——风格返工 = 全片重渲（实测教训）。
- 两种模式都允许样板页之外的自定义风格（如「水墨风」），按 remotion-film 的风格方法论落地。
- 用户中途离开也没关系：样板页在手，下一轮回来直接指编号或说「自动」即可。

## 规则分级约定（全套 skill 统一）

- **[必须]**：硬门槛，跳过即报废/白跑/事实事故。只保留三类——防返工、防白跑、防事实事故。
- **[建议]**：技艺类增强，违反只是质量下降，按题材裁剪。
- **流程裁剪**：整条流水线可按规模裁剪——单事实快查类任务可合并阶段 1+2、跳过 Issue Tree
  与成稿技艺；完整专题（5 分钟以上成片）走全流程，[必须] 项不可裁。

## 编排纪律

1. **[必须] 不许跳阶段**：Step 0 风格没确认就不调研产出文案；调研没过校验就不写文案；插画没齐就不启动合成。
2. **[必须] 每阶段结束向用户展示中间产物**（风格样板确认、调研结论、文案、插画九宫格、冒烟渲染片），确认后进入下一阶段。
3. **[必须] 上下文纪律——重活全部下沉子 Agent**：主线程只做决策与验收，批量搜索、专名回查、社区挖掘、
   批量生图、长渲染一律派子 Agent 或后台任务承接。子 Agent 提示词必须**自包含**
   （目标/边界/输出格式/读写文件路径），产物经工作区文件传递，只返回「≤200 字摘要 + 产出文件路径」。
4. **[必须] 后台任务标准流程**：一切后台任务（生图/TTS/渲染）按 remotion-render-delivery 的四步 SOP 走
   （提交带收尾标记 → 健康门 → 阻塞等待定论 → 渲染类同时开监控网页），不依赖推送通知，严禁 sleep 轮询。
5. **[必须] 文案工艺门槛**：阶段 2 写文案前完成钩子选型（环境装有 `short-video-script-cn` skill 时
   先查其爆款结构库；没有则按 video-script 的钩子类型自行选型），写完跑完六项自检并全过。
6. **[必须] 抽帧 QA**：渲完抽 5–9 帧目检，发现问题改完重渲再交付。
7. **[建议] 提速参数、风格混搭、发布时段优化**等按需取用，不作为流程门槛。

## 典型目录约定（工作区）

```
<workspace>/
├── research/          # 阶段1 中间产物
├── 文案/               # 阶段2：视频文案.md、分镜表.md、发布信息包.md
├── prompts.txt        # 场景ID|插画提示词（doubao-images 的输入）
├── illus/             # 阶段3 产出插画
├── audio/             # TTS 逐段 wav + durations.json 时长表
├── film/              # 阶段4 Remotion 工程（public/illus、public/subs、src/）
└── film/out/          # 阶段5 渲染日志、成片、封面、qa 抽帧
```
