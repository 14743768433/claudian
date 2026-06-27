# Stage 03 Requirements: 学习域严格分层硬化

状态：implemented；manual Obsidian smoke pending

## Overview

把学习域（`src/features/learning/`）重构为**严格分层的 hexagonal 架构**（domain / application / ports / adapters / views，依赖只向内），并用 **dependency-cruiser** 把分层边界变成"越界即报错"。同时拆掉 1897 行的 `LearningController` god object、恢复"状态机是唯一 mutator"、把 Obsidian 调用收进单一适配层、把 `InputController` 的学习逻辑收成薄 hook。

**纯结构重构，零用户可见行为变化。** 这是"加新功能前先还的架构债"。

## Scope

- 学习域目录重组为：`domain/`、`application/`、`ports/`、`adapters/`、`views/`。
- 定义端口接口：`StatePort`、`VaultPort`、`LayoutPort`、`NoticePort`、`LearningTurnPort`（足够具体以承载零行为迁移：activity card / uiMessageBlocks / streaming / 当前 tab 发隐藏 turn / disposer / resolveLinkpath / boundedRead）。
- 实现适配器：`ObsidianVaultAdapter`、`ObsidianLayoutAdapter`、`ObsidianNoticeAdapter`、`ClaudianTurnAdapter`、`FileStateAdapter`；**全仓只有 `adapters/**`、`views/**`（及 composition-root `LearningController`）可 import `obsidian` / Claudian 内部。**
- 拆 `LearningController` → 薄 facade（composition root）+ 若干 L2 协调器（Navigation / TurnCoordinator / CommandCoordinator）+ 纯只读模型（`LearningReadModel`）。
- 恢复**单一 mutation 权威**（两条互补）：① 只有 `domain/LearningStateMachine` 纯函数能"产生"状态变更（`reduce(state, action) -> {nextState, effects}`，零 I/O）；② 只有 `application/StateTransitionService` 能经 `StatePort.saveCourse` "持久化"。
- **系统事件也走状态机**：补系统 action（`courseCreated`/`noteRenamed`/`noteDeleted`/`conversationReplaced`/`coveredSummaryWritten`），杜绝业务收口、系统绕路；`data.json` 索引写入收口 `IndexRepository`。
- `InputController` 的学习逻辑收成薄 hook（核心文件只留调用，不留逻辑）。
- 新增 `.dependency-cruiser.cjs` + `npm run depcruise`，接入现有验证流程/CI。

## Non-Goals

- 不加任何新功能、不改 UX、不改 provider 行为。
- 不动 Claudian runtime/权限/Plan mode/inline-edit。
- 不引入 DI 框架/装饰器/状态库（用普通构造函数注入端口即可）。
- RAG / Materials、LLM 裁判质量门、MCP 动作硬化仍后置（与 Stage 01 一致）。
- 不重写叶子模块逻辑（StateMachine/Progression/QualityGate/ContextInjector 内部算法不动，只调依赖方向）。

## User Scenarios（开发者视角，行为不变）

- 重构后，新建课程 → intake → planChapter → 写节笔记 → 继续下一节 → Start new lesson → 重启恢复，**行为与重构前完全一致**。
- 开发者在 `domain/` 或 `application/` 里写 `import { ... } from 'obsidian'` → **ESLint/depcruise 立刻报错**。
- 开发者想绕过状态机直接 `saveCourse` → depcruise 报错。
- 加新学习功能时，只新增/修改对应 L2 协调器和端口，不必碰一个 1897 行的巨型文件。

## Acceptance Criteria

1. 学习域物理目录为 `domain/ application/ ports/ adapters/ views/`，依赖只向内（L1 不依赖 L2/L4，L2 不依赖 L4，跨外部只经 ports）。
2. 全仓 `grep "from 'obsidian'"` 命中**仅出现在** `src/features/learning/adapters/**` 与 `src/features/learning/views/**`（及 Claudian 既有非学习文件）；`domain/`、`application/`、`ports/` 零 `obsidian` import。
3. 状态变更只由 `domain/LearningStateMachine` 产生；`course-state.json` 写入只发生在 `application/StateTransitionService`（经 `StatePort.saveCourse`）。`LearningController` 及其它协调器不再直接 `saveCourse`。所有系统事件（rename/delete/replace/createCourse/summary）以系统 action 经同一路径落盘。
4. `LearningController` 缩减为薄 facade（composition root），仅装配 + 转发；原方法职责落到 Navigation / TurnCoordinator / CommandCoordinator / ReadModel 等协调器。**目标以 Phase 0 基线快照为准**（基线行数由 `npm run depcruise`/`scripts/learning-baseline` 在 Phase 0 重新生成并记录到本 spec 偏差区，不写死历史数字）。
5. `InputController` 的学习相关新增收成薄 hook（调用 learning facade），不含学习编排逻辑；行数相对 Phase 0 基线显著下降。
6. 存在 `.dependency-cruiser.cjs`，定义 forbidden 规则（见 design，含 adapters-no-application / views-no-domain / application-no-chat-internals / only-transition-service-saves-state / composition-root 豁免），`npm run depcruise` **0 violation**。`obsidian` 的匹配方式在 Phase 0 实测确定。
7. domain/application 的单测可在**不 import obsidian**（用 fake port）下运行通过。
8. 现有学习域 Jest（≥59）+ 全量 `npm test` + `npm run typecheck` + `npm run build` 全部通过。
9. 行为零回归：在真实 Obsidian 手动 smoke 一次核心闭环，与重构前一致。

## References

- [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
- [Validate dependencies according to Clean Architecture](https://betterprogramming.pub/validate-dependencies-according-to-clean-architecture-743077ea084c)
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries)
- [Hexagonal Architecture (Ports & Adapters)](https://medium.com/@tejasrawat_82721/hexagonal-architecture-ports-and-adapters-explained-a-practical-guide-from-concept-to-code-7903053f38f4)
