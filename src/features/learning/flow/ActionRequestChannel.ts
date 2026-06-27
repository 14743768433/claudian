import type { LearningAction } from '../state/types';

export interface ParsedActionRequest {
  action: LearningAction;
  raw: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTitledArray(value: unknown): Array<{ id?: string; title: string }> | null {
  if (!Array.isArray(value)) return null;
  const result: Array<{ id?: string; title: string }> = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) {
      result.push({ title: item.trim() });
      continue;
    }
    if (!isRecord(item) || typeof item.title !== 'string' || item.title.trim().length === 0) {
      return null;
    }
    result.push({
      id: typeof item.id === 'string' ? item.id : undefined,
      title: item.title,
    });
  }
  return result;
}

function asPlanSources(value: unknown): Array<string | { text?: string; cardId?: string; path?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources: Array<string | { text?: string; cardId?: string; path?: string }> = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      sources.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    const source = {
      text: typeof item.text === 'string' ? item.text : undefined,
      cardId: typeof item.cardId === 'string' ? item.cardId : undefined,
      path: typeof item.path === 'string' ? item.path : undefined,
    };
    if (source.text || source.cardId || source.path) {
      sources.push(source);
    }
  }
  return sources.length > 0 ? sources : undefined;
}

function asPlanSections(value: unknown): Extract<LearningAction, { type: 'planChapter' }>['sections'] | null {
  const titled = asTitledArray(value);
  if (!titled || !Array.isArray(value)) return null;
  return titled.map((section, index) => {
    const raw = value[index];
    if (!isRecord(raw)) return section;
    return {
      ...section,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      bulletPoints: Array.isArray(raw.bulletPoints)
        ? raw.bulletPoints.filter((point): point is string => typeof point === 'string')
        : undefined,
      sources: asPlanSources(raw.sources),
    };
  });
}

const LEARNING_ACTION_TYPES = new Set([
  'generateSyllabus',
  'planChapter',
  'sectionNoteWritten',
  'advanceSection',
  'startNewLesson',
]);

function normalizeActionRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !LEARNING_ACTION_TYPES.has(value.type)) {
    return null;
  }

  if (isRecord(value.data)) {
    return {
      ...value.data,
      type: value.type,
    };
  }

  return value;
}

function coerceAction(value: unknown): LearningAction | null {
  const normalized = normalizeActionRecord(value);
  if (!normalized || typeof normalized.type !== 'string') return null;

  switch (normalized.type) {
    case 'generateSyllabus': {
      const topics = asTitledArray(normalized.topics);
      if (!topics) return null;
      return {
        type: 'generateSyllabus',
        topics: topics.map((topic, index) => {
          const raw = Array.isArray(normalized.topics) ? normalized.topics[index] : {};
          return {
            ...topic,
            sourcePaths: isRecord(raw) && Array.isArray(raw.sourcePaths)
              ? raw.sourcePaths.filter((entry): entry is string => typeof entry === 'string')
              : undefined,
            summary: isRecord(raw) && typeof raw.summary === 'string' ? raw.summary : undefined,
          };
        }),
      };
    }
    case 'planChapter': {
      const title = typeof normalized.title === 'string'
        ? normalized.title
        : typeof normalized.chapterTitle === 'string'
          ? normalized.chapterTitle
          : null;
      if (!title) return null;
      const sections = asPlanSections(normalized.sections);
      if (!sections) return null;
      return {
        type: 'planChapter',
        title,
        overview: typeof normalized.overview === 'string'
          ? normalized.overview
          : typeof normalized.chapterDescription === 'string'
            ? normalized.chapterDescription
            : undefined,
        sections,
        nextLessonSummary: typeof normalized.nextLessonSummary === 'string' ? normalized.nextLessonSummary : undefined,
        lessonId: typeof normalized.lessonId === 'string' ? normalized.lessonId : undefined,
        chapterNumber: typeof normalized.chapterNumber === 'number' ? normalized.chapterNumber : undefined,
        conversationId: typeof normalized.conversationId === 'string' ? normalized.conversationId : undefined,
      };
    }
    case 'sectionNoteWritten':
      if (typeof normalized.notePath !== 'string') return null;
      return {
        type: 'sectionNoteWritten',
        sectionId: typeof normalized.sectionId === 'string' ? normalized.sectionId : undefined,
        notePath: normalized.notePath,
        noteTitle: typeof normalized.noteTitle === 'string' ? normalized.noteTitle : undefined,
      };
    case 'advanceSection':
      return {
        type: 'advanceSection',
        sectionId: typeof normalized.sectionId === 'string' ? normalized.sectionId : undefined,
      };
    case 'startNewLesson': {
      const sections = normalized.sections === undefined ? undefined : asTitledArray(normalized.sections);
      if (normalized.sections !== undefined && !sections) return null;
      return {
        type: 'startNewLesson',
        title: typeof normalized.title === 'string'
          ? normalized.title
          : typeof normalized.chapterTitle === 'string'
            ? normalized.chapterTitle
            : undefined,
        conversationId: typeof normalized.conversationId === 'string' ? normalized.conversationId : undefined,
        coveredSummary: typeof normalized.coveredSummary === 'string'
          ? normalized.coveredSummary
          : typeof normalized.chapterDescription === 'string'
            ? normalized.chapterDescription
            : undefined,
        sections: sections ?? undefined,
        force: normalized.force === true,
      };
    }
    default:
      return null;
  }
}

export class ActionRequestChannel {
  private readonly fencePattern = /```([^\n`]*)\r?\n([\s\S]*?)```/g;

  parse(content: string): ParsedActionRequest[] {
    const requests: ParsedActionRequest[] = [];
    for (const match of content.matchAll(this.fencePattern)) {
      const language = match[1].trim().toLowerCase().split(/\s+/)[0] ?? '';
      if (!this.isCandidateFenceLanguage(language)) continue;
      const raw = match[2].trim();
      try {
        const parsed = JSON.parse(raw) as unknown;
        const values = Array.isArray(parsed) ? parsed : [parsed];
        for (const value of values) {
          const action = coerceAction(value);
          if (action) {
            requests.push({ action, raw });
          }
        }
      } catch {
        // Invalid action blocks are ignored here; the controller reports when no typed action was parsed.
      }
    }
    return requests;
  }

  private isCandidateFenceLanguage(language: string): boolean {
    return language === 'ai-tutor-action'
      || language === 'ai'
      || language === 'json'
      || language === '';
  }
}
