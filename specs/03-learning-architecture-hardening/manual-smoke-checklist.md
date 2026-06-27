# Stage 03 Manual Obsidian Smoke Checklist

Status: pending user confirmation
Date:
Tester:
Vault: `D:\claudian\ai-tutor-test-vault`
Plugin dir: `D:\claudian\ai-tutor-test-vault\.obsidian\plugins\claudian-ai-tutor`

Before testing:

- Run `npm run build`.
- Copy `main.js`, `styles.css`, and `manifest.json` into the plugin dir.
- Run `npm run learning:verify-test-vault` and confirm it passes.
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

Result:

- [ ] Pass
- [ ] Fail

Notes / regressions:

