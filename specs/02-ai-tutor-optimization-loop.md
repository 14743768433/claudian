# AI Tutor Optimization Loop

Date: 2026-06-27
Status: active

## Goal

Make the Claudian fork feel like a serious Obsidian-native learning tutor, not just a chat wrapper with course state. Every iteration must compare against:

1. The original `D:\ob-ai-tutor` effect: durable course state, generated artifacts, content verifier, golden/blind candidates.
2. Heptabase AI Tutor: goal interview, long syllabus, lesson plan, source-aware teaching, continuity across lessons, human tutor voice.
3. Modern agent chat tools such as Proma-like interfaces: not only messages, but visible state, modes, actions, artifacts, suggestions, and recoverable progress.

## Evidence Baseline

### Heptabase Observations

Observed through `heptabase` CLI on course `Linux AI 项目全链路实战`.

- Goal interview is explicit before course creation: background, target role, C++ needs, preferred learning style, expected output.
- Course map is large and realistic: 7 major parts and 56 chapters, not an over-compressed outline.
- A lesson has a plan before teaching: overview, parts, bullet points, status, source cards, review part, next lesson summary.
- A later lesson remembers continuity: "上次完成了 Topic 31..." then reads current source cards and plans the next slice.
- Teaching voice is not generic. It uses big-picture framing, practical stakes, exact figures, analogies, and review bridges.

### Original `ob-ai-tutor` Strengths

- `tests/golden/heptabase/*.md` provides benchmark pages.
- `scripts/verify-content.mjs` scores eight dimensions:
  narrativeDepth, structureClarity, visualAids, practicality, explanationDepth, assessmentLoop, sourceGrounding, voiceSharpness.
- `skills/lesson-page-generation/SKILL.md` encodes the content bar: concrete opening, causal explanation, two useful aids, exercise, review bridge, analogy, sharp line, citations.
- Old reports showed Heptabase average around 7.7 and strong blind candidates around 8.5+ when the generator follows the skill.

### Current Claudian Fork Gap

- Course state and conversation mapping exist, but the tutor rhythm is still thin.
- New chapter creation originally opened an empty conversation; now fixed with a kickoff prompt, but the prompt still needs stronger Heptabase-like lesson planning and action guidance.
- The chat surface does not yet make modes, planned actions, next suggestions, or course progress as visible as a learning product should.

## Loop

Each optimization round must run this loop:

1. **Capture**
   - Export or inspect a current Claudian test transcript and generated note.
   - Pull a comparable Heptabase lesson or golden page.
   - Record the user-visible pain point in `implementation-status.md`.

2. **Compare**
   - Compare against the Heptabase behavior checklist:
     goal interview, course scale, source reading, lesson plan, continuity, artifacts, review, next-step suggestions.
   - Compare generated notes with `npm run eval:content` or `npm run eval:content:blind`.
   - Treat the old `ob-ai-tutor` verifier as a floor, not the ceiling.

3. **Diagnose**
   - Classify the gap:
     product flow, state machine, prompt/context, content quality, chat UI, recovery, or evaluation.
   - Prefer fixes that improve the whole learning loop over one-off text patches.

4. **Improve**
   - Update one or more of:
     learning appendix, context injector, kickoff prompts, action protocol, views, content gate, or chat controls.
   - Keep state transitions inside `LearningStateMachine`.
   - Avoid hiding failures behind assistant prose; real progress must be persisted.

5. **Verify**
   - Required local gates for code changes:
     `npm run typecheck`
     focused Jest for touched learning/chat behavior
     `npm run build`
   - Required content gate for prompt/content changes:
     `npm run eval:content`
   - When a blind generator is changed:
     `npm run eval:content:blind`
   - Manual Obsidian check remains required before calling the broader product loop done.

6. **Record**
   - Update `specs/01-claudian-learning-mvp/implementation-status.md` with:
     user-visible issue, root cause, fix, verification, remaining deviation.
   - If the issue changes the desired product behavior, update this loop doc or the Stage 01 spec.

## Target Experience Checklist

A strong learning turn should usually satisfy:

- The assistant knows whether it is in Teach, Ask, or Transform mode.
- The user can see what the tutor is doing now: reading source, planning lesson, teaching section, writing note, reviewing, or opening next lesson.
- A new course starts with a short interview, then proposes a realistic course map.
- A new lesson starts by stating continuity, reading/using relevant material, planning 3-6 parts, and beginning part 1.
- Each teaching answer contains a concrete situation, the causal point, a compact structure, and the next action.
- Every lesson part that becomes a note goes through the lesson-page template and content gate.
- End of lesson writes a summary, starts the next conversation, and auto-kicks the next lesson instead of leaving a blank chat.
- The final assistant turn gives 2-4 useful next-step chips or clear action choices.

## Quality Gates

Content release candidate:

- Overall content score >= 8.0 for each candidate.
- Average candidate score >= 8.5.
- No dimension below 6.5.
- No "voiceSharpness" regression versus the previous accepted prompt/skill version.

Product release candidate:

- New course -> interview -> course map -> first lesson plan -> first section teaching works in Obsidian.
- Start new lesson -> new conversation -> automatic kickoff -> planChapter action works.
- Restart Obsidian -> current course and lesson recover.
- Missing/renamed note and missing conversation recover as specified.

## First Improvements To Land

1. Strengthen `learningAppendix()` around tutor rhythm, modes, action honesty, and next-step chips.
2. Strengthen new lesson kickoff prompt to mirror Heptabase: continuity, source/material note, plan 3-6 parts, teach part 1, emit `planChapter`.
3. Keep the Heptabase content verifier runnable inside this fork.
4. Add tests for the kickoff prompt and appendix so regressions are visible.

## Iteration Log

### 2026-06-27 - Hide Thinking And Protocol Noise

Evidence:
- User testing showed raw model reasoning as `Thought completed` blocks and a large `ai` code block containing `{"type":"planChapter","data":{...}}` in the learning transcript.
- Heptabase-like tutor surfaces keep internal reasoning hidden and show durable lesson state, not raw protocol JSON.
- Proma-like agent interfaces can show activity state, but internal chain-of-thought and machine protocol should not be learner-facing content.

Gap:
- Stored and streaming thinking blocks were rendered as collapsible chat cards.
- The renderer only hid standard ```ai-tutor-action fences, so non-standard `ai`/`json` fences with recognizable learning action JSON could leak into the transcript.
- `ActionRequestChannel` did not unwrap `data` payloads, so the model could visibly output an action-like object without the state machine applying it.

Changes:
- Stored and streaming provider thinking blocks are suppressed from the chat UI and are no longer persisted into visible message blocks.
- Generic `ai`/`json` code fences are hidden when their JSON is recognized as a learning action, including wrapped `data` payloads.
- `ActionRequestChannel` accepts wrapped learning actions and generic candidate fences, then still routes everything through `LearningStateMachine`.
- Added `npm run audit:learning-state` to make old test-vault drift visible: duplicate course roots, index/state mismatches, multiple active lessons, empty started lessons, and protocol leaks in summaries.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 94 tests.
- `npm test -- --runInBand tests/unit/features/chat/controllers/StreamController.test.ts`: pass, 101 tests.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 55 tests.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts tests/unit/features/chat/controllers/StreamController.test.ts tests/unit/features/learning/learningCore.test.ts`: pass, 250 tests.
- `npm run typecheck`: pass.
- `npm run build`: pass.
- Deployed to `ai-tutor-test-vault/.obsidian/plugins/claudian-ai-tutor`.

Remaining:
- Existing test-vault data still contains older polluted course state and should be cleaned or migrated in a separate pass.
- Manual Obsidian retest is needed to confirm live provider thinking no longer appears during a real streamed tutor turn.

### 2026-06-27 - Current-Course Left Navigation

Evidence:
- User testing showed the left chapter sidebar still displayed the previous `提高跑步水平，减肥` course after switching to another learning task.
- In a Heptabase-like tutor, the active lesson navigation is contextual; global course switching lives elsewhere.
- The fork's course library already serves as the all-course surface, so duplicating all courses in the left lesson sidebar made the active task ambiguous.

Gap:
- `ChapterListView` rendered every indexed course grouped by goal, even after `setCourseId()` was called for the active course.
- This made the sidebar look stale when switching from one course to another, even though the underlying course state had changed.

Changes:
- `ChapterListView` now loads and renders only the active course when a `courseId` is assigned.
- If the view opens before `courseId` is assigned, it falls back to `LearningController.loadCurrentCourse()` rather than rendering all indexed courses.
- The course library remains the global all-course switcher; the left sidebar is now current-course chapter navigation.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; recorded this as a product correction to the original grouped-left-tree wording.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/ChapterListView.test.ts`: pass, 2 tests.
- `npm test -- --runInBand tests/unit/features/learning/ChapterListView.test.ts tests/unit/features/learning/CourseArtifactsView.test.ts tests/unit/features/learning/learningCore.test.ts`: pass, 56 tests.
- `npm test -- --runInBand tests/integration/main.test.ts`: pass, 61 tests.
- `npm test -- --runInBand`: pass, 245 suites / 5840 tests.
- `npm run build`: pass.

Remaining:
- Manual Obsidian retest is needed to confirm the old course disappears immediately after switching tasks without requiring a workspace reload.

### 2026-06-27 - Deterministic Next Steps After Review

Evidence:
- The previous pass made final-section completion auto-start Review, but the end of that Review still depended on the model remembering to output `ai-tutor-next-options`.
- Heptabase-like lesson flow makes the next action visible at the lesson boundary.
- Proma-like agent surfaces distinguish durable workflow state from ordinary assistant prose; a next action should not disappear because a model omitted a protocol fence.

Gap:
- Review answers could be good prose while still leaving the user to notice the separate `Start new lesson` button or type a command.
- Existing next-option chips were parsed from assistant text, so they were not guaranteed or durable as orchestration state.

Changes:
- Added a UI-only `learning_next_steps` message block persisted in conversation metadata.
- Orchestrated chapter Review responses now append deterministic chips: `Start new lesson`, `复盘本章`, and `我还有一个问题`.
- The block is not sent to providers and does not mutate `course-state.json`; clicks route through the normal input controller, where `Start new lesson` and `复盘本章` are still guarded by existing learning command handling.
- Message rendering and startup metadata validation now preserve and render these blocks after provider-native history hydration.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against chapter-ended workflow, Start new lesson trigger, provider-neutral UI metadata, and state-machine authority.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 93 tests.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 52 tests.
- `npm test -- --runInBand tests/unit/features/chat/controllers/InputController.test.ts`: pass, 123 tests.
- `npm test -- --runInBand tests/unit/providers/claude/storage/SessionStorage.test.ts`: pass, 30 tests.
- `npm test -- --runInBand tests/integration/main.test.ts`: pass, 61 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5838 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6.
- `npm run build`: pass.

Remaining:
- Manual Obsidian walkthrough is still needed to tune whether the default chip order and labels feel natural in Chinese-heavy courses.
- This does not yet create a dedicated review artifact or a full lesson completion dashboard.

### 2026-06-27 - Auto-Review After Finish Chapter

Evidence:
- User feedback showed that after asking the tutor to move on, the next boundary could still feel inert: the view changed state, but the tutor did not visibly continue the learning work.
- Heptabase-like lesson flow closes a chapter with review/bridge behavior before asking the learner to start the next lesson.
- The fork already had note-grounded `Review`, but final-section `advanceSection` did not automatically call it.

Gap:
- `advanceSection` correctly moved the state machine into `chapterEnded`, but the post-advance kickoff path only knew how to start another pending section.
- On the final section there is no pending section, so the learner saw a quiet boundary instead of a tutor taking the next useful step.

Changes:
- Added a post-advance dispatcher: if the accepted transition is still `teaching`, start the next section; if it is `chapterEnded`, start the note-grounded chapter Review turn in the same conversation.
- Reused the existing Review transformation and section-note snippets, keeping Review separate from `Start new lesson`.
- Added natural-language final-section commands: `完成本章`, `结束本章`, `finish chapter`, and `end chapter`.
- Added focused Jest coverage for both learner-triggered and assistant-emitted final-section `advanceSection` paths.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against `advanceSection`, chapter-ended state, Review, and Start-new-lesson separation.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 51 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5835 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6.
- `npm run build`: pass.
- Deployed to `ai-tutor-test-vault/.obsidian/plugins/claudian-ai-tutor`.

Remaining:
- Manual Obsidian walkthrough is still needed to judge whether auto-review feels like the right amount of initiative, and whether `Start new lesson` should become the default next chip after the review answer.

### 2026-06-27 - Add Note-Grounded Chapter Review

Evidence:
- Heptabase lessons close with review/bridge behavior, not only a button to jump to the next lesson.
- The fork already had `coveredSummary` and a `review` transformation template, but the learner had no explicit end-of-chapter review action.
- The original verifier rewards review/assessment loops, and Proma-like agent interfaces make completed work and next steps visible before moving on.

Gap:
- Compared with Heptabase, finishing a chapter still felt abrupt: `Finish chapter` exposed `Start new lesson`, but there was no stable review turn grounded in the artifacts just written.
- Compared with the Stage 01 state model, review needed to stay separate from `startNewLesson`; otherwise it would become another hidden progression path.

Changes:
- Added a guarded `Review` button that appears after the current learning chapter is ended.
- Added short command routing for `复盘本章` / review / summarize chapter phrases.
- `Review` sends a hidden provider-only prompt using the `review` transformation template and bounded snippets from the chapter's registered section notes.
- The review turn shows a `Preparing chapter review` activity card and explicitly forbids file writes, `ai-tutor-action`, section advancement, and next-lesson creation.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against review transformation scope, `Start new lesson` state boundary, chapter-ended workflow, and the explicit non-goal for full RAG/Materials mounting.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 49 tests.
- `npm test -- --runInBand tests/unit/features/chat/ClaudianView.test.ts`: pass, 16 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5833 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6, strict candidate gate passed.
- `npm run build`: pass.

Remaining:
- Chapter review is chat-native and grounded in registered note snippets; it does not yet write a durable review artifact.
- Full spaced review, flashcards, and source-card/RAG review remain future-stage work.

### 2026-06-27 - Add Source-Aware Practice Turns

Evidence:
- Heptabase lessons include review/check parts instead of ending every section with only exposition or artifact writing.
- The original `ob-ai-tutor` verifier explicitly scores `assessmentLoop`, and the fork already migrated a `quiz` transformation template but did not expose it as a reliable user action.
- The chat next-option chips often include `做一个小测`; before this pass, that chip was only a normal chat message and could drift away from the current section/source context.

Gap:
- Compared with Heptabase, the learner lacked a stable checkpoint loop for the current section.
- Compared with Proma-like agent UX, a suggested action should visibly start a specific workflow with progress state, not depend on the assistant interpreting the text.
- Compared with the Stage 01 architecture, this needed to remain content-layer behavior and not create another state mutation path.

Changes:
- Added a guarded `Practice` button in the learning chat nav row for active teaching sections.
- Added short command routing for `做一个小测` / quiz / practice phrases.
- `Practice` sends a hidden provider-only checkpoint prompt using the `quiz` transformation template and any resolved source snippets for the current lesson-plan part.
- The practice turn shows a `Preparing practice` activity card and explicitly forbids file writes, `ai-tutor-action`, section advancement, and new-lesson creation.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against quiz/review transformation scope, state-machine authority, current-section context, and the explicit non-goal for full RAG/Materials mounting.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 46 tests.
- `npm test -- --runInBand tests/unit/features/chat/ClaudianView.test.ts`: pass, 15 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5829 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6, strict candidate gate passed.
- `npm run build`: pass.

Remaining:
- Practice answers are still generated inside the chat transcript; there is no separate durable quiz artifact or spaced-review system yet.
- Source use is known-source snippet injection from lesson-plan refs, not full source-card reader or RAG.

### 2026-06-27 - Recover Blank New Chapters

Evidence:
- In Obsidian testing, opening or moving into the next chapter could show an empty chat and never send the expected tutor turn.
- The test vault showed multiple empty generated chapters, which came from repeatedly interpreting `开启下一章` while the current active chapter was already blank and waiting to start.
- Some assistant payloads used legacy fields such as `chapterTitle`, `chapterDescription`, and string section lists instead of the stricter MVP action schema.

Gap:
- Compared with Heptabase, a new lesson must immediately do work: carry continuity, plan the slice, and start teaching or reviewing.
- Compared with the Stage 01 spec, "Start new lesson -> new conversation" was not enough; the new conversation had to reliably auto-kickoff and recover from a failed/placeholder attempt.

Changes:
- Auto-kickoff suppression now requires a real assistant response, not merely any message in the conversation.
- Opening a lesson conversation retries chat-tab lookup briefly before giving up, reducing silent blank tabs during Obsidian view switching.
- If the current active lesson is already a blank chapter waiting for kickoff, another `开启下一章` starts that chapter instead of creating another empty lesson.
- The action parser now accepts legacy chapter title/description fields and string section arrays, converting them into typed state-machine actions.
- Accepted new lesson conversations are renamed to the course/chapter title.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against Start new lesson, one-chapter-one-conversation, chapter switching, and no-empty-learning-view expectations.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 44 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5826 tests.
- `npm run build`: pass.

Remaining:
- The current test vault may still contain older empty chapters created before this fix; opening the current active blank chapter should now kickoff, but historical cleanup remains a separate manual/data-migration decision.

### 2026-06-27 - Inject Known Source Snippets Into Write Note Turns

Evidence:
- Heptabase does not merely list sources; lesson teaching and artifacts are grounded in the relevant cards for that lesson part.
- The fork now preserves clickable lesson-plan source refs, but note writing still only told the provider to use sources if available.
- Stage 01 keeps full RAG/Materials mounting out of scope, but it does require lesson-page template injection and source-grounded quality behavior when materials are supplied.

Gap:
- Compared with Heptabase, the generated section note could still be weakly grounded even when the current lesson plan named a vault-backed source.
- Compared with the original `ob-ai-tutor` verifier, source-grounding depends on source snippets actually reaching the writing prompt.
- A full async source injector in every chat turn would require widening the synchronous request-building boundary; the narrower `Write note` orchestration path is already async and controllable.

Changes:
- `Write note` now loads the latest persisted lesson plan for the active conversation and looks at the current part's `sources`.
- For vault-backed source refs, it resolves the file, reads a bounded snippet, and injects a `<source_context>` block into the hidden note-writing turn.
- The activity card now states whether source snippets were resolved, so the learner can distinguish grounded note writing from source-missing note writing.
- The implementation remains known-source injection only: no embedding index, no automatic retrieval, and no arbitrary Materials mount.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against lesson-page injection, source-grounding quality expectations, and the explicit non-goal for full RAG/Materials mounting.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 41 tests.
- `npm test -- --runInBand tests/unit/features/learning/CourseArtifactsView.test.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 93 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5823 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6, strict candidate gate passed.
- `npm run build`: pass.

Remaining:
- Normal learner-authored turns still use the synchronous `LearningContextInjector` and do not dynamically read source files.
- Full source-card reader, Materials mounting, and RAG remain future-stage work.

### 2026-06-27 - Make Lesson Sources Navigable

Evidence:
- Heptabase lesson plans surface source cards as part of the lesson object, so a learner can inspect where the teaching slice came from.
- The fork already asked `planChapter` for `sections[].sources`, but source chips in both chat and the right outline were inert text.
- The Stage 01 spec keeps full RAG/Materials mounting out of scope, but it does require Obsidian-native note navigation and a right course directory.

Gap:
- Compared with Heptabase, sources were visible but not usable.
- Compared with Proma-like agent tools, the plan panel lacked inspectable work-product affordances: the learner could not click from a planned part to the referenced material.
- Structurally, `{ text, path, cardId }` source objects lost their path when converted into UI blocks, so later UI could not open vault-backed sources.

Changes:
- `LearningLessonPlanPart.sources` now accepts either legacy strings or structured `{ label, path, cardId }` refs.
- Accepted `planChapter` actions preserve source path/card metadata in persisted `learning_lesson_plan` UI blocks.
- Chat lesson-plan source chips and right-outline source chips open vault-backed source notes when a path, wikilink, markdown link, or Obsidian linkpath can be resolved.
- Non-vault external card refs remain visible but do not pretend to be mounted source material.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against course-directory navigation, note-opening behavior, source metadata, and the explicit non-goal for full RAG/Materials mounting.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts tests/unit/features/learning/CourseArtifactsView.test.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 133 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5822 tests.
- `npm run build`: pass.

Remaining:
- This is source navigation, not source ingestion: the provider still only uses material that is in context or attached through existing chat mechanisms.
- Full Materials/Sources mounting, RAG, and source-card reader remain future-stage work.

### 2026-06-27 - Add A Deterministic Write Note Action

Evidence:
- Heptabase lessons treat each planned part as something that can become a durable learning artifact, not merely a conversational answer.
- The Stage 01 spec requires the note-writing turn to inject the lesson-page template, then accept `sectionNoteWritten` only after the file exists and passes the runtime quality gate.
- The fork could teach a section and could advance after `noteWritten`, but the learner still had to phrase "生成本节笔记" correctly and trust the model to pick a note path.

Gap:
- The product loop had a weak bridge between "I understand this section" and "write the artifact so I can move on".
- Compared with Heptabase, the section artifact was not a first-class action in the visible learning controls.
- Compared with Proma-like agent interfaces, the next action was too implicit: suggestions existed, but there was no deterministic action button or durable activity state for writing the note.

Changes:
- Added a guarded `Write note` button to the learning chat nav row. It appears only for the current pending section in an active teaching conversation and hides while streaming or after the section note is registered.
- Added `LearningController.writeSectionNoteFromConversation()`, which sends a hidden provider-only note-writing turn with a stable path under `{courseRoot}/lessons/{chapter}/part-N-*.md`.
- The note-writing prompt explicitly requires the injected lesson-page template, actual Markdown file creation, and a `sectionNoteWritten` action block; it forbids `advanceSection` / `startNewLesson` in that turn.
- Short text or chip commands such as `生成本节笔记` now route through the same deterministic path, so next-option chips do not fall back to loose chat.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against the section-note, lesson-page injection, `ContentQualityGate`, and `advanceSection` requirements.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 39 tests.
- `npm test -- --runInBand tests/unit/features/chat/ClaudianView.test.ts`: pass, 14 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5821 tests.
- `npm run build`: pass.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6, strict candidate gate passed.

Remaining:
- The note-writing action still relies on the provider to actually write the Markdown file; the runtime quality gate catches failures after the fact.
- The product still lacks an in-Obsidian source-card reader/evaluation dashboard.

### 2026-06-27 - Promote Lesson Plans Into The Right Outline

Evidence:
- Heptabase lesson plans are not only chat text; the sampled lesson exposes a durable course object with overview, parts, status, sources, and next-lesson bridge.
- The fork already rendered a rich lesson-plan panel in chat, but the right course outline still showed only note rows.
- That meant a newly-opened chapter could still feel empty until a note artifact existed, even after the tutor had planned the chapter.

Gap:
- The right sidebar was specified as the course directory, but it did not yet carry the chapter plan as a navigable learning outline.
- Compared with Heptabase, the learner could not scan the chapter structure outside the transcript.
- Compared with Proma-like agent tools, the planned work product was not visible in the persistent artifact rail.

Changes:
- `CourseArtifactsView` now reads the latest persisted `learning_lesson_plan` block from the lesson conversation.
- The right sidebar renders plan overview, planned parts, status, descriptions, bullet points, source chips, next-lesson summary, and note click-through when a part has an artifact.
- The view falls back to the original section note rows when no persisted plan block exists.
- Added focused Jest coverage for plan rendering, note click-through, and fallback behavior.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against the right sidebar course-directory, `planChapter`, and Start-new-lesson visibility requirements.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/CourseArtifactsView.test.ts`: pass, 2 tests.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 37 tests.
- `npm test -- --runInBand`: pass, 244 suites / 5818 tests.
- `npm run build`: pass.

Remaining:
- The right outline still depends on plan metadata emitted by the agent; it does not independently fetch or verify source cards.
- There is still no full course dashboard or evaluation view inside Obsidian.

### 2026-06-27 - Render Heptabase-Style Lesson Plan Panels

Evidence:
- Heptabase course `Linux AI 项目全链路实战` has 18 lessons in the sampled course; lesson 18 `公共基础层核心文件` exposes a structured `lessonPlan`.
- The sampled Heptabase lesson plan contains an overview, four teaching parts plus Review, part descriptions, bullet points, part status (`inProgress` / `notStarted`), source card references, and a `nextLessonSummary`.
- The message flow shows continuity first (`上次完成了 Topic 31...`), then source reading, then plan creation, then teaching.

Gap:
- The fork had accepted/rejected `planChapter` result cards and compact section items, but it still did not expose a real lesson-plan surface.
- Compared with Heptabase, the learner could not scan overview, parts, sources, status, and next lesson bridge as durable product state.
- Compared with Proma-like agent interfaces, this was still too transcript-shaped: the action was visible, but the work product was not.

Changes:
- Added a persisted `learning_lesson_plan` UI block for accepted `planChapter` actions.
- Extended the `planChapter` action parser with display-only fields: `overview`, `sections[].description`, `sections[].bulletPoints`, `sections[].sources`, and `nextLessonSummary`.
- Kept `course-state.json` narrow: the state machine still stores only the progression truth (`Section.id/title/status`), while rich plan fields stay in `uiMessageBlocks`.
- `MessageRenderer` now renders lesson plan panels with overview, parts, current/pending status, bullet points, sources, and next lesson summary.
- Chapter planning prompts, context injection, and the learning appendix now ask for the richer Heptabase-style plan schema.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against `planChapter`, visible learning-state, and provider-neutral action-channel requirements.
- Heptabase CLI evidence captured with `heptabase course list`, `heptabase lesson list 3bdedc99-d8f5-4c14-8f93-a21c4fbd7df0`, `heptabase lesson read 596eb6f2-92c9-4dc6-ba76-2440c3d556bb`, and `heptabase lesson list-messages 596eb6f2-92c9-4dc6-ba76-2440c3d556bb`.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 37 tests.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 91 tests.
- `npm test -- --runInBand tests/unit/features/chat/controllers/InputController.test.ts`: pass, 123 tests.
- `npm test -- --runInBand tests/unit/providers/claude/storage/SessionStorage.test.ts`: pass, 30 tests.
- `npm test -- --runInBand`: pass, 243 suites / 5816 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6, strict candidate gate passed.
- `npm run build`: pass.

Remaining:
- The panel is display-only metadata; it does not yet read source cards itself or verify that sources were actually fetched.
- There is not yet a full course dashboard showing all lesson plans across the course.

### 2026-06-27 - Complete Tutor Activity Lifecycle

Gap:
- The previous pass made hidden kickoff work visible, but the activity card could remain `Working` forever after the provider turn ended.
- That weakens trust: Proma-like agent surfaces close the loop by showing completed, stopped, or failed work instead of leaving a stale running state.
- Heptabase-like tutor state should feel recoverable: the learner should know whether the tutor finished planning/teaching or whether the turn failed.

Changes:
- `learning_activity` blocks now support `done`, `stopped`, and `error` in addition to `running`.
- `InputController.sendMessage()` updates the live activity card after the provider turn finishes, is interrupted, or throws.
- The final activity state is persisted in `uiMessageBlocks`, so rehydrated provider-native history shows the same state.
- The renderer now labels lifecycle states as `AI Tutor - Done`, `AI Tutor - Stopped`, or `AI Tutor - Error` and applies existing Obsidian status colors.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against no-empty learning views, provider-neutral context injection, and state-machine action boundaries.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 89 tests.
- `npm test -- --runInBand tests/unit/features/chat/controllers/InputController.test.ts`: pass, 123 tests.
- `npm test -- --runInBand`: pass, 243 suites / 5813 tests.
- `npm run build`: pass.

Remaining:
- Manual Obsidian walkthrough is still needed to judge the real streaming timing and whether `Done` should collapse after a delay.
- A fuller activity timeline/dashboard remains out of scope for this pass.

### 2026-06-27 - Show Auto-Kickoff As Tutor Activity

Gap:
- Opening a newly-created intake, next chapter, or next section could still feel empty while the hidden orchestration prompt was waiting on the provider.
- The previous visible workaround made the synthetic prompt look like a learner-authored message (`开始第 N 章`), which is not the right mental model.
- Proma-like agent surfaces show tool/activity state, and Heptabase-style tutor flows make planning/teaching progress visible as product state.

Changes:
- Automatic intake/chapter/section kickoff now uses hidden synthetic user turns for provider orchestration.
- The assistant message starts with a `learning_activity` card such as `Starting course intake`, `Planning chapter`, `Starting chapter section`, or `Starting next section`.
- Activity cards carry compact item lists for the planned or expected substeps and are persisted in `uiMessageBlocks`.
- Action result persistence now preserves non-action UI blocks, so `AI Tutor - Working` activity and later accepted/rejected action-result cards can coexist on the same assistant turn.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against no-empty learning views, provider-neutral context injection, and state-machine action boundaries.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 87 tests.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 36 tests.
- `npm test -- --runInBand tests/unit/providers/claude/storage/SessionStorage.test.ts`: pass, 30 tests.
- `npm test -- --runInBand`: pass, 243 suites / 5809 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6.
- `npm run build`: pass.

Remaining:
- Manual Obsidian walkthrough is still needed to tune real streaming timing and card spacing.
- A fuller activity timeline/dashboard remains out of scope for this pass.

### 2026-06-27 - Make Plans Readable In Action Cards

Gap:
- Heptabase lesson pages expose a plan before teaching: the learner can see the parts, not just a hidden state transition.
- The previous action-result cards proved whether `planChapter` was accepted, but they did not make the planned sections visible enough.
- Proma-like agent surfaces usually show structured substeps. The fork still felt like a chat transcript with status labels, not a learning workflow.

Changes:
- `learning_action_result` blocks now support compact `items`.
- Accepted `generateSyllabus` outcomes include topic titles.
- Accepted `planChapter` outcomes include the planned section titles.
- Accepted `startNewLesson` outcomes include pre-seeded section titles when present; accepted `advanceSection` outcomes show the next section or chapter-complete state.
- `MessageRenderer` renders these items as a compact list inside the action-result card.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against `planChapter`, action-channel, and visible learning-state requirements.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 85 tests.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 36 tests.
- `npm test -- --runInBand tests/unit/providers/claude/storage/SessionStorage.test.ts`: pass, 30 tests.
- `npm test -- --runInBand`: pass, 243 suites / 5807 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6.
- `npm run build`: pass.

Remaining:
- This is still a compact card, not a full Heptabase-style lesson plan page with sources, review blocks, and next lesson summary.
- Manual Obsidian walkthrough is still needed to tune spacing and timing.

### 2026-06-27 - Persist Action Outcomes

Gap:
- The previous pass made `ai-tutor-action` requests readable, but it still only showed what the assistant requested.
- If a state-machine transition was accepted, rejected, or quality-gate blocked, the durable transcript did not clearly show the post-turn result.
- This made chapter transitions feel empty or uncertain: the user could see a new/blank conversation or a Notice, but not a reliable action outcome attached to the assistant turn.

Changes:
- `LearningController.handleAssistantTurnComplete()` now returns structured action outcomes for accepted and rejected requests.
- Outcomes render as `AI Tutor - Accepted` or `AI Tutor - Rejected` cards with state-machine or quality-gate reasons.
- Outcome cards are persisted in session metadata as `uiMessageBlocks` and re-applied after provider-native history hydration, so the visible status does not pollute provider context text.
- The live streaming message is updated immediately after the post-turn state machine runs, before any next conversation or next-section kickoff continues.

Verification:
- Re-read fork spec files: `requirements.md`, `design.md`, `tasks.md`, and `research.md`; checked against requirement 6a and the action-channel design.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 85 tests.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 36 tests.
- `npm test -- --runInBand tests/unit/providers/claude/storage/SessionStorage.test.ts`: pass, 30 tests.
- `npm test -- --runInBand`: pass, 243 suites / 5807 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6.
- `npm run build`: pass.

Remaining:
- Manual Obsidian walkthrough is still needed to judge whether the result cards land at the right moment during real provider streaming and chapter switching.
- Dedicated evaluation/dashboard UI remains out of scope for this pass.

### 2026-06-27 — Hide Protocol, Show Action State

Gap:
- The fork already parsed `ai-tutor-action` fences post-turn, but raw protocol JSON could still appear in the chat transcript.
- Proma-like agent tools make internal actions visible as readable state, not as machine syntax.
- Heptabase exposes plan/source/lesson progress as product state; the user should not need to understand the action protocol to trust the tutor.

Changes:
- `MessageRenderer` now extracts `ai-tutor-action` fences from assistant messages, hides the raw JSON, and renders compact `AI Tutor action` cards.
- Action cards summarize core requests: `Save course map`, `Plan chapter`, `Register section note`, `Advance section`, and `Start new lesson`.
- The existing post-turn parser and state machine are unchanged; this is a display-layer improvement only.

Verification:
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/chat/rendering/MessageRenderer.test.ts`: pass, 83 tests.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 34 tests.
- `npm test -- --runInBand`: pass, 243 suites / 5803 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6.
- `npm run build`: pass.
- Deployed to `ai-tutor-test-vault/.obsidian/plugins/claudian-ai-tutor`.

Remaining:
- Action cards currently summarize requested actions, not accepted/rejected outcomes. Notices still surface rejection; a future pass should record post-turn action results as durable visible status.

### 2026-06-27 — State-Driven Tutor Continuation

Gap:
- Heptabase lesson flow persists a course map, plans the current lesson, then moves into teaching with visible continuity.
- The fork still relied too much on a single assistant reply doing both `planChapter` and first-section teaching correctly.
- If the assistant emitted only `generateSyllabus` or only `planChapter`, state could be saved while the learning loop still felt paused.

Changes:
- Accepted `generateSyllabus` actions now trigger a provider-only first-lesson planning prompt in the same intake conversation.
- Accepted `planChapter` actions now trigger the current-section kickoff prompt, so section 1 starts after the plan is accepted.
- Chapter-planning prompts and learning appendix now clarify that planning and teaching are separated by the plugin-controlled state transition.
- Added focused regression tests for `generateSyllabus -> first lesson planning` and `planChapter -> section 1 kickoff`.

Verification:
- Heptabase reference inspected via CLI:
  - course `Linux AI 项目全链路实战` has a long syllabus and 18 lessons.
  - lesson 18 has a structured plan with overview, parts, status, sources, and next lesson summary.
  - message flow shows continuity from the previous lesson, source reading, plan creation, then teaching.
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 34 tests.
- `npm test -- --runInBand`: pass, 243 suites / 5800 tests.
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6.
- `npm run build`: pass.
- Deployed to `ai-tutor-test-vault/.obsidian/plugins/claudian-ai-tutor`.

Remaining:
- Real Obsidian walkthrough is still needed to confirm timing, focus, and whether automatic follow-up turns feel natural rather than too eager.

### 2026-06-27 — No Blank Learning Turns

Gap:
- Creating or opening a course intake could still leave a blank chat.
- Even after a section note was written, the user had to rely on prose/chips/text commands to move forward.

Changes:
- Blank intake conversations now auto-send a hidden orchestration prompt with a short visible `开始课程 intake：...` message.
- The kickoff path now tolerates a not-yet-synced conversation object as long as the active chat tab itself is empty.
- The chat input nav row shows a state-machine guarded `Next section` button after the current section note is written, and `Finish chapter` on the last section.

Verification:
- `npm run typecheck`: pass.
- `npm test -- --runInBand tests/unit/features/learning/learningCore.test.ts`: pass, 32 tests.
- `npm test -- --runInBand`: pass, 243 suites / 5798 tests.
- `npm run build`: pass.
- Deployed to `ai-tutor-test-vault/.obsidian/plugins/claudian-ai-tutor`.

Remaining:
- Real Obsidian walkthrough is still needed for user-facing timing and focus behavior.

### 2026-06-27 — Visible Learning Surface

Gap:
- The assistant could mention `Next options`, but the chat UI still treated them as plain prose.
- The active learning conversation did not show mode/progress inline, so the user had to infer whether the tutor was planning, teaching, reviewing, or idle.

Changes:
- `MessageRenderer` now parses `Next options` / `下一步` sections and renders up to four clickable chips.
- Chips route through the current tab's `InputController.sendMessage({ content })`, so they behave like normal user turns and keep all runtime/provider behavior intact.
- `LearningController.getConversationStatus()` exposes a read-only status summary for active learning conversations.
- `ClaudianView` renders a compact learning status pill in the input nav row: mode, chapter, lesson title, and section progress.

Verification:
- `npm run typecheck`: pass.
- Focused Jest:
  - `tests/unit/features/chat/rendering/MessageRenderer.test.ts`
  - `tests/unit/features/chat/tabs/Tab.test.ts`
  - `tests/unit/features/learning/learningCore.test.ts`
  - `tests/integration/main.test.ts`
- `npm run eval:content`: pass; benchmark 7.7, blind candidate 8.6.
- `npm run build`: pass.

Remaining:
- Chips are generated from assistant prose, not yet from structured message metadata.
- Teach / Ask / Transform mode is visible as a status label, but there is not yet a dedicated mode switch or evaluation dashboard.
