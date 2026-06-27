# Stage 03 Baseline Snapshot

Generated: 2026-06-27T12:07:07.063Z
Branch: codex/learning-tutor-fork
Commit: 12881b0

## Line Counts

| File | Lines |
| --- | ---: |
| src/features/learning/LearningController.ts | 1898 |
| src/features/chat/controllers/InputController.ts | 1846 |

## saveCourse Call Sites

- src/features/learning/flow/LearningStateMachine.ts:49 - `await this.stateService.saveCourse(state);`
- src/features/learning/LearningController.ts:784 - `await this.stateService.saveCourse(course);`
- src/features/learning/LearningController.ts:1541 - `await this.stateService.saveCourse(course);`
- src/features/learning/state/LearningStateService.ts:154 - `await this.saveCourse(state, { preserveUpdatedAt: true });`
- src/features/learning/state/LearningStateService.ts:198 - `async saveCourse(state: CourseState, options?: { preserveUpdatedAt?: boolean }): Promise<void> {`
- src/features/learning/state/LearningStateService.ts:239 - `await this.saveCourse(state);`
- src/features/learning/state/LearningStateService.ts:271 - `await this.saveCourse(course);`
- src/features/learning/state/LearningStateService.ts:294 - `await this.saveCourse(course);`

## Obsidian Imports In Learning Feature

- src/features/learning/flow/LessonProgression.ts:1 - `import { Notice } from 'obsidian';`
- src/features/learning/LearningController.ts:1 - `import { Notice, TFile, type WorkspaceLeaf } from 'obsidian';`
- src/features/learning/views/ChapterListView.ts:1 - `import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';`
- src/features/learning/views/CourseArtifactsView.ts:1 - `import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';`
- src/features/learning/views/CourseLibraryView.ts:1 - `import { ItemView, Modal, Notice, Setting, type WorkspaceLeaf } from 'obsidian';`

## dependency-cruiser Probe

Command: `npm run depcruise -- --output-type err`

Result at baseline: 0 errors, 1 warning.

- `learning-only-adapters-views-controller-import-obsidian`: `src/features/learning/flow/LessonProgression.ts -> obsidian`

This confirms the Obsidian bare-module match is `^obsidian$`. Rules start as warnings in Phase 0 and must become errors with 0 violations by Phase 5.
