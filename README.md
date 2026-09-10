# PianoKits

> **🏗️ 该项目还处于较早期阶段。随时可能发生破坏性变更。**

## Fork 说明（和弦指法工具）

本仓库为 [`yhlooo/pianokits`](https://github.com/yhlooo/pianokits) 的开发副本，在其基础上新增「和弦指法」工具（和弦解析、指法推荐、虚拟键盘考试）。

- **Fork 时间**：2026-09-10
- **固定 upstream commit**：`2ce1547722c6be9e5e033196fba50cb41080ed1e`（2026-09-07，`feat: 修复进度条拖动和瀑布流不同步的问题`）
- **新增代码位置**：`src/core/chords/`、`src/core/fingering/`、`src/core/practice/chord-practice.ts`、`src/tools/chord-fingering/`；原有基础设施尽量未改动（仅 `src/tools.ts` 注册新工具、`src/style.css` 追加样式）。
- 设计文档见 `docs/development/design/20260910-chord-fingering.md`。

MIDI 钢琴工具箱，在线体验： [https://yhlooo.github.io/pianokits](https://yhlooo.github.io/pianokits)

**已实现工具：**

- MIDI 播放器：播放 MIDI 文件（ .mid ）
  - 瀑布流展示音符
  - MIDI 转五线谱 (beta)
  - 连接 MIDI 键盘播放
  - 连接 MIDI 键盘进行按键练习，支持分轨练习

## 连接 MIDI 键盘

该应用可通过 USB 等方式连接 MIDI 键盘，插入 MIDI 转 USB 线，在页面上点击“连接 MIDI 键盘”即可。连接过程可能会弹窗请求授权。

连接 MIDI 键盘后可使用通过 MIDI 键盘播放、按键练习等功能。

**浏览器兼容性：**

- Mac / Windows 端需使用 Chrome 或 Chromium 内核（ Edge 等）浏览器打开，不支持 Safari 。
- iPad / iPhone 由于主流浏览器受苹果限制必须使用 Webkit 内核，该内核不支持 Web MIDI 协议。可以使用 [Web MIDI Browser](https://apps.apple.com/cn/app/web-midi-browser/id953846217) 应用打开。
