import { LearningContextInjector } from '@/features/learning/context/LearningContextInjector';
import { ContentQualityGate } from '@/features/learning/content/ContentQualityGate';
import { LearningController } from '@/features/learning/LearningController';
import { ActionRequestChannel } from '@/features/learning/flow/ActionRequestChannel';
import { LearningStateMachine } from '@/features/learning/flow/LearningStateMachine';
import { LearningStateMachine as DomainLearningStateMachine } from '@/features/learning/domain/LearningStateMachine';
import { SummaryService } from '@/features/learning/flow/SummaryService';
import { learningAppendix } from '@/features/learning/prompt/learningAppendix';
import { LearningPluginIndex } from '@/features/learning/state/LearningPluginIndex';
import { LearningStateService } from '@/features/learning/state/LearningStateService';
import type { ChatMessage } from '@/core/types';
import type { CourseState, LessonSession } from '@/features/learning/state/types';
import { TFile } from 'obsidian';

class MemoryVaultAdapter {
  files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing file: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

function createPluginDataStore(initial: Record<string, unknown> = {}) {
  let data: unknown = initial;
  return {
    plugin: {
      loadData: jest.fn(async () => data),
      saveData: jest.fn(async (next: unknown) => { data = next; }),
    },
    getData: () => data as Record<string, unknown>,
  };
}

function createStateService() {
  const store = createPluginDataStore();
  const index = new LearningPluginIndex(store.plugin);
  const adapter = new MemoryVaultAdapter();
  const service = new LearningStateService(adapter as any, index);
  return { adapter, index, service, store };
}

describe('LearningPluginIndex', () => {
  it('roundtrips course index entries through plugin data', async () => {
    const store = createPluginDataStore();
    const index = new LearningPluginIndex(store.plugin);

    await index.upsertCourse({
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Learn signals',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: 'lesson-1',
      updatedAt: 10,
    });

    await expect(index.listCourses()).resolves.toEqual([
      expect.objectContaining({ courseId: 'course-1', title: 'Signals' }),
    ]);
    expect(store.getData().learning).toBeDefined();
  });

  it('deduplicates course index entries by normalized root path', async () => {
    const store = createPluginDataStore({
      learning: {
        courses: [
          {
            courseId: 'course-old',
            title: 'Old Reading',
            goalTitle: 'Read better',
            rootPath: 'AI Tutor\\Courses\\reading\\',
            currentLessonId: 'lesson-intake',
            updatedAt: 5,
          },
          {
            courseId: 'course-other',
            title: 'Signals',
            goalTitle: 'Learn signals',
            rootPath: 'AI Tutor/Courses/signals',
            currentLessonId: 'lesson-intake',
            updatedAt: 6,
          },
        ],
      },
    });
    const index = new LearningPluginIndex(store.plugin);

    await index.upsertCourse({
      courseId: 'course-new',
      title: 'Reading',
      goalTitle: 'Read better',
      rootPath: 'AI Tutor/Courses/reading',
      currentLessonId: 'lesson-intake',
      updatedAt: 10,
    });

    await expect(index.listCourses()).resolves.toEqual([
      expect.objectContaining({ courseId: 'course-new', rootPath: 'AI Tutor/Courses/reading' }),
      expect.objectContaining({ courseId: 'course-other' }),
    ]);
  });
});

describe('LearningStateService', () => {
  it('creates, saves, and reloads a course state from course-state.json', async () => {
    const { service, adapter } = createStateService();

    const created = await service.createCourse({
      title: 'Signals',
      goalTitle: 'Understand filters',
      intakeConversationId: 'conv-intake',
      now: 100,
    });

    const savedPath = service.getCourseStatePath(created.rootPath);
    expect(adapter.files.has(savedPath)).toBe(true);

    const loaded = await service.loadCourse(created.courseId, created.rootPath);
    expect(loaded).toEqual(expect.objectContaining({
      courseId: created.courseId,
      currentLessonId: 'lesson-intake',
      machineState: 'intake',
    }));
  });

  it('loads the most recently indexed recoverable course as current', async () => {
    const { service } = createStateService();

    await service.createCourse({
      title: 'Signals',
      goalTitle: 'Understand filters',
      intakeConversationId: 'conv-signals',
      now: 100,
    });
    const latest = await service.createCourse({
      title: 'Control',
      goalTitle: 'Understand feedback',
      intakeConversationId: 'conv-control',
      now: 200,
    });

    await expect(service.loadCurrentCourse()).resolves.toEqual(expect.objectContaining({
      courseId: latest.courseId,
      title: 'Control',
    }));
  });

  it('returns null for missing or invalid course JSON', async () => {
    const { service, adapter } = createStateService();
    adapter.files.set('Bad/.ai-tutor/course-state.json', '{not json');

    await expect(service.loadCourse('course-missing', 'Missing')).resolves.toBeNull();
    await expect(service.loadCourse('course-bad', 'Bad')).resolves.toBeNull();
  });

  it('returns null for course JSON that fails lesson schema validation', async () => {
    const { service, adapter } = createStateService();
    const created = await service.createCourse({
      title: 'Signals',
      goalTitle: 'Understand filters',
      intakeConversationId: 'conv-intake',
      now: 100,
    });
    const savedPath = service.getCourseStatePath(created.rootPath);
    const invalid = {
      ...created,
      lessons: [{ ...created.lessons[0], conversationId: 42 }],
    };
    adapter.files.set(savedPath, JSON.stringify(invalid));

    await expect(service.loadCourse(created.courseId, created.rootPath)).resolves.toBeNull();
  });

  it('replaces a missing conversation mapping', async () => {
    const { service } = createStateService();
    const course = await service.createCourse({
      title: 'Signals',
      goalTitle: 'Understand filters',
      intakeConversationId: 'conv-old',
      now: 100,
    });

    const updated = await service.replaceConversationForLesson(course.courseId, 'lesson-intake', 'conv-new');
    expect(updated?.lessons[0].conversationId).toBe('conv-new');
  });
});

describe('ActionRequestChannel', () => {
  it('parses typed ai-tutor-action fences', () => {
    const channel = new ActionRequestChannel();
    const parsed = channel.parse([
      'done',
      '```ai-tutor-action',
      '{"type":"advanceSection"}',
      '```',
    ].join('\n'));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].action).toEqual({ type: 'advanceSection', sectionId: undefined });
  });

  it('preserves rich planChapter display fields for lesson-plan UI', () => {
    const channel = new ActionRequestChannel();
    const parsed = channel.parse([
      '```ai-tutor-action',
      JSON.stringify({
        type: 'planChapter',
        title: 'Filters',
        overview: 'Build intuition before formulas.',
        nextLessonSummary: 'Next we will move into sampling.',
        sections: [{
          id: 's1',
          title: 'Low-pass intuition',
          description: 'Understand what low-pass filters keep and remove.',
          bulletPoints: ['Cut high-frequency noise', 'Keep slow signal trend'],
          sources: [{ text: 'Filter notes', cardId: 'card-1' }],
        }],
      }),
      '```',
    ].join('\n'));

    expect(parsed[0].action).toEqual(expect.objectContaining({
      type: 'planChapter',
      overview: 'Build intuition before formulas.',
      nextLessonSummary: 'Next we will move into sampling.',
      sections: [expect.objectContaining({
        title: 'Low-pass intuition',
        description: 'Understand what low-pass filters keep and remove.',
        bulletPoints: ['Cut high-frequency noise', 'Keep slow signal trend'],
        sources: [{ text: 'Filter notes', cardId: 'card-1', path: undefined }],
      })],
    }));
  });

  it('parses wrapped planChapter JSON from generic ai fences', () => {
    const channel = new ActionRequestChannel();
    const parsed = channel.parse([
      '```ai',
      JSON.stringify({
        type: 'planChapter',
        data: {
          title: '在AI时代高效阅读',
          overview: '先建立阅读决策框架。',
          sections: [
            { title: 'AI时代为什么还要读书？' },
            { title: '如何快速判断一本书是否值得读？' },
          ],
          nextLessonSummary: '下一章进入实践。',
        },
      }),
      '```',
    ].join('\n'));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].action).toEqual(expect.objectContaining({
      type: 'planChapter',
      title: '在AI时代高效阅读',
      overview: '先建立阅读决策框架。',
      sections: [
        { title: 'AI时代为什么还要读书？', id: undefined, description: undefined, bulletPoints: undefined, sources: undefined },
        { title: '如何快速判断一本书是否值得读？', id: undefined, description: undefined, bulletPoints: undefined, sources: undefined },
      ],
      nextLessonSummary: '下一章进入实践。',
    }));
  });

  it('accepts legacy chapter action fields and string section lists', () => {
    const channel = new ActionRequestChannel();
    const parsed = channel.parse([
      '```ai-tutor-action',
      JSON.stringify({
        type: 'startNewLesson',
        chapterTitle: '基础建立与循序渐进',
        chapterDescription: '第3-8周：从短跑走进持续跑。',
        sections: ['了解你的跑步配速区间', '从慢走到轻跑的渐进式训练'],
      }),
      '```',
    ].join('\n'));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].action).toEqual({
      type: 'startNewLesson',
      title: '基础建立与循序渐进',
      conversationId: undefined,
      coveredSummary: '第3-8周：从短跑走进持续跑。',
      sections: [
        { title: '了解你的跑步配速区间' },
        { title: '从慢走到轻跑的渐进式训练' },
      ],
      force: false,
    });
  });
});

describe('LearningStateMachine', () => {
  it('keeps the domain reducer pure by returning a next state', async () => {
    const { service } = createStateService();
    const course = await service.createCourse({
      title: 'Signals',
      goalTitle: 'Understand filters',
      intakeConversationId: 'conv-intake',
      now: 100,
    });
    const before = JSON.stringify(course);
    const machine = new DomainLearningStateMachine();

    const result = machine.reduce(course, {
      type: 'generateSyllabus',
      topics: [{ title: 'Filters' }],
    });

    expect(result.ok).toBe(true);
    expect(result.nextState?.machineState).toBe('chapterPlanning');
    expect(course.machineState).toBe('intake');
    expect(JSON.stringify(course)).toBe(before);
  });

  it('rejects advancing before the current section note is written', async () => {
    const { service } = createStateService();
    const course = await service.createCourse({
      title: 'Signals',
      goalTitle: 'Understand filters',
      intakeConversationId: 'conv-intake',
      now: 100,
    });
    const machine = new LearningStateMachine(service);

    await machine.applyAction(course.courseId, {
      type: 'planChapter',
      title: 'Filters',
      sections: [{ title: 'Low-pass intuition' }],
      conversationId: 'conv-1',
    });

    const result = await machine.applyAction(course.courseId, { type: 'advanceSection' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/note must be written/i);
  });

  it('moves through noteWritten, advanceSection, and startNewLesson safely', async () => {
    const { service } = createStateService();
    const course = await service.createCourse({
      title: 'Signals',
      goalTitle: 'Understand filters',
      intakeConversationId: 'conv-intake',
      now: 100,
    });
    const machine = new LearningStateMachine(service);

    await machine.applyAction(course.courseId, {
      type: 'planChapter',
      title: 'Filters',
      sections: [{ id: 's1', title: 'Low-pass intuition' }],
      conversationId: 'conv-1',
    });
    await machine.applyAction(course.courseId, {
      type: 'sectionNoteWritten',
      sectionId: 's1',
      notePath: 'AI Tutor/Courses/signals/low-pass.md',
    });
    const advanced = await machine.applyAction(course.courseId, { type: 'advanceSection' });
    expect(advanced.ok).toBe(true);
    expect(advanced.state?.machineState).toBe('chapterEnded');

    const next = await machine.applyAction(course.courseId, {
      type: 'startNewLesson',
      title: 'Sampling',
      conversationId: 'conv-2',
    });
    expect(next.ok).toBe(true);
    expect(next.state?.currentLessonId).toBe('lesson-2');
  });

  it('allows an explicit forced startNewLesson before every section is covered', async () => {
    const { service } = createStateService();
    const course = await service.createCourse({
      title: 'Signals',
      goalTitle: 'Understand filters',
      intakeConversationId: 'conv-intake',
      now: 100,
    });
    const machine = new LearningStateMachine(service);

    await machine.applyAction(course.courseId, {
      type: 'planChapter',
      title: 'Filters',
      sections: [{ id: 's1', title: 'Low-pass intuition' }],
      conversationId: 'conv-1',
    });

    const rejected = await machine.applyAction(course.courseId, {
      type: 'startNewLesson',
      conversationId: 'conv-2',
    });
    expect(rejected.ok).toBe(false);

    const forced = await machine.applyAction(course.courseId, {
      type: 'startNewLesson',
      conversationId: 'conv-2',
      force: true,
    });

    expect(forced.ok).toBe(true);
    expect(forced.state?.currentLessonId).toBe('lesson-2');
    expect(forced.state?.lessons.find((lesson) => lesson.lessonId === 'lesson-2')).toEqual(expect.objectContaining({
      conversationId: 'conv-2',
      previousLessonId: 'lesson-1',
    }));
  });
});

describe('SummaryService', () => {
  function makeLesson(): LessonSession {
    return {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [{ id: 's1', title: 'Low-pass intuition', status: 'noteWritten', notePath: 'filters.md' }],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
  }

  function makeMessage(role: ChatMessage['role'], content: string, id: string): ChatMessage {
    return { id, role, content, timestamp: 1 };
  }

  it('uses the title-generation auxiliary service to add a summary focus', async () => {
    const messages = [
      makeMessage('user', 'Explain low-pass filters.', 'm1'),
      makeMessage('assistant', 'We covered cutoff frequency, 50 Hz noise, and why smoothing preserves slow change.', 'm2'),
    ];
    const plugin = {
      getConversationById: jest.fn(async () => ({ messages })),
    };
    const titleService = {
      generateTitle: jest.fn(async (conversationId, userMessage, callback) => {
        expect(conversationId).toBe('ai-tutor-summary:lesson-1');
        expect(userMessage).toContain('Chapter: Filters');
        expect(userMessage).toContain('filters.md');
        await callback(conversationId, { success: true, title: 'Filter intuition handoff' });
      }),
      cancel: jest.fn(),
    };
    const createTitleService = jest.fn(() => titleService);

    const summary = await new SummaryService(plugin as any, createTitleService as any).summarizeLesson(makeLesson());

    expect(createTitleService).toHaveBeenCalledWith(plugin);
    expect(titleService.generateTitle).toHaveBeenCalledTimes(1);
    expect(titleService.cancel).toHaveBeenCalledTimes(1);
    expect(summary).toContain('Summary focus: Filter intuition handoff');
    expect(summary).toContain('cutoff frequency');
  });

  it('falls back to the extracted assistant summary when auxiliary generation fails', async () => {
    const messages = [
      makeMessage('assistant', 'We practiced the section using 3 examples and wrote the first note.', 'm1'),
    ];
    const plugin = {
      getConversationById: jest.fn(async () => ({ messages })),
    };
    const titleService = {
      generateTitle: jest.fn(async (conversationId, _userMessage, callback) => {
        await callback(conversationId, { success: false, error: 'offline' });
      }),
      cancel: jest.fn(),
    };

    const summary = await new SummaryService(plugin as any, (() => titleService) as any).summarizeLesson(makeLesson());

    expect(summary).toBe('We practiced the section using 3 examples and wrote the first note.');
  });

  it('removes protocol fences before saving a lesson handoff summary', async () => {
    const messages = [
      makeMessage('assistant', [
        'We planned the next chapter and wrote the note.',
        '```ai-tutor-action',
        '{"type":"startNewLesson","chapterTitle":"Noisy protocol"}',
        '```',
        '```ai',
        '{"options":["Continue","Generate note"]}',
        '```',
        'Next options:',
        '- Start new lesson',
      ].join('\n'), 'm1'),
    ];
    const plugin = {
      getConversationById: jest.fn(async () => ({ messages })),
    };
    const titleService = {
      generateTitle: jest.fn(async (conversationId, userMessage, callback) => {
        expect(userMessage).not.toContain('ai-tutor-action');
        expect(userMessage).not.toContain('startNewLesson');
        expect(userMessage).not.toContain('"options"');
        await callback(conversationId, { success: true, title: 'Clean handoff' });
      }),
      cancel: jest.fn(),
    };

    const summary = await new SummaryService(plugin as any, (() => titleService) as any).summarizeLesson(makeLesson());

    expect(summary).toContain('Summary focus: Clean handoff');
    expect(summary).toContain('We planned the next chapter');
    expect(summary).not.toContain('ai-tutor-action');
    expect(summary).not.toContain('startNewLesson');
    expect(summary).not.toContain('"options"');
  });

  it('uses a deterministic fallback when no conversation text is available', async () => {
    const plugin = {
      getConversationById: jest.fn(async () => ({ messages: [] })),
    };
    const createTitleService = jest.fn();

    const summary = await new SummaryService(plugin as any, createTitleService as any).summarizeLesson(makeLesson());

    expect(summary).toBe('Covered Filters with 1 section(s).');
    expect(createTitleService).not.toHaveBeenCalled();
  });
});

describe('LearningController lesson controls', () => {
  it('starts a new lesson from the chat button path through LessonProgression', async () => {
    const previousLesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'ended',
      sections: [{ id: 's1', title: 'Low-pass intuition', status: 'covered', notePath: 'filters.md' }],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const nextLesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Sampling',
      conversationId: 'conv-2',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      previousLessonId: previousLesson.lessonId,
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: previousLesson.lessonId,
      machineState: 'chapterEnded',
      syllabus: [],
      lessons: [previousLesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const nextCourse: CourseState = {
      ...course,
      currentLessonId: nextLesson.lessonId,
      machineState: 'chapterPlanning',
      lessons: [previousLesson, nextLesson],
      updatedAt: 2,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({
      course,
      lesson: previousLesson,
    });
    const startNewLesson = jest
      .spyOn((controller as any).progression, 'startNewLesson')
      .mockResolvedValue({ ok: true, state: nextCourse });
    const openChatConversation = jest
      .spyOn(controller as any, 'openChatConversation')
      .mockResolvedValue(undefined);

    await controller.startNewLessonFromConversation('conv-1');

    expect(startNewLesson).toHaveBeenCalledWith(
      course.courseId,
      { type: 'startNewLesson' },
      previousLesson,
    );
    expect(openChatConversation).toHaveBeenCalledWith('conv-2');
  });

  it('handles explicit user text as a forced start-new-lesson command', async () => {
    const intakeLesson: LessonSession = {
      lessonId: 'lesson-intake',
      kind: 'intake',
      chapterNumber: 0,
      title: 'Intake',
      conversationId: 'conv-intake',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const nextLesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Chapter 1',
      conversationId: 'conv-next',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      previousLessonId: intakeLesson.lessonId,
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: intakeLesson.lessonId,
      machineState: 'intake',
      syllabus: [],
      lessons: [intakeLesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const nextCourse: CourseState = {
      ...course,
      currentLessonId: nextLesson.lessonId,
      machineState: 'chapterPlanning',
      lessons: [intakeLesson, nextLesson],
      updatedAt: 2,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({
      course,
      lesson: intakeLesson,
    });
    const startNewLesson = jest
      .spyOn((controller as any).progression, 'startNewLesson')
      .mockResolvedValue({ ok: true, state: nextCourse });
    const openChatConversation = jest
      .spyOn(controller as any, 'openChatConversation')
      .mockResolvedValue(undefined);

    await expect(controller.handleUserCommand('conv-intake', '开启下一章')).resolves.toBe(true);

    expect(startNewLesson).toHaveBeenCalledWith(
      course.courseId,
      { type: 'startNewLesson', force: true },
      intakeLesson,
    );
    expect(openChatConversation).toHaveBeenCalledWith('conv-next');
  });

  it('starts the current blank chapter instead of creating another blank chapter', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterPlanning',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 2,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({ id: 'conv-2', messages: [] })),
      getConversationById: jest.fn(async () => ({ id: 'conv-2', messages: [] })),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    const startNewLesson = jest
      .spyOn((controller as any).progression, 'startNewLesson')
      .mockResolvedValue({ ok: true, state: course });
    const openChatConversation = jest
      .spyOn(controller as any, 'openChatConversation')
      .mockResolvedValue(undefined);

    await expect(controller.handleUserCommand('conv-2', '开启下一章')).resolves.toBe(true);

    expect(startNewLesson).not.toHaveBeenCalled();
    expect(openChatConversation).toHaveBeenCalledWith('conv-2');
  });

  it('handles explicit user text as a state-machine guarded next-section command', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'noteWritten', notePath: 'low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const advancedLesson: LessonSession = {
      ...lesson,
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'covered', notePath: 'low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 1,
      updatedAt: 2,
    };
    const advancedCourse: CourseState = {
      ...course,
      lessons: [advancedLesson],
      updatedAt: 2,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const switchToTab = jest.fn(async () => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        messages: [{ id: 'assistant-1', role: 'assistant', content: 'Plan saved.', timestamp: 1 }],
        uiMessageBlocks: {},
      })),
      getConversationById: jest.fn(),
      updateConversation: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab,
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    const advanceSection = jest
      .spyOn((controller as any).progression, 'advanceSection')
      .mockResolvedValue({ ok: true, state: advancedCourse });

    await expect(controller.handleUserCommand('conv-1', '继续下一节')).resolves.toBe(true);

    expect(advanceSection).toHaveBeenCalledWith(course.courseId);
    expect(switchToTab).toHaveBeenCalledWith('tab-1');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0];
    expect(sent?.displayContent).toBe('开始第 2 节：Cutoff frequency');
    expect(sent?.content).toContain('请开始第 1 章 第 2/2 节「Cutoff frequency」的学习');
    expect(sent?.content).toContain('不要重新 planChapter');
  });

  it('starts a chapter review after explicit user text finishes the last section', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'covered', notePath: 'low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'noteWritten', notePath: 'cutoff.md' },
      ],
      currentSectionIndex: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const endedLesson: LessonSession = {
      ...lesson,
      status: 'ended',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'covered', notePath: 'low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'covered', notePath: 'cutoff.md' },
      ],
      updatedAt: 2,
    };
    const endedCourse: CourseState = {
      ...course,
      machineState: 'chapterEnded',
      lessons: [endedLesson],
      updatedAt: 2,
    };
    const files = new Map<string, string>([
      ['low-pass.md', 'Low-pass filters keep slow signal movement and remove high-frequency noise.'],
      ['cutoff.md', 'Cutoff frequency defines the boundary where attenuation begins.'],
    ]);
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: {
          adapter: {
            exists: jest.fn(async (path: string) => files.has(path)),
            read: jest.fn(async (path: string) => files.get(path) ?? ''),
          },
        },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        messages: [{ id: 'assistant-1', role: 'assistant', content: 'Section complete.', timestamp: 1 }],
        uiMessageBlocks: {},
      })),
      getConversationById: jest.fn(),
      updateConversation: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab: jest.fn(async () => undefined),
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    jest.spyOn((controller as any).progression, 'advanceSection')
      .mockResolvedValue({ ok: true, state: endedCourse });

    await expect(controller.handleUserCommand('conv-1', '完成本章')).resolves.toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0];
    expect(sent?.displayContent).toBe('复盘本章：Filters');
    expect(sent?.hideUserMessage).toBe(true);
    expect(sent?.learningActivity).toEqual(expect.objectContaining({
      type: 'learning_activity',
      label: 'Preparing chapter review',
      detail: 'Chapter 1: Filters',
      items: expect.arrayContaining(['2 sections', '2 lesson note snippets', 'Generate review bridge']),
    }));
    expect(sent?.content).toContain('<lesson_note_context>');
    expect(sent?.content).toContain('Review Generation Transformation');
    expect(sent?.content).toContain('不要写文件，不要输出 ai-tutor-action');
  });

  it('rejects next-section user text before the current section note is written', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'pending' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = jest.fn();
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        messages: [{ id: 'assistant-1', role: 'assistant', content: 'Plan saved.', timestamp: 1 }],
        uiMessageBlocks: {},
      })),
      getConversationById: jest.fn(),
      updateConversation: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [] },
            controllers: { inputController: { sendMessage } },
          }],
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    jest.spyOn((controller as any).progression, 'advanceSection')
      .mockResolvedValue({ ok: false, message: 'Current section note must be written before advancing.' });

    await expect(controller.handleUserCommand('conv-1', '开始下一节')).resolves.toBe(true);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores non-learning progression text commands', async () => {
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue(null);

    await expect(controller.handleUserCommand('conv-missing', '开启下一章')).resolves.toBe(false);
    await expect(controller.handleUserCommand('conv-missing', '讲讲下一章是什么')).resolves.toBe(false);
    await expect(controller.handleUserCommand('conv-missing', '讲讲下一节是什么')).resolves.toBe(false);
  });

  it('summarizes the active learning conversation for chat status UI', () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'active',
      sections: [
        { id: 's1', title: 'Aerobic base', status: 'covered' },
        { id: 's2', title: 'Long run rhythm', status: 'pending' },
      ],
      currentSectionIndex: 1,
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 2,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    (controller as any).cacheCourse(course);

    expect(controller.getConversationStatus('conv-2')).toEqual({
      mode: 'Teach',
      turnMode: 'teach',
      courseTitle: 'Running',
      lessonTitle: 'Endurance base',
      chapterLabel: 'Chapter 2',
      sectionLabel: '2/2 Long run rhythm',
      machineState: 'teaching',
    });
    expect(controller.setConversationTurnMode('conv-2', 'ask')).toBe(true);
    expect(controller.getConversationStatus('conv-2')?.turnMode).toBe('ask');
    expect(controller.getConversationStatus('missing')).toBeNull();
  });

  it('exposes guarded next-section controls only after the current section note is written', () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'active',
      sections: [
        { id: 's1', title: 'Aerobic base', status: 'noteWritten', notePath: 'aerobic.md' },
        { id: 's2', title: 'Long run rhythm', status: 'pending' },
      ],
      currentSectionIndex: 0,
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 2,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    (controller as any).cacheCourse(course);

    expect(controller.canPracticeSection('conv-2')).toBe(true);
    expect(controller.canReviewLesson('conv-2')).toBe(false);
    expect(controller.canWriteSectionNote('conv-2')).toBe(false);
    expect(controller.canAdvanceSection('conv-2')).toBe(true);
    expect(controller.getAdvanceSectionLabel('conv-2')).toBe('Next section');

    const lastSectionLesson: LessonSession = {
      ...lesson,
      sections: [
        { id: 's1', title: 'Aerobic base', status: 'covered', notePath: 'aerobic.md' },
        { id: 's2', title: 'Long run rhythm', status: 'noteWritten', notePath: 'long-run.md' },
      ],
      currentSectionIndex: 1,
    };
    (controller as any).cacheCourse({ ...course, lessons: [lastSectionLesson] });
    expect(controller.canAdvanceSection('conv-2')).toBe(true);
    expect(controller.getAdvanceSectionLabel('conv-2')).toBe('Finish chapter');

    const pendingLesson: LessonSession = {
      ...lesson,
      sections: [
        { id: 's1', title: 'Aerobic base', status: 'covered', notePath: 'aerobic.md' },
        { id: 's2', title: 'Long run rhythm', status: 'pending' },
      ],
      currentSectionIndex: 1,
    };
    (controller as any).cacheCourse({ ...course, lessons: [pendingLesson] });
    expect(controller.canPracticeSection('conv-2')).toBe(true);
    expect(controller.canReviewLesson('conv-2')).toBe(false);
    expect(controller.canWriteSectionNote('conv-2')).toBe(true);
    expect(controller.canAdvanceSection('conv-2')).toBe(false);
    expect(controller.getAdvanceSectionLabel('conv-2')).toBeNull();
  });

  it('exposes chapter review controls only after the chapter is finished', () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'ended',
      sections: [
        { id: 's1', title: 'Aerobic base', status: 'covered', notePath: 'aerobic.md' },
        { id: 's2', title: 'Long run rhythm', status: 'covered', notePath: 'long-run.md' },
      ],
      currentSectionIndex: 1,
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 3,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterEnded',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 3,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    (controller as any).cacheCourse(course);

    expect(controller.canReviewLesson('conv-2')).toBe(true);
    expect(controller.canPracticeSection('conv-2')).toBe(false);
  });

  it('starts a hidden note-writing turn for the current pending section', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'pending' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const switchToTab = jest.fn(async () => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab,
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await controller.writeSectionNoteFromConversation('conv-1');

    expect(switchToTab).toHaveBeenCalledWith('tab-1');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0];
    const expectedPath = 'AI Tutor/Courses/signals/lessons/001-filters/part-01-low-pass-intuition.md';
    expect(sent?.hideUserMessage).toBe(true);
    expect(sent?.displayContent).toBe('生成本节笔记：Low-pass intuition');
    expect(sent?.learningActivity).toEqual(expect.objectContaining({
      type: 'learning_activity',
      label: 'Writing section note',
      detail: 'Section 1/2: Low-pass intuition',
      items: expect.arrayContaining(['Low-pass intuition', expectedPath, 'Run quality gate']),
    }));
    expect(sent?.content).toContain('写本节笔记');
    expect(sent?.content).toContain(expectedPath);
    expect(sent?.content).toContain('sectionNoteWritten');
    expect(sent?.content).toContain('"sectionId":"s1"');
    expect(sent?.content).toContain('不要输出 advanceSection 或 startNewLesson');
  });

  it('injects resolved current-section source snippets into the hidden note-writing turn', async () => {
    const sourceFile = new (TFile as any)('sources/filter-notes.md') as TFile;
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'pending' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: {
          adapter: {},
          getAbstractFileByPath: jest.fn((path: string) => (
            path === 'sources/filter-notes.md' ? sourceFile : null
          )),
          cachedRead: jest.fn(async () => 'Low-pass filters keep slow signals and reduce high-frequency noise.'),
        },
        metadataCache: { getFirstLinkpathDest: jest.fn() },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        uiMessageBlocks: {
          'assistant-1': [{
            type: 'learning_lesson_plan',
            title: 'Filters',
            parts: [{
              title: 'Low-pass intuition',
              sources: [{ label: 'Filter notes', path: 'sources/filter-notes.md' }],
            }],
          }],
        },
        messages: [],
      })),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab: jest.fn(async () => undefined),
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await controller.writeSectionNoteFromConversation('conv-1');

    const sent = sendMessage.mock.calls[0][0];
    expect(sent?.content).toContain('<source_context>');
    expect(sent?.content).toContain('[1] Filter notes');
    expect(sent?.content).toContain('Path: sources/filter-notes.md');
    expect(sent?.content).toContain('Low-pass filters keep slow signals');
    expect(sent?.learningActivity).toEqual(expect.objectContaining({
      items: expect.arrayContaining(['1 source snippets']),
    }));
  });

  it('starts a hidden source-aware practice turn for the current section', async () => {
    const sourceFile = new (TFile as any)('sources/filter-notes.md') as TFile;
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'pending' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: {
          adapter: {},
          getAbstractFileByPath: jest.fn((path: string) => (
            path === 'sources/filter-notes.md' ? sourceFile : null
          )),
          cachedRead: jest.fn(async () => 'Low-pass filters keep slow signals and reduce high-frequency noise.'),
        },
        metadataCache: { getFirstLinkpathDest: jest.fn() },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        uiMessageBlocks: {
          'assistant-1': [{
            type: 'learning_lesson_plan',
            title: 'Filters',
            parts: [{
              title: 'Low-pass intuition',
              sources: [{ label: 'Filter notes', path: 'sources/filter-notes.md' }],
            }],
          }],
        },
        messages: [],
      })),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab: jest.fn(async () => undefined),
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await controller.practiceSectionFromConversation('conv-1');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0];
    expect(sent?.hideUserMessage).toBe(true);
    expect(sent?.displayContent).toBe('小测：Low-pass intuition');
    expect(sent?.learningActivity).toEqual(expect.objectContaining({
      type: 'learning_activity',
      label: 'Preparing practice',
      detail: 'Section 1/2: Low-pass intuition',
      items: expect.arrayContaining(['Low-pass intuition', '1 source snippets', 'Generate checkpoint questions']),
    }));
    expect(sent?.content).toContain('<source_context>');
    expect(sent?.content).toContain('[1] Filter notes');
    expect(sent?.content).toContain('Quiz Generation Transformation');
    expect(sent?.content).toContain('不要写文件，不要输出 ai-tutor-action');
    expect(sent?.content).toContain('ai-tutor-next-options');
  });

  it('routes short write-note text commands through the note-writing action', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [{ id: 's1', title: 'Low-pass intuition', status: 'pending' }],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    const writeNote = jest.spyOn(controller, 'writeSectionNoteFromConversation').mockResolvedValue(undefined);

    await expect(controller.handleUserCommand('conv-1', '生成本节笔记')).resolves.toBe(true);

    expect(writeNote).toHaveBeenCalledWith('conv-1');
  });

  it('routes short practice text commands through the practice action', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [{ id: 's1', title: 'Low-pass intuition', status: 'pending' }],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    const practice = jest.spyOn(controller, 'practiceSectionFromConversation').mockResolvedValue(undefined);

    await expect(controller.handleUserCommand('conv-1', '做一个小测')).resolves.toBe(true);

    expect(practice).toHaveBeenCalledWith('conv-1');
  });

  it('starts a hidden note-grounded chapter review turn for a finished chapter', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'ended',
      sections: [
        { id: 's1', title: 'Aerobic base', status: 'covered', notePath: 'notes/aerobic.md', noteTitle: 'Aerobic Base' },
        { id: 's2', title: 'Long run rhythm', status: 'covered', notePath: 'notes/long-run.md' },
      ],
      currentSectionIndex: 1,
      coveredSummary: 'Built a safe running foundation.',
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 3,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterEnded',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 3,
    };
    const files = new Map<string, string>([
      ['notes/aerobic.md', 'Aerobic base means easy effort, low injury risk, and repeatable weekly volume.'],
      ['notes/long-run.md', 'Long-run rhythm should feel conversational and should not become a race.'],
    ]);
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: {
          adapter: {
            exists: jest.fn(async (path: string) => files.has(path)),
            read: jest.fn(async (path: string) => files.get(path) ?? ''),
          },
        },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-2',
            conversationId: 'conv-2',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab: jest.fn(async () => undefined),
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await controller.reviewLessonFromConversation('conv-2');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0];
    expect(sent?.hideUserMessage).toBe(true);
    expect(sent?.displayContent).toBe('复盘本章：Endurance base');
    expect(sent?.learningActivity).toEqual(expect.objectContaining({
      type: 'learning_activity',
      label: 'Preparing chapter review',
      detail: 'Chapter 2: Endurance base',
      items: expect.arrayContaining(['2 sections', '2 lesson note snippets', 'Generate review bridge']),
    }));
    expect(sent?.content).toContain('<lesson_note_context>');
    expect(sent?.content).toContain('[note 1] Aerobic Base');
    expect(sent?.content).toContain('Review Generation Transformation');
    expect(sent?.content).toContain('不要写文件，不要输出 ai-tutor-action');
    expect(sent?.content).toContain('What to review next');
  });

  it('persists deterministic next-step chips after an orchestrated chapter review response', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'ended',
      sections: [
        { id: 's1', title: 'Aerobic base', status: 'covered', notePath: 'notes/aerobic.md' },
        { id: 's2', title: 'Long run rhythm', status: 'covered', notePath: 'notes/long-run.md' },
      ],
      currentSectionIndex: 1,
      coveredSummary: 'Built a safe running foundation.',
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 3,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterEnded',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 3,
    };
    const conversation = {
      id: 'conv-2',
      messages: [{
        id: 'assistant-review',
        role: 'assistant',
        content: 'Here is the chapter review.',
        timestamp: 4,
        contentBlocks: [{ type: 'text', content: 'Here is the chapter review.' }],
      }],
      uiMessageBlocks: {
        'assistant-review': [{
          type: 'learning_activity',
          label: 'Preparing chapter review',
          status: 'done',
          detail: 'Chapter 2: Endurance base',
        }],
      },
    };
    const updateConversation = jest.fn(async (_id: string, updates: Record<string, unknown>) => {
      Object.assign(conversation, updates);
    });
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
      getConversationSync: jest.fn(() => conversation),
      getConversationById: jest.fn(),
      updateConversation,
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    jest.spyOn(controller.stateService, 'loadCourse').mockResolvedValue(course);

    const completion = await controller.handleAssistantTurnComplete(
      'conv-2',
      'Here is the chapter review.',
      'assistant-review',
    );

    expect(completion.nextSteps).toEqual([expect.objectContaining({
      type: 'learning_next_steps',
      detail: 'Chapter 2 review complete',
      options: expect.arrayContaining(['Start new lesson', '复盘本章', '我还有一个问题']),
    })]);
    expect(updateConversation).toHaveBeenCalledWith('conv-2', expect.objectContaining({
      uiMessageBlocks: {
        'assistant-review': expect.arrayContaining([
          expect.objectContaining({ type: 'learning_activity', label: 'Preparing chapter review' }),
          expect.objectContaining({ type: 'learning_next_steps' }),
        ]),
      },
    }));
    expect(conversation.messages[0].contentBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'learning_next_steps' }),
    ]));
  });

  it('routes short review text commands through the chapter review action', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'ended',
      sections: [{ id: 's1', title: 'Aerobic base', status: 'covered', notePath: 'notes/aerobic.md' }],
      currentSectionIndex: 0,
      createdAt: 2,
      updatedAt: 3,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterEnded',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 3,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    const review = jest.spyOn(controller, 'reviewLessonFromConversation').mockResolvedValue(undefined);

    await expect(controller.handleUserCommand('conv-2', '复盘本章')).resolves.toBe(true);

    expect(review).toHaveBeenCalledWith('conv-2');
  });

  it('opens vault-backed lesson plan sources from structured source refs', async () => {
    const sourceFile = new (TFile as any)('sources/filter-notes.md') as TFile;
    const openFile = jest.fn(async () => undefined);
    const plugin = {
      app: {
        vault: {
          adapter: {},
          getAbstractFileByPath: jest.fn((path: string) => (
            path === 'sources/filter-notes.md' ? sourceFile : null
          )),
        },
        metadataCache: { getFirstLinkpathDest: jest.fn() },
        workspace: { getLeaf: jest.fn(() => ({ openFile })) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);

    await controller.openSource({ label: 'Filter notes', path: 'sources/filter-notes.md' });

    expect(plugin.app.workspace.getLeaf).toHaveBeenCalledWith('split', 'vertical');
    expect(openFile).toHaveBeenCalledWith(sourceFile);
  });

  it('opens and starts the new conversation after an assistant startNewLesson action', async () => {
    const previousLesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Base',
      conversationId: 'conv-1',
      status: 'ended',
      sections: [{ id: 's1', title: 'Base idea', status: 'covered', notePath: 'base.md' }],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const nextLesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      previousLessonId: previousLesson.lessonId,
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: previousLesson.lessonId,
      machineState: 'chapterEnded',
      syllabus: [],
      lessons: [previousLesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const nextCourse: CourseState = {
      ...course,
      currentLessonId: nextLesson.lessonId,
      machineState: 'chapterPlanning',
      lessons: [previousLesson, nextLesson],
      updatedAt: 2,
    };
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson: previousLesson });
    jest.spyOn(controller.stateService, 'loadCourse').mockResolvedValue(course);
    jest.spyOn((controller as any).progression, 'startNewLesson')
      .mockResolvedValue({ ok: true, state: nextCourse });
    const openChatConversation = jest
      .spyOn(controller as any, 'openChatConversation')
      .mockResolvedValue(undefined);

    await controller.handleAssistantTurnComplete('conv-1', [
      'Done.',
      '```ai-tutor-action',
      '{"type":"startNewLesson"}',
      '```',
    ].join('\n'));

    expect(openChatConversation).toHaveBeenCalledWith('conv-2');
  });

  it('continues from an accepted syllabus action into first-lesson planning', async () => {
    const intakeLesson: LessonSession = {
      lessonId: 'lesson-intake',
      kind: 'intake',
      chapterNumber: 0,
      title: 'Intake',
      conversationId: 'conv-intake',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: intakeLesson.lessonId,
      machineState: 'intake',
      syllabus: [],
      lessons: [intakeLesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const plannedCourse: CourseState = {
      ...course,
      machineState: 'chapterPlanning',
      syllabus: [{
        id: 'topic-1',
        title: 'Aerobic base',
        order: 1,
        summary: 'Build the first durable running foundation.',
      }],
      updatedAt: 2,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const switchToTab = jest.fn(async () => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        messages: [{ id: 'assistant-1', role: 'assistant', content: 'Plan saved.', timestamp: 1 }],
        uiMessageBlocks: {},
      })),
      getConversationById: jest.fn(),
      updateConversation: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-intake',
            conversationId: 'conv-intake',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab,
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson: intakeLesson });
    jest.spyOn(controller.stateService, 'loadCourse').mockResolvedValue(course);
    jest.spyOn((controller as any).progression, 'applyAssistantAction')
      .mockResolvedValue({ ok: true, state: plannedCourse });

    await controller.handleAssistantTurnComplete('conv-intake', [
      'Course map ready.',
      '```ai-tutor-action',
      '{"type":"generateSyllabus","topics":[{"title":"Aerobic base","summary":"Build the first durable running foundation."}]}',
      '```',
    ].join('\n'));

    expect(switchToTab).toHaveBeenCalledWith('tab-intake');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0];
    expect(sent?.displayContent).toBe('规划第 1 章：Running');
    expect(sent?.content).toContain('课程「Running」的大纲已经保存');
    expect(sent?.content).toContain('Aerobic base');
    expect(sent?.content).toContain('planChapter');
    expect(sent?.content).toContain('插件会自动开始第 1 节教学');
  });

  it('starts section 1 after an assistant planChapter action is accepted', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterPlanning',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const plannedLesson: LessonSession = {
      ...lesson,
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'pending' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      updatedAt: 2,
    };
    const plannedCourse: CourseState = {
      ...course,
      machineState: 'teaching',
      lessons: [plannedLesson],
      updatedAt: 2,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const switchToTab = jest.fn(async () => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        messages: [{ id: 'assistant-1', role: 'assistant', content: 'Plan saved.', timestamp: 1 }],
        uiMessageBlocks: {},
      })),
      getConversationById: jest.fn(),
      updateConversation: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab,
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    jest.spyOn(controller.stateService, 'loadCourse').mockResolvedValue(course);
    jest.spyOn((controller as any).progression, 'applyAssistantAction')
      .mockResolvedValue({ ok: true, state: plannedCourse });

    const completion = await controller.handleAssistantTurnComplete('conv-1', [
      'Plan saved.',
      '```ai-tutor-action',
      JSON.stringify({
        type: 'planChapter',
        title: 'Filters',
        overview: 'Build intuition before formulas.',
        nextLessonSummary: 'Next we will move into sampling.',
        sections: [
          {
            id: 's1',
            title: 'Low-pass intuition',
            description: 'Understand what low-pass filters keep and remove.',
            bulletPoints: ['Cut high-frequency noise', 'Keep slow signal trend'],
            sources: [{ text: 'Filter notes', cardId: 'card-1' }],
          },
          { id: 's2', title: 'Cutoff frequency' },
        ],
      }),
      '```',
    ].join('\n'), 'assistant-1');

    expect(switchToTab).toHaveBeenCalledWith('tab-1');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(completion.actionOutcomes).toEqual([expect.objectContaining({
      actionType: 'planChapter',
      status: 'accepted',
      items: ['Low-pass intuition', 'Cutoff frequency'],
      lessonPlan: expect.objectContaining({
        type: 'learning_lesson_plan',
        title: 'Filters',
        overview: 'Build intuition before formulas.',
        nextLessonSummary: 'Next we will move into sampling.',
        parts: [
          expect.objectContaining({
            title: 'Low-pass intuition',
            status: 'current',
            description: 'Understand what low-pass filters keep and remove.',
            bulletPoints: ['Cut high-frequency noise', 'Keep slow signal trend'],
            sources: [{ label: 'Filter notes', cardId: 'card-1', path: undefined }],
          }),
          expect.objectContaining({ title: 'Cutoff frequency', status: 'pending' }),
        ],
      }),
    })]);
    expect(plugin.updateConversation).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      uiMessageBlocks: {
        'assistant-1': expect.arrayContaining([
          expect.objectContaining({ type: 'learning_action_result', status: 'accepted' }),
          expect.objectContaining({ type: 'learning_lesson_plan', title: 'Filters' }),
        ]),
      },
    }));
    const sent = sendMessage.mock.calls[0][0];
    expect(sent?.displayContent).toBe('开始第 1 节：Low-pass intuition');
    expect(sent?.content).toContain('请开始第 1 章 第 1/2 节「Low-pass intuition」的学习');
    expect(sent?.content).toContain('不要重新 planChapter');
  });

  it('starts the next section after an assistant advanceSection action is accepted', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'noteWritten', notePath: 'low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const advancedLesson: LessonSession = {
      ...lesson,
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'covered', notePath: 'low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 1,
      updatedAt: 2,
    };
    const advancedCourse: CourseState = {
      ...course,
      lessons: [advancedLesson],
      updatedAt: 2,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab: jest.fn(async () => undefined),
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    jest.spyOn(controller.stateService, 'loadCourse').mockResolvedValue(course);
    jest.spyOn((controller as any).progression, 'advanceSection')
      .mockResolvedValue({ ok: true, state: advancedCourse });

    await controller.handleAssistantTurnComplete('conv-1', [
      'Done.',
      '```ai-tutor-action',
      '{"type":"advanceSection"}',
      '```',
    ].join('\n'));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]?.displayContent).toBe('开始第 2 节：Cutoff frequency');
  });

  it('starts a chapter review after an assistant advanceSection action finishes the last section', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'covered', notePath: 'low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'noteWritten', notePath: 'cutoff.md' },
      ],
      currentSectionIndex: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const endedLesson: LessonSession = {
      ...lesson,
      status: 'ended',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'covered', notePath: 'low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'covered', notePath: 'cutoff.md' },
      ],
      updatedAt: 2,
    };
    const endedCourse: CourseState = {
      ...course,
      machineState: 'chapterEnded',
      lessons: [endedLesson],
      updatedAt: 2,
    };
    const files = new Map<string, string>([
      ['low-pass.md', 'Low-pass filters keep slow signal movement and remove high-frequency noise.'],
      ['cutoff.md', 'Cutoff frequency defines the boundary where attenuation begins.'],
    ]);
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: {
          adapter: {
            exists: jest.fn(async (path: string) => files.has(path)),
            read: jest.fn(async (path: string) => files.get(path) ?? ''),
          },
        },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => [{
        refreshLearningControls: jest.fn(),
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-1',
            state: { isStreaming: false, messages: [{ role: 'assistant' }] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab: jest.fn(async () => undefined),
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    jest.spyOn(controller.stateService, 'loadCourse').mockResolvedValue(course);
    jest.spyOn((controller as any).progression, 'advanceSection')
      .mockResolvedValue({ ok: true, state: endedCourse });

    await controller.handleAssistantTurnComplete('conv-1', [
      'Done.',
      '```ai-tutor-action',
      '{"type":"advanceSection"}',
      '```',
    ].join('\n'));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0];
    expect(sent?.displayContent).toBe('复盘本章：Filters');
    expect(sent?.learningActivity).toEqual(expect.objectContaining({
      type: 'learning_activity',
      label: 'Preparing chapter review',
      detail: 'Chapter 1: Filters',
      items: expect.arrayContaining(['2 sections', '2 lesson note snippets', 'Generate review bridge']),
    }));
    expect(sent?.content).toContain('<lesson_note_context>');
    expect(sent?.content).toContain('Review Generation Transformation');
  });

  it('returns and persists accepted learning action outcomes on the assistant message', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [{ id: 's1', title: 'Low-pass intuition', status: 'pending' }],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const conversation = {
      id: 'conv-1',
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        content: 'Note written.',
        timestamp: 1,
        contentBlocks: [{ type: 'text', content: 'Note written.' }],
      }],
    };
    const updateConversation = jest.fn(async (_id: string, updates: Record<string, unknown>) => {
      Object.assign(conversation, updates);
    });
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
      getConversationSync: jest.fn(() => conversation),
      updateConversation,
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    jest.spyOn(controller.stateService, 'loadCourse').mockResolvedValue(course);
    jest.spyOn(controller as any, 'checkNoteQuality').mockResolvedValue({ pass: true, reasons: [] });
    jest.spyOn((controller as any).progression, 'applyAssistantAction')
      .mockResolvedValue({ ok: true, state: course });

    const completion = await controller.handleAssistantTurnComplete('conv-1', [
      'Note written.',
      '```ai-tutor-action',
      '{"type":"sectionNoteWritten","sectionId":"s1","notePath":"AI Tutor/Courses/signals/s1.md","noteTitle":"Low-pass intuition"}',
      '```',
    ].join('\n'), 'assistant-1');

    expect(completion.repairPrompt).toBeNull();
    expect(completion.actionOutcomes).toEqual([expect.objectContaining({
      actionType: 'sectionNoteWritten',
      label: 'Register section note',
      status: 'accepted',
      detail: 'Low-pass intuition',
      message: 'Section note registered.',
    })]);
    expect(updateConversation).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      uiMessageBlocks: {
        'assistant-1': [expect.objectContaining({
          type: 'learning_action_result',
          status: 'accepted',
          label: 'Register section note',
        })],
      },
    }));
    expect(conversation.messages[0].contentBlocks).toEqual([
      { type: 'text', content: 'Note written.' },
      expect.objectContaining({ type: 'learning_action_result', status: 'accepted' }),
    ]);
  });

  it('returns and persists rejected learning action outcomes from the state machine', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [{ id: 's1', title: 'Low-pass intuition', status: 'pending' }],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Signals',
      goalTitle: 'Understand filters',
      rootPath: 'AI Tutor/Courses/signals',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const conversation = {
      id: 'conv-1',
      messages: [{ id: 'assistant-1', role: 'assistant', content: 'Advance.', timestamp: 1 }],
    };
    const updateConversation = jest.fn(async (_id: string, updates: Record<string, unknown>) => {
      Object.assign(conversation, updates);
    });
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getAllViews: jest.fn(() => []),
      getConversationSync: jest.fn(() => conversation),
      updateConversation,
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });
    jest.spyOn(controller.stateService, 'loadCourse').mockResolvedValue(course);
    jest.spyOn(controller.stateService, 'listCourses').mockResolvedValue([]);
    jest.spyOn((controller as any).progression, 'advanceSection')
      .mockResolvedValue({ ok: false, message: 'Current section note must be written first.' });

    const completion = await controller.handleAssistantTurnComplete('conv-1', [
      'Advance.',
      '```ai-tutor-action',
      '{"type":"advanceSection"}',
      '```',
    ].join('\n'), 'assistant-1');

    expect(completion.actionOutcomes).toEqual([expect.objectContaining({
      actionType: 'advanceSection',
      label: 'Advance section',
      status: 'rejected',
      message: 'Current section note must be written first.',
    })]);
    expect(updateConversation).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      uiMessageBlocks: {
        'assistant-1': [expect.objectContaining({
          type: 'learning_action_result',
          status: 'rejected',
          message: 'Current section note must be written first.',
        })],
      },
    }));
  });

  it('auto-starts a blank intake conversation instead of leaving the course empty', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-intake',
      kind: 'intake',
      chapterNumber: 0,
      title: 'Intake',
      conversationId: 'conv-intake',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'intake',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const switchToTab = jest.fn(async () => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({ id: 'conv-intake', messages: [] })),
      getAllViews: jest.fn(() => [{
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-intake',
            conversationId: 'conv-intake',
            state: { isStreaming: false, messages: [] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab,
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await (controller as any).maybeKickoffCurrentLesson('conv-intake');

    expect(switchToTab).toHaveBeenCalledWith('tab-intake');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentOptions = sendMessage.mock.calls[0][0];
    expect(sentOptions?.hideUserMessage).toBe(true);
    expect(sentOptions?.learningActivity).toEqual(expect.objectContaining({
      type: 'learning_activity',
      label: 'Starting course intake',
      status: 'running',
    }));
    expect(sentOptions?.displayContent).toBe('开始课程 intake：Running');
    expect(sentOptions?.content).toContain('请开始课程「Running」的 intake');
    expect(sentOptions?.content).toContain('最应该准备/读取哪些材料');
    expect(sentOptions?.content).toContain('ai-tutor-next-options');
  });

  it('auto-starts a blank chapterPlanning lesson conversation when it is opened', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterPlanning',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 2,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const switchToTab = jest.fn(async () => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({ id: 'conv-2', messages: [] })),
      getAllViews: jest.fn(() => [{
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-2',
            state: { isStreaming: false, messages: [] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab,
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await (controller as any).maybeKickoffCurrentLesson('conv-2');

    expect(switchToTab).toHaveBeenCalledWith('tab-1');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [sentOptions] = sendMessage.mock.calls[0] ?? [];
    expect(sentOptions?.hideUserMessage).toBe(true);
    expect(sentOptions?.learningActivity).toEqual(expect.objectContaining({
      type: 'learning_activity',
      label: 'Planning chapter',
      detail: 'Chapter 2: Endurance base',
    }));
    expect(sentOptions?.content).toBeTruthy();
    const sent = sentOptions?.content ?? '';
    expect(sent).toContain('请开始第 2 章「Endurance base」的学习');
    expect(sent).toContain('planChapter');
    expect(sent).toContain('Heptabase 风格');
    expect(sent).toContain('ai-tutor-next-options');
    expect(sent).toContain('不要输出 startNewLesson action');
    expect(sentOptions?.displayContent).toBe('开始第 2 章：Endurance base');
  });

  it('auto-starts a blank planned teaching lesson instead of leaving the chapter empty', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'active',
      sections: [
        { id: 's1', title: 'Aerobic base', status: 'pending' },
        { id: 's2', title: 'Long run rhythm', status: 'pending' },
      ],
      currentSectionIndex: 0,
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'teaching',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 2,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({ id: 'conv-2', messages: [] })),
      getAllViews: jest.fn(() => [{
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: null,
            state: { currentConversationId: 'conv-2', isStreaming: false, messages: [] },
            controllers: { inputController: { sendMessage } },
          }],
          switchToTab: jest.fn(async () => undefined),
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await (controller as any).maybeKickoffCurrentLesson('conv-2');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]?.hideUserMessage).toBe(true);
    expect(sendMessage.mock.calls[0][0]?.learningActivity).toEqual(expect.objectContaining({
      type: 'learning_activity',
      label: 'Starting chapter section',
    }));
    const sent = sendMessage.mock.calls[0][0]?.content ?? '';
    expect(sent).toContain('本章已经有小节计划，不要重新 planChapter');
    expect(sent).toContain('Aerobic base');
    expect(sent).not.toContain('类型为 planChapter');
  });

  it('retries auto-start when a chapterPlanning conversation only has a failed user placeholder', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterPlanning',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 2,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-2',
        messages: [{ id: 'm1', role: 'user', content: 'already started', timestamp: 1 }],
      })),
      getAllViews: jest.fn(() => [{
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-2',
            state: { isStreaming: false, messages: [] },
            controllers: { inputController: { sendMessage } },
          }],
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await (controller as any).maybeKickoffCurrentLesson('conv-2');

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not auto-start chapterPlanning conversations that already have an assistant response', async () => {
    const lesson: LessonSession = {
      lessonId: 'lesson-2',
      kind: 'lesson',
      chapterNumber: 2,
      title: 'Endurance base',
      conversationId: 'conv-2',
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      previousLessonId: 'lesson-1',
      createdAt: 2,
      updatedAt: 2,
    };
    const course: CourseState = {
      schemaVersion: 1,
      courseId: 'course-1',
      title: 'Running',
      goalTitle: 'Improve running and lose weight',
      rootPath: 'AI Tutor/Courses/running',
      currentLessonId: lesson.lessonId,
      machineState: 'chapterPlanning',
      syllabus: [],
      lessons: [lesson],
      createdAt: 1,
      updatedAt: 2,
    };
    const sendMessage = jest.fn(async (_options?: { content?: string; displayContent?: string; hideUserMessage?: boolean; learningActivity?: unknown }) => undefined);
    const plugin = {
      app: {
        vault: { adapter: {} },
        workspace: { getLeavesOfType: jest.fn(() => []) },
      },
      loadData: jest.fn(async () => ({})),
      saveData: jest.fn(),
      getConversationSync: jest.fn(() => ({
        id: 'conv-2',
        lastResponseAt: 3,
        messages: [{ id: 'm1', role: 'assistant', content: '已经开始规划。', timestamp: 1 }],
      })),
      getAllViews: jest.fn(() => [{
        getTabManager: () => ({
          getAllTabs: () => [{
            id: 'tab-1',
            conversationId: 'conv-2',
            state: { isStreaming: false, messages: [] },
            controllers: { inputController: { sendMessage } },
          }],
        }),
      }]),
    };
    const controller = new LearningController(plugin as any);
    jest.spyOn(controller.stateService, 'findByConversationId').mockResolvedValue({ course, lesson });

    await (controller as any).maybeKickoffCurrentLesson('conv-2');

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('LearningContextInjector', () => {
  function makeCourse(): { course: CourseState; lesson: LessonSession } {
    const lesson: LessonSession = {
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [{ id: 's1', title: 'Low-pass intuition', status: 'pending' }],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    return {
      lesson,
      course: {
        schemaVersion: 1,
        courseId: 'course-1',
        title: 'Signals',
        goalTitle: 'Understand filters',
        rootPath: 'AI Tutor/Courses/signals',
        currentLessonId: lesson.lessonId,
        machineState: 'teaching',
        syllabus: [{ id: 'topic-1', title: 'Filters', order: 1 }],
        lessons: [lesson],
        createdAt: 1,
        updatedAt: 1,
      },
    };
  }

  it('injects full context on first turns and pointer context later', () => {
    const injector = new LearningContextInjector();
    const { course, lesson } = makeCourse();

    const first = injector.build({
      course,
      lesson,
      conversationMessageCount: 0,
      request: { text: 'hello' },
    });
    const later = injector.build({
      course,
      lesson,
      conversationMessageCount: 5,
      request: { text: 'hello' },
    });

    expect(first).toContain('mode="full"');
    expect(first).toContain('Syllabus:');
    expect(first).toContain('Tutor mode: Teach: tutor the current section');
    expect(first).toContain('Selected turn mode: teach');
    expect(first).toContain('Tutor rhythm:');
    expect(first).toContain('ai-tutor-next-options');
    expect(later).toContain('mode="pointer"');
  });

  it('injects the selected turn mode instruction', () => {
    const injector = new LearningContextInjector();
    const { course, lesson } = makeCourse();

    const result = injector.build({
      course,
      lesson,
      conversationMessageCount: 5,
      request: { text: '这个问题怎么理解？' },
      selectedTurnMode: 'ask',
    });

    expect(result).toContain('Selected turn mode: ask');
    expect(result).toContain('Ask mode: answer the learner question directly');
  });

  it('injects the lesson-page template for note generation turns', () => {
    const injector = new LearningContextInjector();
    const { course, lesson } = makeCourse();

    const result = injector.build({
      course,
      lesson,
      conversationMessageCount: 5,
      request: { text: '请生成节笔记' },
    });

    expect(result).toContain('<lesson_page_template>');
    expect(result).toContain('Lesson Page Generation Skill');
    expect(result).toContain('voiceSharpness');
  });
});

describe('learningAppendix', () => {
  it('sets the Heptabase-quality tutor rhythm and action honesty rules', () => {
    const appendix = learningAppendix();

    expect(appendix).toContain('Think in three modes');
    expect(appendix).toContain('Teach');
    expect(appendix).toContain('Ask');
    expect(appendix).toContain('Transform');
    expect(appendix).toContain('ai-tutor-next-options');
    expect(appendix).toContain('chapterPlanning');
    expect(appendix).toContain('planChapter');
    expect(appendix).toContain('Heptabase-quality bar');
  });
});

describe('ContentQualityGate', () => {
  it('rejects obviously thin notes', () => {
    const gate = new ContentQualityGate();
    const result = gate.check('# Short\n\n总之，这很重要。');

    expect(result.pass).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(1);
  });

  it('accepts a structured lesson note with analogy, numbers, and review loop', () => {
    const gate = new ContentQualityGate();
    const markdown = [
      '# Low-pass intuition',
      '## Concrete scene',
      'Imagine the filter like a doorman letting 20 quiet guests through while blocking sudden noise.',
      '## Why it matters',
      'Because a 24-bit sensor can still produce unstable readings when 50 Hz noise dominates the useful signal.',
      '## Step-by-step model',
      'The boundary exists because raw samples vary; therefore we preserve slow change and reduce fast spikes.',
      '## Practical check',
      'Compare 100 samples before and after smoothing, then inspect the maximum jump.',
      '## Check Yourself',
      'What changes if the cutoff is too low?',
      '## Next step',
      'Use this idea when reading the next section.',
      'Extra prose '.repeat(80),
    ].join('\n\n');

    expect(gate.check(markdown).pass).toBe(true);
  });
});
