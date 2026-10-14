---
name: editing-craft
description: 剪辑手法强化指南 - 让代码画的视频摆脱"简陋感"的硬规则。每个规则都对应 Remotion 具体 API 用法。
metadata:
  tags: editing, pacing, motion-design, anti-slop, craft
---

# 剪辑手法强化指南（防"简陋感"硬规则）

> 简陋感的本质：**一个平面上只有几个元素在做 linear 运动**。
> 专业感的本质：**多层视差 + 错落节奏 + 有重量的运动曲线 + 声画同步**。
> 以下每条规则都可执行、可检查。

## 1. 节奏（Pacing）——最优先

- **每 1.5–3 秒必须发生一件"视觉事件"**：元素进场、镜头移动、转场、强调弹出。
  超过 3 秒画面静止 = 观众划走。
- **单个镜头 2–4 秒**为主，重点镜头可到 5–6 秒。全片镜头时长要有变化，
  连续等长镜头 = 机械感。
- **开场黄金 3 秒**：第一帧就要有内容在动，禁止黑场淡入开场。
  用最强钩子开场（大字弹出 / 核心画面 / 悬念元素）。
- **镜头数校验**：写 timeline 前先列分镜表（镜号/时长/画面事件/台词或字幕），
  一个 60 秒的视频 ≥ 20 个镜头事件。
- **收尾**：结尾页至少留 2.5 秒，配一个持续微动效（呼吸缩放/飘动），
  禁止完全静止的结尾帧。

## 2. 分层构图 + 视差——简陋感的最大来源是"单层平面"

- 每个场景至少 **3 层**：背景层、中景层（主体）、前景层（遮挡物/装饰/光斑）。
- **视差**：镜头移动时各层速度不同。前景移动快、背景移动慢：

  ```tsx
  // 摄影机向右平移时
  const camX = interpolate(frame, [0, 90], [0, 200], EasingOutClamp);
  <Layer style={{transform: `translateX(${-camX * 1.4}px)`}} />  // 前景
  <Layer style={{transform: `translateX(${-camX * 0.5}px)`}} />  // 中景
  <Layer style={{transform: `translateX(${-camX * 0.15}px)`}} /> // 背景
  ```

- 前景可以**超出画框**（负 margin、大比例遮挡物），制造纵深。
- 背景永远不是纯色：加渐变、噪点、缓慢飘动的粒子/云/星，哪怕很淡。

## 3. 摄影机感——让画面"有人拍"而不是"贴上去"

- **Ken Burns**：每个静态画面都加极缓慢的 zoom（每秒 1–2% scale）
  或平移，方向交替使用。
- **呼吸感**：主体元素加 `sin(frame / fps * 2π) * 0.5%` 的持续缩放，
  消灭"死图"。
- **镜头震动**：强调/撞击帧加 3–6px 的 2–3 帧抖动（用随机偏移，
  `random(\`shake-${frame}\`)` 保证确定性，否则每帧渲染不一致）。
- **推拉**：关键信息揭晓时快速 zoom-in（8–12 帧内 scale 1→1.15，
  Easing.out），比直接弹出高级。
- 常量的 random 必须带 seed：`random("x-" + i)`，不带的 random 会导致
  渲染帧与预览帧不一致。

## 4. 进出场纪律——每个元素都要有 in 和 out

- **没有元素允许凭空出现或凭空消失**。统一用 in/out spring 对：

  ```tsx
  const {fps, durationInFrames} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 200}, durationInFrames: 20});
  const exit = spring({frame, fps, config: {damping: 200}, durationInFrames: 15,
    delay: durationInFrames - 18});
  const opacity = Math.min(enter, exit);
  const translateY = interpolate(enter - exit, [0, 1], [40, 0]);
  ```

- **Stagger（错落）**：列表/多元素进场，相邻元素延迟 3–5 帧，
  禁止同时出现。`delay: i * 4`。
- **入场方向要有语义**：文字从下滑入（像字幕）、侧栏从侧边滑入、
  数字从下往上翻。全场从上往下 = 呆板。
- **Anticipation（预备动作）**：大动作前先反向移动 2–3 帧
  （弹出前先缩 0.96 再弹），迪士尼十二法则，效果显著。

## 5. 运动曲线纪律——linear 是原罪

- **全片禁止 `Easing.linear` 用于元素运动**（透明度淡入除外）。
- 默认选择：位移用 `spring({config: {damping: 200}})` 或
  `Easing.out(Easing.cubic)`；弹出用 `{damping: 12, stiffness: 180}`（微弹）；
  重物/大面板用 `{damping: 15, stiffness: 80, mass: 2}`。
- **入场快、离场更快**：exit 时长 ≈ enter 的 60–70%。
- 所有 interpolate **必须 clamp**（`extrapolateLeft/Right: 'clamp'`）。

## 6. 转场——不要每一场都用同一个

- 用 `<TransitionSeries>`（见 [transitions.md](transitions.md)），但：
  **连续两场不许用同一种转场**。fade → slide → wipe 轮换，
  且全片 fade 占比 < 1/3。
- 转场时长 10–20 帧（0.3–0.7 秒），太久拖节奏。
- **匹配剪辑**（match cut）替代转场：上一场主体位置 = 下一场主体位置，
  观感最专业，成本只是对坐标。
- 高频动作转场：快速甩镜（zoom 冲出 + 下一场冲入）配 whoosh 音效。

## 7. 文字动效——字是 B 站视频的第一主角

- **逐字/逐词进场**（见 [text-animations.md](references/assets/text-animations-typewriter.tsx)
  和 [display-captions.md](display-captions.md)），禁止整段文字一起淡入。
- **关键词高亮**：字幕中关键词变色/加粗/放大 + 微弹，
  用 `@remotion/captions` 的 word-level 时间戳做卡拉 OK 式高亮。
- **数字滚动**：数据展示用 `interpolate` + `Easing.out` 从 0 滚到目标值，
  禁止直接显示最终数字。
- 大标题进场用 **scale 1.3→1 + blur 8→0 + opacity** 三通道叠加，
  比单一 fade 厚重得多。
- 字幕要描边或底条：纯色字在插画上会看不清（白字+深色描边最稳）。

## 8. 声画同步——没有声音的动效只有一半效果

- **关键动效必须配音效**：弹出配 pop、转场配 whoosh、计数配 tick、
  揭晓配 riser。用 `<Sequence from={...}><Audio src={...} /></Sequence>` 对齐到帧。
- 音效提前 1–2 帧于视觉峰值（声音先于画面被感知）。
- **踩点**：BGM 有明显鼓点的段落，让元素进场对齐鼓点帧
  （先听音频定 beat 帧，写进常量表）。
- BGM 音量 15–25%，音效 60–80%，人声 100%。用 `volume={(f) => interpolate(f, [...])}`
  做 BGM 在人声段落自动压低（ducking）。

## 9. 质感层——消灭"PPT 感"的最后一公里

- **噪点/颗粒**：全片顶层叠 `<Noise>` 类组件（opacity 0.04–0.08，
  `random` 带帧 seed 让颗粒跳动）。
- **暗角 vignette**：径向渐变叠层，聚焦中心。
- **Letterbox 黑边**：横屏片用上下黑边（各 4–6% 高度）立刻有电影感。
- **光效**：高光扫过（线性渐变 translateX 掠过标题）、闪烁星点。
- **色板纪律**：全片 ≤ 4 个主色 + 1 个强调色，先定义常量再写组件，
  禁止随手写颜色。

## 10. 反 AI 味清单（本机用户已明确否决，出现即返工）

- ❌ 蓝紫渐变大字报配色
- ❌ 「第一/第二/第三」AI 列表腔文案
- ❌ 元素全部同时淡入、全部 linear 匀速运动
- ❌ 每场转场都是同一个 fade
- ❌ 纯色背景 + 居中单元素、无任何纹理层
- ❌ 结尾静止帧 / "谢谢观看"白屏
- ✅ 风格基调以「style-7-methods.md（7 种代码画风方法论）」为准，
  做视频前先读同目录的 [style-7-methods.md](style-7-methods.md)

## 11. 标准镜头模板（可直接抄的组合拳）

一个"及格线以上"的镜头 = 缓慢镜头移动 + 分层 + stagger 进场 + 出场 + 音效：

```tsx
const Scene = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  // 镜头：全片缓慢推近
  const camScale = interpolate(frame, [0, durationInFrames], [1, 1.06]);
  return (
    <AbsoluteFill style={{backgroundColor: '#1a1625', overflow: 'hidden'}}>
      {/* 背景层：慢速漂移 */}
      <AbsoluteFill style={{transform: `scale(${camScale}) translateX(${-frame * 0.2}px)`}}>
        {/* 渐变 + 粒子... */}
      </AbsoluteFill>
      {/* 中景：主体 stagger 进场 */}
      {items.map((it, i) => {
        const s = spring({frame, fps, delay: 8 + i * 4, config: {damping: 200}, durationInFrames: 20});
        return <Item key={i} style={{
          opacity: s,
          transform: `translateY(${interpolate(s, [0, 1], [36, 0])}px)`,
        }} />;
      })}
      {/* 前景光斑：视差最快层 */}
      {/* 顶层：噪点 + 暗角 + letterbox */}
    </AbsoluteFill>
  );
};
```

## 12. 自检清单（渲染前过一遍，缺一项就补）

- [ ] 分镜表列了？每 1.5–3 秒有视觉事件？
- [ ] 每个场景 ≥ 3 层 + 层间速度不同？
- [ ] 所有运动非 linear？所有 interpolate clamp？
- [ ] 每个元素有 in/out？多元素 stagger 了？
- [ ] 转场不重复？开场 3 秒有动作？
- [ ] 关键动效配了音效？人声/BGM/音效音量分层了？
- [ ] 噪点 + 暗角（+ 视风格加 letterbox）质感层加了？
- [ ] 冒烟渲染后抽帧目检：文字压没压插画、层级对不对、字幕读得清吗？
