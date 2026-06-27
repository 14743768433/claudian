# Implementation Status

Date: 2026-06-27

## Implemented

- Fork branch `codex/learning-tutor-fork` created in `D:\claudian`.
- Planning spec copied from `D:\ob-ai-tutor\specs\01-claudian-learning-mvp\`.
- User-visible plugin brand changed to AI Tutor for manifest, package description, ribbon, commands, chat title, settings copy, and base system identity.
- The command palette entry now uses the spec text `AI Tutor: 打开课程书架`.
- The Obsidian ribbon icon opens the AI Tutor course library directly.
- Added learning state domain under `src/features/learning/`:
  - `LearningPluginIndex`
  - `LearningStateService`
  - `LearningStateMachine`
  - `ActionRequestChannel`
  - `LearningContextInjector`
  - `LessonProgression`
  - `SummaryService`
  - `TransformationRegistry`
  - `ContentQualityGate`
  - learning views and controller.
- Added course library, chapter list side leaf, and artifacts side leaf.
- Chapter list now renders the full goal -> course -> chapter tree from all indexed courses, with the active course and lesson highlighted.
- After user testing, `ChapterListView` was corrected to render only the current course's goal, title, and lessons. The course library remains the all-course switcher; the left sidebar is now contextual chapter navigation, so switching to another learning task no longer leaves the previous course at the top.
- New course flow creates an intake conversation, `data.json` index entry, and `{courseRoot}/.ai-tutor/course-state.json`.
- `LearningStateService.loadCurrentCourse()` restores the most recently indexed recoverable course, and `course-state.json` validation now checks the nested syllabus, lesson, and section schema.
- Assistant turn completion parses `ai-tutor-action` fenced JSON and routes valid requests through `LearningStateMachine`.
- Current course context is injected into provider turns; note-generation turns inject lesson-page template text.
- `SummaryService` reads the finished lesson conversation, reuses Claudian's provider-routed title-generation auxiliary service to add a concise summary focus, preserves the recent assistant-message digest as the covered summary body, and falls back deterministically when conversation/title generation is unavailable.
- Claude system prompt now includes the AI Tutor learning appendix via `buildSystemPrompt(..., { appendices })`.
- Vault rename/delete events update or mark missing note artifact links.
- Conversation replacement is created when a lesson conversation mapping points to a missing conversation.
- Learning layout reuses an existing AI Tutor chat leaf when one is open; otherwise it creates one main-area tab, then switches it to the current lesson conversation.
- The chat input nav row shows a `Start new lesson` button when the active lesson is ended and the course is in `chapterEnded`; clicking it routes through `LessonProgression` and `LearningStateMachine`, creates the next lesson conversation, refreshes learning views, and opens the next chapter chat.
- User text commands such as `开启下一章`, `Start new lesson`, `next chapter`, and `next lesson` are intercepted in learning conversations and force-routed through `LessonProgression` / `LearningStateMachine`, so a next lesson conversation is created even when the assistant does not emit an `ai-tutor-action` block.
- Blank current `chapterPlanning` lesson conversations now auto-send a chapter kickoff prompt when opened, causing the provider turn to receive the normal first-turn `<course_context>` and instructing the assistant to `planChapter` before teaching section 1. Conversations with a real assistant response are not auto-started again, but user-only/failed kickoff placeholders no longer block retry.
- New chapter kickoff now retries short-lived chat-tab lookup after switching conversations, preventing the next chapter from silently staying blank when Obsidian has not fully attached the tab yet.
- If the current active lesson is already a blank/new chapter waiting for kickoff, user text such as `开启下一章` opens and starts that current chapter instead of creating another empty chapter.
- `ActionRequestChannel` now accepts common legacy/LLM-shaped chapter fields (`chapterTitle`, `chapterDescription`, and string `sections[]`) and converts them into typed `startNewLesson` / `planChapter` actions, reducing empty-chapter drift when the assistant does not exactly follow the MVP schema.
- New lesson conversations are renamed to `course · chapter` after the state machine accepts `startNewLesson`, instead of staying as a default date-only chat title.
- Assistant-emitted `startNewLesson` actions now also open the newly-created chapter conversation immediately after the state machine accepts the action.
- Blank current `teaching` lesson conversations with pre-planned sections now auto-start as well; the kickoff prompt skips re-planning and begins section 1 instead of leaving the chapter chat empty.
- Programmatic lesson kickoff hides the synthetic user prompt and renders a visible `AI Tutor - Working` activity card on the assistant message, so opening an intake/chapter/next section shows that the tutor is planning or teaching instead of leaving a blank-looking chat or pretending the learner typed `开始第 N 章`.
- Blank current intake conversations now auto-send an intake kickoff prompt when opened, so a newly-created course starts by asking for or prioritizing learning materials instead of showing an empty chat.
- Accepted `generateSyllabus` actions now automatically trigger a provider-only first-lesson planning prompt in the same intake conversation, so course-map creation flows into chapter planning instead of stopping at the map.
- Accepted `planChapter` actions now automatically trigger the current section kickoff prompt, so lesson planning flows into section teaching without relying on the assistant to do both in one reply.
- User text commands such as `继续下一节`, `开始下一节`, and `next section` are intercepted in learning conversations and routed through `LearningStateMachine` via `LessonProgression.advanceSection`. If the current section is not `noteWritten`, the transition is rejected with a Notice instead of letting the model guess.
- Accepted `advanceSection` actions, whether user-triggered or assistant-emitted, now immediately send a hidden provider-only tutoring prompt in the same chapter conversation and show a `Starting next section` activity card.
- The chat input nav row now shows a guarded `Next section` button after the current section note is written; on the final section it becomes `Finish chapter`, still routing through the state machine.
- The chat input nav row now shows a guarded `Write note` button for the current pending section. It sends a hidden provider-only note-writing turn with a stable target note path, visible `Writing section note` activity card, lesson-page template injection, and an explicit `sectionNoteWritten` action request. Short text/chip commands such as `生成本节笔记` route through the same path.
- The chat input nav row now shows a guarded `Practice` button for the current active section. It sends a hidden provider-only quiz/checkpoint turn using the `quiz` transformation template and any resolved current-part source snippets, but does not write files, emit `ai-tutor-action`, or mutate `course-state.json`. Short text/chip commands such as `做一个小测` route through the same path.
- The chat input nav row now shows a guarded `Review` button after a chapter is finished. It sends a hidden provider-only chapter review turn using the `review` transformation template and bounded snippets from the chapter's registered section notes, but does not write files, emit `ai-tutor-action`, or start the next lesson. Short text/chip commands such as `复盘本章` route through the same path.
- Final-section `advanceSection` transitions, whether triggered by the learner or by an accepted assistant action, now automatically start the same note-grounded chapter review turn after the state becomes `chapterEnded`. Natural-language commands such as `完成本章`, `结束本章`, `finish chapter`, and `end chapter` route through the same guarded state-machine path.
- Orchestrated chapter Review responses now persist a `learning_next_steps` UI-only block with deterministic chips for `Start new lesson`, `复盘本章`, and `我还有一个问题`. These chips survive provider-native history hydration and route through the normal chat input path without being sent as hidden provider context.
- Note links from the right artifacts view open in a main-area vertical split.
- Low-quality `sectionNoteWritten` actions are rejected, capped auto-repair prompts are sent back into the same conversation, and repeated failures stop with a Notice while preserving the file.
- Learning conversations run post-turn state reload validation and show a Notice when `course-state.json` is invalid or missing.
- Runtime skill seeding writes `.claude/skills/{lesson-page,quiz,review,concept-card}/SKILL.md` when missing.
- Added `npm run audit:learning-state` to inspect a vault/plugin data pair for duplicate course roots, index/state mismatches, multiple active lessons, empty started lessons, and protocol leaks in covered summaries.
- Added `specs/02-ai-tutor-optimization-loop.md` as the ongoing improvement loop. It compares the Claudian fork against the original `D:\ob-ai-tutor` verifier/golden assets and real Heptabase AI Tutor behavior observed through the `heptabase` CLI.
- Migrated Heptabase golden content benchmarks, `scripts/verify-content.mjs`, `scripts/blind-candidate-local.mjs`, and `skills/lesson-page-generation/SKILL.md` into this fork. Package scripts now include `npm run eval:content`, `npm run eval:content:benchmark`, `npm run eval:content:blind`, and `npm run eval:content:release`.
- Strengthened the learning appendix, new-lesson kickoff prompt, and learning context injection around the Heptabase-like tutor rhythm: mode awareness, continuity, chapter plan before teaching, first section kickoff, durable note quality, and 2-4 `Next options` after substantial turns.
- Runtime lesson-page template injection now includes the stronger old verifier bar: grounded context, concrete opening, causal explanation, two useful aids, exercise, review bridge, analogy, sharp line, and the eight quality dimensions.
- Assistant `Next options` / `下一步` sections now render as clickable chat chips; clicking a chip sends that option through the active tab's normal input controller.
- Assistant `ai-tutor-next-options` JSON fences now render as clickable chips while the protocol block is hidden from the visible answer.
- Assistant `ai-tutor-action` JSON fences now render as small `AI Tutor action` cards while the raw protocol JSON is hidden from the visible answer.
- Provider thinking / reasoning blocks are now hidden from stored and streaming chat UI, so internal model thought transcripts no longer appear as `Thought completed` blocks in the learning surface.
- Non-standard learning action code fences such as `ai` / `json` containing `{"type":"planChapter","data":{...}}` are now treated as hidden protocol, rendered as readable action cards, and parsed through the same post-turn state-machine channel.
- Assistant `ai-tutor-action` requests now produce structured post-turn result blocks after the state machine runs: accepted actions render as `AI Tutor - Accepted`, rejected actions render as `AI Tutor - Rejected` with the state-machine or quality-gate reason.
- Learning action result blocks are stored in session metadata as `uiMessageBlocks`, then re-applied after provider-native history hydration. This keeps action status visible without adding provider-context text.
- Learning action result blocks can now carry compact `items`, so accepted `generateSyllabus`, `planChapter`, and pre-sectioned `startNewLesson` actions show the concrete topics/sections directly in the chat card.
- Accepted `planChapter` actions now also create a persisted `learning_lesson_plan` UI block. The chat shows a Heptabase-style lesson plan panel with chapter title, overview, parts, current/pending status, section descriptions, bullet points, sources, and next-lesson summary when the agent provides those fields.
- The `planChapter` action parser accepts optional `overview`, `sections[].description`, `sections[].bulletPoints`, `sections[].sources`, and `nextLessonSummary` fields for display without expanding the course-state truth model.
- The right `CourseArtifactsView` now reads the latest persisted `learning_lesson_plan` block from the lesson conversation and renders the chapter overview, planned parts, statuses, bullet points, sources, next-lesson summary, and note click-through. If no lesson-plan block exists, it falls back to the old section note tree.
- After the Heptabase right-rail review, `CourseArtifactsView` now treats the selected lesson part as a material panel rather than a preview list: the selected section renders its full Obsidian Markdown note content in the side leaf, and the part's vault-backed reference materials render as full Markdown source cards with Open actions. Unresolved external/card sources remain visible as source records without pretending local content exists.
- Lesson plan source refs now preserve `{ label, path, cardId }` metadata in UI blocks. Source chips in the chat lesson-plan panel and right course outline open vault-backed source notes when a path, wikilink, markdown link, or Obsidian linkpath can be resolved; non-vault external card refs remain visible without pretending to be mounted materials.
- The deterministic `Write note` action now reads bounded snippets from the current lesson-plan part's resolved vault source paths and injects them into the hidden note-writing turn as `<source_context>`. This gives the lesson-page template real source grounding when known source notes exist, while still leaving full RAG/Materials mounting out of Stage 01.
- Automatic intake/chapter/section kickoff turns now store `learning_activity` UI blocks in `uiMessageBlocks`, with labels, details, and compact item lists that survive provider history hydration and coexist with accepted/rejected action-result cards.
- Learning activity cards now have a small lifecycle: `Working` while the hidden orchestration turn is in flight, `Done` after the provider turn completes, `Stopped` if interrupted, and `Error` if the provider turn fails. The final state is persisted in `uiMessageBlocks`.
- Learning conversations now show a compact status pill in the chat input nav row with mode, chapter, lesson title, and current section progress.
- Learning conversations now include Teach / Ask / Transform mode controls in the chat input nav row; the selected mode is injected into the next provider turn.
- Focused Jest coverage added for index/state roundtrip, invalid JSON safe failure, action parsing, legal/illegal transitions, context injection, quality gate, and replacement mapping.

## Verification

- `npm run typecheck`: pass.
- `npm test`: pass, 245 test suites / 5840 tests.
- `npm run build`: pass.
- `npm run eval:content`: pass.
  - Heptabase benchmark average: 7.7.
  - Blind candidate average: 8.6.
- Chat UX focused regression: pass.
  - `MessageRenderer` extracts and renders clickable `Next options` chips.
  - `Tab` routes clicked chips through `InputController.sendMessage`.
  - `LearningController.getConversationStatus()` exposes read-only status data for the chat status pill.
  - `MessageRenderer` hides raw `ai-tutor-action` fences and renders readable action cards such as `Plan chapter` or `Start new lesson`.
  - `MessageRenderer` hides generic `ai`/`json` code fences when they contain learning action JSON, including wrapped `data` payloads.
  - Stored and streaming provider thinking blocks are suppressed from the chat surface instead of rendering `Thought completed` cards.
  - `MessageRenderer` suppresses requested-action preview cards after a persisted accepted/rejected result is present.
  - `MessageRenderer` renders persisted action-result `items` as a compact topic/section list.
  - `MessageRenderer` renders persisted and live `learning_lesson_plan` panels with overview, parts, clickable vault-backed sources, and next-lesson summary.
  - `MessageRenderer` renders persisted and live `learning_next_steps` chips after orchestrated Review turns, and clicked chips route through the active tab's normal input controller.
  - `ChapterListView` renders only the active/current course and does not show other indexed courses after task switching.
  - `CourseArtifactsView` renders persisted lesson-plan metadata from conversation UI blocks, opens linked notes for planned parts that already have artifacts, opens vault-backed source chips, and falls back to section rows when no plan block exists.
  - `ClaudianView` exposes the `Practice` action while the active learning conversation has a current teachable section and hides it while streaming.
  - `ClaudianView` exposes the `Write note` action only when the active learning conversation has a current pending section and hides it while streaming or after the note is written.
  - `ClaudianView` exposes the `Review` action only when the active learning chapter is finished and hides it while streaming.
  - `MessageRenderer` renders persisted `learning_activity` cards, appends live activity cards to streaming assistant messages, and displays `Done` / `Stopped` / `Error` lifecycle states.
  - `LearningController.handleAssistantTurnComplete()` returns accepted/rejected outcomes and persists them to `uiMessageBlocks`.
  - `InputController.sendMessage()` supports hidden synthetic learning prompts with durable activity metadata, marks final activity state after the provider turn completes, and avoids blank title generation.
  - `SessionStorage.toSessionMetadata()` preserves `uiMessageBlocks`, including learning activity blocks, while still omitting full conversation messages.
- Post-Obsidian-feedback focused regression: pass.
  - Natural-language `开启下一章` command creates a new lesson conversation through the state machine.
  - Blank `chapterPlanning` lesson conversations auto-start instead of sitting empty after the next chapter opens.
  - Blank `chapterPlanning` conversations retry auto-start if a previous hidden kickoff left only a user placeholder and no assistant response.
  - Active blank chapters treat another `开启下一章` as "start this chapter now" rather than creating another empty chapter.
  - Legacy `chapterTitle` / `chapterDescription` / string-section action payloads are parsed into typed actions.
  - Assistant `startNewLesson` actions open and start the next chapter conversation after the action is accepted.
  - Blank `teaching` lesson conversations with pre-planned sections auto-start section 1 instead of sitting empty.
  - Blank `intake` course conversations auto-start with a material/goal intake prompt instead of sitting empty.
  - Assistant `generateSyllabus` actions kick off first-lesson planning after the syllabus is accepted.
  - Assistant `planChapter` actions kick off section 1 after the chapter plan is accepted.
  - Natural-language `继续下一节` command advances only after the current section note is written, and then starts the next section in the same conversation.
  - Assistant `advanceSection` actions use the same guarded path and auto-kickoff behavior as the user command path.
  - Final-section `advanceSection` actions now immediately start a hidden note-grounded chapter Review turn after the course enters `chapterEnded`, so `Finish chapter` no longer leaves the learner at a quiet boundary.
  - Natural-language `完成本章` / `结束本章` / `finish chapter` / `end chapter` commands are accepted as state-machine guarded final-section advance requests.
  - The chat nav row exposes a state-aware `Next section` / `Finish chapter` button only when the state machine can accept `advanceSection`.
  - The chat nav row exposes a state-aware `Write note` button before `advanceSection` is allowed; clicking it or using the `生成本节笔记` chip starts a hidden note-writing turn that must emit `sectionNoteWritten`.
  - The hidden `Write note` turn injects bounded `<source_context>` snippets from the current plan part's vault-backed sources when those files can be resolved.
  - The chat nav row exposes a state-aware `Practice` button for the current active section; clicking it or using the `做一个小测` chip starts a hidden checkpoint turn that uses the quiz transformation and any resolved source snippets without changing state.
  - The chat nav row exposes a state-aware `Review` button once the chapter is ended; clicking it or using the `复盘本章` chip starts a hidden review turn grounded in registered section note snippets without changing state or starting the next chapter.
  - Review turn completion persists deterministic `Start new lesson` / `复盘本章` / follow-up chips as UI-only metadata, so the chapter-end boundary has a visible next action even if the model omits structured next options.
  - New chapter kickoff prompt now requires continuity, `planChapter` when needed, section-1 teaching, and `ai-tutor-next-options`.
- Focused Jest set: pass.
  - `tests/unit/features/learning/learningCore.test.ts` (latest targeted run: 52 tests)
  - `tests/unit/features/learning/ChapterListView.test.ts` (latest targeted run: 2 tests)
  - `tests/unit/features/chat/ClaudianView.test.ts` (latest targeted run: 16 tests)
  - `tests/unit/features/chat/rendering/MessageRenderer.test.ts` (latest targeted run: 94 tests)
  - `tests/unit/features/chat/controllers/StreamController.test.ts` (latest targeted run: 101 tests)
  - `tests/unit/features/chat/controllers/InputController.test.ts`
  - `tests/unit/features/learning/CourseArtifactsView.test.ts`
  - `tests/unit/providers/claude/storage/SessionStorage.test.ts`
  - `tests/unit/i18n/i18n.test.ts`
  - `tests/unit/i18n/locales.test.ts`
  - `tests/unit/providers/claude/prompt/systemPrompt.test.ts`
  - `tests/integration/main.test.ts`

## Known Deviations

- Real Obsidian manual walkthrough has not been run in this implementation pass. Automated Jest/build/typecheck gates are green.
- The main-area right Markdown note pane is opened on artifact click via a vertical split. Course entry opens the side leaves and current chat conversation, matching the design note to avoid forcing the user's main-area layout until a note is opened/generated.
- The default course root is `AI Tutor/Courses/{slug}` rather than the sample `message/ob-ai-tutor/{course-slug}` from the design document.
- The original Stage 01 wording described the left chapter list as grouped by goal -> course -> chapter. User testing showed that this made task switching confusing because previous courses remained visible in the active course sidebar. Current product behavior intentionally treats the course library as the global switcher and `ChapterListView` as current-course navigation only.
- The optimization loop is active but not complete. The current pass adds deterministic Practice/checkpoint and chapter Review turns, bounded known-source snippets for deterministic note-writing turns, deterministic Review next-step chips, and current-course-only left navigation, improving assessment/review/source-grounded artifacts and task focus without claiming full RAG/Materials mounting. It does not yet include a dedicated evaluation dashboard inside Obsidian or a full source-card reader.
- `npm run audit:learning-state -- --vault ai-tutor-test-vault --json` currently reports old test-vault pollution created by earlier manual runs: duplicate `如何阅读一本书` index entries, multiple active lessons in `学习跑步`, empty started lessons, and historical `coveredSummary` protocol leaks. New code prevents key sources of this drift, but a separate cleanup/migration pass is still needed if the existing test data should be normalized.

## Spec Re-read

Latest hidden-thinking/protocol pass re-read `requirements.md`, `design.md`, `tasks.md`, and `research.md` from the fork copy and checked the implementation against provider-neutral chat UI, action-channel authority, and no-empty-learning-view expectations: internal provider thinking is no longer rendered or persisted as visible message blocks, while non-standard but recognizable learning action JSON is hidden from the transcript and still routed through `ActionRequestChannel` and `LearningStateMachine`.

Latest current-course-left-nav pass re-read `requirements.md`, `design.md`, `tasks.md`, and `research.md` from the fork copy and checked the implementation against the course-entry, chapter-switching, and four-pane learning layout intent: the original all-course grouped chapter tree was corrected to current-course-only navigation because real task switching made previous courses look stale; this is recorded as a product correction while the course library remains the all-course surface. Latest review-next-steps pass re-read `requirements.md`, `design.md`, `tasks.md`, and `research.md` from the fork copy and checked the implementation against the chapter-ended workflow, Start new lesson trigger, provider-neutral UI metadata, and state-machine authority: `learning_next_steps` chips are persisted outside provider text and route through the normal input path, but they do not mutate `course-state.json`, emit actions by themselves, or replace the guarded `Start new lesson` state-machine transition. Latest auto-review-after-finish pass re-read `requirements.md`, `design.md`, `tasks.md`, and `research.md` from the fork copy and checked the implementation against requirement 6b (`advanceSection`), the chapter-ended state boundary, and the Review / Start new lesson separation: final-section `advanceSection` now starts a hidden note-grounded review turn after entering `chapterEnded`, but it does not write files, register artifacts, emit `ai-tutor-action`, mutate `course-state.json`, or start the next chapter. Latest chapter-review pass re-read `requirements.md`, `design.md`, `tasks.md`, and `research.md` from the fork copy and checked the implementation against the `TransformationRegistry` review content layer, `Start new lesson` state boundary, chapter-ended workflow, and explicit non-goal for RAG/Materials mounting: `Review` starts a hidden note-grounded review turn after the chapter is ended, but it does not write files, register artifacts, emit `ai-tutor-action`, mutate `course-state.json`, or start the next chapter. Latest practice-checkpoint pass re-read `requirements.md`, `design.md`, `tasks.md`, and `research.md` from the fork copy and checked the implementation against the `TransformationRegistry` quiz/review content layer, state-machine authority, current-section context, and explicit non-goal for RAG/Materials mounting: `Practice` starts a hidden source-aware quiz turn for the current active section, but it does not write files, register artifacts, emit `ai-tutor-action`, or mutate `course-state.json`. Latest blank-chapter recovery pass re-read `requirements.md`, `design.md`, `tasks.md`, and `research.md` from the fork copy and checked the implementation against Start new lesson, one-chapter-one-conversation, chapter switching, and no-empty-learning-view expectations: new/blank current chapters now retry kickoff until a chat tab is available, only real assistant responses suppress auto-start, and legacy chapter action payloads are coerced into the typed action channel instead of causing empty chapter drift. Latest source-snippet note pass re-read `requirements.md`, `design.md`, `tasks.md`, and `research.md` from the fork copy and checked the implementation against the lesson-page injection, source-grounding quality gate, and explicit non-goal for full RAG/Materials mounting: `Write note` can now inject short snippets from known vault-backed lesson-plan sources, but it does not build a retrieval index or mount arbitrary materials. Latest clickable-source pass re-read the same spec files and checked the implementation against the right sidebar course-directory, note-opening, `planChapter` source metadata, and explicit non-goal for full RAG/Materials mounting: source refs are now preserved and clickable when vault-backed, but this remains navigation over known source refs rather than embedding/RAG. Latest write-note-action pass re-read the same spec files and checked the implementation against the section-note, lesson-page injection, `ContentQualityGate`, and `advanceSection` requirements: `Write note` starts a hidden note-generation turn, but `course-state.json` is still changed only after the assistant writes the file and submits a valid `sectionNoteWritten` action that passes the runtime quality gate. Latest right-outline pass re-read the same spec files and checked the implementation against the right sidebar course-directory, `planChapter`, and Start-new-lesson visibility requirements: the right side now surfaces the persisted chapter plan as course outline metadata while `course-state.json` remains the progression truth. Latest lesson-plan-panel pass re-read the same spec files and checked the implementation against the `planChapter`, visible learning-state, and provider-neutral action-channel requirements: richer plan fields are accepted as display-only metadata, while `course-state.json` still stores only the state-machine truth needed for progression. The activity-lifecycle pass re-read the same spec files and checked the implementation against the no-empty-learning-view scenarios and provider-neutral action/context design: automatic intake/chapter/section prompts are still orchestration-only provider turns, and the learner sees whether that turn is working, done, stopped, or failed. The auto-kickoff activity-card pass re-read the same spec files and checked that hidden orchestration prompts show durable tutor activity without leaking synthetic user text. The rich-plan-card pass re-read the same spec files and checked the implementation against the action-channel and `planChapter` requirements: accepted action outcomes are still state-machine guarded, and syllabus/chapter-plan results expose topics/sections as UI-only metadata without changing provider text.

After implementation and after the final fixes, `requirements.md`, `design.md`, `tasks.md`, and `research.md` were re-read from the fork copy and compared against the implementation. During the optimization-loop pass, the Start new lesson / first-turn context / `planChapter` sections were checked again against the fork spec. The follow-up next-section pass re-read the same spec files and checked the implementation against requirement 6b (`继续下一节` / `advanceSection`). The blank-intake and guarded-button pass re-read the same spec files and checked the implementation against the no-empty-learning-view intent in the Home/course-entry and lesson-progression scenarios. The syllabus-to-plan and plan-to-section pass re-read the same spec files and checked the implementation against the new course intake, `generateSyllabus`, `planChapter`, and first-section teaching flow. The action-card pass re-read the same spec files and checked the implementation against the action request channel requirement: the agent still submits fenced requests, the plugin still validates them, and the chat UI now hides raw protocol while showing a readable action summary. The activity-card pass re-read the same spec files and checked that automatic kickoff turns show visible state while keeping the synthetic orchestration prompt out of the user transcript and provider-neutral state machine boundaries intact. The lifecycle pass re-read the same spec files and checked that the visible activity state completes or fails without changing the state-machine or provider-text contract. The lesson-plan-panel pass re-read the same spec files and checked that accepted `planChapter` requests can render a richer learning plan while preserving state-machine authority. The deviations above are the remaining product/verification notes. The spec status remains `active` until the real Obsidian user-scenario walkthrough is completed.
