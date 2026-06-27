# Stage 03 Implementation Status

Updated: 2026-06-27
Branch: `codex/learning-tutor-fork`

## Completed

- Baseline commits and Stage 03 tooling are in git history.
- `dependency-cruiser` is installed, `npm run depcruise` is configured, and rules now run with `severity: "error"`.
- `npm run verify` was added and passed locally: depcruise, typecheck, full Jest, build.
- Learning ports and adapters exist: `StatePort`, `VaultPort`, `LayoutPort`, `NoticePort`, `LearningTurnPort`; `ObsidianVaultAdapter`, `ObsidianLayoutAdapter`, `ObsidianNoticeAdapter`, `ClaudianTurnAdapter`, `FileStateAdapter`.
- `LearningController` is a composition-root facade. Current baseline reports 42 lines versus Phase 0 baseline 1898.
- Obsidian imports in the learning feature are limited to `adapters/**` and `views/**`.
- `domain/LearningStateMachine` is pure: `reduce(state, action) -> { nextState, effects }`.
- `application/StateTransitionService` is the persistence path used by business actions and the migrated system actions.
- Migrated system actions: `noteRenamed`, `noteDeleted`, `conversationReplaced`; added internal `lessonSelected`.
- `SummaryService` and `LessonProgression` now use `LearningTurnPort`.
- `InputController` learning completion logic was moved into `learning/adapters/LearningInputBridge`; the chat controller now keeps thin learning hooks.

## Known Deviations

- `courseCreated` is not yet modeled as a domain system action. Course creation still uses `LearningStateService.createCourse`, which writes the initial course state.
- `coveredSummaryWritten` is not a separate system action. Chapter summaries are still saved through the accepted `startNewLesson` action path.
- `IndexRepository` has not been split from `LearningPluginIndex`; `data.json` index writes still flow through the existing index class.
- `LearningService` is much smaller at the controller boundary but is not yet fully split into separate `NavigationCoordinator`, `CommandCoordinator`, `TurnCoordinator`, `LearningReadModel`, and `SourceLoader` files.
- Compatibility files remain in legacy folders (`flow/`, `state/`, `content/`) as re-export shims while tests and imports migrate.
- Real Obsidian smoke still requires manual user verification in the test vault.

## Verification

- `npm run depcruise`: passed, 0 violations.
- `npm run typecheck`: passed.
- `npm test`: passed, 245 suites / 5850 tests.
- `npm run build`: passed.
- `npm run verify`: passed.
