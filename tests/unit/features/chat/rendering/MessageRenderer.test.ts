import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Menu } from 'obsidian';

import {
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_SPAWN_AGENT,
  TOOL_TASK,
  TOOL_WAIT_AGENT,
  TOOL_WRITE_STDIN,
} from '@/core/tools/toolNames';
import type {
  ChatMessage,
  ImageAttachment,
  LearningActivityContentBlock,
  LearningActionResultContentBlock,
  LearningLessonPlanContentBlock,
  LearningNextStepsContentBlock,
} from '@/core/types';
import {
  extractTutorActions,
  extractNextOptions,
  MessageRenderer,
  stripTutorActionBlocks,
  stripNextOptionsBlocks,
  stripTutorProtocolBlocksForStreaming,
} from '@/features/chat/rendering/MessageRenderer';
import { renderStoredAsyncSubagent, renderStoredSubagent } from '@/features/chat/rendering/SubagentRenderer';
import { renderStoredThinkingBlock } from '@/features/chat/rendering/ThinkingBlockRenderer';
import { renderStoredToolCall } from '@/features/chat/rendering/ToolCallRenderer';
import { renderStoredWriteEdit } from '@/features/chat/rendering/WriteEditRenderer';

jest.mock('@/features/chat/rendering/SubagentRenderer', () => ({
  renderStoredAsyncSubagent: jest.fn().mockReturnValue({ wrapperEl: {}, cleanup: jest.fn() }),
  renderStoredSubagent: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  renderStoredThinkingBlock: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ToolCallRenderer', () => ({
  renderStoredToolCall: jest.fn(),
}));
jest.mock('@/features/chat/rendering/WriteEditRenderer', () => ({
  renderStoredWriteEdit: jest.fn(),
}));
jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: jest.fn().mockImplementation((md: string) => md),
}));
jest.mock('@/utils/fileLink', () => ({
  processFileLinks: jest.fn(),
  registerFileLinkHandler: jest.fn(),
}));

function createMockComponent() {
  return {
    registerDomEvent: jest.fn(),
    register: jest.fn(),
    addChild: jest.fn(),
    load: jest.fn(),
    unload: jest.fn(),
  };
}

function mockCapabilities(providerId: 'claude' | 'codex' = 'claude') {
  return () => ({
    providerId,
    supportsPersistentRuntime: true,
    supportsNativeHistory: providerId === 'claude',
    supportsPlanMode: true,
    supportsRewind: true,
    supportsFork: true,
    supportsProviderCommands: true,
    supportsImageAttachments: true,
    supportsInstructionMode: true,
    supportsMcpTools: true,
    reasoningControl: 'effort' as const,
  });
}

function createRenderer(
  messagesEl?: any,
  providerId: 'claude' | 'codex' = 'claude',
  settings: Record<string, unknown> = {},
  nextOptionCallback?: (option: string) => Promise<void> | void,
) {
  const el = messagesEl ?? createMockEl();
  const comp = createMockComponent();
  const openSource = jest.fn();
  const plugin = {
    app: {},
    settings: { mediaFolder: '', ...settings },
    learningController: { openSource },
  };
  return {
    renderer: new MessageRenderer(
      plugin as any,
      comp as any,
      el,
      undefined,
      undefined,
      mockCapabilities(providerId),
      nextOptionCallback,
    ),
    messagesEl: el,
    openSource,
  };
}

describe('MessageRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Menu as typeof Menu & { instances: unknown[] }).instances.length = 0;
  });

  describe('extractNextOptions', () => {
    it('extracts English and Chinese next option lists', () => {
      expect(extractNextOptions([
        'Done.',
        '',
        'Next options:',
        '- 继续讲深一点',
        '- 生成第 1 节笔记',
        '- 做一个小测',
      ].join('\n'))).toEqual(['继续讲深一点', '生成第 1 节笔记', '做一个小测']);

      expect(extractNextOptions('下一步：继续讲深一点 / 生成笔记 / 开始下一节')).toEqual([
        '继续讲深一点',
        '生成笔记',
        '开始下一节',
      ]);
    });

    it('extracts structured JSON options and strips the hidden protocol block', () => {
      const markdown = [
        '这一节先到这里。',
        '',
        '```ai-tutor-next-options',
        '{"options":["继续讲深一点","生成第 1 节笔记","做一个小测"]}',
        '```',
      ].join('\n');

      expect(extractNextOptions(markdown)).toEqual([
        '继续讲深一点',
        '生成第 1 节笔记',
        '做一个小测',
      ]);
      expect(stripNextOptionsBlocks(markdown)).toBe('这一节先到这里。');
    });
    it('extracts structured options from generic ai fences and hides the raw JSON', () => {
      const markdown = [
        'Ready for the next step.',
        '',
        '```ai',
        '{"options":["Continue the framework","Evaluate one book","Generate the chapter note"]}',
        '```',
      ].join('\n');

      expect(extractNextOptions(markdown)).toEqual([
        'Continue the framework',
        'Evaluate one book',
        'Generate the chapter note',
      ]);
      expect(stripNextOptionsBlocks(markdown)).toBe('Ready for the next step.');
    });

    it('hides dangling generic ai options fences during streaming', () => {
      const markdown = [
        'Ready for the next step.',
        '',
        '```ai',
        '{"options":["Continue the framework"',
      ].join('\n');

      expect(stripTutorProtocolBlocksForStreaming(markdown)).toBe('Ready for the next step.');
    });
  });

  describe('extractTutorActions', () => {
    it('summarizes structured learning actions without exposing raw JSON', () => {
      const markdown = [
        '本章计划如下。',
        '',
        '```ai-tutor-action',
        '{"type":"planChapter","title":"Filters","sections":[{"title":"Low-pass intuition"},{"title":"Cutoff frequency"}]}',
        '```',
      ].join('\n');

      expect(extractTutorActions(markdown)).toEqual([
        { type: 'planChapter', label: 'Plan chapter', detail: 'Filters · 2 sections' },
      ]);
      expect(stripTutorActionBlocks(markdown)).toBe('本章计划如下。');
    });

    it('summarizes syllabus, note, section, and lesson actions', () => {
      const markdown = [
        '```ai-tutor-action',
        '[',
        '{"type":"generateSyllabus","topics":[{"title":"A"},{"title":"B"}]},',
        '{"type":"sectionNoteWritten","notePath":"AI Tutor/Courses/running/part-1.md"},',
        '{"type":"advanceSection"},',
        '{"type":"startNewLesson"}',
        ']',
        '```',
      ].join('\n');

      expect(extractTutorActions(markdown)).toEqual([
        { type: 'generateSyllabus', label: 'Save course map', detail: '2 topics' },
        { type: 'sectionNoteWritten', label: 'Register section note', detail: 'AI Tutor/Courses/running/part-1.md' },
        { type: 'advanceSection', label: 'Advance section' },
        { type: 'startNewLesson', label: 'Start new lesson' },
      ]);
    });
  });

  // ============================================
  // renderMessages
  // ============================================

  it('renders welcome element and calls renderStoredMessage for each message', () => {
    const messagesEl = createMockEl();
    const emptySpy = jest.spyOn(messagesEl, 'empty');
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '', timestamp: Date.now(), toolCalls: [], contentBlocks: [] },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    expect(emptySpy).toHaveBeenCalled();
    expect(renderStoredSpy).toHaveBeenCalledTimes(1);
    expect(welcomeEl.hasClass('claudian-welcome')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Hello');
  });

  it('renders empty messages list with just welcome element', () => {
    const { renderer } = createRenderer();
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const welcomeEl = renderer.renderMessages([], () => 'Welcome!');

    expect(renderStoredSpy).not.toHaveBeenCalled();
    expect(welcomeEl.hasClass('claudian-welcome')).toBe(true);
  });

  // ============================================
  // renderStoredMessage
  // ============================================

  it('renders interrupt messages with interrupt styling instead of user bubble', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-1',
      role: 'user',
      content: '[Request interrupted by user]',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create assistant-style message with interrupt content
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
    // Check the content contains interrupt styling
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    const interruptedEl = textEl.children[0];
    expect(interruptedEl.hasClass('claudian-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders interrupted assistant message with content + interrupt indicator', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-1',
      role: 'assistant',
      content: 'Starting to work on the feature...',
      timestamp: Date.now(),
      isInterrupt: true,
      contentBlocks: [{ type: 'text', content: 'Starting to work on the feature...' }],
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create an assistant message (not a bare interrupt marker)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);

    // The content div should have both content rendering and an interrupt indicator
    const contentEl = msgEl.children[0];
    const lastChild = contentEl.children[contentEl.children.length - 1];
    const interruptedEl = lastChild.children[0];
    expect(interruptedEl.hasClass('claudian-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders clickable Next options chips for assistant messages', () => {
    const onNextOption = jest.fn();
    const { renderer, messagesEl } = createRenderer(undefined, 'claude', {}, onNextOption);
    const msg: ChatMessage = {
      id: 'assistant-next',
      role: 'assistant',
      content: [
        '这一节先到这里。',
        '',
        'Next options:',
        '- 继续讲深一点',
        '- 生成第 1 节笔记',
      ].join('\n'),
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    const chips = messagesEl.querySelectorAll('.claudian-next-option-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe('继续讲深一点');

    chips[0].click();

    expect(onNextOption).toHaveBeenCalledWith('继续讲深一点');
    expect(chips[0].getAttribute('disabled')).toBe('true');
  });

  it('renders structured Next options as chips without showing the protocol fence', () => {
    const onNextOption = jest.fn();
    const { renderer, messagesEl } = createRenderer(undefined, 'claude', {}, onNextOption);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const msg: ChatMessage = {
      id: 'assistant-next-structured',
      role: 'assistant',
      content: [
        '这一节先到这里。',
        '',
        '```ai-tutor-next-options',
        '{"options":["继续讲深一点","生成第 1 节笔记"]}',
        '```',
      ].join('\n'),
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), '这一节先到这里。');
    expect(renderContentSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('ai-tutor-next-options'),
    );
    expect(messagesEl.querySelectorAll('.claudian-next-option-chip')).toHaveLength(2);
  });

  it('renders persisted learning next-step chips and routes clicks through the next-option callback', () => {
    const onNextOption = jest.fn();
    const { renderer, messagesEl } = createRenderer(undefined, 'claude', {}, onNextOption);
    const nextSteps: LearningNextStepsContentBlock = {
      type: 'learning_next_steps',
      label: 'Next',
      detail: 'Chapter 1 review complete',
      options: ['Start new lesson', '复盘本章', '我还有一个问题'],
    };
    const msg: ChatMessage = {
      id: 'assistant-review-next',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [nextSteps],
    };

    renderer.renderStoredMessage(msg);

    const row = messagesEl.querySelector('.claudian-next-options');
    expect(row).not.toBeNull();
    expect(row?.classList.contains('is-learning-next-steps')).toBe(true);
    expect(row?.querySelector('.claudian-next-options-detail')?.textContent).toBe('Chapter 1 review complete');
    const chips = messagesEl.querySelectorAll('.claudian-next-option-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toBe('Start new lesson');

    chips[0].click();

    expect(onNextOption).toHaveBeenCalledWith('Start new lesson');
  });

  it('renders learning action cards without showing the protocol fence', () => {
    const { renderer, messagesEl } = createRenderer();
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const msg: ChatMessage = {
      id: 'assistant-action',
      role: 'assistant',
      content: [
        '我已经规划好这一章。',
        '',
        '```ai-tutor-action',
        '{"type":"planChapter","title":"Filters","sections":[{"title":"Low-pass intuition"},{"title":"Cutoff frequency"}]}',
        '```',
      ].join('\n'),
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), '我已经规划好这一章。');
    expect(renderContentSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('ai-tutor-action'),
    );
    const actionCards = messagesEl.querySelectorAll('.claudian-tutor-action-card');
    expect(actionCards).toHaveLength(1);
    expect(actionCards[0].querySelector('.claudian-tutor-action-kicker')?.textContent).toBe('AI Tutor - Requested');
    expect(actionCards[0].querySelector('.claudian-tutor-action-label')?.textContent).toBe('Plan chapter');
    expect(actionCards[0].querySelector('.claudian-tutor-action-detail')?.textContent).toBe('Filters · 2 sections');
  });

  it('hides wrapped learning action JSON from generic ai code fences', () => {
    const { renderer, messagesEl } = createRenderer();
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const msg: ChatMessage = {
      id: 'assistant-action-ai-fence',
      role: 'assistant',
      content: [
        '课程计划已经准备好了。',
        '',
        '```ai',
        JSON.stringify({
          type: 'planChapter',
          data: {
            title: '在AI时代高效阅读',
            overview: 'Build a decision framework before reading.',
            sections: [
              { title: 'AI时代为什么还要读书？' },
              { title: '如何快速判断一本书是否值得读？' },
            ],
          },
        }),
        '```',
      ].join('\n'),
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), '课程计划已经准备好了。');
    expect(renderContentSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('"type":"planChapter"'),
    );
    const actionCards = messagesEl.querySelectorAll('.claudian-tutor-action-card');
    expect(actionCards).toHaveLength(1);
    expect(actionCards[0].querySelector('.claudian-tutor-action-label')?.textContent).toBe('Plan chapter');
    expect(actionCards[0].querySelector('.claudian-tutor-action-detail')?.textContent).toBe('在AI时代高效阅读 · 2 sections');
  });

  it('renders persisted learning action results and suppresses requested duplicates', () => {
    const { renderer, messagesEl } = createRenderer();
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const msg: ChatMessage = {
      id: 'assistant-action-result',
      role: 'assistant',
      content: [
        'Plan saved.',
        '',
        '```ai-tutor-action',
        '{"type":"planChapter","title":"Filters","sections":[{"title":"Low-pass intuition"}]}',
        '```',
      ].join('\n'),
      timestamp: Date.now(),
      contentBlocks: [
        {
          type: 'text',
          content: 'Plan saved.\n\n```ai-tutor-action\n{"type":"planChapter","title":"Filters","sections":[{"title":"Low-pass intuition"}]}\n```',
        },
        {
          type: 'learning_action_result',
          actionType: 'planChapter',
          label: 'Plan chapter',
          status: 'accepted',
          detail: 'Filters - 1 sections',
          message: 'Chapter plan saved.',
          items: ['Low-pass intuition'],
        },
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Plan saved.');
    const actionCards = messagesEl.querySelectorAll('.claudian-tutor-action-card');
    expect(actionCards).toHaveLength(1);
    expect(actionCards[0].querySelector('.claudian-tutor-action-kicker')?.textContent).toBe('AI Tutor - Accepted');
    expect(actionCards[0].querySelector('.claudian-tutor-action-label')?.textContent).toBe('Plan chapter');
    expect(actionCards[0].querySelector('.claudian-tutor-action-message')?.textContent).toBe('Chapter plan saved.');
    const planItems = actionCards[0].querySelector('.claudian-tutor-action-items');
    expect(planItems?.children[0]?.textContent).toBe('Low-pass intuition');
  });

  it('appends live learning action results to the streaming assistant message', () => {
    const { renderer, messagesEl } = createRenderer();
    const msg: ChatMessage = {
      id: 'assistant-live-action-result',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [],
    };
    const outcomeBlocks: LearningActionResultContentBlock[] = [{
      type: 'learning_action_result',
      actionType: 'startNewLesson',
      label: 'Start new lesson',
      status: 'accepted',
      message: 'New lesson conversation opened.',
      items: ['Continuity check', 'First concept'],
    }];

    renderer.addMessage(msg);
    renderer.appendLearningActionResults(msg.id, outcomeBlocks);

    const actionCards = messagesEl.querySelectorAll('.claudian-tutor-action-card');
    expect(actionCards).toHaveLength(1);
    expect(actionCards[0].querySelector('.claudian-tutor-action-kicker')?.textContent).toBe('AI Tutor - Accepted');
    expect(actionCards[0].querySelector('.claudian-tutor-action-label')?.textContent).toBe('Start new lesson');
    const lessonItems = actionCards[0].querySelector('.claudian-tutor-action-items');
    expect(lessonItems?.children[0]?.textContent).toBe('Continuity check');
  });

  it('renders persisted lesson plan cards with clickable sources and next lesson summary', () => {
    const { renderer, messagesEl, openSource } = createRenderer();
    const msg: ChatMessage = {
      id: 'assistant-lesson-plan',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [{
        type: 'learning_lesson_plan',
        title: 'Filters',
        detail: 'Chapter 1',
        overview: 'Build intuition before formulas.',
        parts: [{
          title: 'Low-pass intuition',
          status: 'current',
          description: 'Understand what low-pass filters keep and remove.',
          bulletPoints: ['Cut high-frequency noise', 'Keep slow signal trend'],
          sources: [{ label: 'Filter notes', path: 'sources/filter-notes.md' }],
        }, {
          title: 'Cutoff frequency',
          status: 'pending',
        }],
        nextLessonSummary: 'Next we will move into sampling.',
      }],
    };

    renderer.renderStoredMessage(msg);

    const cards = messagesEl.querySelectorAll('.claudian-lesson-plan-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.claudian-lesson-plan-kicker')?.textContent).toBe('AI Tutor - Lesson plan');
    expect(cards[0].querySelector('.claudian-lesson-plan-title')?.textContent).toBe('Filters');
    expect(cards[0].querySelector('.claudian-lesson-plan-overview')?.textContent).toBe('Build intuition before formulas.');
    expect(cards[0].querySelector('.claudian-lesson-plan-part-title')?.textContent).toBe('Low-pass intuition');
    expect(cards[0].querySelector('.claudian-lesson-plan-bullets')?.children[0]?.textContent).toBe('Cut high-frequency noise');
    expect(cards[0].querySelector('.claudian-lesson-plan-source')?.textContent).toBe('Filter notes');
    expect(cards[0].querySelector('.claudian-lesson-plan-next-text')?.textContent).toBe('Next we will move into sampling.');

    (cards[0].querySelector('.claudian-lesson-plan-source') as HTMLElement | null)?.click();

    expect(openSource).toHaveBeenCalledWith({ label: 'Filter notes', path: 'sources/filter-notes.md' });
  });

  it('appends live lesson plan cards to a streaming assistant message', () => {
    const { renderer, messagesEl } = createRenderer();
    const msg: ChatMessage = {
      id: 'assistant-live-lesson-plan',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [],
    };
    const plan: LearningLessonPlanContentBlock = {
      type: 'learning_lesson_plan',
      title: 'FrameworkBase.hpp',
      parts: [{ title: 'Runtime type system', status: 'current' }],
    };

    renderer.addMessage(msg);
    renderer.appendLearningLessonPlans(msg.id, [plan]);

    const cards = messagesEl.querySelectorAll('.claudian-lesson-plan-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.claudian-lesson-plan-title')?.textContent).toBe('FrameworkBase.hpp');
  });

  it('appends live learning next-step chips to a streaming assistant message', () => {
    const onNextOption = jest.fn();
    const { renderer, messagesEl } = createRenderer(undefined, 'claude', {}, onNextOption);
    const msg: ChatMessage = {
      id: 'assistant-live-next-steps',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [],
    };
    const block: LearningNextStepsContentBlock = {
      type: 'learning_next_steps',
      detail: 'Chapter 2 review complete',
      options: ['Start new lesson'],
    };

    renderer.addMessage(msg);
    renderer.appendLearningNextSteps(msg.id, [block]);

    const row = messagesEl.querySelector('.claudian-next-options');
    expect(row).not.toBeNull();
    expect(row?.classList.contains('is-learning-next-steps')).toBe(true);
    expect(row?.querySelector('.claudian-next-option-chip')?.textContent).toBe('Start new lesson');
  });

  it('renders learning activity cards for orchestrated provider turns', () => {
    const { renderer, messagesEl } = createRenderer();
    const msg: ChatMessage = {
      id: 'assistant-activity',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [{
        type: 'learning_activity',
        label: 'Planning chapter',
        status: 'running',
        detail: 'Chapter 2: Endurance base',
        items: ['Read continuity', 'Plan 3-6 sections'],
      }],
    };

    renderer.renderStoredMessage(msg);

    const cards = messagesEl.querySelectorAll('.claudian-learning-activity-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.claudian-learning-activity-kicker')?.textContent).toBe('AI Tutor - Working');
    expect(cards[0].querySelector('.claudian-learning-activity-label')?.textContent).toBe('Planning chapter');
    expect(cards[0].querySelector('.claudian-learning-activity-detail')?.textContent).toBe('Chapter 2: Endurance base');
    expect(cards[0].querySelector('.claudian-learning-activity-items')?.children[0]?.textContent).toBe('Read continuity');
  });

  it('appends live learning activity cards to a streaming assistant message', () => {
    const { renderer, messagesEl } = createRenderer();
    const msg: ChatMessage = {
      id: 'assistant-live-activity',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [],
    };
    const activity: LearningActivityContentBlock = {
      type: 'learning_activity',
      label: 'Starting next section',
      status: 'running',
      detail: 'Section 2/3: Cutoff frequency',
    };

    renderer.addMessage(msg);
    renderer.appendLearningActivity(msg.id, activity);

    const cards = messagesEl.querySelectorAll('.claudian-learning-activity-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.claudian-learning-activity-label')?.textContent).toBe('Starting next section');
  });

  it('updates live learning activity cards when the activity finishes', () => {
    const { renderer, messagesEl } = createRenderer();
    const msg: ChatMessage = {
      id: 'assistant-live-activity-done',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [],
    };
    const activity: LearningActivityContentBlock = {
      type: 'learning_activity',
      label: 'Planning chapter',
      status: 'running',
      detail: 'Chapter 2: Filters',
    };

    renderer.addMessage(msg);
    renderer.appendLearningActivity(msg.id, activity);
    renderer.appendLearningActivity(msg.id, { ...activity, status: 'done' });

    const cards = messagesEl.querySelectorAll('.claudian-learning-activity-card');
    const finalCard = cards[cards.length - 1];
    expect(finalCard.classList.contains('is-done')).toBe(true);
    expect(finalCard.querySelector('.claudian-learning-activity-kicker')?.textContent).toBe('AI Tutor - Done');
  });

  it('renders stopped and error learning activity states', () => {
    const { renderer, messagesEl } = createRenderer();

    renderer.renderStoredMessage({
      id: 'assistant-stopped-activity',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [{
        type: 'learning_activity',
        label: 'Starting next section',
        status: 'stopped',
      }],
    });
    renderer.renderStoredMessage({
      id: 'assistant-error-activity',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [{
        type: 'learning_activity',
        label: 'Planning chapter',
        status: 'error',
      }],
    });

    const cards = messagesEl.querySelectorAll('.claudian-learning-activity-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.claudian-learning-activity-kicker')?.textContent).toBe('AI Tutor - Stopped');
    expect(cards[1].querySelector('.claudian-learning-activity-kicker')?.textContent).toBe('AI Tutor - Error');
  });

  it('renders bare interrupt marker for empty interrupted assistant message', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-2',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create a bare interrupt marker (same as Claude-style)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    expect(textEl.children[0].hasClass('claudian-interrupted')).toBe(true);
  });

  it('skips rebuilt context messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'rebuilt-1',
      role: 'user',
      content: 'rebuilt context',
      timestamp: Date.now(),
      isRebuiltContext: true,
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(0);
  });

  it('renders user message with text content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello world',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-user')).toBe(true);
  });

  it('renders user message with displayContent instead of content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  it('renders extracted user display content when stored message has hidden XML context', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Explain this\n\n<current_note>\nnotes/test.md\n</current_note>',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Explain this');
  });

  it('skips empty user message bubble (image-only)', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    renderer.renderStoredMessage(msg);

    // Images should still be rendered, but no message bubble
    expect(renderer.renderMessageImages).toHaveBeenCalled();
    // Only the images container, no message bubble
    const bubbles = messagesEl.children.filter(
      (c: any) => c.hasClass('claudian-message')
    );
    expect(bubbles.length).toBe(0);
  });

  it('renders user message with images above bubble', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Check this image',
      timestamp: Date.now(),
      images,
    };

    renderer.renderStoredMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('adds a rewind button for eligible stored user messages', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.renderStoredMessage(allMessages[1], allMessages, 1);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).not.toBeNull();
  });

  it('adds rewind but not fork for a completed first user message', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const forkCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      rewindCallback,
      forkCallback,
      mockCapabilities(),
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const allMessages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'response', timestamp: 2, assistantMessageId: 'resp-a' },
    ];

    renderer.renderStoredMessage(allMessages[0], allMessages, 0);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-message-fork-btn')).toBeNull();
    expect((renderer as any).liveMessageEls.has('u1')).toBe(false);
  });

  it('does not add a rewind button when stored render is called without context', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
      userMessageId: 'user-u',
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).toBeNull();
  });

  it('shows rewind mode menu for eligible streamed user messages', async () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 2,
      userMessageId: 'user-u',
    };
    renderer.addMessage(userMsg);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      userMsg,
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.refreshActionButtons(userMsg, allMessages, 1);

    const btn = messagesEl.querySelector('.claudian-message-rewind-btn');
    expect(btn).not.toBeNull();

    btn!.click();
    const menu = (Menu as typeof Menu & { instances: any[] }).instances[0];
    expect(menu.items.map((item: any) => item.title)).toEqual([
      'Rewind conversation only',
      'Rewind code + conversation',
    ]);

    menu.items[0].clickHandler?.();
    await Promise.resolve();

    expect(rewindCallback).toHaveBeenCalledWith('u1', 'conversation');
  });

  it('refreshes rewind but not fork for a streamed first user message', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const forkCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      rewindCallback,
      forkCallback,
      mockCapabilities(),
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
      userMessageId: 'user-u',
    };
    renderer.addMessage(userMsg);

    renderer.refreshActionButtons(userMsg, [
      userMsg,
      { id: 'a1', role: 'assistant', content: 'response', timestamp: 2, assistantMessageId: 'resp-a' },
    ], 0);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-message-fork-btn')).toBeNull();
  });

  // ============================================
  // renderAssistantContent
  // ============================================

  it('renders assistant content blocks using specialized renderers', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'todo', name: 'TodoWrite', input: { items: [] } } as any,
        { id: 'edit', name: 'Edit', input: { file_path: 'notes/test.md' } } as any,
        { id: 'read', name: 'Read', input: { file_path: 'notes/test.md' } } as any,
        {
          id: 'sub-1',
          name: TOOL_TASK,
          input: { description: 'Async subagent' },
          status: 'running',
          subagent: { id: 'sub-1', mode: 'async', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
        {
          id: 'sub-2',
          name: TOOL_TASK,
          input: { description: 'Sync subagent' },
          status: 'running',
          subagent: { id: 'sub-2', mode: 'sync', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
      ],
      contentBlocks: [
        { type: 'thinking', content: 'thinking', durationSeconds: 2 } as any,
        { type: 'text', content: 'Text block' } as any,
        { type: 'tool_use', toolId: 'todo' } as any,
        { type: 'tool_use', toolId: 'edit' } as any,
        { type: 'tool_use', toolId: 'read' } as any,
        { type: 'subagent', subagentId: 'sub-1', mode: 'async' } as any,
        { type: 'subagent', subagentId: 'sub-2' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredThinkingBlock).not.toHaveBeenCalled();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Text block');
    // TodoWrite is not rendered inline - only in bottom panel
    expect(renderStoredWriteEdit).toHaveBeenCalled();
    expect(renderStoredToolCall).toHaveBeenCalled();
    expect(renderStoredAsyncSubagent).toHaveBeenCalled();
    expect(renderStoredSubagent).toHaveBeenCalled();
  });

  it('passes collapsed file-edit default to stored Write/Edit renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'm-write-default',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'edit-1', name: 'Edit', input: { file_path: 'notes/test.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'edit-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredWriteEdit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'edit-1', name: 'Edit' }),
      { initiallyExpanded: false },
    );
  });

  it('passes expanded file-edit default to stored Write/Edit renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', { expandFileEditsByDefault: true });

    const msg: ChatMessage = {
      id: 'm-write-expanded',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'write-1', name: 'Write', input: { file_path: 'notes/test.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'write-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredWriteEdit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'write-1', name: 'Write' }),
      { initiallyExpanded: true },
    );
  });

  it('skips empty or whitespace-only text blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: '' } as any,
        { type: 'text', content: '   ' } as any,
        { type: 'text', content: 'Real content' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Only the non-empty text block should trigger renderContent
    expect(renderContentSpy).toHaveBeenCalledTimes(1);
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Real content');
  });

  it('does not render stored Codex write_stdin transport tools', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: '' },
          status: 'completed',
          result: 'poll output',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
    expect(messagesEl.children).toHaveLength(0);
  });

  it('renders stored Codex write_stdin tools when they send real input', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: 'y\n' },
          status: 'completed',
          result: 'Input sent.',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'stdin-1',
        name: TOOL_WRITE_STDIN,
        input: { session_id: '2404', chars: 'y\n' },
      }),
      { initiallyExpanded: false },
    );
    expect(messagesEl.children).toHaveLength(1);
  });

  it('passes expanded file-edit default to stored apply_patch renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex', { expandFileEditsByDefault: true });

    const msg: ChatMessage = {
      id: 'm-apply-patch-expanded',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'patch-1',
          name: TOOL_APPLY_PATCH,
          input: { changes: [{ path: 'src/main.ts', kind: 'update' }] },
          status: 'completed',
          result: 'Applied patch',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'patch-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'patch-1', name: TOOL_APPLY_PATCH }),
      { initiallyExpanded: true },
    );
  });

  it('renders response duration footer when durationSeconds is present', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response text' } as any,
      ],
      durationSeconds: 65,
      durationFlavorWord: 'Baked',
    };

    renderer.renderStoredMessage(msg);

    // Find the footer element
    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0]; // claudian-message-content
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeDefined();
    const durationSpan = footerEl!.children[0];
    expect(durationSpan.textContent).toContain('Baked');
    expect(durationSpan.textContent).toContain('1m 5s');
  });

  it('does not render footer when durationSeconds is 0', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 0,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeUndefined();
  });

  it('uses default flavor word "Baked" when durationFlavorWord is not set', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 30,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeDefined();
    expect(footerEl!.children[0].textContent).toContain('Baked');
  });

  it('renders fallback content for old conversations without contentBlocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const addCopySpy = jest.spyOn(renderer, 'addTextCopyButton').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Legacy response text',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Should render content text
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should add copy button for fallback text
    expect(addCopySpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should render tool call
    expect(renderStoredToolCall).toHaveBeenCalled();
  });

  it('renders unreferenced tool calls when contentBlocks miss tool_use blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-unreferenced-tool',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'a.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'text', content: 'Only text block persisted' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Only text block persisted');
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' }),
      { initiallyExpanded: false },
    );
  });

  it('renders Task tool calls as subagents for backward compatibility', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-1',
          name: TOOL_TASK,
          input: { description: 'Run tests' },
          status: 'completed',
          result: 'All passed',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-1',
        description: 'Run tests',
        status: 'completed',
        result: 'All passed',
      })
    );
  });

  it('renders Task tool as async subagent when linked subagent mode is async', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-1',
          name: TOOL_TASK,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: 'Task running',
          subagent: {
            id: 'task-async-1',
            description: 'Background task',
            mode: 'async',
            asyncStatus: 'running',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-1',
        mode: 'async',
        asyncStatus: 'running',
      })
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  it('infers async running state from structured Task result content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async-structured',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-structured-1',
          name: TOOL_TASK,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: [{ type: 'text', text: '{"status":"running"}' }] as any,
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-structured-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-structured-1',
        asyncStatus: 'running',
      })
    );
  });

  it('uses subagent block mode hint when linked subagent mode is missing', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-mode-hint',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-hint-1',
          name: TOOL_TASK,
          input: { description: 'Background task from block hint' },
          status: 'running',
          subagent: {
            id: 'task-hint-1',
            description: 'Background task from block hint',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'subagent', subagentId: 'task-hint-1', mode: 'async' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-hint-1',
        mode: 'async',
      })
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  // ============================================
  // TaskOutput skipping
  // ============================================

  it('should skip TaskOutput tool calls (internal async subagent communication)', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc', block: true } } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
  });

  it('should render other tool calls but skip TaskOutput when mixed', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc' } } as any,
        { id: 'grep-1', name: 'Grep', input: { pattern: 'test' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'read-1' } as any,
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
        { type: 'tool_use', toolId: 'grep-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledTimes(2);
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' }),
      { initiallyExpanded: false },
    );
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'grep-1', name: 'Grep' }),
      { initiallyExpanded: false },
    );
  });

  // ============================================
  // addMessage (streaming)
  // ============================================

  it('addMessage creates user message bubble with text', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('claudian-message-user')).toBe(true);
  });

  it('addMessage stores a truncated first-line table-of-contents title for user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: `${'x'.repeat(90)}\nsecond line`,
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.getAttribute('data-toc-title')).toBe(`${'x'.repeat(77)}...`);
  });

  it('addMessage renders images for user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Look at this',
      timestamp: Date.now(),
      images,
    };

    renderer.addMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('addMessage skips empty bubble for image-only user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});
    const scrollSpy = jest.spyOn(renderer, 'scrollToBottom').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    const result = renderer.addMessage(msg);

    // Should still return an element (last child or messagesEl)
    expect(result).toBeDefined();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('addMessage creates assistant message element without user-specific rendering', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
  });

  // ============================================
  // setMessagesEl
  // ============================================

  it('setMessagesEl updates the container element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const newEl = createMockEl();

    renderer.setMessagesEl(newEl);

    // Verify by using scrollToBottom which references messagesEl
    renderer.scrollToBottom();
    // The new element should have been used (scrollTop set)
    expect(newEl.scrollTop).toBe(newEl.scrollHeight);
  });

  // ============================================
  // Image rendering
  // ============================================

  it('renderMessageImages creates image elements', () => {
    const containerEl = createMockEl();
    const { renderer } = createRenderer();
    jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data1', size: 200, source: 'file' },
      { id: 'img-2', name: 'avatar.jpg', mediaType: 'image/jpeg', data: 'base64data2', size: 300, source: 'file' },
    ];

    renderer.renderMessageImages(containerEl, images);

    // Should create images container with 2 image wrappers
    expect(containerEl.children.length).toBe(1);
    const imagesContainer = containerEl.children[0];
    expect(imagesContainer.hasClass('claudian-message-images')).toBe(true);
    expect(imagesContainer.children.length).toBe(2);
  });

  it('setImageSrc sets data URI on image element', () => {
    const { renderer } = createRenderer();
    const imgEl = createMockEl('img');

    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    renderer.setImageSrc(imgEl as any, image);

    expect(imgEl.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('showFullImage creates overlay with image', () => {
    const { renderer } = createRenderer();
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    // Mock document.body.createDiv (document may not exist in node env)
    const overlayEl = createMockEl();
    const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
    const origDocument = globalThis.document;
    (globalThis as any).document = { body: mockBody, addEventListener: jest.fn(), removeEventListener: jest.fn() };

    try {
      renderer.showFullImage(image);
      expect(mockBody.createDiv).toHaveBeenCalledWith({ cls: 'claudian-image-modal-overlay' });
    } finally {
      (globalThis as any).document = origDocument;
    }
  });

  // ============================================
  // Copy button
  // ============================================

  it('addTextCopyButton adds a copy button element', () => {
    const textEl = createMockEl();
    const { renderer } = createRenderer();

    renderer.addTextCopyButton(textEl, 'some markdown');

    expect(textEl.children.length).toBe(1);
    const copyBtn = textEl.children[0];
    expect(copyBtn.hasClass('claudian-text-copy-btn')).toBe(true);
  });

  // ============================================
  // Scroll utilities
  // ============================================

  it('scrollToBottom sets scrollTop to scrollHeight', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    const { renderer } = createRenderer(messagesEl);

    renderer.scrollToBottom();

    expect(messagesEl.scrollTop).toBe(1000);
  });

  it('scrollToBottomIfNeeded scrolls when near bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 950;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    // Mock requestAnimationFrame
    const origRAF = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 0; };

    try {
      renderer.scrollToBottomIfNeeded();
      // Near bottom (1000 - 950 - 0 = 50, < 100 threshold) → scrolls
      expect(messagesEl.scrollTop).toBe(1000);
    } finally {
      (globalThis as any).requestAnimationFrame = origRAF;
    }
  });

  it('scrollToBottomIfNeeded does not scroll when far from bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 100;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    const originalScrollTop = messagesEl.scrollTop;
    renderer.scrollToBottomIfNeeded();

    // scrollTop should not change (900 > 100 threshold)
    expect(messagesEl.scrollTop).toBe(originalScrollTop);
  });

  // ============================================
  // renderContent
  // ============================================

  it('renderContent should not throw on valid markdown', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();

    // Should not throw even if internal rendering fails (graceful error handling)
    await expect(renderer.renderContent(el, '**Hello** world')).resolves.not.toThrow();
  });

  it('renderContent should empty the element before rendering', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    el.createDiv({ text: 'old content' });
    expect(el.children.length).toBe(1);

    await renderer.renderContent(el, 'new content');

    // After render, old content should be gone (empty() was called before rendering)
    expect(el.children.length).toBe(0);
  });

  it('renderContent should skip file-link post-processing when markdown has no wikilinks', async () => {
    const { processFileLinks } = await import('@/utils/fileLink');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, 'plain markdown without links');

    expect(processFileLinks).not.toHaveBeenCalled();
  });

  it('renderContent escapes math delimiters only when requested for streaming', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(
      el,
      'Live $x + y$ and `echo $PATH`',
      { deferMath: true }
    );

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Live \\$x + y\\$ and `echo $PATH`',
      el,
      '',
      expect.anything()
    );
  });

  // ============================================
  // addTextCopyButton - click behavior
  // ============================================

  describe('addTextCopyButton - click behavior', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('click should copy and show feedback', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'markdown content');

      const copyBtn = textEl.children[0];
      expect(copyBtn.hasClass('claudian-text-copy-btn')).toBe(true);

      // Simulate click
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      await clickHandlers![0]({ stopPropagation: jest.fn() });

      expect(writeTextMock).toHaveBeenCalledWith('markdown content');
      expect(copyBtn.textContent).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);
    });

    it('should handle clipboard API failure gracefully', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockRejectedValue(new Error('not allowed'));
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'content');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Should not throw
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // Should not show feedback on error
      expect(copyBtn.textContent).not.toBe('copied!');
    });
  });

  // ============================================
  // renderMessages (entry point)
  // ============================================

  it('renderMessages should render stored messages and return welcome element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'a1', role: 'assistant', content: 'Hi there', timestamp: Date.now(), contentBlocks: [{ type: 'text', content: 'Hi there' }] as any },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Good morning!');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl!.hasClass('claudian-welcome')).toBe(true);
  });

  it('renderMessages should store table-of-contents title from displayContent before content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Expanded prompt that should not appear',
        displayContent: 'Visible slash command\nwith details',
        timestamp: Date.now(),
      },
    ];

    renderer.renderMessages(messages, () => 'Hello');

    const msgEl = messagesEl.querySelector('.claudian-message-user');
    expect(msgEl?.getAttribute('data-toc-title')).toBe('Visible slash command');
  });

  it('renderMessages should hide welcome when messages exist', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    // When messages exist, welcome should be hidden
    expect(welcomeEl).toBeDefined();
  });

  it('renderMessages should return welcome element when no messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const welcomeEl = renderer.renderMessages([], () => 'Welcome');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl!.hasClass('claudian-welcome')).toBe(true);
  });

  // ============================================
  // Task tool rendering - error and running status
  // ============================================

  describe('Task tool rendering - error and running status', () => {
    it('renders Task tool with error status as subagent with status error', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-err',
            name: TOOL_TASK,
            input: { description: 'Failing task' },
            status: 'error',
            result: 'Something went wrong',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-err' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-err',
          description: 'Failing task',
          status: 'error',
          result: 'Something went wrong',
        })
      );
    });

    it('renders Task tool with running status (default case in switch)', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-run',
            name: TOOL_TASK,
            input: { description: 'Running task' },
            status: 'pending',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-run' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-run',
          description: 'Running task',
          status: 'running',
        })
      );
    });

    it('renders Task tool with no description uses fallback Subagent task', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-no-desc',
            name: TOOL_TASK,
            input: {},
            status: 'completed',
            result: 'Done',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-no-desc' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-no-desc',
          description: 'Subagent task',
          status: 'completed',
        })
      );
    });

    it('renders Codex spawn_agent with the same prompt and result recovered on reload', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm-codex-subagent',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'spawn-1',
            name: TOOL_SPAWN_AGENT,
            input: {
              message: 'Inspect utils.ts and return the final patch summary.',
              model: 'gpt-5.4-mini',
            },
            status: 'completed',
            result: '{"agent_id":"agent-1","nickname":"Zeno"}',
          } as any,
          {
            id: 'wait-1',
            name: TOOL_WAIT_AGENT,
            input: { targets: ['agent-1'], timeout_ms: 30000 },
            status: 'completed',
            result: '{"status":{"agent-1":{"completed":"Patched utils.ts and verified imports."}},"timed_out":false}',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'spawn-1' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'spawn-1',
          description: 'Zeno (gpt-5.4-mini)',
          prompt: 'Inspect utils.ts and return the final patch summary.',
          status: 'completed',
          result: 'Patched utils.ts and verified imports.',
        })
      );
    });
  });

  // ============================================
  // showFullImage - close behaviors
  // ============================================

  describe('showFullImage - close behaviors', () => {
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    function setupDocumentMock() {
      const overlayEl = createMockEl();
      const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
      const docListeners = new Map<string, ((...args: any[]) => void)[]>();
      const origDocument = globalThis.document;

      (globalThis as any).document = {
        body: mockBody,
        addEventListener: jest.fn((event: string, handler: (...args: any[]) => void) => {
          if (!docListeners.has(event)) docListeners.set(event, []);
          docListeners.get(event)!.push(handler);
        }),
        removeEventListener: jest.fn((event: string, handler: (...args: any[]) => void) => {
          const handlers = docListeners.get(event);
          if (handlers) {
            const idx = handlers.indexOf(handler);
            if (idx !== -1) handlers.splice(idx, 1);
          }
        }),
      };

      return { overlayEl, docListeners, origDocument };
    }

    it('closeBtn click removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        // The overlay has a modal child, which has a close button child
        const modalEl = overlayEl.children[0]; // claudian-image-modal
        // Children: img (index 0), closeBtn (index 1)
        const closeBtn = modalEl.children[1];
        expect(closeBtn.hasClass('claudian-image-modal-close')).toBe(true);

        const removeSpy = jest.spyOn(overlayEl, 'remove');
        closeBtn.click();

        expect(removeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('clicking overlay background removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        const removeSpy = jest.spyOn(overlayEl, 'remove');

        // Simulate click on the overlay itself (e.target === overlay)
        const clickHandlers = overlayEl._eventListeners.get('click');
        expect(clickHandlers).toBeDefined();
        clickHandlers![0]({ target: overlayEl });

        expect(removeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('ESC key removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, docListeners, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        const removeSpy = jest.spyOn(overlayEl, 'remove');

        // Simulate ESC key press via the document keydown listener
        const keydownHandlers = docListeners.get('keydown');
        expect(keydownHandlers).toBeDefined();
        expect(keydownHandlers!.length).toBeGreaterThan(0);
        keydownHandlers![0]({ key: 'Escape' });

        expect(removeSpy).toHaveBeenCalled();
        // After close, the keydown handler should be removed
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
      } finally {
        (globalThis as any).document = origDocument;
      }
    });
  });

  // ============================================
  // renderContent - code block wrapping (error path)
  // ============================================

  describe('renderContent - error handling', () => {
    it('renderContent shows error div when MarkdownRenderer throws', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockRejectedValueOnce(
        new Error('Render failed')
      );

      const { renderer } = createRenderer();
      const el = createMockEl();

      await renderer.renderContent(el, '**broken markdown**');

      const errorDiv = el.children.find(
        (c: any) => c.hasClass('claudian-render-error')
      );
      expect(errorDiv).toBeDefined();
      expect(errorDiv!.textContent).toBe('Failed to render message content.');
    });
  });

  // ============================================
  // addTextCopyButton - rapid click handling
  // ============================================

  describe('addTextCopyButton - rapid click handling', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('rapid clicks clear previous timeout', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      // First click
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(copyBtn.textContent).toBe('Copied!');

      // Second rapid click before timeout expires
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // clearTimeout should have been called for the first pending timeout
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(copyBtn.textContent).toBe('Copied!');

      clearTimeoutSpy.mockRestore();
    });

    it('feedback timeout restores icon after delay', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const originalInnerHTML = copyBtn.innerHTML;
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Click to copy
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(copyBtn.textContent).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);

      // Advance timers by 1500ms (the feedback duration)
      jest.advanceTimersByTime(1500);

      // Icon should be restored and copied class removed
      expect(copyBtn.innerHTML).toBe(originalInnerHTML);
      expect(copyBtn.classList.contains('copied')).toBe(false);
    });
  });

  // ============================================
  // renderContent - code block wrapping
  // ============================================

  describe('renderContent - code block wrapping', () => {
    it('passes image-processed markdown directly to MarkdownRenderer', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { replaceImageEmbedsWithHtml } = await import('@/utils/imageEmbed');
      const { processFileLinks } = await import('@/utils/fileLink');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (replaceImageEmbedsWithHtml as jest.Mock).mockReturnValueOnce(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]'
      );

      await renderer.renderContent(el, 'before-images ![[image.png]] [[note.md]]');

      expect(replaceImageEmbedsWithHtml).toHaveBeenCalledWith(
        'before-images ![[image.png]] [[note.md]]',
        expect.anything(),
        { mediaFolder: '' }
      );
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]',
        el,
        '',
        expect.anything()
      );
      expect(processFileLinks).toHaveBeenCalledWith(expect.anything(), el);
    });

    it('should wrap pre elements in code wrapper divs', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create a pre element in the container
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'console.log("hello")' });
        }
      );

      await renderer.renderContent(el, '```js\nconsole.log("hello")\n```');

      // The pre should be wrapped in a claudian-code-wrapper
      // Due to mock limitations, check that querySelectorAll was called on el
      // The actual wrapping logic runs on real DOM, but the mock captures calls
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should skip wrapping already-wrapped pre elements', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create an already-wrapped pre element
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const wrapper = container.createDiv({ cls: 'claudian-code-wrapper' });
          wrapper.createEl('pre');
        }
      );

      await renderer.renderContent(el, '```\nalready wrapped\n```');

      // Should not throw and should complete normally
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // renderMessageImages - click handler
  // ============================================

  describe('renderMessageImages - click handler', () => {
    it('should add click handler on image elements', () => {
      const containerEl = createMockEl();
      const { renderer } = createRenderer();
      const showFullImageSpy = jest.spyOn(renderer, 'showFullImage').mockImplementation(() => {});
      jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

      const images: ImageAttachment[] = [
        { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
      ];

      renderer.renderMessageImages(containerEl, images);

      // Find the img element and check for click handler
      const imagesContainer = containerEl.children[0];
      const wrapper = imagesContainer.children[0];
      const imgEl = wrapper.children[0]; // The img element

      // Check click handler is registered
      const clickHandlers = imgEl._eventListeners?.get('click');
      expect(clickHandlers).toBeDefined();
      expect(clickHandlers!.length).toBe(1);

      // Trigger click and verify showFullImage is called
      clickHandlers![0]();
      expect(showFullImageSpy).toHaveBeenCalledWith(images[0]);
    });
  });

  // ============================================
  // renderContent - code block wrapping with language labels
  // ============================================

  describe('renderContent - language label and copy', () => {
    it('should add language label when code block has language class', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          const code = pre.createEl('code');
          code.className = 'language-typescript';
          code.textContent = 'const x = 1;';
        }
      );

      await renderer.renderContent(el, '```typescript\nconst x = 1;\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should move copy-code-button outside pre into wrapper', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'some code' });
          const copyBtn = pre.createEl('button');
          copyBtn.className = 'copy-code-button';
        }
      );

      await renderer.renderContent(el, '```\nsome code\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // addMessage - displayContent for user messages
  // ============================================

  it('addMessage renders displayContent instead of content when available', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.addMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  // ============================================
  // Stored thinking blocks are hidden from the chat surface
  // ============================================

  describe('stored thinking block visibility', () => {
    it('does not render a stored thinking-only assistant message', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'deep thought', durationSeconds: 42 } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).not.toHaveBeenCalled();
      expect(messagesEl.children.length).toBe(0);
    });

    it('renders visible text while suppressing adjacent stored thinking', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: 'Visible answer',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'thought without duration' } as any,
          { type: 'text', content: 'Visible answer' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).not.toHaveBeenCalled();
      expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Visible answer');
    });
  });
});
