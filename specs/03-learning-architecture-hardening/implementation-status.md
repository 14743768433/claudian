# Stage 03 Implementation Status

Updated: 2026-06-27
Branch: `codex/learning-tutor-fork`

## Status

Automated implementation and verification are complete. Real Obsidian smoke remains pending user confirmation in `ai-tutor-test-vault/`.

## Completed

- Baseline commits and Stage 03 tooling are in git history.
- `dependency-cruiser` is installed, `npm run depcruise` is configured, and rules run with `severity: "error"`.
- `npm run learning:architecture-audit` is configured and included in `npm run verify`; it fails on legacy learning entrypoint imports, wrong top-level learning directories, illegal learning Obsidian imports, and `.saveCourse()` calls outside `StateTransitionService`.
- Jest includes a persisted core-loop smoke for create course -> generate syllabus -> plan chapter -> write/register section note -> advance section -> start new lesson -> simulated restart restore from the plugin index and `course-state.json`.
- `npm run learning:verify-test-vault` verifies that `main.js`, `styles.css`, and `manifest.json` in `ai-tutor-test-vault/.obsidian/plugins/claudian-ai-tutor` match the current build outputs by SHA-256.
- `npm run verify` passes locally: depcruise, typecheck, full Jest, build.
- Learning ports and adapters exist: `StatePort`, `VaultPort`, `LayoutPort`, `NoticePort`, `LearningTurnPort`; `ObsidianVaultAdapter`, `ObsidianLayoutAdapter`, `ObsidianNoticeAdapter`, `ClaudianTurnAdapter`, `FileStateAdapter`.
- `LearningController` is a composition root facade. Current baseline reports about 50 lines versus Phase 0 baseline 1898.
- `LearningService` is no longer the Obsidian god object; responsibilities are split into `NavigationCoordinator`, `CommandCoordinator`, `TurnCoordinator`, `LearningReadModel`, `SourceLoader`, `LessonProgression`, `SummaryService`, `StateTransitionService`, and `IndexRepository`.
- `TurnCoordinator` owns turn decoration, assistant-turn completion, action result persistence, review next-step persistence, and repair orchestration.
- `TurnCoordinator` owns deterministic note quality checks and repair-attempt limits.
- `CommandCoordinator` owns command parsing and the `*FromConversation` command workflows; `LearningService` keeps same public methods as thin compatibility forwards.
- Learning feature top-level directories are now limited to `adapters/`, `application/`, `domain/`, `ports/`, and `views/`; previous `content/`, `context/`, `flow/`, `prompt/`, and `state/` entrypoints were moved into the layered structure or removed.
- Obsidian imports in the learning feature are limited to `adapters/**` and `views/**`.
- `domain/LearningStateMachine` is pure: `reduce(state, action) -> { nextState, effects }`.
- `application/StateTransitionService` is the persistence path used by business actions and migrated system actions.
- Migrated system actions include `courseCreated`, `noteRenamed`, `noteDeleted`, `conversationReplaced`, `coveredSummaryWritten`, and internal `lessonSelected`.
- `IndexRepository` is the narrow write entry for derived `data.json` course index updates.
- `InputController` learning completion logic is moved into `learning/adapters/LearningInputBridge`; the chat controller now keeps thin learning hooks.

## Current Evidence

- `npm run depcruise`: passed, 0 violations.
- `npm run learning:architecture-audit`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 245 suites / 5853 tests.
- `npm run build`: passed.
- `npm run verify`: passed.
- `npm run learning:verify-test-vault`: passed.
- `npm run learning:baseline` reports:
  - `src/features/learning/LearningController.ts`: 50 lines.
  - `src/features/learning/application/LearningService.ts`: 832 lines after coordinator extraction and directory consolidation.
  - `src/features/chat/controllers/InputController.ts`: 1807 lines.
  - real `saveCourse` call site: `src/features/learning/application/StateTransitionService.ts`.
  - learning-feature `obsidian` imports only in `adapters/**` and `views/**`.
- `Get-ChildItem -Directory src/features/learning` reports only `adapters`, `application`, `domain`, `ports`, and `views`.
- `.dependency-cruiser.cjs` now also forbids `application/**` importing `adapters/**` or `views/**`.

## Remaining Manual Gate

- Real Obsidian smoke: new course -> intake -> plan chapter -> write section note -> continue section -> Start new lesson -> restart restore. This needs user-side verification in the test vault.
- Use `manual-smoke-checklist.md` in this spec folder to record the user-side smoke result.
