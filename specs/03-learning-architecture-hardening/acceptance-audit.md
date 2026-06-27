# Stage 03 Acceptance Audit

Updated: 2026-06-27
Branch: `codex/learning-tutor-fork`

## Result

Stage 03 automated acceptance is complete. Full completion is still pending AC9: real Obsidian manual smoke in `ai-tutor-smoke-vault`, followed by `npm run learning:verify-manual-smoke -- --vault ai-tutor-smoke-vault`.

## Acceptance Criteria Matrix

| AC | Requirement | Status | Current evidence |
| --- | --- | --- | --- |
| 1 | Learning feature has only `domain/ application/ ports/ adapters/ views/`; dependencies point inward. | Pass | `Get-ChildItem -Directory src/features/learning` reports only the five expected folders. `npm run depcruise` passed with 0 violations across 411 modules / 1187 dependencies. |
| 2 | Learning `obsidian` imports are limited to adapters/views; domain/application/ports have none. | Pass | `npm run learning:baseline` reports learning Obsidian imports only in `adapters/ObsidianLayoutAdapter.ts`, `adapters/ObsidianNoticeAdapter.ts`, `adapters/ObsidianVaultAdapter.ts`, and the three `views/*.ts` files. `npm run learning:architecture-audit` enforces this. |
| 3 | State changes are produced by `domain/LearningStateMachine`; persistence goes through `application/StateTransitionService`; system events use the same path. | Pass | `npm run learning:baseline` reports the real `.saveCourse()` call site only in `application/StateTransitionService.ts`. `npm run learning:architecture-audit` additionally blocks course-index mutations outside `IndexRepository` and production `applyToState()` calls outside the compatibility boundary. |
| 4 | `LearningController` is a thin facade/composition root; responsibilities moved to coordinators/read model. | Pass | `npm run learning:baseline` reports `src/features/learning/LearningController.ts` at 50 lines. `implementation-status.md` maps responsibilities to `NavigationCoordinator`, `CommandCoordinator`, `TurnCoordinator`, `LearningReadModel`, `SourceLoader`, `LessonProgression`, `SummaryService`, `StateTransitionService`, and `IndexRepository`. |
| 5 | `InputController` learning logic is thin hooks, not learning orchestration. | Pass with structural evidence | `InputController.ts` references learning only through the facade/bridge hooks: command interception, assistant completion bridge, and turn decoration. Learning completion logic is in `learning/adapters/LearningInputBridge`; orchestration is in learning application coordinators. |
| 6 | `.dependency-cruiser.cjs` exists, forbidden rules are error-level, `npm run depcruise` has 0 violations. | Pass | `npm run depcruise` passed with 0 violations. `npm run verify` includes architecture audit, depcruise, typecheck, full Jest, and build. |
| 7 | Domain/application tests run without importing Obsidian, using fake ports/adapters. | Pass | `tests/unit/features/learning/learningCore.test.ts` covers domain/application flows with fake/file adapters and is included in full Jest. Architecture audit and depcruise prevent domain/application Obsidian imports. |
| 8 | Existing learning Jest plus full `npm test`, `typecheck`, and `build` all pass. | Pass | `npm run verify` passed: learning architecture audit, depcruise, typecheck, 245 Jest suites / 5853 tests, and build. |
| 9 | Zero behavior regression proven by real Obsidian smoke: new course -> intake -> plan chapter -> write note -> continue section -> Start new lesson -> restart restore. | Pending | `npm run learning:smoke-ready -- --fresh` passed and prepared `ai-tutor-smoke-vault` with the plugin enabled and no existing courses. The real Obsidian smoke has not been confirmed yet. |

## Remaining Gate

1. Run `npm run learning:smoke-ready -- --fresh`.
2. Open `D:\claudian\ai-tutor-smoke-vault` in Obsidian.
3. Complete `manual-smoke-checklist.md`.
4. Run `npm run learning:verify-manual-smoke -- --vault ai-tutor-smoke-vault`.

Only after step 4 passes should Stage 03 be marked fully complete.
