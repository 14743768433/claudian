import type { ChatTurnRequest } from '../../../core/runtime/types';
import { TransformationRegistry } from '../content/TransformationRegistry';
import type { CourseState, LearningTurnMode, LessonSession, Section } from '../state/types';

export interface LearningTurnContext {
  course: CourseState;
  lesson: LessonSession;
  conversationMessageCount: number;
  request: ChatTurnRequest;
  forceLessonPageTemplate?: boolean;
  selectedTurnMode?: LearningTurnMode;
}

function currentSection(lesson: LessonSession): Section | null {
  return lesson.sections[lesson.currentSectionIndex] ?? null;
}

function compactSections(lesson: LessonSession): string {
  if (lesson.sections.length === 0) return 'No sections planned yet.';
  return lesson.sections
    .map((section, index) => {
      const marker = index === lesson.currentSectionIndex ? 'current' : section.status;
      const note = section.notePath ? ` note="${section.notePath}"` : '';
      return `- [${marker}] ${section.id}: ${section.title}${note}`;
    })
    .join('\n');
}

function tutorMode(course: CourseState): string {
  if (course.machineState === 'chapterPlanning') return 'Teach: plan this chapter; the plugin will start section 1 after the plan is accepted';
  if (course.machineState === 'teaching') return 'Teach: tutor the current section';
  if (course.machineState === 'chapterEnded') return 'Review: summarize and wait for next lesson';
  if (course.machineState === 'intake') return 'Intake: interview the learner and shape the course map';
  return `Teach: ${course.machineState}`;
}

function modeInstruction(mode: LearningTurnMode): string {
  switch (mode) {
    case 'ask':
      return 'Ask mode: answer the learner question directly, cite course context when useful, and do not advance course state unless explicitly needed.';
    case 'transform':
      return 'Transform mode: create or revise a durable artifact using the appropriate template; persist progress only through valid action blocks.';
    case 'teach':
    default:
      return 'Teach mode: tutor the current chapter/section, keep continuity, and offer concrete next learning moves.';
  }
}

function shouldInjectLessonTemplate(request: ChatTurnRequest, force?: boolean): boolean {
  if (force) return true;
  return /(生成|写|create|draft|write).*(节笔记|lesson note|lesson page|note)/i.test(request.text);
}

export class LearningContextInjector {
  constructor(private readonly registry = new TransformationRegistry()) {}

  build(context: LearningTurnContext): string {
    const full = context.conversationMessageCount <= 2;
    const section = currentSection(context.lesson);
    const syllabus = context.course.syllabus
      .map((topic) => `${topic.order}. ${topic.title}${topic.summary ? ` - ${topic.summary}` : ''}`)
      .join('\n') || 'No syllabus generated yet.';

    const header = full
      ? `<course_context mode="full" courseId="${context.course.courseId}">`
      : `<course_context mode="pointer" courseId="${context.course.courseId}">`;

    const lines = [
      header,
      `Course: ${context.course.title}`,
      `Goal: ${context.course.goalTitle}`,
      `Machine state: ${context.course.machineState}`,
      `Tutor mode: ${tutorMode(context.course)}`,
      `Selected turn mode: ${context.selectedTurnMode ?? 'teach'}`,
      `Selected mode instruction: ${modeInstruction(context.selectedTurnMode ?? 'teach')}`,
      `Current chapter: ${context.lesson.chapterNumber} - ${context.lesson.title}`,
      `Current section: ${section ? `${section.id} - ${section.title} (${section.status})` : 'none'}`,
      '',
      'Tutor rhythm:',
      '- State your current position in the course before teaching.',
      '- If chapterPlanning, propose 3-6 concrete sections and emit planChapter; include title, overview, sections with title/description/bulletPoints/sources, and nextLessonSummary. Do not pretend the plan is saved before the action is accepted.',
      '- If teaching, explain the current section and offer 2-4 options in an ai-tutor-next-options JSON block.',
      '- If asked to write a note, use the lesson-page template and emit sectionNoteWritten only after the file is written.',
      '',
      'Sections:',
      compactSections(context.lesson),
    ];

    if (full) {
      lines.push('', 'Syllabus:', syllabus);
      const previousSummary = context.course.lessons
        .filter((lesson) => lesson.coveredSummary)
        .map((lesson) => `- ${lesson.title}: ${lesson.coveredSummary}`)
        .join('\n');
      if (previousSummary) {
        lines.push('', 'Previous chapter summaries:', previousSummary);
      }
    }

    lines.push('</course_context>');

    if (shouldInjectLessonTemplate(context.request, context.forceLessonPageTemplate)) {
      lines.push('', '<lesson_page_template>', this.registry.get('lesson-page').body, '</lesson_page_template>');
    }

    return lines.join('\n');
  }

  decorateRequest(context: LearningTurnContext): ChatTurnRequest {
    const injection = this.build(context);
    return {
      ...context.request,
      text: `${injection}\n\n${context.request.text}`,
    };
  }
}
