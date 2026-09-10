# 和弦指法工具（Chord Fingering）

日期：2026-09-10（随实现落地，与当前实现一致）

## 1. 目标与边界

在 pianokits 上新增「和弦指法」工具：和弦符号解析 → 音符/转位生成 → 指法推荐 →
虚拟键盘考试（后续接入 MIDI）。核心算法全部为纯 TypeScript 模块，可在无 DOM、
无 Web MIDI 环境下运行与测试；UI 只做展示与输入适配。

第一版范围（MVP）：

- 和弦质量：大三、小三、减三、增三、挂二、挂四、属七、大七、小七、半减七（m7b5）；
- 符号：`C` `Cm` `Cdim` `Caug`/`C+` `Csus2` `Csus4` `C7` `Cmaj7` `Cm7` `Cm7b5`（含升降号根音与 ♯/♭ 别名）；
- 转位：三和弦 2 个、七和弦 3 个（第三转位显式规则）；
- 指法：standard / small-hand / custom（例外覆盖）× 左右手；
- UI：搜索、根音/类型/转位选择、左右手、profile、88 键显示与高亮、指法数字、
  半音移调、虚拟键盘考试模式；
- MIDI：适配器形态接入（MidiInput → Practice Engine），UI 不直接读 Web MIDI。

不在第一版范围：六和弦、完整爵士符号解析器、实时识别模式、MIDI 考试模式（Phase 9/10）。

## 2. 模块与目录

```
src/core/chords/            和弦核心（纯函数）
  quality.ts                ChordQuality 数据表（数据驱动，禁止 UI 硬编码音程）
  parse.ts                  parseChordSymbol / noteNameToPc / ChordParseError
  notes.ts                  getChordNotes(root, quality, inversion)
src/core/fingering/         指法核心（纯函数）
  patterns.ts               三和弦 / 七和弦 × 左右手模式表（低→高手指序列）
  profile.ts                STANDARD / SMALL_HAND / createCustomProfile + 例外覆盖
  engine.ts                 getChordFingering({root, quality, inversion, hand, profile})
src/core/practice/          练习判定（纯逻辑，不依赖 MIDI）
  chord-practice.ts         ChordPracticeEngine（统一输入接口 setHeld）
src/tools/chord-fingering/  工具页（UI 适配层）
  chord-keyboard.ts         88 键封装：指法徽标层 / 考试点亮 / 虚拟键盘输入
  midi-input.ts             MIDI 适配器（Web MIDI → 按住音高集合）
  mount.ts                  页面装配：控件、浏览渲染、考试流程
```

命名注意：上游已有 `src/core/practice.ts`（MIDI 播放器练习模式）。新引擎放在
`src/core/practice/chord-practice.ts`，导入必须写完整路径——`import './practice'`
会解析到旧文件（文件优先于目录），因此不提供该目录的 `index.ts` 以免误用。

## 3. 关键设计

### 3.1 数据模型与音符生成

- `ChordQuality = { id, symbols, intervals, noteDegrees, noteCount, category, supportedInversions }`，
  全部质量集中在 `CHORD_QUALITIES` 表；新增和弦 = 加一条数据，解析/音符/指法自动支持。
- `getChordNotes`：原位根音固定落在 60–71（第 4 八度区），闭位排列；第 k 转位 =
  最低 k 个音逐个移高八度（第一转位把最低音移到顶部）。该基点保证 12 根音 ×
  全部质量 × 全部转位落在 88 键范围（21–108），测试锁定此边界。

### 3.2 符号解析

- 正则拆出「根音字母 + 变音记号 + 后缀」；后缀表由 `CHORD_QUALITIES[].symbols`
  自动展开、精确匹配（避免 `maj7`/`m` 前缀歧义）。
- 根音保留用户拼写取向（`Bb` 不折成 `A#`），仅统一大小写与 ♯/♭；解析失败抛
  `ChordParseError`（带原始输入），UI 据此显示红字反馈。

### 3.3 指法引擎 = 规则 + profile + 例外覆盖

- 规则：三和弦与七和弦分别建模式表；左右手独立（左手不镜像推导）。
  - RH 三和弦：原位 1-3-5、一转 1-3-5、二转 1-2-5；LH：5-3-1 / 5-3-1 / 5-3-1。
  - RH 七和弦（规格 §7 参考模式）：1-2-3-5 / 1-2-4-5 / 1-2-3-5 / 1-2-3-4；
    LH 独立表：5-3-2-1 / 5-3-2-1 / 5-4-2-1（二转）/ 5-4-2-1（三转，最低两音二度相邻）。
- profile：`standard`（稳定基准，永不因个人偏好修改）、`small-hand`（仅把三和弦
  模式中段的 3 指放宽为 2，即 1-3-5 → 1-2-5、5-3-1 → 5-2-1；七和弦不变）、
  `custom`（以 standard 为基底叠加例外）。
- 例外覆盖：键 `${qualityId}/${hand}/${inversion}` → 完整手指序列；profile 内置
  覆盖与调用方临时覆盖都支持，引擎按「调用方覆盖 > profile 覆盖 > 基准模式」取值，
  并校验序列形状（1–5、长度 = noteCount）。
- 不存在「每和弦一条手工数据」；不使用单一最外音距离公式。

### 3.4 练习判定（统一输入接口）

`ChordPracticeEngine` 只接受「当前按下的音高集合」（`setHeld`）：

- 目标外按键 = 按错（UI 标红）；held 与目标完全一致（不多不少）时解答成立；
- `onSolved` 严格边沿触发（未成立 → 成立一次），持续按住不重复，松开重弹可再触发；
- 虚拟键盘与 MIDI 适配器都汇入同一引擎，考试判定逻辑零改动复用。

### 3.5 UI 适配要点

- 指法徽标：`keyGeometry` 公式归一化为百分比定位（白键贴底缘、黑键在下段），
  随键盘宽度自适应，无需监听 resize；不改共享组件 `buildPiano`。
- 虚拟键盘输入：触摸/手写笔 = 按住语义（pointer capture，滑出键面也能抬起）；
  鼠标 = 点击锁定/解锁（单指针无法同时按住多键，锁定才能用鼠标叠出和弦解答题目）。
- 移调：±半音作用于展示与考试目标音高（指法不变）；考试中途移调会把当前题
  同步平移。基点 60–71 + ±11 半音始终落在 88 键内，无需夹取。
- 考试：随机 12 根音 × 全部质量 × 有效转位 × 当前手别；考试中不亮指法徽标
  （避免提示答案），解答成立闪绿并亮出指法，900ms 后自动下一题；
  「下一题」在未答完时按下会清零连对。
- 触摸适配：控件 min-height 44px、键盘容器 `touch-action: none`、横屏优先
  （控件行自动折行，键盘贴底全宽）。

## 4. 测试

Vitest 参数化（`src/**/*.test.ts`，node 环境）：

- `core/chords/quality.test.ts`：10 质量字段自洽（音程升序唯一、noteCount、
  supportedInversions = noteCount − 1 等）；
- `core/chords/parse.test.ts`：规格 §3 全部示例、升降号与 ♯/♭、别名符号、非法串；
- `core/chords/notes.test.ts`：12 根音 × 10 质量 × 全部有效转位（音符数、升序、
  音高集合 mod 12、转位音程结构、88 键边界）、原位基点、转位语义、非法输入；
- `core/fingering/engine.test.ts`：同一参数矩阵 × 左右手（指法数量、编号 1–5、
  左右手规则不镜像、规格 §7 七和弦模式逐项断言）、small-hand、custom 覆盖、
  非法输入（手别/质量/转位/覆盖形状）；
- `core/practice/chord-practice.test.ts`：判错、解答、边沿触发一次、换题重置、快照隔离。

## 5. 兼容性与后续阶段

- 上游基础设施未改动；本工具仅新增目录 + `tools.ts` 注册 + `style.css` 追加样式段。
- Phase 9（实时识别）与 Phase 10（MIDI 考试模式）可在现有适配上扩展：
  `midi-input.ts` 已把 Web MIDI 折算为按住集合，识别模式只需在引擎前加
  「按住集合 → 和弦匹配」纯函数。
