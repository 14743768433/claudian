# Stage 03 Research: 学习域严格分层硬化

状态：active
日期：2026-06-27
实现仓：`D:\claudian`（fork 分支 `codex/learning-tutor-fork`）

## 目标一句话

把 Stage 01/02 已实现、但分层被破坏的学习域，重构成**严格分层的 hexagonal（Ports & Adapters）架构**，并加**自动化越界报错**（dependency-cruiser），在加更多功能前先还掉架构债。**不改任何用户可见行为。**

## 已审阅的本仓源码（带证据）

| 文件 | 行数 | 观察 |
| --- | --- | --- |
| `src/features/learning/LearningController.ts` | **1897 / 89 方法** | god object：import 了 `obsidian`(Notice/TFile/WorkspaceLeaf) + `../../main` + 所有学习层；吞了导航/能力/命令/turn 协调/持久化/质量/事件 |
| `src/features/chat/controllers/InputController.ts` | 1845（+138 vs 上游 1707） | 学习编排逻辑渗进 Claudian 核心文件（25 处 learning 引用） |
| `src/features/learning/flow/LearningStateMachine.ts` | 257 | `saveCourse` 调用点之一（合法权威） |
| `src/features/learning/state/LearningStateService.ts` | 307 | 暴露 `saveCourse`，内部多处自写 |
| `flow/LessonProgression.ts` `content/ContentQualityGate.ts` `context/LearningContextInjector.ts` `views/*` | 73 / 77 / 116 / 93-252 | 叶子模块小而单一（健康） |

### 核心问题 1：mutation 权威被稀释

`stateService.saveCourse(...)` 的调用者有三处：
- `flow/LearningStateMachine.ts:49` ✅ 设计中唯一权威
- `LearningController.ts:784` / `LearningController.ts:1541` ❌ god controller 直接写 state，绕过状态机
- `state/LearningStateService.ts` 内部（createCourse / rename / delete）

→ 当初为防漂移定的"只有状态机能改 state"被破坏。

### 核心问题 2：Obsidian 耦合散落

`obsidian` 的 import（`Notice` / `TFile` / `WorkspaceLeaf` / `App` / `plugin`）散布在 `LearningController` 和三个 `views/*`，没有单一适配边界。学习领域逻辑无法脱离 Obsidian 单测（现在能单测只因部分模块碰巧没碰 Obsidian）。

### 核心问题 3：god controller

1897 行集中了六类职责（导航、能力只读、命令、turn 协调、持久化+质量、vault 事件）。**叶子模块薄是因为编排胶水全堆进了它。** 未来每个功能都要动它 → 碰撞点。

## 参考做法（调研）

- **Hexagonal / Ports & Adapters（Cockburn）+ Clean Architecture Dependency Rule**：依赖只向内；领域核心 framework-neutral；外部系统（Obsidian、provider）是端口背后的适配器。
- **本仓 Claudian 自身就是范例**：`core/`(runtime/prompt/tools=领域+端口) ← `providers/{claude,codex,opencode,pi}`(适配器) ← `features/`(应用)。`ChatRuntime` 是端口，`pi` 是适配器。**学习域应照搬，把 Obsidian 也当被适配的外部系统。**
- **`D:\project-graph-obsidian` 已用此模式**：`editor/`(model/services/**ports**) framework-neutral 核心 + `view`/`integration`/`pg-access` Obsidian 适配层 + `@service`/DI + `ObsidianIntegrationManager`（返回布尔、不直接调 Obsidian，注入 adapter）。**但它没有自动强制（仅约定）——本 Stage 要补上。**
- **越界报错工具**：
  - `dependency-cruiser`：`forbidden` 规则，`npx depcruise src --validate`，CI 越界即 fail。
  - `eslint-plugin-boundaries`：`strict` 模式 + element types，IDE/lint 即时报错。

参考链接见 `requirements.md` 末尾 References。

## 迁移决策

1. 学习域重组为 4 层：`domain / application / ports / adapters / views`，依赖只向内。
2. **所有 `obsidian` 调用收进 `adapters/`**，全仓只有 adapters 与 `views` 能 import `obsidian`；领域/应用层零 Obsidian。
3. **状态变更与持久化分离**（采纳评审意见，避免 domain 依赖 ports 的矛盾）：`domain/LearningStateMachine` 纯函数产生 `{nextState, effects}`、零 I/O；`application/StateTransitionService` 是唯一持久化方（经 `StatePort.saveCourse`）。系统事件（createCourse/rename/delete/replace/summary）以**系统 action** 经同一路径，杜绝绕路。
4. **拆 god controller**：89 方法分到若干 L2 协调器 + 纯只读模型；`LearningController` 退化成薄 facade（保持对 `main.ts`/`InputController` 的现有公共 API 不变，减少 blast radius）。
5. **InputController 收成薄 hook**：核心文件只留一两行 `learning?.decorateTurn()` / `onTurnComplete()`，逻辑回 learning/。
6. **加 dependency-cruiser 配置 + CI**：把 1–5 的边界变成"越界即报错"。
7. 行为零变化：纯结构重构，所有现有 Jest/build 必须仍绿。

## 风险

| 风险 | 缓解 |
| --- | --- |
| 大重构在**未提交**代码上做 | **先 commit 现状**（前置任务），再分步重构，每步跑测试 |
| 重构引入行为回归 | 不动逻辑、只搬位置+换依赖方向；每步 `npm test` + 关键路径手验 |
| 测试随目录移动大面积红 | 分步移动，先建端口/适配器、再迁调用、最后删旧路径 |
| depcruise 规则误伤合法依赖 | 规则先 `warn` 跑一轮看清现状，再逐条升 `error` |

## 测试想法

- `npx depcruise src --validate` 0 violation（核心验收）。
- 现有学习域 Jest（59）+ 全量 + build 仍绿。
- domain/application 单测在**不 import obsidian** 的前提下可跑（用 fake port）。
- 断言全仓只有 `adapters/**` 与 `views/**` 出现 `from 'obsidian'`。
- 断言 `saveCourse`/写 state 只被状态机模块可达。
