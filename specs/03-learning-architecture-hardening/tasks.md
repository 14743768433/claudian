# Stage 03 Tasks: 学习域严格分层硬化

状态：implemented；manual Obsidian smoke pending

## Implementation Result

- 自动化实施项已完成：基线/工具、端口适配器、coordinator/read-model/source-loader 拆分、状态 mutation 收口、InputController hook、depcruise error 规则、全量验证。
- 未执行的可选项：`eslint-plugin-boundaries` IDE 级补充规则。
- 未能由 Codex 独立完成的门：真实 Obsidian 手动 smoke，需要用户在 `ai-tutor-test-vault/` 中确认。

## Phase 0 — 基线与工具（先建安全网）
- [ ] **commit 拆两步、严格 scoped**（不污染基线）：
  - [ ] **commit A**：Stage 01/02 产品实现基线——仅 `src/`、`tests/`、`specs/`、`scripts/`、`skills/`、`.claude/skills/` 等应入库内容。
  - [ ] **commit B**：Stage 03 硬化 spec + tooling（`.dependency-cruiser.cjs`、package 脚本）。
  - [ ] **排除**：`ai-tutor-test-vault/`、构建产物（main.js/styles.css 若被 .gitignore 覆盖则跳过）、临时数据、测试 vault 的 `data.json`。提交前 `git status` 核对无测试 vault/临时文件混入。
- [ ] 装 `dependency-cruiser`（devDependency）；加 `npm run depcruise`。
- [ ] **实测 obsidian 匹配方式**：`depcruise --no-config src/features/learning/LearningController.ts --output-type text`，看 `from 'obsidian'` 被报成 external/couldNotResolve/具体路径，据此定 `.dependency-cruiser.cjs` 里 `obsidian` 的 `to.path` 写法。
- [ ] 加 `.dependency-cruiser.cjs`（design 草案），规则先全 `severity: 'warn'`。
- [ ] **重新生成现状基线快照**（行数 + 违规清单）：LearningController/InputController 当前行数、`saveCourse` 调用点、`from 'obsidian'` 命中文件，记录到本 spec 偏差区（替代任何写死的历史数字）。
- [ ] `npm test` / `typecheck` / `build` 绿，确认基线健康。

## Phase 1 — 端口与适配器（搬 Obsidian，不改逻辑）
- [ ] 建 `ports/`：`StatePort` `VaultPort` `LayoutPort` `NoticePort` `LearningTurnPort`（按 design 的具体签名，含 disposer/boundedRead/resolveLinkpath/uiMessageBlocks/streaming）。
- [ ] 建 `adapters/`：`ObsidianVaultAdapter` `ObsidianLayoutAdapter` `ObsidianNoticeAdapter` `ClaudianTurnAdapter` `FileStateAdapter`，把现散落 Obsidian/plugin 调用搬进来。
- [ ] `LearningController`（composition root）构造并持有适配器；其余学习模块通过端口拿能力。
- [ ] Jest：适配器薄封装行为；现有学习测试仍绿。

## Phase 2 — 拆 god controller
- [ ] 切出 `application/coordinators/NavigationCoordinator`（导航/布局/开笔记，经 Layout/Vault 端口）。
- [ ] 切出 `application/LearningReadModel`（can*/status/labels/turnMode，纯只读）。
- [ ] 切出 `application/coordinators/CommandCoordinator`（命令 + *FromConversation，调 LessonProgression）。
- [ ] 切出 `application/coordinators/TurnCoordinator`（decorateTurn/handleAssistantTurnComplete/persist*/返修编排）。
- [ ] 切出 `application/SourceLoader`（source snippets / lesson plan，经 VaultPort）。
- [ ] `LearningController` 缩成薄 facade（目标 < 300 行），公共 API 签名不变。
- [ ] Jest：协调器单测；facade 转发；现有测试仍绿。

## Phase 3 — 纯状态机 + StateTransitionService + 系统 action
- [ ] `domain/LearningStateMachine` 改为**纯函数** `reduce(state, action) -> { nextState, effects }`，零 I/O、零 ports。
- [ ] `application/StateTransitionService`：唯一持久化方——跑状态机 → `StatePort.saveCourse(nextState)` → 派发 effects。移除 Controller/协调器的直接 `saveCourse`（原基线两处）。
- [ ] 扩 `LearningAction` 加**系统 action**：`courseCreated`/`noteRenamed`/`noteDeleted`/`conversationReplaced`/`coveredSummaryWritten`；把 createCourse、vault rename/delete、conversation replacement、summary 写入全部改成发系统 action 经状态机。
- [ ] `data.json` 索引写入收口 `application/IndexRepository`（经 `StatePort.upsertIndex`），rootPath normalize 归它。
- [ ] Jest：系统/业务 action 转移正确；除 `StateTransitionService` 外无路径可达 `saveCourse`；状态机为纯函数（可无依赖单测）。

## Phase 4 — 收薄 InputController
- [ ] 学习逻辑从 `InputController` 移回 learning/；核心文件只留 ≤~20 行 hook（`learning?.decorateTurn()` / `onTurnComplete()` / `interceptCommand()`）。
- [ ] Jest：InputController 学习 hook 调用正确；聊天主流程回归绿。

## Phase 5 — 强制与收尾
- [ ] 把 `.dependency-cruiser.cjs` 规则逐条从 `warn` 升 `error`，修到 **0 violation**。
- [ ] `npm run depcruise` 接入 CI / 与 typecheck 并列。
- [ ] （可选）加 `eslint-plugin-boundaries` strict 供 IDE 即时报错。
- [ ] `grep "from 'obsidian'"` 仅命中 `adapters/**` `views/**`。
- [ ] `npm test`（全量）+ `typecheck` + `build` 全绿。
- [ ] 真实 Obsidian 手动 smoke 核心闭环，确认行为零变化。
- [ ] 重读本 spec 四文件核对偏差，更新状态。

## 验收对齐
- requirements.md 全部 Acceptance Criteria 通过。
- depcruise 0 violation 是硬门；行为零回归是底线。
