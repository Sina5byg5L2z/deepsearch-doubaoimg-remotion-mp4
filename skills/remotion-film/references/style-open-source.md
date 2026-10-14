---
name: style-open-source
description: 5 个衍生自高质量开源项目的视频风格（08-12）：来源、视觉规则、Remotion 落地要点。
metadata:
  tags: style, open-source, geist, neo-brutalism, aceternity, roughjs, echarts
---

# 开源项目衍生风格（08–12）· 落地手册

> 与 style-7-methods.md 的 7 个基础风格互补。样张见
> [assets/style-samples.html](../assets/style-samples.html)。每个来源都是真实开源项目，
> 可直接读其仓库/官网提炼更多组件细节。

## 08 · Neo-Brutalism 新粗野主义

- **来源**：[neobrutalism.dev](https://www.neobrutalism.dev/)（MIT，shadcn/ui 风格化组件库）
- **视觉规则**：粗黑边框 3–4px；**硬阴影 = X/Y 偏移 + 零模糊 + 纯黑**；高饱和撞色
  （明黄/粉/绿/蓝）；**禁渐变禁圆角软化**（圆角只用于胶囊按钮）；特大号无衬线标题；
  形状像"画图软件画出来的"：方块、圆、星形、多边形全带描边。
- **Remotion 落地**：
  - 动效纪律：元素按"贴纸拍上去"的方式进场——spring 硬着陆（`{damping: 14, stiffness: 220}`）+
    2 帧过冲；位移用阶梯感或直线冲刺，禁飘。
  - 装饰带（marquee 滚动条）用 `interpolate` 匀速循环；星形/色块旋转到位后定住。
  - 提供强调动效：色块快速替换（背景色 2 帧切换）模拟"盖章"。

## 09 · Geist 暗色极简风

- **来源**：[vercel/geist](https://vercel.com/geist)（Vercel 开源设计系统）
- **视觉规则**：纯黑/近黑底；白色特大字 + 细字距；细网格线（1px，低透明度）向边缘
  mask 渐隐；单色辉光（径向渐变，克制）；导航/正文灰阶只有 3 档；一切动画快而准。
- **Remotion 落地**：
  - 网格层：CSS background-image 双 linear-gradient + `mask-image: radial-gradient(...)`
    渐隐（预渲染没问题，Remotion 走 Chrome 渲染）。
  - 文字进场：opacity 0→1 只用 6–8 帧 + 字距从 8px 收到 3px，"冷启动"感。
  - 辉光呼吸：径向渐变层 opacity ±8% 正弦波动（`Math.sin(frame/fps*2π)`）。
  - 全片色彩纪律：黑白灰 + 恰好一个品牌色（蓝/紫二选一）。

## 10 · Aceternity 发光渐变风

- **来源**：[Aceternity UI](https://ui.aceternity.com/)（shadcn 生态最热组件库，开源组件）
- **视觉规则**：深蓝黑底；**锥形聚光灯束**（conic-gradient 从顶部打下来）；渐变大字
  （background-clip: text，紫→粉→青）；玻璃拟态卡片（1px 半透明边 + 背景模糊）；
  星点微光；元素从光束里"浮现"。
- **Remotion 落地**：
  - 光束旋转：conic-gradient 角度用 interpolate 缓慢扫动，配合 mask 上下渐隐。
  - 玻璃卡片进场：y +30→0、opacity、blur 8→0 三通道同步。
  - 渐变字可以直接给 CSS（Chrome 渲染支持 background-clip），动效只动容器不動渐变。
  - 谨慎：辉光类效果多会增加渲染耗时，预览冒烟确认帧耗时无明显劣化再全片。

## 11 · Rough.js 草图黑板风

- **来源**：[roughjs](https://roughjs.com/)（MIT，20k+ stars——手绘风格图形库）
- **视觉规则**：黑板深绿/牛皮纸底；潦草双描边线条（rough 的 hachure 感）；虚线圈重点；
  粉笔色（米白/浅黄）标注 + 手写强调（"3x!"、下划波浪线）；坐标轴/图形都像手画的。
- **Remotion 落地**：
  - 最简单路径：**SVG + `roughjs` 在浏览器端生成 path**（roughjs 有浏览器 bundle，
    `RoughSVG(svg)` 生成节点后序列化复用，避免每帧重新生成导致线条抖动不一致——
    生成一次存成静态 JSX，动效只动整组 transform）。
  - "描边生长"动效：strokeDasharray = 周长，dashoffset 从周长→0（interpolate，Easing.out）。
  - 手写字进场用逐字 + 每字 ±2° 随机旋转（seed 固定）。

## 12 · 数据大屏风

- **来源**：[ECharts](https://echarts.apache.org/)（Apache-2.0）+ 国内开源数据大屏模板生态
- **视觉规则**：深蓝渐变底；青色发光折线/柱状；面板分区（半透明深蓝卡片 + 1px 蓝边 +
  发光角标）；标题居中带辉光；数字滚动 + 网格底纹。
- **Remotion 落地**：
  - 折线"生长"：polyline 按 point 数量分段显现，或用 clipPath 矩形从左到右展开。
  - 数字滚动：`Math.round(interpolate(frame, [...], [0, target]))` + Easing.out，
    单位后缀固定不动。
  - 发光统一用 `filter: drop-shadow(0 0 Npx rgba(...))`，不要 blur 大面积（渲染慢）。
  - 面板进场：四角角标先画出（8 帧），面板体淡入，最后数字滚动——层次感靠时序。

## 风格混搭允许

主风格贯彻全片 + 副风格点缀单幕是允许的（如主叙事 Geist + 数据幕切大屏风），
但**一幕内只允许一种风格**；转场用两风格共有的元素（同色系辉光/同款边框）做匹配剪辑。
