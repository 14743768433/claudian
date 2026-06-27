import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Scope, setIcon } from 'obsidian';

import { getHiddenProviderCommandSet } from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from '../../core/providers/types';
import { VIEW_TYPE_CLAUDIAN } from '../../core/types';
import type { LearningTurnMode } from '../../features/learning/state/types';
import type ClaudianPlugin from '../../main';
import { createProviderIconSvg } from '../../shared/icons';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../utils/animationFrame';
import type { HistoryConversationStatus } from './controllers/ConversationController';
import {
  getTabProviderId,
  onProviderAvailabilityChanged,
  sendTabInputMessageFromExplicitEnterShortcut,
  updatePlanModeUI,
} from './tabs/Tab';
import { TabBar } from './tabs/TabBar';
import { TabManager } from './tabs/TabManager';
import type { TabData, TabId } from './tabs/types';
import { recalculateUsageForModel } from './utils/usageInfo';

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

export class ClaudianView extends ItemView {
  private plugin: ClaudianPlugin;

  // Tab management
  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;
  private tabBarContainerEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private navRowContent: HTMLElement | null = null;
  private inputFooterEl: HTMLElement | null = null;
  private inputNavRowHostEl: HTMLElement | null = null;
  private activeInputSlotEl: HTMLElement | null = null;
  private activeInputTabId: TabId | null = null;

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private logoEl: HTMLElement | null = null;
  private newTabButtonEl: HTMLElement | null = null;
  private practiceButtonEl: HTMLButtonElement | null = null;
  private writeNoteButtonEl: HTMLButtonElement | null = null;
  private advanceSectionButtonEl: HTMLButtonElement | null = null;
  private advanceSectionButtonLabelEl: HTMLElement | null = null;
  private reviewLessonButtonEl: HTMLButtonElement | null = null;
  private startNewLessonButtonEl: HTMLButtonElement | null = null;
  private learningStatusEl: HTMLElement | null = null;
  private learningModeControlsEl: HTMLElement | null = null;
  private readonly learningModeButtons = new Map<LearningTurnMode, HTMLButtonElement>();

  // Header elements
  private historyDropdown: HTMLElement | null = null;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudianPlugin) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches ClaudianView.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const prototype = Object.getPrototypeOf(this) as LoadableView;
    const originalLoad = prototype.load.bind(this) as () => Promise<void> | void;
    Object.defineProperty(this, 'load', {
      value: async () => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          (this as LoadableView).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          return await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN;
  }

  getDisplayText(): string {
    return 'AI Tutor Chat';
  }

  getIcon(): string {
    return 'graduation-cap';
  }

  /** Refreshes model-dependent UI across all tabs (used after settings/env changes). */
  refreshModelSelector(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      onProviderAvailabilityChanged(tab, this.plugin);
      const providerId = getTabProviderId(tab, this.plugin);
      const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
        this.plugin.settings,
        providerId,
      );
      const model = providerSettings.model;
      const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
      const capabilities = ProviderRegistry.getCapabilities(providerId);
      const contextWindow = uiConfig.getContextWindowSize(
        model,
        providerSettings.customContextLimits,
        providerSettings,
      );

      if (tab.state.usage) {
        tab.state.usage = recalculateUsageForModel(tab.state.usage, model, contextWindow);
      }

      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.permissionToggle?.updateDisplay();
      tab.ui.serviceTierToggle?.updateDisplay();
      tab.dom.inputWrapper.toggleClass(
        'claudian-input-plan-mode',
        providerSettings.permissionMode === 'plan' && capabilities.supportsPlanMode,
      );
    }

    this.tabManager?.primeProviderRuntime();
  }

  invalidateProviderCommandCaches(providerIds?: ProviderId[]): void {
    this.tabManager?.invalidateProviderCommandCaches(providerIds);
  }

  /** Updates provider-scoped hidden commands on all tabs after settings changes. */
  updateHiddenProviderCommands(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(
        getHiddenProviderCommandSet(this.plugin.settings, getTabProviderId(tab, this.plugin)),
      );
    }
  }

  async onOpen() {
    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!this.containerEl) {
      return;
    }

    // Use contentEl (standard Obsidian API) as primary target.
    // Hover Editor and other plugins may modify the DOM structure,
    // so we need fallbacks to handle non-standard scenarios.
    let container: HTMLElement | null =
      this.contentEl ?? (this.containerEl.children[1] as HTMLElement | null);

    if (!container) {
      // Last resort: create our own container inside containerEl
      container = this.containerEl.createDiv();
    }

    this.viewContainerEl = container;
    this.viewContainerEl.empty();
    this.viewContainerEl.addClass('claudian-container');

    const header = this.viewContainerEl.createDiv({ cls: 'claudian-header' });
    this.buildHeader(header);

    this.navRowContent = this.buildNavRowContent();
    this.tabContentEl = this.viewContainerEl.createDiv({ cls: 'claudian-tab-content-container' });
    this.buildInputFooter();

    this.tabManager = new TabManager(
      this.plugin,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.persistTabState();
          this.syncProviderBrandColor();
        },
        onActiveTabChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.updateLearningControls();
          this.syncProviderBrandColor();
        },
        onTabSwitched: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.updateLearningControls();
          this.persistTabState();
          this.syncProviderBrandColor();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.persistTabState();
        },
        onTabStreamingChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateLearningControls();
        },
        onTabTitleChanged: () => this.updateTabBar(),
        onTabAttentionChanged: () => this.updateTabBar(),
        onTabConversationChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateLearningControls();
          this.persistTabState();
          this.syncProviderBrandColor();
        },
        onTabProviderChanged: () => {
          this.updateTabBar();
          this.syncProviderBrandColor();
        },
      }
    );

    this.wireEventHandlers();
    await this.restoreOrCreateTabs();
    this.syncProviderBrandColor();
    this.attachNavRowContentToInputFooter();
    this.updateInputLocation();
    this.updateTabBarVisibility();
    this.tabManager?.primeProviderRuntime();
    this.updateLearningControls();
  }

  async onClose() {
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
      this.pendingTabBarUpdate = null;
    }

    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];

    await this.persistTabStateImmediate();

    this.restoreActiveInputToTabContent();
    await this.tabManager?.destroy();
    this.tabManager = null;

    this.tabBar?.destroy();
    this.tabBar = null;
    this.scope = null;
  }

  // ============================================
  // UI Building
  // ============================================

  private buildHeader(header: HTMLElement): void {
    const titleEl = header.createDiv({ cls: 'claudian-title' });

    this.logoEl = titleEl.createSpan({ cls: 'claudian-logo' });
    this.syncHeaderLogo(DEFAULT_CHAT_PROVIDER_ID);

    titleEl.createEl('h4', { text: 'AI Tutor', cls: 'claudian-title-text' });
  }

  /**
   * Builds the active tab nav row content.
   * The wrapper is moved to the active tab's nav row on tab switches.
   */
  private buildNavRowContent(): HTMLElement {
    const activeDocument = this.containerEl.ownerDocument;

    const fragment = activeDocument.createDocumentFragment();

    this.tabBarContainerEl = activeDocument.createElement('div');
    this.tabBarContainerEl.className = 'claudian-tab-bar-container';
    this.tabBar = new TabBar(this.tabBarContainerEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabClose: (tabId) => {
        void this.handleTabClose(tabId);
      },
      onNewTab: () => {
        void this.createNewTab().catch(() => new Notice('Failed to create tab'));
      },
    });
    fragment.appendChild(this.tabBarContainerEl);

    const navActionsEl = activeDocument.createElement('div');
    navActionsEl.className = 'claudian-input-nav-actions';

    this.learningModeControlsEl = activeDocument.createElement('div');
    this.learningModeControlsEl.className = 'ai-tutor-mode-controls claudian-hidden';
    this.learningModeControlsEl.setAttribute('aria-label', 'AI Tutor mode');
    this.learningModeControlsEl.setAttribute('role', 'group');
    this.learningModeButtons.clear();
    const modes: Array<{ id: LearningTurnMode; icon: string; label: string }> = [
      { id: 'teach', icon: 'book-open', label: 'Teach' },
      { id: 'ask', icon: 'search', label: 'Ask' },
      { id: 'transform', icon: 'wand-sparkles', label: 'Transform' },
    ];
    for (const mode of modes) {
      const button = activeDocument.createElement('button');
      button.type = 'button';
      button.className = 'ai-tutor-mode-btn';
      button.setAttribute('aria-label', `${mode.label} mode`);
      button.setAttribute('title', `${mode.label} mode`);
      setIcon(button, mode.icon);
      button.createSpan({ text: mode.label });
      button.addEventListener('click', () => {
        const conversationId = this.tabManager?.getActiveTab()?.state.currentConversationId ?? null;
        if (!this.plugin.learningController.setConversationTurnMode(conversationId, mode.id)) {
          return;
        }
        this.updateLearningControls();
      });
      this.learningModeButtons.set(mode.id, button);
      this.learningModeControlsEl.appendChild(button);
    }
    navActionsEl.appendChild(this.learningModeControlsEl);

    this.learningStatusEl = activeDocument.createElement('div');
    this.learningStatusEl.className = 'ai-tutor-learning-status claudian-hidden';
    this.learningStatusEl.setAttribute('aria-live', 'polite');
    navActionsEl.appendChild(this.learningStatusEl);

    this.practiceButtonEl = activeDocument.createElement('button');
    this.practiceButtonEl.type = 'button';
    this.practiceButtonEl.className = 'claudian-input-nav-btn ai-tutor-practice-btn claudian-hidden';
    setIcon(this.practiceButtonEl, 'list-checks');
    this.practiceButtonEl.createSpan({ text: 'Practice' });
    this.practiceButtonEl.setAttribute('aria-label', 'Practice current section');
    this.practiceButtonEl.setAttribute('title', 'Practice current section');
    this.practiceButtonEl.addEventListener('click', () => {
      const conversationId = this.tabManager?.getActiveTab()?.state.currentConversationId ?? null;
      if (!conversationId) return;
      this.practiceButtonEl?.setAttribute('disabled', 'true');
      void this.plugin.learningController.practiceSectionFromConversation(conversationId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Failed to prepare practice: ${message}`);
        })
        .finally(() => this.updateLearningControls());
    });
    navActionsEl.appendChild(this.practiceButtonEl);

    this.writeNoteButtonEl = activeDocument.createElement('button');
    this.writeNoteButtonEl.type = 'button';
    this.writeNoteButtonEl.className = 'claudian-input-nav-btn ai-tutor-write-note-btn claudian-hidden';
    setIcon(this.writeNoteButtonEl, 'file-pen-line');
    this.writeNoteButtonEl.createSpan({ text: 'Write note' });
    this.writeNoteButtonEl.setAttribute('aria-label', 'Write section note');
    this.writeNoteButtonEl.setAttribute('title', 'Write section note');
    this.writeNoteButtonEl.addEventListener('click', () => {
      const conversationId = this.tabManager?.getActiveTab()?.state.currentConversationId ?? null;
      if (!conversationId) return;
      this.writeNoteButtonEl?.setAttribute('disabled', 'true');
      void this.plugin.learningController.writeSectionNoteFromConversation(conversationId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Failed to write section note: ${message}`);
        })
        .finally(() => this.updateLearningControls());
    });
    navActionsEl.appendChild(this.writeNoteButtonEl);

    this.advanceSectionButtonEl = activeDocument.createElement('button');
    this.advanceSectionButtonEl.type = 'button';
    this.advanceSectionButtonEl.className = 'claudian-input-nav-btn ai-tutor-advance-section-btn claudian-hidden';
    setIcon(this.advanceSectionButtonEl, 'arrow-right');
    this.advanceSectionButtonLabelEl = this.advanceSectionButtonEl.createSpan({ text: 'Next section' });
    this.advanceSectionButtonEl.setAttribute('aria-label', 'Next section');
    this.advanceSectionButtonEl.setAttribute('title', 'Next section');
    this.advanceSectionButtonEl.addEventListener('click', () => {
      const conversationId = this.tabManager?.getActiveTab()?.state.currentConversationId ?? null;
      if (!conversationId) return;
      this.advanceSectionButtonEl?.setAttribute('disabled', 'true');
      void this.plugin.learningController.advanceSectionFromConversation(conversationId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Failed to continue section: ${message}`);
        })
        .finally(() => this.updateLearningControls());
    });
    navActionsEl.appendChild(this.advanceSectionButtonEl);

    this.reviewLessonButtonEl = activeDocument.createElement('button');
    this.reviewLessonButtonEl.type = 'button';
    this.reviewLessonButtonEl.className = 'claudian-input-nav-btn ai-tutor-review-lesson-btn claudian-hidden';
    setIcon(this.reviewLessonButtonEl, 'clipboard-check');
    this.reviewLessonButtonEl.createSpan({ text: 'Review' });
    this.reviewLessonButtonEl.setAttribute('aria-label', 'Review chapter');
    this.reviewLessonButtonEl.setAttribute('title', 'Review chapter');
    this.reviewLessonButtonEl.addEventListener('click', () => {
      const conversationId = this.tabManager?.getActiveTab()?.state.currentConversationId ?? null;
      if (!conversationId) return;
      this.reviewLessonButtonEl?.setAttribute('disabled', 'true');
      void this.plugin.learningController.reviewLessonFromConversation(conversationId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Failed to prepare review: ${message}`);
        })
        .finally(() => this.updateLearningControls());
    });
    navActionsEl.appendChild(this.reviewLessonButtonEl);

    this.startNewLessonButtonEl = activeDocument.createElement('button');
    this.startNewLessonButtonEl.type = 'button';
    this.startNewLessonButtonEl.className = 'claudian-input-nav-btn ai-tutor-start-new-lesson-btn claudian-hidden';
    setIcon(this.startNewLessonButtonEl, 'skip-forward');
    this.startNewLessonButtonEl.createSpan({ text: 'Start new lesson' });
    this.startNewLessonButtonEl.setAttribute('aria-label', 'Start new lesson');
    this.startNewLessonButtonEl.setAttribute('title', 'Start new lesson');
    this.startNewLessonButtonEl.addEventListener('click', () => {
      const conversationId = this.tabManager?.getActiveTab()?.state.currentConversationId ?? null;
      if (!conversationId) return;
      this.startNewLessonButtonEl?.setAttribute('disabled', 'true');
      void this.plugin.learningController.startNewLessonFromConversation(conversationId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Failed to start new lesson: ${message}`);
        })
        .finally(() => this.updateLearningControls());
    });
    navActionsEl.appendChild(this.startNewLessonButtonEl);

    this.newTabButtonEl = navActionsEl.createDiv({ cls: 'claudian-input-nav-btn claudian-new-tab-btn' });
    setIcon(this.newTabButtonEl, 'square-plus');
    this.newTabButtonEl.setAttribute('aria-label', 'New tab');
    this.newTabButtonEl.addEventListener('click', () => {
      void this.createNewTab().catch(() => new Notice('Failed to create tab'));
    });

    const newBtn = navActionsEl.createDiv({ cls: 'claudian-input-nav-btn' });
    setIcon(newBtn, 'square-pen');
    newBtn.setAttribute('aria-label', 'New conversation');
    newBtn.addEventListener('click', () => {
      void (async () => {
        await this.tabManager?.createNewConversation();
        this.updateHistoryDropdown();
      })().catch(() => new Notice('Failed to create conversation'));
    });

    // History dropdown
    const historyContainer = navActionsEl.createDiv({ cls: 'claudian-history-container' });
    const historyBtn = historyContainer.createDiv({ cls: 'claudian-input-nav-btn' });
    setIcon(historyBtn, 'history');
    historyBtn.setAttribute('aria-label', 'Chat history');

    this.historyDropdown = historyContainer.createDiv({ cls: 'claudian-history-menu' });

    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    fragment.appendChild(navActionsEl);

    const wrapper = activeDocument.createElement('div');
    wrapper.className = 'claudian-input-nav-content';
    wrapper.appendChild(fragment);
    return wrapper;
  }

  private buildInputFooter(): void {
    if (!this.viewContainerEl) return;

    this.inputFooterEl = this.viewContainerEl.createDiv({ cls: 'claudian-input-footer' });
    this.inputNavRowHostEl = this.inputFooterEl.createDiv({
      cls: 'claudian-input-nav-row claudian-view-input-nav-row',
    });
    this.activeInputSlotEl = this.inputFooterEl.createDiv({ cls: 'claudian-active-input-slot' });
  }

  private attachNavRowContentToInputFooter(): void {
    if (!this.inputNavRowHostEl || !this.navRowContent) return;

    this.tabBar?.captureScrollPosition();
    this.inputNavRowHostEl.appendChild(this.navRowContent);
    this.tabBar?.restoreScrollPosition();
  }

  private updateInputLocation(): void {
    const activeTab = this.tabManager?.getActiveTab();
    if (!this.activeInputSlotEl) return;

    if (!activeTab) {
      this.activeInputSlotEl.empty();
      this.activeInputTabId = null;
      return;
    }

    if (this.activeInputTabId && this.activeInputTabId !== activeTab.id) {
      const previousTab = this.tabManager?.getTab(this.activeInputTabId);
      if (previousTab) {
        previousTab.dom.contentEl.appendChild(previousTab.dom.inputComposerEl);
      }
    }

    if (this.activeInputTabId === activeTab.id) {
      if (activeTab.dom.inputComposerEl.parentElement !== this.activeInputSlotEl) {
        this.activeInputSlotEl.appendChild(activeTab.dom.inputComposerEl);
      }
      return;
    }

    this.activeInputSlotEl.empty();
    this.activeInputSlotEl.appendChild(activeTab.dom.inputComposerEl);
    this.activeInputTabId = activeTab.id;
  }

  private restoreActiveInputToTabContent(): void {
    if (!this.activeInputTabId) return;

    const activeInputTab = this.tabManager?.getTab(this.activeInputTabId);
    if (activeInputTab) {
      activeInputTab.dom.contentEl.appendChild(activeInputTab.dom.inputComposerEl);
    }
    this.activeInputSlotEl?.empty();
    this.activeInputTabId = null;
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.updateTabBarVisibility();
    this.updateLearningControls();
  }

  refreshLearningControls(): void {
    this.updateLearningControls();
  }

  // ============================================
  // Tab Management
  // ============================================

  private handleTabClick(tabId: TabId): void {
    const switched = this.tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice('Failed to switch tab'));
    }
  }

  private async handleTabClose(tabId: TabId): Promise<void> {
    try {
      const tab = this.tabManager?.getTab(tabId);
      // If streaming, treat close like user interrupt (force close cancels the stream)
      const force = tab?.state.isStreaming ?? false;
      await this.tabManager?.closeTab(tabId, force);
      this.updateTabBarVisibility();
    } catch {
      new Notice('Failed to close tab');
    }
  }

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      const maxTabs = this.plugin.settings.maxTabs ?? 3;
      new Notice(`Maximum ${maxTabs} tabs allowed`);
      this.updateTabBarVisibility();
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = scheduleAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      if (!this.tabManager || !this.tabBar) return;

      const items = this.tabManager.getTabBarItems();
      this.tabBar.update(items);
      this.updateTabBarVisibility();
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private updateTabBarVisibility(): void {
    if (!this.tabBarContainerEl || !this.tabManager) return;

    const tabCount = this.tabManager.getTabCount();
    const showTabBar = tabCount >= 2;

    this.tabBarContainerEl.toggleClass('claudian-hidden', !showTabBar);

    this.updateNewTabButtonVisibility();
  }

  private updateNewTabButtonVisibility(): void {
    if (!this.newTabButtonEl || !this.tabManager) return;

    const canCreateTab = this.tabManager.canCreateTab();
    this.newTabButtonEl.toggleClass('claudian-hidden', !canCreateTab);
    if (canCreateTab) {
      this.newTabButtonEl.removeAttribute('aria-disabled');
      this.newTabButtonEl.removeAttribute('aria-hidden');
      return;
    }

    this.newTabButtonEl.setAttribute('aria-disabled', 'true');
    this.newTabButtonEl.setAttribute('aria-hidden', 'true');
  }

  private updateLearningControls(): void {
    this.updateLearningStatus();
    this.updateLearningActionButton();
  }

  private updateLearningStatus(): void {
    if (!this.learningStatusEl) return;

    const activeTab = this.tabManager?.getActiveTab() ?? null;
    const conversationId = activeTab?.state.currentConversationId ?? null;
    const status = this.plugin.learningController.getConversationStatus(conversationId);

    this.updateLearningModeControls(status?.turnMode ?? null);
    this.learningStatusEl.empty();
    this.learningStatusEl.toggleClass('claudian-hidden', !status);
    if (!status) {
      this.learningStatusEl.removeAttribute('title');
      return;
    }

    this.learningStatusEl.setAttribute(
      'title',
      `${status.courseTitle} · ${status.chapterLabel}: ${status.lessonTitle} · ${status.sectionLabel}`,
    );
    this.learningStatusEl.createSpan({ cls: 'ai-tutor-learning-status-mode', text: status.mode });
    this.learningStatusEl.createSpan({
      cls: 'ai-tutor-learning-status-main',
      text: `${status.chapterLabel} · ${status.lessonTitle}`,
    });
    this.learningStatusEl.createSpan({
      cls: 'ai-tutor-learning-status-section',
      text: status.sectionLabel,
    });
  }

  private updateLearningModeControls(mode: LearningTurnMode | null): void {
    if (!this.learningModeControlsEl) return;

    this.learningModeControlsEl.toggleClass('claudian-hidden', !mode);
    for (const [buttonMode, button] of this.learningModeButtons) {
      const active = mode === buttonMode;
      button.toggleClass('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  private updateLearningActionButton(): void {
    if (!this.startNewLessonButtonEl || !this.advanceSectionButtonEl || !this.writeNoteButtonEl || !this.practiceButtonEl || !this.reviewLessonButtonEl) return;

    const activeTab = this.tabManager?.getActiveTab() ?? null;
    const conversationId = activeTab?.state.currentConversationId ?? null;
    const canPractice = !activeTab?.state.isStreaming
      && this.plugin.learningController.canPracticeSection(conversationId);
    this.practiceButtonEl.toggleClass('claudian-hidden', !canPractice);
    if (canPractice) {
      this.practiceButtonEl.removeAttribute('disabled');
      this.practiceButtonEl.removeAttribute('aria-hidden');
    } else {
      this.practiceButtonEl.setAttribute('disabled', 'true');
      this.practiceButtonEl.setAttribute('aria-hidden', 'true');
    }

    const canWrite = !activeTab?.state.isStreaming
      && this.plugin.learningController.canWriteSectionNote(conversationId);
    this.writeNoteButtonEl.toggleClass('claudian-hidden', !canWrite);
    if (canWrite) {
      this.writeNoteButtonEl.removeAttribute('disabled');
      this.writeNoteButtonEl.removeAttribute('aria-hidden');
    } else {
      this.writeNoteButtonEl.setAttribute('disabled', 'true');
      this.writeNoteButtonEl.setAttribute('aria-hidden', 'true');
    }

    const canAdvance = !activeTab?.state.isStreaming
      && this.plugin.learningController.canAdvanceSection(conversationId);
    const advanceLabel = this.plugin.learningController.getAdvanceSectionLabel(conversationId) ?? 'Next section';
    if (this.advanceSectionButtonLabelEl) {
      this.advanceSectionButtonLabelEl.setText(advanceLabel);
    }
    this.advanceSectionButtonEl.setAttribute('aria-label', advanceLabel);
    this.advanceSectionButtonEl.setAttribute('title', advanceLabel);
    this.advanceSectionButtonEl.toggleClass('claudian-hidden', !canAdvance);
    if (canAdvance) {
      this.advanceSectionButtonEl.removeAttribute('disabled');
      this.advanceSectionButtonEl.removeAttribute('aria-hidden');
    } else {
      this.advanceSectionButtonEl.setAttribute('disabled', 'true');
      this.advanceSectionButtonEl.setAttribute('aria-hidden', 'true');
    }

    const canReview = !activeTab?.state.isStreaming
      && this.plugin.learningController.canReviewLesson(conversationId);
    this.reviewLessonButtonEl.toggleClass('claudian-hidden', !canReview);
    if (canReview) {
      this.reviewLessonButtonEl.removeAttribute('disabled');
      this.reviewLessonButtonEl.removeAttribute('aria-hidden');
    } else {
      this.reviewLessonButtonEl.setAttribute('disabled', 'true');
      this.reviewLessonButtonEl.setAttribute('aria-hidden', 'true');
    }

    const canStart = !activeTab?.state.isStreaming
      && this.plugin.learningController.canStartNewLesson(conversationId);

    this.startNewLessonButtonEl.toggleClass('claudian-hidden', !canStart);
    if (canStart) {
      this.startNewLessonButtonEl.removeAttribute('disabled');
      this.startNewLessonButtonEl.removeAttribute('aria-hidden');
    } else {
      this.startNewLessonButtonEl.setAttribute('disabled', 'true');
      this.startNewLessonButtonEl.setAttribute('aria-hidden', 'true');
    }
  }

  /** Sets `data-provider` on the root container so CSS brand color follows the active provider. */
  private syncProviderBrandColor(): void {
    if (!this.viewContainerEl) return;
    const activeTab = this.tabManager?.getActiveTab();
    const providerId = activeTab ? getTabProviderId(activeTab, this.plugin) : DEFAULT_CHAT_PROVIDER_ID;
    this.viewContainerEl.dataset.provider = providerId;
    this.syncHeaderLogo(providerId);
  }

  /** Rebuilds the header logo SVG to match the given provider. */
  private syncHeaderLogo(providerId: ProviderId): void {
    if (!this.logoEl) return;
    const icon = ProviderRegistry.getChatUIConfig(providerId).getProviderIcon?.();
    if (!icon) return;
    const existing = this.logoEl.querySelector('svg');
    if (existing?.getAttribute('data-provider') === providerId) return;
    this.logoEl.empty();
    const svg = createProviderIconSvg(icon, {
      dataProvider: providerId,
      height: 18,
      ownerDocument: this.logoEl.ownerDocument,
      width: 18,
    });
    this.logoEl.appendChild(svg);
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.historyDropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
    }
  }

  private updateHistoryDropdown(): void {
    if (!this.historyDropdown) return;
    this.historyDropdown.empty();

    const activeTab = this.tabManager?.getActiveTab();
    const conversationController = activeTab?.controllers.conversationController;

    if (conversationController) {
      conversationController.renderHistoryDropdown(this.historyDropdown, {
        onSelectConversation: (id) => this.openHistoryConversation(id),
        onOpenConversationInNewTab: (id, activate) =>
          this.openHistoryConversationInNewTab(id, activate),
        getConversationStatus: (id) => this.getHistoryConversationStatus(id),
      });
    }
  }

  private async openHistoryConversation(conversationId: string): Promise<void> {
    await this.tabManager?.openConversation(conversationId);
    this.historyDropdown?.removeClass('visible');
  }

  private async openHistoryConversationInNewTab(
    conversationId: string,
    activate = true,
  ): Promise<void> {
    await this.tabManager?.openConversation(conversationId, {
      preferNewTab: true,
      activate,
    });
    this.historyDropdown?.removeClass('visible');
  }

  private getHistoryConversationStatus(conversationId: string): HistoryConversationStatus {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.conversationId === conversationId) {
      return {
        openState: 'current',
        isRunning: activeTab.state.isStreaming,
        location: 'current-view',
        tabIndex: this.getHistoryTabIndex(activeTab),
      };
    }

    const localTab = this.findTabWithConversation(conversationId);
    if (localTab) {
      return {
        openState: 'open',
        isRunning: localTab.state.isStreaming,
        location: 'current-view',
        tabIndex: this.getHistoryTabIndex(localTab),
      };
    }

    const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
    if (crossViewResult && crossViewResult.view !== this) {
      const crossViewTab = crossViewResult.view.getTabManager()?.getTab(crossViewResult.tabId);
      return {
        openState: 'open',
        isRunning: crossViewTab?.state.isStreaming ?? false,
        location: 'other-view',
      };
    }

    return {
      openState: 'closed',
      isRunning: false,
      location: 'current-view',
    };
  }

  private findTabWithConversation(conversationId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.conversationId === conversationId) ?? null;
  }

  private getHistoryTabIndex(tab: TabData): number | undefined {
    const index = this.tabManager?.getAllTabs().findIndex(candidate => candidate.id === tab.id) ?? -1;
    return index >= 0 ? index + 1 : undefined;
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // Document-level click to close dropdowns
    this.registerDomEvent(activeDocument, 'click', () => {
      this.historyDropdown?.removeClass('visible');
    });

    // View-level Shift+Tab to toggle plan mode (works from any focused element)
    this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Tab' && e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const activeTab = this.tabManager?.getActiveTab();
        if (!activeTab) return;
        const providerId = getTabProviderId(activeTab, this.plugin);
        if (!ProviderRegistry.getCapabilities(providerId).supportsPlanMode) return;
        const current = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
          this.plugin.settings,
          providerId,
        ).permissionMode as string;
        if (current === 'plan') {
          const restoreMode = activeTab.state.prePlanPermissionMode ?? 'normal';
          activeTab.state.prePlanPermissionMode = null;
          updatePlanModeUI(activeTab, this.plugin, restoreMode);
        } else {
          activeTab.state.prePlanPermissionMode = current;
          updatePlanModeUI(activeTab, this.plugin, 'plan');
        }
      }
    });

    // View scopes are the Obsidian-owned boundary for main-area tab hotkeys.
    // Returning false consumes Escape before Obsidian uses it for pane navigation.
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Escape', (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (!e.defaultPrevented) {
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });
    this.scope.register(['Mod'], 'Enter', (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const activeTab = this.tabManager?.getActiveTab();
      if (!activeTab) return;
      if (sendTabInputMessageFromExplicitEnterShortcut(activeTab, e, { requireInputFocus: true })) {
        return false;
      }
    });

    // Vault events - forward to active tab's file context manager
    const markCacheDirty = (includesFolders: boolean): void => {
      const mgr = this.tabManager?.getActiveTab()?.ui.fileContextManager;
      if (!mgr) return;
      mgr.markFileCacheDirty();
      if (includesFolders) mgr.markFolderCacheDirty();
    };
    this.eventRefs.push(
      this.plugin.app.vault.on('create', () => markCacheDirty(true)),
      this.plugin.app.vault.on('delete', () => markCacheDirty(true)),
      this.plugin.app.vault.on('rename', () => markCacheDirty(true)),
      this.plugin.app.vault.on('modify', () => markCacheDirty(false))
    );

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.inputEl) {
          fcm.hideMentionDropdown();
        }
      }
    });
  }

  // ============================================
  // Persistence
  // ============================================

  private async restoreOrCreateTabs(): Promise<void> {
    if (!this.tabManager) return;

    // Try to restore from persisted state
    const persistedState = await this.plugin.storage.getTabManagerState();
    if (persistedState && persistedState.openTabs.length > 0) {
      await this.tabManager.restoreState(persistedState);
      return;
    }

    // Fallback: create a new empty tab
    await this.tabManager.createTab();
  }

  private persistTabState(): void {

    // Debounce persistence to avoid rapid writes (300ms delay)
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = window.setTimeout(() => {
      this.pendingPersist = null;
      if (!this.tabManager) return;
      const state = this.tabManager.getPersistedState();
      this.plugin.persistTabManagerState(state).catch(() => {
        // Silently ignore persistence errors
      });
    }, 300);
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    // Cancel any pending debounced persist
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    if (!this.tabManager) return;
    const state = this.tabManager.getPersistedState();
    await this.plugin.persistTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }

  /** Gets shared view controls that should preserve active tab selection context. */
  getSharedSelectionFocusScopeEls(): HTMLElement[] {
    return [
      this.inputNavRowHostEl,
    ].filter((el): el is HTMLElement => el !== null);
  }
}
