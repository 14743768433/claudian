# Stage 01 Research: Claudian 学习版整合 MVP

状态：active
日期：2026-06-27

## 目标一句话

把 Claudian（Obsidian 原生 agent runtime）fork 成一个专用「AI Tutor 学习插件」：聊天主通道复用 Claudian，外加学习域（课程 / 章节 / 笔记目录 / 推进流程）。本 Stage 只做最简核心闭环，封面/进度%/RAG/质量门/MCP 全部后置。

## 已审阅的原始源码

### Claudian（`D:\claudian`，v2.0.25，id `realclaudian`，desktop-only，Jest）

- `src/main.ts` — 插件入口：`registerView(VIEW_TYPE_CLAUDIAN)`、`activateView()`、`getLeafForPlacement(placement)`（main-tab / left-sidebar / right-sidebar）、会话管理（`createConversation` / `switchConversation` / `getConversationList` / `ConversationMeta`）、`.claudian/` 会话存储；插件级 `loadData/saveData` 可作为书架课程索引。
- `src/core/prompt/mainAgent.ts` — `buildSystemPrompt(settings, { appendices })`：**已有 appendices 注入口**；用户消息已约定 XML 上下文标签 `<current_note>` / `<editor_selection>`。
- `src/features/chat/controllers/InputController.ts` — `buildTurnSubmission()`（:704）产出 `turnRequest`：`text`（经 `transformContextMentions` 处理 @mention）、`currentNotePath`、`externalContextPaths`、`editorSelection` 等。**每轮上下文注入点。**
- `src/features/chat/ClaudianView.ts` — 单一聊天视图骨架：`header`（title + tab nav + history dropdown）+ `claudian-tab-content-container` + `claudian-input-footer`；多会话靠 `TabManager`。
- `src/features/chat/tabs/TabManager.ts` — 每 tab 一个 conversation/session（仅确认职责，未逐行读）。
- `src/core/storage/HomeFileAdapter.ts` — skills/commands 走文件存储（`CodexSkillStorage` 扫 home 级路径），未深读。

### 当前 AI Tutor（`D:\ob-ai-tutor`，Vitest，已实现 v2）

- `src/domain/course-state.ts`、`src/services/*`（CourseStateStore / ChatLogStore / ActionLogStore / ContextBuilder / RetrievalService / TutorActionExecutor / CourseStateMigration）、`src/agent/IntentRouter.ts`、`src/agent/transformations/TransformationRegistry.ts`、`skills/*/SKILL.md`。
- 关联 spec：`docs/ai-tutor-product-spec-v2.md`（领域模型 + 三模式 + RAG + 验收闭环）。

## Claudian 现有行为（与本 Stage 相关）

- 聊天视图可放 main-tab / 左栏 / 右栏；同一视图内多 tab，每 tab 一个 provider 原生会话。
- 会话列表 `getConversationList()` 返回扁平 `ConversationMeta[]`（id / providerId / title / createdAt / updatedAt / preview …），按时间排序，无"课程/章节"分组概念。
- 系统提示由 `buildSystemPrompt` 构造，支持 `appendices` 追加段，无需 fork 基础提示。
- 每轮发送的内容在 `buildTurnSubmission` 组装，可在此追加上下文或扩展 `externalContextPaths`。
- runtime / provider（Claude / Codex / OpenCode / Pi）与权限 / Plan mode 已完整，**本 Stage 不碰**。

## 与目标布局的差距（Gaps）

| 差距 | 说明 |
| --- | --- |
| 无「课程 / 章节」概念 | Claudian 只有扁平会话；需把会话按"目标→课程→章节"分组 |
| 无会话↔学习状态映射 | 需让一个 conversation 知道自己属于哪门课的第几章 |
| 无学习面板 | 需新增书架(Home)、章节列表(左 side leaf)、课程目录(右 side leaf)三个视图 |
| 无推进动作 | 需 `Start new lesson`：结束本章会话 → 新建下一章会话 → 带上一章摘要 |
| 无学习上下文注入 | 需在 `buildTurnSubmission` 后追加当前章 ContextEnvelope |
| 无学习身份 | 需在系统提示加 learning appendix |
| 测试框架不一致 | AI Tutor 是 Vitest，Claudian 是 Jest；迁移域逻辑时统一为 Jest |

## 迁移决策（Migration decisions）

1. **Fork Claudian**，不并排装两个插件（避免两套历史/状态/写权限）。
2. **4 栏布局用 Obsidian 原生分栏拼**：左栏(章节，side leaf) + 主区左(同一个 Claudian 聊天 view，进入课程时强制移动/定位) + 主区右(笔记 `.md`，原生渲染) + 右栏(课程目录，side leaf)。不自造巨型视图、不嵌入改写 Claudian 聊天组件。
3. **一章 = 一个 Claudian conversation**（UX 上是"章=会话"）；用 `LessonSession.conversationId` + conversation 学习元数据关联（实现上是解耦映射）。
4. **书架索引在插件 data.json，课程状态 JSON 是真相**：`data.json` 只存 courseId/title/rootPath/currentLessonId；完整课程状态存 `.ai-tutor/course-state.json`；Markdown 笔记是派生。
5. **章节逐节累积**（每次 Start new lesson 长一节），不预建空会话。
6. **学习规则放 provider-neutral 层**（系统提示 appendix + context injector + post-turn 校验），不写死在某个 provider。
7. **编排 ⟂ 内容两层正交分离**：编排层（状态机/推进/上下文）与内容层（写作模板/质量门）解耦，只在生成笔记时汇合。
8. **状态机是状态唯一权威**：Agent 不直接改 `course-state.json`，只能发 `ai-tutor-action` 标记提交请求，插件 `LearningStateMachine` post-turn 校验+应用。MVP 用结构化标记通道，MCP 硬化后置。
9. **三层层级 + 两级推进**：课程→章(会话)→节(笔记)；`继续下一节` 推进节、`Start new lesson` 推进章。章的节计划由 Agent `planChapter` 提交。
10. **内容质量靠插件硬门，不靠 Agent 自律**：① 生成时由编排层注入 lesson-page 模板；② 写出后 `ContentQualityGate` 跑确定性检查 + 自动返修。`verify-content.mjs` 的确定性检查升级为运行时门；LLM 深度裁判后置。
11. **后置**：封面、进度%、RAG/Materials、LLM 裁判质量门、MCP 动作层、多 provider 调优。

## 风险（Risks）

| 风险 | 缓解 |
| --- | --- |
| Agent 直接写 vault 导致学习状态漂移 | 本 Stage 先 post-turn 轻校验（JSON schema），高风险动作 MCP 化留到后续 Stage |
| Claudian 升级与 fork 分叉 | 学习改动尽量集中在新增文件 + 少数注入点，减少与上游冲突面 |
| conversation 元数据扩展被 Claudian 覆盖 | 学习映射以 `.ai-tutor/course-state.json` 为真相，conversation 上只放冗余索引 |
| 用户 rename/delete 笔记 | rename 时监听 vault 事件更新 ArtifactRef；delete 时保留缺失链接，不自动恢复 |
| desktop-only | 明确非目标：不支持移动端 |

## 测试想法（Test ideas）

- `LearningStateService` roundtrip：写课程 → 重启 → 恢复课程/章节/当前章。
- `LearningPluginIndex` roundtrip：新建课程 → 写插件 data.json → Home 重新列出课程。
- 章节↔会话映射：新建章节 → 断言 `LessonSession.conversationId` 与 Claudian conversation 对应。
- `Start new lesson`：结束 N 章 → 断言新建 N+1 章会话且携带 N 章 `coveredSummary`。
- conversation 丢失恢复：删除/缺失 conversation → 进入章节时创建 replacement conversation 并更新 mapping。
- 左栏分组：给定 3 门课各若干章 → 断言按"目标→课程→章节"正确分组排序。
- 系统提示 appendix：断言 learning appendix 出现在 `buildSystemPrompt` 输出。
- 上下文注入：断言 `buildTurnSubmission` 输出 text 含当前章 `<course_context>` 块。
