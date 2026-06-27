# Lesson Page Generation Skill

Use this skill when generating or revising an AI Tutor lesson note page.

## Goal

Produce one lesson-part note that feels like a patient technical tutor, not a generic AI summary. The page must help the learner understand one bounded slice of the current `LessonSession`.

## Required Inputs

- `LessonSession`
- `ContextEnvelope`
- Current `LessonPart`
- Course display title
- Any source snippets supplied inside the `ContextEnvelope`

## Context Rules

- Use only the current `ContextEnvelope` as grounding.
- Do not infer or include unrelated course topics that are not in `courseMapSlice`.
- Prefer the previous lesson summary over raw previous chat.
- Treat source snippets as citeable context; do not invent citations.
- When source snippets are supplied, cite them inline as `[1]`, `[2]`, etc. and end the page with machine-readable source lines in the exact form `[Source block] [1] title/path: short paraphrase`.
- Keep display title and file slug separate. Use the slug only for file naming metadata outside the Markdown body; do not print `slug`, `file name`, or course metadata as visible lesson text unless the user explicitly asks.

## Page Shape

1. Open with a concrete scene, problem, or question.
2. Explain why this part matters before defining terms.
3. Build the concept step by step in prose, and make the causal links explicit: why the step exists, because what can go wrong, therefore what should be logged or checked.
4. Include **two complementary** visual/structured aids that each earn their place — typically a mental-model aid (Mermaid flow or table) plus something concrete to inspect (a code/log/config block). Do NOT mechanically stuff every page with all of mermaid + table + code; a third aid is only worth adding when it shows something the first two cannot. A purely conceptual page may use two well-chosen aids and no code at all.
5. Add a short practical application or check-your-understanding exercise.
6. End with a review bridge and next-step transition.

## Voice & Sharpness (what separates a tutor from a summary)

A page must be **memorable**, not merely correct and tidy. Aim for at least one line the learner could repeat verbatim in an interview.

- Land **at least one vivid analogy** that makes an abstract idea physical (e.g. 标准托盘 / 录音棚 / 把大象装进冰箱). The analogy should do explanatory work, not decorate.
- Include **at least one "sharp" line** — a punchy contrast or memorable claim grounded in the domain (e.g. "回答 random_split 你是学生，回答代表性样本筛选你是工程师").
- Use **concrete, specific figures** (24-bit、50kSPS、200 校准样本、连续 5 帧) instead of vague intensifiers like "很重要 / 非常关键".
- Vary sentence rhythm and acknowledge the learner's anxiety where natural. Do not fall into a mechanically symmetric "为什么…因为…因此…" mold on every paragraph — that reads as a template, not a voice.

## Quality Rubric

Score each page on eight dimensions, 0-10:

- Narrative depth: enough prose, concrete transitions, no outline-only page.
- Structure clarity: headings are useful and not decorative.
- Visual aids: two complementary aids that each earn their place (a mental model + something concrete). Two strong aids beats three perfunctory ones; do not stuff every page with mermaid + table + code by reflex.
- Practicality: the learner can try or inspect something.
- Explanation depth: explains why and how, not only what. Use explicit causal language such as `为什么`, `因为`, `因此`, `所以`, `本质`, `原因`, or equivalent English markers when making engineering tradeoffs.
- Assessment loop: review/check questions are present.
- Source grounding: source snippets and citations are used when provided.
- Voice & sharpness: at least one vivid analogy and one memorable/quotable line; concrete figures over vague intensifiers; human rhythm rather than mechanical symmetry. Generic AI connectives (首先/其次/综上所述/众所周知) and template-feel lower this score.

Minimum acceptable overall score: 6.5. For release candidates, each page should score at least 8.0 overall, average at least 8.5 across candidates, and no dimension should fall below 6.5. Pages below threshold must be revised before being treated as final.

## Avoid

- A page made mostly of bullet points.
- Starting with dictionary-style definitions.
- Mentioning every course topic just because it exists.
- Hiding uncertainty when no source snippet supports a claim.
- Ending with informal source notes that omit `[Source block]`; the verifier will treat those as ungrounded.
- Using only one visual aid for an engineering lesson; the page should give both a mental model and something concrete to inspect.
- Reflexively stuffing every page with mermaid + table + code when two aids already carry the point — padding is not depth.
- A page with no analogy and no memorable line; correct-but-forgettable prose fails the voice bar even if every other dimension passes.
- Mechanically symmetric paragraphs (every one shaped 为什么…因为…因此); vary the rhythm.
- Listing pipeline steps without explaining the reason behind each boundary; every major interface should include a short cause/effect explanation.
- Blocking the text on image generation; use `image://pending/{id}` when needed.
