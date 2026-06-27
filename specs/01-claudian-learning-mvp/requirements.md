# Stage 01 Requirements: Claudian 学习版整合 MVP

状态：active

## Overview

把 Claudian fork 成「AI Tutor」学习插件。用户能从一个**课程书架**进入某门课，在**章节会话**里边聊边学，AI 把内容动态写成**笔记**并指引去看哪篇，章节学完点 **Start new lesson** 推进到下一章。学习状态持久化在 `.ai-tutor/`，重启 Obsidian 不丢。

本 Stage 只交付最简核心闭环；视觉打磨与高级能力后置。

## Scope

- Fork Claudian 并品牌化为 AI Tutor（视图标题 / ribbon / manifest / 默认文案）。
- 一个 **Ctrl+P 命令** 打开常驻的 **课程书架 Tab（Home）**。
- 书架有 `+` 新建课程入口；新建后先生成/保存课程记录，并提示用户接下来应读取或准备哪些学习材料。
- 书架课程索引由插件 `data.json`（`loadData/saveData`）维护；每门课的详细学习状态仍写入该课程目录下的 `.ai-tutor/course-state.json`。
- 书架以卡片列出所有课程，点击进入该课的 **4 栏学习布局**：
  - 左栏：Obsidian side leaf，章节列表（按"目标→课程→章节"分组），点击切换章节会话。
  - 主区左：复用同一个 Claudian 原生聊天 view；进入课程时强制移动/定位到该学习布局的聊天位置。
  - 主区右：当前笔记 `.md`（Obsidian 原生渲染，可由 AI 通过 wikilink 指引切换）。
  - 右栏：Obsidian side leaf，课程目录（全课章节→笔记树），点击打开笔记。
- **一章 = 一个 Claudian conversation**；左栏切换 = 切换会话。
- **三层层级**：课程 → 章(Chapter，= 会话) → 节(Section，= 一篇笔记)。两级推进：
  - **继续下一节**：同一章会话内生成下一节笔记（`advanceSection`）。
  - **Start new lesson**：本章末节学完后结束当前章 → 新建下一章会话 → 注入上一章 `coveredSummary`。
- **编排 ⟂ 内容两层分离**：编排层（何时/覆盖什么/状态）与内容层（写成什么样）正交。
- **状态机权威 + action 请求通道**：插件 `LearningStateMachine` 是唯一能改 `course-state.json` 的地方；**Agent 不直接改状态**，只能在回复里发 `ai-tutor-action` 标记提交请求，插件 post-turn 解析→校验→应用；越权请求被拒。
- **本章节计划由 Agent 提交**（进章时 `planChapter` 基于 syllabus 切片）。
- **内容深度/质量硬门**：① 生成节笔记的轮次由编排层**注入 lesson-page 模板**；② 写出后由 `ContentQualityGate` 跑**确定性检查 + 自动返修循环**（≤N 次）。
- **学习状态服务** 读写 `.ai-tutor/course-state.json`（课程、章、节、章↔会话映射、artifacts、当前章/节指针、machineState）。
- **系统提示 learning appendix**（身份 + 压缩写作规范 + action 约定）+ **当前章上下文注入**（首轮重、后续轻）。
- 章节**逐节累积**生成。

## Non-Goals（本 Stage 明确不做）

- 课程封面图、环形进度百分比、上次学习时间等书架视觉细节（先用占位/纯文字）。
- RAG 检索、Materials/Sources 挂载、embedding。
- **LLM 裁判**质量门（深度/锐度，verify:content:llm）——本 Stage 只做**确定性运行时质量门**，LLM 裁判后置。
- MCP 受控动作工具层——本 Stage action 请求走**结构化标记 post-turn 解析**，MCP 硬化后置。
- 多 provider 行为对齐与调优（默认能用 Claude 即可）。
- 大纲(CourseMap)自动重排、撤销 UI、闪卡、知识地图白板。
- 移动端支持（Claudian desktop-only）。

## User Scenarios

- 按 Ctrl+P → 选「AI Tutor: 打开课程书架」→ 看到我的课程卡片列表。
- 点某门课卡片 → 进入 4 栏布局，定位到该课**当前章**的会话。
- 在中间聊天里提问 → AI 回答，并把成体系内容写成笔记、在回答里用 `[[note]]` 指引"看这篇"。
- 右栏点某章的某篇笔记 → 在主区右打开该 `.md`。
- 如果笔记被 Obsidian rename，课程目录中的链接随 rename 更新；如果笔记被删除，目录保留缺失项/空链接，不尝试自动恢复内容。
- 左栏点另一章 → 中间聊天切换到那章的会话与上下文。
- 点 **Start new lesson** → 当前章标记结束，开出下一章新会话，新会话已知道上一章学到哪。
- 关闭并重开 Obsidian → 课程、章节、当前章、各章笔记都还在。

## Acceptance Criteria

1. 插件在 Obsidian 中以「AI Tutor」名义出现（视图标题 / ribbon / 命令均非 "Claudian"）。
2. 存在命令 `AI Tutor: 打开课程书架`，触发后打开常驻 Home Tab，列出所有课程（至少课名可点击）并提供 `+` 新建课程入口。
3. 新建课程后，插件 `data.json` 中出现课程索引记录；课程目录下出现 `.ai-tutor/course-state.json`；界面提示用户下一步应准备/阅读的材料。
4. 点击课程卡片后，工作区呈现 4 栏：左=章节列表 side leaf、主区左=复用的 Claudian 聊天 view、主区右=笔记位、右=课程目录 side leaf。
5. 左栏章节按"目标→课程→章节号"分组排序；点击某章使中间聊天切换到该章对应的 Claudian conversation。
6. 每个章节对应且仅对应一个 conversation；该映射写在 `.ai-tutor/course-state.json` 的 `LessonSession.conversationId`。
6a. **状态机权威**：Agent 发 `ai-tutor-action` 标记提交请求；插件 post-turn 解析并经 `LearningStateMachine` 校验后才改 `course-state.json`；越权请求（如未写笔记就 `advanceSection`）被拒并回提示。Agent 无法绕过状态机改状态。
6b. **章/节推进**：`planChapter` 写入本章 sections；`继续下一节`(`advanceSection`) 在同一会话内推进 currentSectionIndex，仅当当前节已 `noteWritten` 时允许。
6c. **内容质量硬门**：生成节笔记的轮次注入了 lesson-page 模板；写出后 `ContentQualityGate` 跑确定性检查，**不达标的笔记被自动打回返修**（≤N 次），达标才登记为 artifact。给一篇明显过短/无类比的笔记，断言它被判不过。
7. 点击 **Start new lesson**：当前 `LessonSession.status` 变为 `ended`，生成 `coveredSummary`，新建下一章 `LessonSession` 与对应 conversation，并把上一章 `coveredSummary` 注入新会话首轮上下文。
8. 章节随推进逐个出现（不预建）；右栏课程目录实时反映已存在章节及其笔记。
9. 系统提示包含 learning appendix（断言其标识字符串存在）。
10. 每轮发送给 provider 的内容，在存在当前章时包含 `<course_context>` 块（含课名、当前章标题、上一章摘要）。
11. 每个 assistant turn 完成后，若当前 conversation 属于某章，执行 post-turn 轻校验：`course-state.json` 必须是合法 JSON 且符合 schema；失败时在 UI/Notice 中提示。
12. 重启 Obsidian 后，`LearningStateService.loadCurrentCourse()` 能恢复课程地图、章节列表与当前章指针，不依赖解析 Markdown。
13. `npm test`（Jest）与 `npm run build` 通过。
