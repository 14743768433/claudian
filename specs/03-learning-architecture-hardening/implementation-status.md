# Stage 03 Implementation Status

Updated: 2026-06-27
Branch: `codex/learning-tutor-fork`

## Status

Automated implementation and verification are complete. Real Obsidian smoke remains pending user confirmation in `ai-tutor-test-vault/`.

## Completed

- Baseline commits and Stage 03 tooling are in git history.
- `dependency-cruiser` is installed, `npm run depcruise` is configured, and rules run with `severity: "error"`.
- `npm run verify` passes locally: depcruise, typecheck, full Jest, build.
- Learning ports and adapters exist: `StatePort`, `VaultPort`, `LayoutPort`, `NoticePort`, `LearningTurnPort`; `ObsidianVaultAdapter`, `ObsidianLayoutAdapter`, `ObsidianNoticeAdapter`, `ClaudianTurnAdapter`, `FileStateAdapter`.
- `LearningController` is a composition root facade. Current baseline reports about 50 lines versus Phase 0 baseline 1898.
- `LearningService` is no longer the Obsidian god object; responsibilities are split into `NavigationCoordinator`, `CommandCoordinator`, `TurnCoordinator`, `LearningReadModel`, `SourceLoader`, `LessonProgression`, `SummaryService`, `StateTransitionService`, and `IndexRepository`.
- `TurnCoordinator` owns turn decoration, assistant-turn completion, action result persistence, review next-step persistence, and repair orchestration.
- `CommandCoordinator` owns command parsing and delegates the existing `*FromConversation` command workflows through the learning facade. The workflow bodies remain behavior-preserving facade methods because moving the prompt builders would be a larger non-behavioral split.
- Obsidian imports in the learning feature are limited to `adapters/**` and `views/**`.
- `domain/LearningStateMachine` is pure: `reduce(state, action) -> { nextState, effects }`.
- `application/StateTransitionService` is the persistence path used by business actions and migrated system actions.
- Migrated system actions include `courseCreated`, `noteRenamed`, `noteDeleted`, `conversationReplaced`, `coveredSummaryWritten`, and internal `lessonSelected`.
- `IndexRepository` is the narrow write entry for derived `data.json` course index updates.
- `InputController` learning completion logic is moved into `learning/adapters/LearningInputBridge`; the chat controller now keeps thin learning hooks.

## Current Evidence

- `npm run depcruise`: passed, 0 violations.
- `npm run typecheck`: passed.
- `npm test`: passed, 245 suites / 5852 tests.
- `npm run build`: passed.
- `npm run verify`: passed.
- `npm run learning:baseline` reports:
  - `src/features/learning/LearningController.ts`: 50 lines.
  - `src/features/chat/controllers/InputController.ts`: 1807 lines.
  - real `saveCourse` call site: `src/features/learning/application/StateTransitionService.ts`.
  - learning-feature `obsidian` imports only in `adapters/**` and `views/**`.

## Remaining Manual Gate

- Real Obsidian smoke: new course -> intake -> plan chapter -> write section note -> continue section -> Start new lesson -> restart restore. This needs user-side verification in the test vault.
