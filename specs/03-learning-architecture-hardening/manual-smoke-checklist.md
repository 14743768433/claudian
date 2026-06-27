# Stage 03 Manual Obsidian Smoke Checklist

Status: pending user confirmation
Date:
Tester:
Vault: `D:\claudian\ai-tutor-test-vault`
Plugin dir: `D:\claudian\ai-tutor-test-vault\.obsidian\plugins\claudian-ai-tutor`

Before testing:

- Run `npm run learning:smoke-ready`; this runs `verify`, deploys the current build to the test vault, verifies deployed hashes, and prints existing course IDs.
- In Obsidian, reload or re-enable the AI Tutor plugin.

Core smoke:

- [ ] Open AI Tutor from the Obsidian ribbon/command.
- [ ] Create a new course from the course library.
- [ ] Confirm the course appears in the library and left chapter list.
- [ ] Confirm intake conversation is not blank and starts working.
- [ ] Accept or trigger a syllabus/chapter plan.
- [ ] Confirm chapter plan creates a chapter conversation and begins first-section work.
- [ ] Generate a section note and confirm it appears in the right artifacts pane.
- [ ] Continue to the next section and confirm the same chapter conversation is reused.
- [ ] Finish the chapter and trigger Start new lesson.
- [ ] Confirm a new chapter conversation is opened and starts planning/working instead of staying blank.
- [ ] Restart Obsidian.
- [ ] Confirm the course library, current lesson, chapter list, and artifacts restore from persisted state.

Post-smoke persistence check:

- If needed, run `npm run learning:verify-manual-smoke -- --list` to find the tested `courseId`.
- Run `npm run learning:verify-manual-smoke`.
- If the tested course is not the newest course in `data.json`, run `npm run learning:verify-manual-smoke -- --course-id <courseId>`.
- Confirm the script reports:
  - one active current lesson after Start new lesson,
  - an ended prior chapter with a covered section note,
  - the current lesson conversation metadata exists,
  - plugin `data.json` and course `.ai-tutor/course-state.json` agree.

Result:

- [ ] Pass
- [ ] Fail

Notes / regressions:
