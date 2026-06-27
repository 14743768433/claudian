export type TransformationId = 'lesson-page' | 'quiz' | 'review' | 'concept-card';

export interface TransformationTemplate {
  id: TransformationId;
  title: string;
  body: string;
}

const LESSON_PAGE_TEMPLATE = `# Lesson Page Generation Skill

Use this when generating or revising an AI Tutor lesson note page.

Goal:
Produce one lesson-part note that feels like a patient technical tutor, not a generic AI summary. The page must help the learner understand one bounded slice of the current LessonSession.

Required inputs:
- LessonSession and current section.
- Current course context and previous summaries.
- Any source snippets supplied in the prompt.

Context rules:
- Use only the supplied course context and source snippets as grounding.
- Prefer the previous lesson summary over raw previous chat.
- When source snippets are supplied, cite them inline as [1], [2], etc. and end with source lines in the exact form [Source block] [1] title/path: short paraphrase.

Page shape:
1. Open with a concrete scene, problem, or question.
2. Explain why this part matters before defining terms.
3. Build the concept step by step and make causal links explicit: why the step exists, what can go wrong, and what should be logged, checked, or remembered.
4. Include two complementary visual or structured aids that each earn their place, usually a mental-model aid plus something concrete to inspect.
5. Add a short practical application or check-your-understanding exercise.
6. End with a review bridge and next-step transition.

Quality bar:
- Include at least one vivid analogy that explains the concept, not decoration.
- Include at least one memorable, sharp sentence the learner could repeat in an interview.
- Prefer concrete numbers, code/file names, and examples over vague intensifiers.
- When source snippets are supplied, cite them inline and include source lines.
- Avoid outline-only pages, dictionary openings, generic AI transitions, and mechanically symmetric paragraphs.
- Minimum release bar: narrativeDepth, structureClarity, visualAids, practicality, explanationDepth, assessmentLoop, sourceGrounding, and voiceSharpness should all be strong.`;

const QUIZ_TEMPLATE = `# Quiz Generation Transformation

Generate one end-of-lesson quiz from already covered material only.

Output Markdown only. Include 4-6 questions mixing single-choice, short-answer, and one applied troubleshooting question. Every question must map to covered material. End with an answer key and a short remediation note for each answer.`;

const REVIEW_TEMPLATE = `# Review Generation Transformation

Generate one review page that closes the current lesson and prepares the next one.

Output Markdown only. Start with the core capability the learner should now have, summarize the lesson in 3-5 sharp sections, include "Check Yourself", and include "What to review next" when next lesson context is available.`;

const CONCEPT_CARD_TEMPLATE = `# Concept Card Transformation

Generate one compact concept note for a single technical idea.

Output Markdown only. Use one H1 with the concept name. Include a plain-language definition, why it matters, how it appears in this course, common confusion, and a tiny self-check. Prefer one strong analogy over a long list.`;

export class TransformationRegistry {
  private readonly templates = new Map<TransformationId, TransformationTemplate>([
    ['lesson-page', { id: 'lesson-page', title: 'Lesson Page', body: LESSON_PAGE_TEMPLATE }],
    ['quiz', { id: 'quiz', title: 'Quiz', body: QUIZ_TEMPLATE }],
    ['review', { id: 'review', title: 'Review', body: REVIEW_TEMPLATE }],
    ['concept-card', { id: 'concept-card', title: 'Concept Card', body: CONCEPT_CARD_TEMPLATE }],
  ]);

  get(id: TransformationId): TransformationTemplate {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Unknown transformation template: ${id}`);
    }
    return template;
  }

  list(): TransformationTemplate[] {
    return Array.from(this.templates.values());
  }
}
