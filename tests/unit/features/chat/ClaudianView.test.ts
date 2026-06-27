import { createMockEl } from '@test/helpers/mockElement';
import { Platform, Scope } from 'obsidian';

import { ClaudianView } from '@/features/chat/ClaudianView';

const MockScope = Scope as typeof Scope & { instances: Scope[] };

function createViewHarness(options: {
  canCreateTab: boolean;
  tabCount?: number;
}): {
  newTabButtonEl: ReturnType<typeof createMockEl>;
  view: any;
} {
  const newTabButtonEl = createMockEl();
  const view = Object.create(ClaudianView.prototype) as any;

  view.plugin = {
    settings: {},
  };
  view.tabManager = {
    canCreateTab: jest.fn().mockReturnValue(options.canCreateTab),
    getTabCount: jest.fn().mockReturnValue(options.tabCount ?? 1),
  };
  view.tabBarContainerEl = createMockEl();
  view.logoEl = createMockEl();
  view.newTabButtonEl = newTabButtonEl;

  return { newTabButtonEl, view };
}

describe('ClaudianView tab controls', () => {
  it('hides the new-tab button when the tab manager is at capacity', () => {
    const { newTabButtonEl, view } = createViewHarness({ canCreateTab: false });

    view.refreshTabControls();

    expect(newTabButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBe('true');
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the new-tab button when another tab can be created', () => {
    const { newTabButtonEl, view } = createViewHarness({ canCreateTab: true });
    newTabButtonEl.addClass('claudian-hidden');
    newTabButtonEl.setAttribute('aria-disabled', 'true');
    newTabButtonEl.setAttribute('aria-hidden', 'true');

    view.refreshTabControls();

    expect(newTabButtonEl.hasClass('claudian-hidden')).toBe(false);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBeNull();
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBeNull();
  });

  it('keeps tab controls in the view-owned input row', () => {
    const navRowContent = createMockEl();
    const inputNavRowHostEl = createMockEl();
    const view = Object.create(ClaudianView.prototype) as any;

    view.containerEl = createMockEl();
    view.navRowContent = navRowContent;
    view.inputNavRowHostEl = inputNavRowHostEl;
    view.tabBar = {
      captureScrollPosition: jest.fn(),
      restoreScrollPosition: jest.fn(),
    };

    view.attachNavRowContentToInputFooter();

    expect(inputNavRowHostEl.children).toContain(navRowContent);
    expect(view.tabBar.captureScrollPosition).toHaveBeenCalledTimes(1);
    expect(view.tabBar.restoreScrollPosition).toHaveBeenCalledTimes(1);
  });

  it('moves only the active tab input into the stable input slot', () => {
    const activeInputSlotEl = createMockEl();
    const tab1 = {
      id: 'tab-1',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl: createMockEl(),
        inputContainerEl: createMockEl(),
      },
    };
    const tab2 = {
      id: 'tab-2',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl: createMockEl(),
        inputContainerEl: createMockEl(),
      },
    };
    const view = Object.create(ClaudianView.prototype) as any;

    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn()
        .mockReturnValueOnce(tab1)
        .mockReturnValueOnce(tab2),
      getTab: jest.fn((id: string) => id === 'tab-1' ? tab1 : tab2),
    };

    view.updateInputLocation();
    view.updateInputLocation();

    expect(activeInputSlotEl.children).toContain(tab2.dom.inputComposerEl);
    expect(activeInputSlotEl.children).not.toContain(tab1.dom.inputComposerEl);
    expect(tab1.dom.contentEl.children).toContain(tab1.dom.inputComposerEl);
  });

  it('preserves active pending prompt siblings during same-tab input updates', () => {
    const activeInputSlotEl = createMockEl();
    const inputComposerEl = activeInputSlotEl.createDiv();
    const pendingPromptEl = inputComposerEl.createDiv({ cls: 'claudian-ask-question-inline' });
    const tab = {
      id: 'tab-1',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl,
        inputContainerEl: inputComposerEl.createDiv({ cls: 'claudian-input-container' }),
      },
    };
    const view = Object.create(ClaudianView.prototype) as any;

    Object.defineProperty(inputComposerEl, 'parentElement', {
      configurable: true,
      get: () => activeInputSlotEl,
    });
    view.activeInputTabId = 'tab-1';
    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(tab),
      getTab: jest.fn().mockReturnValue(tab),
    };

    view.updateInputLocation();

    expect(activeInputSlotEl.children).toContain(inputComposerEl);
    expect(inputComposerEl.children).toContain(pendingPromptEl);
  });

  it('clears the stable input slot when no tab is active', () => {
    const activeInputSlotEl = createMockEl();
    const staleInputEl = activeInputSlotEl.createDiv();
    const view = Object.create(ClaudianView.prototype) as any;

    view.activeInputTabId = 'tab-1';
    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(null),
    };

    view.updateInputLocation();

    expect(activeInputSlotEl.children).not.toContain(staleInputEl);
    expect(view.activeInputTabId).toBeNull();
  });

  it('toggles the history dropdown when the history button is clicked', () => {
    const historyDropdown = createMockEl();
    const view = Object.create(ClaudianView.prototype) as any;

    view.historyDropdown = historyDropdown;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(null),
    };

    view.toggleHistoryDropdown();

    expect(historyDropdown.hasClass('visible')).toBe(true);

    view.toggleHistoryDropdown();

    expect(historyDropdown.hasClass('visible')).toBe(false);
  });

  it('shows the write-note action only when the current learning section can be written', () => {
    const practiceButtonEl = createMockEl('button');
    const writeNoteButtonEl = createMockEl('button');
    const advanceSectionButtonEl = createMockEl('button');
    const reviewLessonButtonEl = createMockEl('button');
    const startNewLessonButtonEl = createMockEl('button');
    const advanceSectionButtonLabelEl = createMockEl();
    const view = Object.create(ClaudianView.prototype) as any;

    view.practiceButtonEl = practiceButtonEl;
    view.writeNoteButtonEl = writeNoteButtonEl;
    view.advanceSectionButtonEl = advanceSectionButtonEl;
    view.reviewLessonButtonEl = reviewLessonButtonEl;
    view.startNewLessonButtonEl = startNewLessonButtonEl;
    view.advanceSectionButtonLabelEl = advanceSectionButtonLabelEl;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { currentConversationId: 'conv-1', isStreaming: false },
      }),
    };
    view.plugin = {
      learningController: {
        canPracticeSection: jest.fn().mockReturnValue(false),
        canWriteSectionNote: jest.fn().mockReturnValue(true),
        canAdvanceSection: jest.fn().mockReturnValue(false),
        canReviewLesson: jest.fn().mockReturnValue(false),
        getAdvanceSectionLabel: jest.fn().mockReturnValue(null),
        canStartNewLesson: jest.fn().mockReturnValue(false),
      },
    };

    view.updateLearningActionButton();

    expect(writeNoteButtonEl.hasClass('claudian-hidden')).toBe(false);
    expect(writeNoteButtonEl.getAttribute('disabled')).toBeNull();
    expect(writeNoteButtonEl.getAttribute('aria-hidden')).toBeNull();
    expect(practiceButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(advanceSectionButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(reviewLessonButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(startNewLessonButtonEl.hasClass('claudian-hidden')).toBe(true);

    view.plugin.learningController.canWriteSectionNote.mockReturnValue(false);

    view.updateLearningActionButton();

    expect(writeNoteButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(writeNoteButtonEl.getAttribute('disabled')).toBe('true');
    expect(writeNoteButtonEl.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the practice action while the current learning section is active', () => {
    const practiceButtonEl = createMockEl('button');
    const writeNoteButtonEl = createMockEl('button');
    const advanceSectionButtonEl = createMockEl('button');
    const reviewLessonButtonEl = createMockEl('button');
    const startNewLessonButtonEl = createMockEl('button');
    const view = Object.create(ClaudianView.prototype) as any;

    view.practiceButtonEl = practiceButtonEl;
    view.writeNoteButtonEl = writeNoteButtonEl;
    view.advanceSectionButtonEl = advanceSectionButtonEl;
    view.reviewLessonButtonEl = reviewLessonButtonEl;
    view.startNewLessonButtonEl = startNewLessonButtonEl;
    view.advanceSectionButtonLabelEl = createMockEl();
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { currentConversationId: 'conv-1', isStreaming: false },
      }),
    };
    view.plugin = {
      learningController: {
        canPracticeSection: jest.fn().mockReturnValue(true),
        canWriteSectionNote: jest.fn().mockReturnValue(false),
        canAdvanceSection: jest.fn().mockReturnValue(false),
        canReviewLesson: jest.fn().mockReturnValue(false),
        getAdvanceSectionLabel: jest.fn().mockReturnValue(null),
        canStartNewLesson: jest.fn().mockReturnValue(false),
      },
    };

    view.updateLearningActionButton();

    expect(practiceButtonEl.hasClass('claudian-hidden')).toBe(false);
    expect(practiceButtonEl.getAttribute('disabled')).toBeNull();
    expect(practiceButtonEl.getAttribute('aria-hidden')).toBeNull();

    view.tabManager.getActiveTab.mockReturnValue({
      state: { currentConversationId: 'conv-1', isStreaming: true },
    });

    view.updateLearningActionButton();

    expect(practiceButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(practiceButtonEl.getAttribute('disabled')).toBe('true');
    expect(practiceButtonEl.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the review action when the current learning chapter is ready for review', () => {
    const practiceButtonEl = createMockEl('button');
    const writeNoteButtonEl = createMockEl('button');
    const advanceSectionButtonEl = createMockEl('button');
    const reviewLessonButtonEl = createMockEl('button');
    const startNewLessonButtonEl = createMockEl('button');
    const view = Object.create(ClaudianView.prototype) as any;

    view.practiceButtonEl = practiceButtonEl;
    view.writeNoteButtonEl = writeNoteButtonEl;
    view.advanceSectionButtonEl = advanceSectionButtonEl;
    view.reviewLessonButtonEl = reviewLessonButtonEl;
    view.startNewLessonButtonEl = startNewLessonButtonEl;
    view.advanceSectionButtonLabelEl = createMockEl();
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { currentConversationId: 'conv-1', isStreaming: false },
      }),
    };
    view.plugin = {
      learningController: {
        canPracticeSection: jest.fn().mockReturnValue(false),
        canWriteSectionNote: jest.fn().mockReturnValue(false),
        canAdvanceSection: jest.fn().mockReturnValue(false),
        canReviewLesson: jest.fn().mockReturnValue(true),
        getAdvanceSectionLabel: jest.fn().mockReturnValue(null),
        canStartNewLesson: jest.fn().mockReturnValue(true),
      },
    };

    view.updateLearningActionButton();

    expect(reviewLessonButtonEl.hasClass('claudian-hidden')).toBe(false);
    expect(reviewLessonButtonEl.getAttribute('disabled')).toBeNull();
    expect(reviewLessonButtonEl.getAttribute('aria-hidden')).toBeNull();
    expect(startNewLessonButtonEl.hasClass('claudian-hidden')).toBe(false);

    view.tabManager.getActiveTab.mockReturnValue({
      state: { currentConversationId: 'conv-1', isStreaming: true },
    });

    view.updateLearningActionButton();

    expect(reviewLessonButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(reviewLessonButtonEl.getAttribute('disabled')).toBe('true');
    expect(reviewLessonButtonEl.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ClaudianView Escape handling', () => {
  beforeEach(() => {
    MockScope.instances.length = 0;
  });

  function createEscapeHarness(options: {
    isStreaming: boolean;
  }): {
    cancelStreaming: jest.Mock;
    eventRefs: unknown[];
    view: any;
  } {
    const cancelStreaming = jest.fn();
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(ClaudianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: options.isStreaming },
        controllers: {
          inputController: { cancelStreaming },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
    };

    return { cancelStreaming, eventRefs, view };
  }

  function createScopedSendHarness(options: {
    inputFocused: boolean;
  }): {
    inputEl: HTMLTextAreaElement;
    sendMessage: jest.Mock;
    view: any;
  } {
    const sendMessage = jest.fn();
    const inputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    Object.defineProperty(inputEl.ownerDocument, 'activeElement', {
      configurable: true,
      get: () => options.inputFocused ? inputEl : null,
    });
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(ClaudianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: false },
        dom: { inputEl },
        controllers: {
          inputController: { sendMessage },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
    };

    return { inputEl, sendMessage, view };
  }

  it('registers Escape on the Obsidian view scope instead of document keydown capture', () => {
    const { view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();

    expect(view.scope).toBeInstanceOf(Scope);
    expect(view.scope.parent).toBe(view.app.scope);
    expect(view.scope.register).toHaveBeenCalledWith([], 'Escape', expect.any(Function));
    expect(view.registerDomEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      'keydown',
      expect.any(Function),
      { capture: true }
    );
  });

  it('cancels streaming and consumes scoped Escape', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('consumes scoped Escape without cancelling when not streaming', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: false });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('consumes already handled scoped Escape without cancelling again', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({
      key: 'Escape',
      isComposing: false,
      defaultPrevented: true,
    } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('sends from focused composer through scoped Mod+Enter', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: true });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('ignores scoped Mod+Enter when composer is not focused', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: false });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
