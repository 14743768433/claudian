# Stage 01 Tasks: Claudian 学习版整合 MVP

状态：active

## Phase 0 — Fork 与品牌化
- [ ] 在 `D:\claudian` 开分支：`git switch -c codex/learning-tutor-fork`。
- [ ] 改 `manifest.json`（id / name → AI Tutor）、`package.json`、视图标题、ribbon、`addCommand` 文案。
- [ ] 保持 desktop-only；默认 provider 文案从 coding 改为 learning。
- [ ] `npm run build` 通过；Obsidian 能打开 AI Tutor 侧栏。
- [ ] 把本 spec 目录复制到 `D:\claudian\specs\01-claudian-learning-mvp\`。

## Phase 1 — 状态层（持久化）
- [ ] `src/features/learning/state/types.ts`（CourseState / CourseMachineState / LessonSession / Section / SyllabusTopic / 插件 data 索引类型）。
- [ ] `LearningPluginIndex`：`plugin.loadData/saveData` 维护书架课程索引。
- [ ] `LearningStateService`：load/save `course-state.json`、listCourses、currentLesson、章节↔会话映射，经 vault adapter。
- [ ] Jest：plugin data index roundtrip + state roundtrip + 重启恢复。

## Phase 2 — 状态机 + action 请求通道（编排层核心）
- [ ] `LearningStateMachine`：唯一改 course-state.json；实现转移表（generateSyllabus / planChapter / sectionNoteWritten / advanceSection / startNewLesson）+ 前置校验 + 拒绝越权。
- [ ] `ActionRequestChannel`：post-turn 解析 ```ai-tutor-action``` 围栏块 → 交状态机。
- [ ] 接入 assistant turn 完成钩子。
- [ ] Jest：合法转移成功、越权被拒、标记解析正确。

## Phase 3 — 四栏视图
- [ ] `CourseLibraryView`（书架 Home，卡片：课名 + 进入；`+` 新建课程；封面/进度占位）。
- [ ] 新建课程流程：建 course root、写 course-state.json(intake)、写 data.json 索引、建 intake 会话、提示用户准备材料。
- [ ] `ChapterListView`（左 side leaf：目标→课程→章节分组，点击切会话）。
- [ ] `CourseArtifactsView`（右 side leaf：全课章节→节笔记树，点击开 `.md`）。
- [ ] `arrangeLearningLayout(courseId)`：打开左右 side leaf + 复用 ClaudianView 切当前章会话；**不强排主区**；笔记栏只在生成新笔记时聚焦。
- [ ] `addCommand('AI Tutor: 打开课程书架')` → 常驻 Home Tab。
- [ ] Jest：左栏分组排序。

## Phase 4 — 推进流程 + 上下文注入（编排层）
- [ ] `LessonProgression`：planChapter / advanceSection / startNewLesson 编排步骤。
- [ ] `SummaryService`：读会话消息后台生成 coveredSummary（失败 fallback），复用 Claudian title-gen 机制。
- [ ] conversation 缺失恢复：进入章节若 conversationId 不存在则建 replacement 并更新映射。
- [ ] 聊天内 `Start new lesson` 触点（结章态出现按钮）。
- [ ] `learningAppendix()` 接入 `buildSystemPrompt` 的 appendices（身份 + 压缩写作规范 + action 约定）。
- [ ] `LearningContextInjector` + 在 `buildTurnSubmission` 注入：首轮重 `<course_context>`、后续轻、生成节笔记轮注入 lesson-page 模板。
- [ ] Jest：startNewLesson 携带摘要；首轮注入 course_context；生成轮注入模板。
- [ ] vault rename/delete 事件：更新/保留 `Section.notePath/title`。

## Phase 5 — 内容层移植 + 运行时质量门
- [ ] 种子化 `.claude/skills/{lesson-page,quiz,review,concept-card}/SKILL.md`（从 ob-ai-tutor 移植写作模板）。
- [ ] 把六段式 + 反 AI 腔 + 金句/锐度核心条目压缩进 `learningAppendix`（常驻）。
- [ ] `TransformationRegistry`：四种命名生成意图 → 对应 skill。
- [ ] `ContentQualityGate`：移植 `verify-content.mjs` 的确定性检查为运行时门（篇幅/六段式/类比/反AI腔/数字/引用）。
- [ ] 返修循环：不达标自动打回 Agent 重写（≤N 次），仍不过保留 + Notice。
- [ ] Jest：低质笔记被判不过并返修；达标通过。

## 收尾
- [ ] post-turn 轻校验：每个 assistant turn 后若属某章，校验 course-state.json schema 合法，失败 UI/Notice 提示。
- [ ] 手动跑通 requirements.md 全部 User Scenarios 一次。
- [ ] `npm test -- --run`（Jest）通过。
- [ ] `npm run build` 通过。
- [ ] 更新本 spec 状态为 done，记录与设计的偏差。

## 后置（不属于本 Stage，新开 Stage）
- [ ] 书架封面 / 进度% / 上次学习时间。
- [ ] RAG 检索 + Materials/Sources 挂载（迁 RetrievalService / SourceIndexService）。
- [ ] LLM 裁判质量门（深度/锐度，verify:content:llm）接入运行时或发布门。
- [ ] action 请求通道硬化为 Claude MCP 工具。
- [ ] CourseMap 自动重排 + 撤销 UI。
