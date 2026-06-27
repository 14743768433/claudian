import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Menu, Notice, setIcon } from 'obsidian';

import { DEFAULT_CHAT_PROVIDER_ID, type ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRewindMode } from '../../../core/runtime/types';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type {
  ChatMessage,
  ImageAttachment,
  LearningActivityContentBlock,
  LearningActionResultContentBlock,
  LearningLessonPlanContentBlock,
  LearningLessonPlanSource,
  LearningNextStepsContentBlock,
  SubagentInfo,
  ToolCallInfo,
} from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { extractUserDisplayContent } from '../../../utils/context';
import { formatDurationMmSs } from '../../../utils/date';
import { processFileLinks, registerFileLinkHandler } from '../../../utils/fileLink';
import { replaceImageEmbedsWithHtml } from '../../../utils/imageEmbed';
import { escapeMathDelimitersForStreaming } from '../../../utils/markdownMath';
import { findRewindContext } from '../rewind';
import { formatConversationDirectoryTitle } from '../utils/conversationDirectoryTitle';
import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';
import {
  renderStoredAsyncSubagent,
  renderStoredSubagent,
} from './SubagentRenderer';
import { renderStoredToolCall } from './ToolCallRenderer';
import { renderStoredWriteEdit } from './WriteEditRenderer';

export interface RenderContentOptions {
  deferMath?: boolean;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions
) => Promise<void>;

export type NextOptionCallback = (option: string) => Promise<void> | void;

export interface TutorActionSummary {
  type: string;
  label: string;
  detail?: string;
}

type TutorActionCard = TutorActionSummary & {
  status?: 'requested' | 'accepted' | 'rejected';
  message?: string;
  items?: string[];
};

const TUTOR_ACTION_TYPES = new Set([
  'generateSyllabus',
  'planChapter',
  'sectionNoteWritten',
  'advanceSection',
  'startNewLesson',
]);

function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

function stripOptionMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[。.!！?？]+$/g, '')
    .trim();
}

function splitInlineOptions(value: string): string[] {
  const cleaned = stripOptionMarkdown(value);
  if (!cleaned) return [];

  const parts = cleaned.includes('/') || cleaned.includes('|') || cleaned.includes('｜') || cleaned.includes('、') || cleaned.includes(';') || cleaned.includes('；')
    ? cleaned.split(/\s*(?:\/|\||｜|、|;|；)\s*/g)
    : [cleaned];

  return parts
    .map(stripOptionMarkdown)
    .filter((part) => part.length >= 2 && part.length <= 80);
}

function collectUniqueOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const option of options) {
    const cleaned = stripOptionMarkdown(option);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
    if (result.length >= 4) break;
  }
  return result;
}

function parseStructuredNextOptions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { options?: unknown }).options)
        ? (parsed as { options: unknown[] }).options
        : [];
    return collectUniqueOptions(values.filter((value): value is string => typeof value === 'string'));
  } catch {
    return collectUniqueOptions(
      trimmed
        .split(/\r?\n/)
        .flatMap((line) => splitInlineOptions(line.replace(/^(?:[-*+•]\s+|\d+[.)]\s+)/, ''))),
    );
  }
}

function structuredNextOptionsFromJson(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { options?: unknown }).options)
        ? (parsed as { options: unknown[] }).options
        : [];
    const options = collectUniqueOptions(values.filter((value): value is string => typeof value === 'string'));
    return options.length > 0 ? options : null;
  } catch {
    return null;
  }
}

function lessonPlanSourceLabel(source: string | LearningLessonPlanSource): string {
  return typeof source === 'string' ? source.trim() : source.label.trim();
}

function lessonPlanSourcePath(source: string | LearningLessonPlanSource): string | null {
  if (typeof source !== 'string' && source.path?.trim()) {
    return source.path.trim();
  }
  const label = lessonPlanSourceLabel(source);
  if (!label) return null;
  const wiki = label.match(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]/);
  if (wiki?.[1]?.trim()) return wiki[1].trim();
  const markdown = label.match(/\]\(([^)]+?\.md)(?:#[^)]+)?\)/i);
  if (markdown?.[1]?.trim()) return markdown[1].trim();
  return /\.md(?:$|[\s"')\]])/i.test(label) ? label : null;
}

export function stripNextOptionsBlocks(markdown: string): string {
  return markdown
    .replace(/```([^\n`]*)\r?\n([\s\S]*?)```/g, (match, language: string, body: string) => (
      shouldTreatFenceAsNextOptions(language, body) ? '' : match
    ))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripTutorActionBlocks(markdown: string): string {
  return markdown
    .replace(/```([^\n`]*)\r?\n([\s\S]*?)```/g, (match, language: string, body: string) => (
      shouldTreatFenceAsTutorAction(language, body) ? '' : match
    ))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripTutorProtocolBlocks(markdown: string): string {
  return stripTutorActionBlocks(stripNextOptionsBlocks(markdown));
}

function shouldTreatDanglingFenceAsTutorAction(language: string, body: string): boolean {
  const normalized = language.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (normalized === 'ai-tutor-action') return true;
  if (normalized !== 'ai' && normalized !== 'json' && normalized !== '') return false;

  const trimmed = body.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  return /"type"\s*:\s*"(generateSyllabus|planChapter|sectionNoteWritten|advanceSection|startNewLesson)/.test(trimmed);
}

function shouldTreatDanglingFenceAsTutorProtocol(language: string, body: string): boolean {
  return shouldTreatDanglingFenceAsTutorAction(language, body)
    || shouldTreatDanglingFenceAsNextOptions(language, body);
}

function stripDanglingTutorActionFence(markdown: string): string {
  const fencePattern = /```([^\n`]*)\r?\n/g;
  let cursor = 0;

  while (true) {
    fencePattern.lastIndex = cursor;
    const opening = fencePattern.exec(markdown);
    if (!opening) return markdown;

    const bodyStart = fencePattern.lastIndex;
    const closingIndex = markdown.indexOf('```', bodyStart);
    if (closingIndex === -1) {
      const language = opening[1] ?? '';
      const body = markdown.slice(bodyStart);
      return shouldTreatDanglingFenceAsTutorProtocol(language, body)
        ? markdown.slice(0, opening.index)
        : markdown;
    }

    cursor = closingIndex + 3;
  }
}

export function stripTutorProtocolBlocksForStreaming(markdown: string): string {
  return stripDanglingTutorActionFence(stripTutorProtocolBlocks(markdown))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeTutorActionValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const action = value as Record<string, unknown>;
  if (typeof action.type !== 'string' || !TUTOR_ACTION_TYPES.has(action.type)) return null;

  if (action.data && typeof action.data === 'object' && !Array.isArray(action.data)) {
    return {
      ...(action.data as Record<string, unknown>),
      type: action.type,
    };
  }

  return action;
}

function summarizeTutorAction(value: unknown): TutorActionSummary | null {
  const action = normalizeTutorActionValue(value) as {
    type?: unknown;
    title?: unknown;
    chapterTitle?: unknown;
    notePath?: unknown;
    noteTitle?: unknown;
    sections?: unknown;
    topics?: unknown;
  } | null;
  if (!action) return null;
  if (typeof action.type !== 'string' || !action.type.trim()) return null;

  switch (action.type) {
    case 'generateSyllabus': {
      const count = Array.isArray(action.topics) ? action.topics.length : 0;
      return {
        type: action.type,
        label: 'Save course map',
        detail: count > 0 ? `${count} topics` : undefined,
      };
    }
    case 'planChapter': {
      const count = Array.isArray(action.sections) ? action.sections.length : 0;
      const title = typeof action.title === 'string' && action.title.trim()
        ? action.title.trim()
        : typeof action.chapterTitle === 'string' && action.chapterTitle.trim()
          ? action.chapterTitle.trim()
          : 'current chapter';
      return {
        type: action.type,
        label: 'Plan chapter',
        detail: count > 0 ? `${title} · ${count} sections` : title,
      };
    }
    case 'sectionNoteWritten': {
      const note = typeof action.noteTitle === 'string' && action.noteTitle.trim()
        ? action.noteTitle.trim()
        : typeof action.notePath === 'string' && action.notePath.trim()
          ? action.notePath.trim()
          : undefined;
      return { type: action.type, label: 'Register section note', detail: note };
    }
    case 'advanceSection':
      return { type: action.type, label: 'Advance section' };
    case 'startNewLesson':
      return { type: action.type, label: 'Start new lesson' };
    default:
      return { type: action.type, label: 'Learning action' };
  }
}

function tutorActionsFromJson(raw: string): TutorActionSummary[] | null {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const actions = values
      .map(summarizeTutorAction)
      .filter((action): action is TutorActionSummary => action !== null);
    return actions.length > 0 ? actions : null;
  } catch {
    return null;
  }
}

function shouldTreatFenceAsTutorAction(language: string, body: string): boolean {
  const normalized = language.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const isCandidateLanguage = normalized === 'ai-tutor-action'
    || normalized === 'ai'
    || normalized === 'json'
    || normalized === '';
  if (!isCandidateLanguage) return false;
  if (normalized === 'ai-tutor-action') return true;
  return tutorActionsFromJson(body) !== null;
}

function shouldTreatFenceAsNextOptions(language: string, body: string): boolean {
  const normalized = language.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (normalized === 'ai-tutor-next-options') return true;
  if (normalized !== 'ai' && normalized !== 'json' && normalized !== '') return false;
  return structuredNextOptionsFromJson(body) !== null;
}

function shouldTreatDanglingFenceAsNextOptions(language: string, body: string): boolean {
  const normalized = language.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (normalized === 'ai-tutor-next-options') return true;
  if (normalized !== 'ai' && normalized !== 'json' && normalized !== '') return false;

  const trimmed = body.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  return /"options"\s*:/.test(trimmed);
}

export function extractTutorActions(markdown: string): TutorActionSummary[] {
  const actions: TutorActionSummary[] = [];
  markdown.replace(/```([^\n`]*)\r?\n([\s\S]*?)```/g, (_match, language: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return '';
    const parsedActions = tutorActionsFromJson(trimmed);
    if (parsedActions) {
      actions.push(...parsedActions);
    } else if (language.trim().toLowerCase().startsWith('ai-tutor-action')) {
      actions.push({ type: 'invalid', label: 'Learning action', detail: 'Could not preview request' });
    }
    return '';
  });
  return actions.slice(0, 4);
}

export function extractNextOptions(markdown: string): string[] {
  const structuredOptions: string[] = [];
  markdown.replace(/```([^\n`]*)\r?\n([\s\S]*?)```/g, (_match, language: string, body: string) => {
    if (shouldTreatFenceAsNextOptions(language, body)) {
      structuredOptions.push(...parseStructuredNextOptions(body));
    }
    return '';
  });
  if (structuredOptions.length > 0) {
    return collectUniqueOptions(structuredOptions);
  }

  const lines = markdown.split(/\r?\n/);
  const options: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const heading = line.match(/^(?:#{1,6}\s*)?(?:\*\*)?\s*(Next options|下一步(?:选项)?|接下来(?:可以|建议)?)(?:\*\*)?\s*[:：]?\s*(.*)$/i);
    if (!heading) continue;

    for (const inlineOption of splitInlineOptions(heading[2] ?? '')) {
      options.push(inlineOption);
      if (options.length >= 4) return options;
    }

    for (let optionIndex = index + 1; optionIndex < lines.length && options.length < 4; optionIndex++) {
      const optionLine = lines[optionIndex].trim();
      if (!optionLine) {
        if (options.length > 0) break;
        continue;
      }
      if (/^(#{1,6}\s+|```|~~~)/.test(optionLine) || /ai-tutor-action/i.test(optionLine)) {
        break;
      }

      const bullet = optionLine.match(/^(?:[-*+•]\s+|\d+[.)]\s+)(.+)$/);
      if (bullet) {
        for (const option of splitInlineOptions(bullet[1])) {
          options.push(option);
          if (options.length >= 4) return options;
        }
        continue;
      }

      if (options.length === 0) {
        for (const option of splitInlineOptions(optionLine)) {
          options.push(option);
          if (options.length >= 4) return options;
        }
      }
      break;
    }

    break;
  }

  return collectUniqueOptions(options);
}

export class MessageRenderer {
  private app: App;
  private plugin: ClaudianPlugin;
  private component: Component;
  private messagesEl: HTMLElement;
  private rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>;
  private getCapabilities: () => ProviderCapabilities;
  private forkCallback?: (messageId: string) => Promise<void>;
  private nextOptionCallback?: NextOptionCallback;
  private liveMessageEls = new Map<string, HTMLElement>();

  constructor(
    plugin: ClaudianPlugin,
    component: Component,
    messagesEl: HTMLElement,
    rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>,
    forkCallback?: (messageId: string) => Promise<void>,
    getCapabilities?: () => ProviderCapabilities,
    nextOptionCallback?: NextOptionCallback,
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.component = component;
    this.messagesEl = messagesEl;
    this.rewindCallback = rewindCallback;
    this.forkCallback = forkCallback;
    this.nextOptionCallback = nextOptionCallback;
    this.getCapabilities = getCapabilities ?? (() => ({
      providerId: DEFAULT_CHAT_PROVIDER_ID,
      supportsPersistentRuntime: false,
      supportsNativeHistory: false,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: false,
      supportsInstructionMode: false,
      supportsMcpTools: false,
      supportsTurnSteer: false,
      reasoningControl: 'none' as const,
    }));

    // Register delegated click handler for file links
    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }

  /** Sets the messages container element. */
  setMessagesEl(el: HTMLElement): void {
    this.messagesEl = el;
  }

  private getSubagentLifecycleAdapter(toolName?: string) {
    return resolveSubagentLifecycleAdapter(this.getCapabilities().providerId, toolName);
  }

  private shouldExpandFileEditsByDefault(): boolean {
    return this.plugin.settings?.expandFileEditsByDefault === true;
  }

  private getUserMessageTextToShow(msg: ChatMessage): string {
    return msg.displayContent ?? extractUserDisplayContent(msg.content) ?? msg.content;
  }

  private applyTocTitle(msgEl: HTMLElement, text: string): void {
    const tocTitle = formatConversationDirectoryTitle(text);
    if (tocTitle) {
      msgEl.setAttribute('data-toc-title', tocTitle);
    } else {
      msgEl.removeAttribute('data-toc-title');
    }
  }

  // ============================================
  // Streaming Message Rendering
  // ============================================

  /**
   * Adds a new message to the chat during streaming.
   * Returns the message element for content updates.
   */
  addMessage(msg: ChatMessage): HTMLElement {
    // Render images above message bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (!textToShow) {
        this.scrollToBottom();
        const lastChild = this.messagesEl.lastElementChild as HTMLElement;
        return lastChild ?? this.messagesEl;
      }
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-message claudian-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });
    this.liveMessageEls.set(msg.id, msgEl);

    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
        void this.renderContent(textEl, textToShow);
        this.addUserCopyButton(msgEl, textToShow);
        this.applyTocTitle(msgEl, textToShow);
      }
      if (this.rewindCallback || this.forkCallback) {
        this.liveMessageEls.set(msg.id, msgEl);
      }
    }

    this.scrollToBottom();
    return msgEl;
  }

  updateLiveUserMessage(msg: ChatMessage): void {
    if (msg.role !== 'user') {
      return;
    }

    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) {
      return;
    }

    const contentEl = msgEl.querySelector<HTMLElement>('.claudian-message-content');
    if (!contentEl) {
      return;
    }

    contentEl.empty();

    const textToShow = this.getUserMessageTextToShow(msg);
    if (textToShow) {
      const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
      void this.renderContent(textEl, textToShow);
      this.applyTocTitle(msgEl, textToShow);
    } else {
      msgEl.removeAttribute('data-toc-title');
    }

    const toolbar = msgEl.querySelector<HTMLElement>('.claudian-user-msg-actions');
    if (toolbar) {
      toolbar.querySelectorAll('.claudian-user-msg-copy-btn').forEach((el) => el.remove());
    }

    if (textToShow) {
      this.addUserCopyButton(msgEl, textToShow);
    }
  }

  removeMessage(messageId: string): void {
    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!msgEl) {
      return;
    }

    msgEl.remove();
    this.liveMessageEls.delete(messageId);
  }

  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================

  /**
   * Renders all messages for conversation load/switch.
   * @param messages Array of messages to render
   * @param getGreeting Function to get greeting text
   * @returns The newly created welcome element
   */
  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string
  ): HTMLElement {
    this.messagesEl.empty();
    this.liveMessageEls.clear();

    // Recreate welcome element after clearing
    const newWelcomeEl = this.messagesEl.createDiv({ cls: 'claudian-welcome' });
    newWelcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: getGreeting() });

    for (let i = 0; i < messages.length; i++) {
      this.renderStoredMessage(messages[i], messages, i);
    }

    this.scrollToBottom();
    return newWelcomeEl;
  }

  renderStoredMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    // Bare interrupt marker: user-role interrupts (Claude bracket markers) always render
    // as a standalone indicator. Assistant-role interrupts (Codex partial responses)
    // only use the bare marker when there's no content to preserve.
    if (msg.isInterrupt && (msg.role === 'user' || !this.hasVisibleContent(msg))) {
      this.renderInterruptMessage();
      return;
    }

    // Skip rebuilt context messages (history sent to SDK on session reset)
    // These are internal context for the AI, not actual user messages to display
    if (msg.isRebuiltContext) {
      return;
    }

    // Render images above bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (!textToShow) {
        return;
      }
    }
    if (msg.role === 'assistant' && !this.hasVisibleContent(msg)) {
      return;
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-message claudian-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
        void this.renderContent(textEl, textToShow);
        this.addUserCopyButton(msgEl, textToShow);
        this.applyTocTitle(msgEl, textToShow);
      }
      if (msg.userMessageId) {
        if (this.rewindCallback && this.isRewindEligible(allMessages, index)) {
          this.addRewindButton(msgEl, msg.id);
        }
        if (this.forkCallback && this.isForkEligible(allMessages, index)) {
          this.addForkButton(msgEl, msg.id);
        }
      }
    } else if (msg.role === 'assistant') {
      this.renderAssistantContent(msg, contentEl);
      if (msg.isInterrupt) {
        this.appendInterruptIndicator(contentEl);
      }
    }
  }

  private hasVisibleContent(msg: ChatMessage): boolean {
    if (msg.content && this.hasVisibleMarkdownContent(msg.content)) return true;
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      for (const block of msg.contentBlocks) {
        if (block.type === 'text' && this.hasVisibleMarkdownContent(block.content)) return true;
        if (block.type === 'context_compacted') return true;
        if (block.type === 'subagent') return true;
        if (block.type === 'learning_activity') return true;
        if (block.type === 'learning_action_result') return true;
        if (block.type === 'learning_lesson_plan') return true;
        if (block.type === 'learning_next_steps') return true;
        if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall && this.shouldRenderToolCall(toolCall)) return true;
        }
      }
    }
    if (msg.toolCalls?.some(toolCall => this.shouldRenderToolCall(toolCall))) return true;
    return false;
  }

  private hasVisibleMarkdownContent(markdown: string): boolean {
    return stripTutorProtocolBlocks(markdown).trim().length > 0
      || extractTutorActions(markdown).length > 0
      || extractNextOptions(markdown).length > 0;
  }

  private isRewindEligible(allMessages?: ChatMessage[], index?: number): boolean {
    if (!allMessages || index === undefined) return false;
    const ctx = findRewindContext(allMessages, index);
    return ctx.hasResponse;
  }

  private isForkEligible(allMessages?: ChatMessage[], index?: number): boolean {
    if (!allMessages || index === undefined) return false;
    const ctx = findRewindContext(allMessages, index);
    return !!ctx.prevAssistantUuid && ctx.hasResponse;
  }

  private renderInterruptMessage(): void {
    const msgEl = this.messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content', attr: { dir: 'auto' } });
    this.appendInterruptIndicator(contentEl);
  }

  private appendInterruptIndicator(contentEl: HTMLElement): void {
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
    textEl.createSpan({ cls: 'claudian-interrupted', text: 'Interrupted' });
    textEl.appendText(' ');
    textEl.createSpan({
      cls: 'claudian-interrupted-hint',
      text: '\u00B7 What should AI Tutor do instead?',
    });
  }

  /**
   * Renders assistant message content (content blocks or fallback).
   */
  private renderAssistantContent(msg: ChatMessage, contentEl: HTMLElement): void {
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      const renderedToolIds = new Set<string>();
      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking') {
          continue;
        } else if (block.type === 'text') {
          // Skip empty or whitespace-only text blocks to avoid extra gaps
          const visibleContent = stripTutorProtocolBlocks(block.content);
          if (!visibleContent) {
            continue;
          }
          const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
          void this.renderContent(textEl, visibleContent);
          this.addTextCopyButton(textEl, visibleContent);
        } else if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall) {
            this.renderToolCall(contentEl, toolCall, msg);
            renderedToolIds.add(toolCall.id);
          }
        } else if (block.type === 'context_compacted') {
          const boundaryEl = contentEl.createDiv({ cls: 'claudian-compact-boundary' });
          boundaryEl.createSpan({ cls: 'claudian-compact-boundary-label', text: 'Conversation compacted' });
        } else if (block.type === 'learning_activity') {
          this.renderLearningActivityCard(contentEl, block);
        } else if (block.type === 'learning_action_result') {
          this.renderTutorActionCard(contentEl, {
            type: block.actionType,
            label: block.label,
            detail: block.detail,
            status: block.status,
            message: block.message,
            items: block.items,
          });
        } else if (block.type === 'learning_lesson_plan') {
          this.renderLessonPlanCard(contentEl, block);
        } else if (block.type === 'learning_next_steps') {
          this.renderLearningNextSteps(contentEl, block);
        } else if (block.type === 'subagent') {
          const taskToolCall = msg.toolCalls?.find(
            tc => tc.id === block.subagentId && isSubagentToolName(tc.name)
          );
          if (!taskToolCall) continue;

          this.renderTaskSubagent(contentEl, taskToolCall, block.mode);
          renderedToolIds.add(taskToolCall.id);
        }
      }

      // Defensive fallback: preserve tool visibility when contentBlocks/toolCalls drift on reload.
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const toolCall of msg.toolCalls) {
          if (renderedToolIds.has(toolCall.id)) continue;
          this.renderToolCall(contentEl, toolCall, msg);
          renderedToolIds.add(toolCall.id);
        }
      }
    } else {
      // Fallback for old conversations without contentBlocks
      if (msg.content) {
        const visibleContent = stripTutorProtocolBlocks(msg.content);
        if (visibleContent) {
          const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
          void this.renderContent(textEl, visibleContent);
          this.addTextCopyButton(textEl, visibleContent);
        }
      }
      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          this.renderToolCall(contentEl, toolCall, msg);
        }
      }
    }

    // Render response duration footer (skip when message contains a compaction boundary)
    const hasCompactBoundary = msg.contentBlocks?.some(b => b.type === 'context_compacted');
    if (msg.durationSeconds && msg.durationSeconds > 0 && !hasCompactBoundary) {
      const flavorWord = msg.durationFlavorWord || 'Baked';
      const footerEl = contentEl.createDiv({ cls: 'claudian-response-footer' });
      footerEl.createSpan({
        text: `* ${flavorWord} for ${formatDurationMmSs(msg.durationSeconds)}`,
        cls: 'claudian-baked-duration',
      });
    }

    this.renderTutorActionCards(contentEl, msg);
    this.renderNextOptionChips(contentEl, msg);
  }

  private getAssistantOptionSource(msg: ChatMessage): string {
    const textBlocks = msg.contentBlocks
      ?.filter((block): block is Extract<NonNullable<ChatMessage['contentBlocks']>[number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.content.trim())
      .filter(Boolean) ?? [];
    return textBlocks.length > 0 ? textBlocks.join('\n') : msg.content;
  }

  private renderNextOptionChips(contentEl: HTMLElement, msg: ChatMessage): void {
    if (!this.nextOptionCallback) return;
    const options = extractNextOptions(this.getAssistantOptionSource(msg));
    if (options.length === 0) return;

    this.renderNextOptionChipRow(contentEl, options, 'Next');
  }

  private renderNextOptionChipRow(parent: HTMLElement, options: string[], label: string, detail?: string): HTMLElement | null {
    const cleanedOptions = collectUniqueOptions(options);
    if (cleanedOptions.length === 0) return null;

    const chipsEl = parent.createDiv({ cls: 'claudian-next-options' });
    chipsEl.createSpan({ cls: 'claudian-next-options-label', text: label });
    if (detail) {
      chipsEl.createSpan({ cls: 'claudian-next-options-detail', text: detail });
    }
    for (const option of cleanedOptions) {
      const chip = chipsEl.createEl('button', {
        cls: 'claudian-next-option-chip',
        text: option,
        attr: {
          type: 'button',
          'aria-label': `Send: ${option}`,
        },
      });
      if (!this.nextOptionCallback) {
        chip.setAttribute('disabled', 'true');
      }
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!this.nextOptionCallback) return;
        chip.setAttribute('disabled', 'true');
        runRendererAction(async () => {
          await this.nextOptionCallback?.(option);
        });
      });
    }
    return chipsEl;
  }

  private renderLearningNextSteps(parent: HTMLElement, block: LearningNextStepsContentBlock): HTMLElement | null {
    const stepsEl = this.renderNextOptionChipRow(parent, block.options, block.label ?? 'Next', block.detail);
    stepsEl?.addClass('is-learning-next-steps');
    return stepsEl;
  }

  private renderTutorActionCards(contentEl: HTMLElement, msg: ChatMessage): void {
    if (msg.contentBlocks?.some(block => block.type === 'learning_action_result')) {
      return;
    }

    const actions = extractTutorActions(this.getAssistantOptionSource(msg));
    if (actions.length === 0) return;

    const actionsEl = contentEl.createDiv({ cls: 'claudian-tutor-actions' });
    for (const action of actions) {
      this.renderTutorActionCard(actionsEl, { ...action, status: 'requested' });
    }
  }

  appendLearningActionResults(messageId: string, outcomes: LearningActionResultContentBlock[]): void {
    if (outcomes.length === 0) return;

    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    const contentEl = msgEl?.querySelector<HTMLElement>('.claudian-message-content');
    if (!contentEl) return;

    contentEl.querySelectorAll('.claudian-tutor-actions').forEach((el) => el.remove());

    const actionsEl = contentEl.createDiv({ cls: 'claudian-tutor-actions is-result' });
    const footerEl = contentEl.querySelector<HTMLElement>('.claudian-response-footer');
    if (footerEl) {
      contentEl.insertBefore(actionsEl, footerEl);
    }
    for (const outcome of outcomes) {
      this.renderTutorActionCard(actionsEl, {
        type: outcome.actionType,
        label: outcome.label,
        detail: outcome.detail,
        status: outcome.status,
        message: outcome.message,
        items: outcome.items,
      });
    }
    this.scrollToBottom();
  }

  appendLearningLessonPlans(messageId: string, plans: LearningLessonPlanContentBlock[]): void {
    if (plans.length === 0) return;

    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    const contentEl = msgEl?.querySelector<HTMLElement>('.claudian-message-content');
    if (!contentEl) return;

    contentEl.querySelectorAll('.claudian-lesson-plan-card').forEach((el) => el.remove());
    const footerEl = contentEl.querySelector<HTMLElement>('.claudian-response-footer');
    for (const plan of plans) {
      const planEl = this.renderLessonPlanCard(contentEl, plan);
      if (footerEl) {
        contentEl.insertBefore(planEl, footerEl);
      }
    }
    this.scrollToBottom();
  }

  appendLearningNextSteps(messageId: string, blocks: LearningNextStepsContentBlock[]): void {
    if (blocks.length === 0) return;

    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    const contentEl = msgEl?.querySelector<HTMLElement>('.claudian-message-content');
    if (!contentEl) return;

    contentEl.querySelectorAll('.claudian-next-options.is-learning-next-steps').forEach((el) => el.remove());
    const footerEl = contentEl.querySelector<HTMLElement>('.claudian-response-footer');
    for (const block of blocks) {
      const stepsEl = this.renderLearningNextSteps(contentEl, block);
      if (stepsEl) {
        if (footerEl) {
          contentEl.insertBefore(stepsEl, footerEl);
        }
      }
    }
    this.scrollToBottom();
  }

  appendLearningActivity(messageId: string, activity: LearningActivityContentBlock): void {
    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    const contentEl = msgEl?.querySelector<HTMLElement>('.claudian-message-content');
    if (!contentEl) return;

    contentEl.querySelectorAll('.claudian-learning-activity-card').forEach((el) => el.remove());
    const textEl = contentEl.querySelector<HTMLElement>('.claudian-text-block');
    const cardEl = this.renderLearningActivityCard(contentEl, activity);
    if (textEl) {
      contentEl.insertBefore(cardEl, textEl);
    }
    this.scrollToBottom();
  }

  private renderLearningActivityCard(parent: HTMLElement, activity: LearningActivityContentBlock): HTMLElement {
    const cardEl = parent.createDiv({ cls: `claudian-learning-activity-card is-${activity.status}` });
    cardEl.createSpan({ cls: 'claudian-learning-activity-kicker', text: this.getLearningActivityKicker(activity.status) });
    cardEl.createSpan({ cls: 'claudian-learning-activity-label', text: activity.label });
    if (activity.detail) {
      cardEl.createSpan({ cls: 'claudian-learning-activity-detail', text: activity.detail });
    }

    const items = activity.items?.map((item) => item.trim()).filter(Boolean).slice(0, 8) ?? [];
    if (items.length > 0) {
      const listEl = cardEl.createEl('ul', { cls: 'claudian-learning-activity-items' });
      for (const item of items) {
        listEl.createEl('li', { text: item });
      }
    }
    return cardEl;
  }

  private getLearningActivityKicker(status: LearningActivityContentBlock['status']): string {
    if (status === 'done') return 'AI Tutor - Done';
    if (status === 'error') return 'AI Tutor - Error';
    if (status === 'stopped') return 'AI Tutor - Stopped';
    return 'AI Tutor - Working';
  }

  private renderLessonPlanCard(parent: HTMLElement, plan: LearningLessonPlanContentBlock): HTMLElement {
    const cardEl = parent.createDiv({ cls: 'claudian-lesson-plan-card' });
    const headerEl = cardEl.createDiv({ cls: 'claudian-lesson-plan-header' });
    headerEl.createSpan({ cls: 'claudian-lesson-plan-kicker', text: 'AI Tutor - Lesson plan' });
    headerEl.createSpan({ cls: 'claudian-lesson-plan-title', text: plan.title });
    if (plan.detail) {
      headerEl.createSpan({ cls: 'claudian-lesson-plan-detail', text: plan.detail });
    }
    if (plan.overview) {
      cardEl.createDiv({ cls: 'claudian-lesson-plan-overview', text: plan.overview });
    }

    const parts = plan.parts.slice(0, 8);
    if (parts.length > 0) {
      const listEl = cardEl.createEl('ol', { cls: 'claudian-lesson-plan-parts' });
      for (const part of parts) {
        const itemEl = listEl.createEl('li', { cls: `claudian-lesson-plan-part is-${part.status ?? 'pending'}` });
        const partHeaderEl = itemEl.createDiv({ cls: 'claudian-lesson-plan-part-header' });
        partHeaderEl.createSpan({ cls: 'claudian-lesson-plan-part-title', text: part.title });
        partHeaderEl.createSpan({ cls: 'claudian-lesson-plan-part-status', text: this.getLessonPlanPartStatus(part.status) });
        if (part.description) {
          itemEl.createDiv({ cls: 'claudian-lesson-plan-part-description', text: part.description });
        }
        const bulletPoints = part.bulletPoints?.map((point) => point.trim()).filter(Boolean).slice(0, 5) ?? [];
        if (bulletPoints.length > 0) {
          const bulletsEl = itemEl.createEl('ul', { cls: 'claudian-lesson-plan-bullets' });
          for (const point of bulletPoints) {
            bulletsEl.createEl('li', { text: point });
          }
        }
        const sources = part.sources?.filter((source) => !!lessonPlanSourceLabel(source)).slice(0, 4) ?? [];
        if (sources.length > 0) {
          const sourcesEl = itemEl.createDiv({ cls: 'claudian-lesson-plan-sources' });
          sourcesEl.createSpan({ cls: 'claudian-lesson-plan-sources-label', text: 'Sources' });
          for (const source of sources) {
            this.renderLessonPlanSourceChip(sourcesEl, source);
          }
        }
      }
    }

    if (plan.nextLessonSummary) {
      const nextEl = cardEl.createDiv({ cls: 'claudian-lesson-plan-next' });
      nextEl.createSpan({ cls: 'claudian-lesson-plan-next-label', text: 'Next lesson' });
      nextEl.createSpan({ cls: 'claudian-lesson-plan-next-text', text: plan.nextLessonSummary });
    }
    return cardEl;
  }

  private renderLessonPlanSourceChip(parent: HTMLElement, source: string | LearningLessonPlanSource): void {
    const label = lessonPlanSourceLabel(source);
    const path = lessonPlanSourcePath(source);
    if (!path) {
      parent.createSpan({ cls: 'claudian-lesson-plan-source', text: label });
      return;
    }

    const button = parent.createEl('button', {
      cls: 'claudian-lesson-plan-source is-clickable',
      text: label,
      attr: {
        type: 'button',
        title: `Open source: ${path}`,
      },
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.plugin.learningController.openSource(source);
    });
  }

  private getLessonPlanPartStatus(status: LearningLessonPlanContentBlock['parts'][number]['status']): string {
    if (status === 'current') return 'Now';
    if (status === 'done') return 'Done';
    if (status === 'review') return 'Review';
    return 'Pending';
  }

  private renderTutorActionCard(parent: HTMLElement, action: TutorActionCard): HTMLElement {
    const status = action.status ?? 'requested';
    const cardEl = parent.createDiv({ cls: `claudian-tutor-action-card is-${status}` });
    const statusText = status === 'accepted'
      ? 'Accepted'
      : status === 'rejected'
        ? 'Rejected'
        : 'Requested';

    cardEl.createSpan({ cls: 'claudian-tutor-action-kicker', text: `AI Tutor - ${statusText}` });
    cardEl.createSpan({ cls: 'claudian-tutor-action-label', text: action.label });
    if (action.detail) {
      cardEl.createSpan({ cls: 'claudian-tutor-action-detail', text: action.detail });
    }
    if (action.message) {
      cardEl.createSpan({ cls: 'claudian-tutor-action-message', text: action.message });
    }
    const items = action.items?.map((item) => item.trim()).filter(Boolean).slice(0, 8) ?? [];
    if (items.length > 0) {
      const listEl = cardEl.createEl('ul', { cls: 'claudian-tutor-action-items' });
      for (const item of items) {
        listEl.createEl('li', { text: item });
      }
    }
    return cardEl;
  }

  /**
   * Renders a tool call with special handling for Write/Edit, Agent (subagent),
   * and Codex collab agent lifecycle tools.
   */
  private renderToolCall(contentEl: HTMLElement, toolCall: ToolCallInfo, msg?: ChatMessage): void {
    if (!this.shouldRenderToolCall(toolCall)) return;
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);

    if (isWriteEditTool(toolCall.name)) {
      renderStoredWriteEdit(contentEl, toolCall, {
        initiallyExpanded: this.shouldExpandFileEditsByDefault(),
      });
    } else if (isSubagentToolName(toolCall.name)) {
      this.renderTaskSubagent(contentEl, toolCall);
    } else if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name) && msg) {
      this.renderProviderLifecycleSubagent(contentEl, toolCall, msg);
    } else {
      renderStoredToolCall(contentEl, toolCall, {
        initiallyExpanded: toolCall.name === TOOL_APPLY_PATCH && this.shouldExpandFileEditsByDefault(),
      });
    }
  }

  private shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
    if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
    if (toolCall.name === TOOL_WRITE_STDIN && this.isSilentWriteStdinTool(toolCall)) return false;
    if (toolCall.name === 'custom_tool_call_output') return false;

    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);
    if (subagentLifecycleAdapter?.isHiddenTool(toolCall.name)) return false;

    return true;
  }

  private isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
    return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
  }

  private renderTaskSubagent(
    contentEl: HTMLElement,
    toolCall: ToolCallInfo,
    modeHint?: 'sync' | 'async'
  ): void {
    const subagentInfo = this.resolveTaskSubagent(toolCall, modeHint);
    if (subagentInfo.mode === 'async') {
      renderStoredAsyncSubagent(contentEl, subagentInfo);
      return;
    }
    renderStoredSubagent(contentEl, subagentInfo);
  }

  /**
   * Consolidates provider lifecycle tools (spawn + wait/close)
   * into a single subagent block with prompt and result.
   */
  private renderProviderLifecycleSubagent(
    contentEl: HTMLElement,
    spawnToolCall: ToolCallInfo,
    msg: ChatMessage,
  ): void {
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(spawnToolCall.name);
    if (!subagentLifecycleAdapter) {
      renderStoredToolCall(contentEl, spawnToolCall);
      return;
    }

    const subagentInfo = subagentLifecycleAdapter.buildSubagentInfo(
      spawnToolCall,
      msg.toolCalls ?? [],
    );
    renderStoredSubagent(contentEl, subagentInfo);
  }

  private resolveTaskSubagent(toolCall: ToolCallInfo, modeHint?: 'sync' | 'async'): SubagentInfo {
    if (toolCall.subagent) {
      if (!modeHint || toolCall.subagent.mode === modeHint) {
        return toolCall.subagent;
      }
      return {
        ...toolCall.subagent,
        mode: modeHint,
      };
    }

    const description = (toolCall.input?.description as string) || 'Subagent task';
    const prompt = (toolCall.input?.prompt as string) || '';
    const mode = modeHint ?? (toolCall.input?.run_in_background === true ? 'async' : 'sync');

    if (mode !== 'async') {
      return {
        id: toolCall.id,
        description,
        prompt,
        status: this.mapToolStatusToSubagentStatus(toolCall.status),
        toolCalls: [],
        isExpanded: false,
        result: toolCall.result,
      };
    }

    const asyncStatus = this.inferAsyncStatusFromTaskTool(toolCall);
    return {
      id: toolCall.id,
      description,
      prompt,
      mode: 'async',
      status: asyncStatus,
      asyncStatus,
      toolCalls: [],
      isExpanded: false,
      result: toolCall.result,
    };
  }

  private mapToolStatusToSubagentStatus(
    status: ToolCallInfo['status']
  ): 'completed' | 'error' | 'running' {
    switch (status) {
      case 'completed':
        return 'completed';
      case 'error':
      case 'blocked':
        return 'error';
      default:
        return 'running';
    }
  }

  private inferAsyncStatusFromTaskTool(toolCall: ToolCallInfo): 'running' | 'completed' | 'error' {
    if (toolCall.status === 'error' || toolCall.status === 'blocked') return 'error';
    if (toolCall.status === 'running') return 'running';

    const lowerResult = extractToolResultContent(toolCall.result, { fallbackIndent: 2 }).toLowerCase();
    if (
      lowerResult.includes('not_ready') ||
      lowerResult.includes('not ready') ||
      lowerResult.includes('"status":"running"') ||
      lowerResult.includes('"status":"pending"') ||
      lowerResult.includes('"retrieval_status":"running"') ||
      lowerResult.includes('"retrieval_status":"not_ready"')
    ) {
      return 'running';
    }

    return 'completed';
  }

  // ============================================
  // Image Rendering
  // ============================================

  /**
   * Renders image attachments above a message.
   */
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = containerEl.createDiv({ cls: 'claudian-message-images' });

    for (const image of images) {
      const imageWrapper = imagesEl.createDiv({ cls: 'claudian-message-image' });
      const imgEl = imageWrapper.createEl('img', {
        attr: {
          alt: image.name,
        },
      });

      void this.setImageSrc(imgEl, image);

      // Click to view full size
      imgEl.addEventListener('click', () => {
        void this.showFullImage(image);
      });
    }
  }

  /**
   * Shows full-size image in modal overlay.
   */
  showFullImage(image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;

    const ownerDocument = this.messagesEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-image-modal' });

    modal.createEl('img', {
      attr: {
        src: dataUri,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'claudian-image-modal-close' });
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }

  /**
   * Sets image src from attachment data.
   */
  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;
    imgEl.setAttribute('src', dataUri);
  }

  // ============================================
  // Content Rendering
  // ============================================

  /**
   * Renders markdown content with code block enhancements.
   */
  async renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions
  ): Promise<void> {
    el.empty();

    try {
      const renderMarkdown = options?.deferMath
        ? escapeMathDelimitersForStreaming(markdown)
        : markdown;
      // Normalize embeds before MarkdownRenderer consumes them.
      const processedMarkdown = replaceImageEmbedsWithHtml(
        renderMarkdown,
        this.app,
        { mediaFolder: this.plugin.settings.mediaFolder }
      );
      await MarkdownRenderer.render(
        this.app,
        processedMarkdown,
        el,
        '',
        this.component
      );

      // Wrap pre elements and move buttons outside scroll area
      el.querySelectorAll('pre').forEach((pre) => {
        // Skip if already wrapped
        if (pre.parentElement?.classList.contains('claudian-code-wrapper')) return;

        // Create wrapper
        const wrapper = createEl('div', { cls: 'claudian-code-wrapper' });
        pre.parentElement?.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // Check for language class and add label
        const code = pre.querySelector('code[class*="language-"]');
        if (code) {
          const match = code.className.match(/language-(\w+)/);
          if (match) {
            wrapper.classList.add('has-language');
            const label = createEl('span', {
              cls: 'claudian-code-lang-label',
              text: match[1],
            });
            wrapper.appendChild(label);
            label.addEventListener('click', () => {
              runRendererAction(async () => {
                const originalLabel = match[1];
                if (!originalLabel) return;

                try {
                  await navigator.clipboard.writeText(code.textContent || '');
                  label.setText('Copied!');
                  window.setTimeout(() => label.setText(originalLabel), 1500);
                } catch {
                  // Clipboard API may fail in non-secure contexts
                }
              });
            });
          }
        }

        // Move Obsidian's copy button outside pre into wrapper
        const copyBtn = pre.querySelector('.copy-code-button');
        if (copyBtn) {
          wrapper.appendChild(copyBtn);
        }
      });

      // Process wikilinks only when the source can contain them; the DOM pass is expensive.
      if (processedMarkdown.includes('[[')) {
        processFileLinks(this.app, el);
      }
    } catch {
      el.createDiv({
        cls: 'claudian-render-error',
        text: 'Failed to render message content.',
      });
    }
  }

  // ============================================
  // Copy Button
  // ============================================

  /**
   * Adds a copy button to a text block.
   * Button shows clipboard icon on hover, changes to "copied!" on click.
   * @param textEl The rendered text element
   * @param markdown The original markdown content to copy
   */
  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    const copyBtn = textEl.createSpan({ cls: 'claudian-text-copy-btn' });
    setIcon(copyBtn, 'copy');

    let feedbackTimeout: number | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {

        try {
          await navigator.clipboard.writeText(markdown);
        } catch {
          // Clipboard API may fail in non-secure contexts
          return;
        }

        // Clear any pending timeout from rapid clicks
        if (feedbackTimeout) {
          window.clearTimeout(feedbackTimeout);
        }

        // Show "copied!" feedback
        copyBtn.empty();
        copyBtn.setText('Copied!');
        copyBtn.classList.add('copied');

        feedbackTimeout = window.setTimeout(() => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    if (!msg.userMessageId) return;
    const canRewind = this.isRewindEligible(allMessages, index);
    const canFork = this.isForkEligible(allMessages, index);
    if (!canRewind && !canFork) return;
    const msgEl = this.liveMessageEls.get(msg.id);
    if (!msgEl) return;

    if (canRewind && this.rewindCallback && !msgEl.querySelector('.claudian-message-rewind-btn')) {
      this.addRewindButton(msgEl, msg.id);
    }
    if (canFork && this.forkCallback && !msgEl.querySelector('.claudian-message-fork-btn')) {
      this.addForkButton(msgEl, msg.id);
    }
    this.cleanupLiveMessageEl(msg.id, msgEl, { canRewind, canFork });
  }

  private cleanupLiveMessageEl(
    msgId: string,
    msgEl: HTMLElement,
    expectedActions: { canRewind: boolean; canFork: boolean },
  ): void {
    const needsRewind = expectedActions.canRewind
      && this.rewindCallback
      && !msgEl.querySelector('.claudian-message-rewind-btn');
    const needsFork = expectedActions.canFork
      && this.forkCallback
      && !msgEl.querySelector('.claudian-message-fork-btn');
    if (!needsRewind && !needsFork) {
      this.liveMessageEls.delete(msgId);
    }
  }

  private getOrCreateActionsToolbar(msgEl: HTMLElement): HTMLElement {
    const existing = msgEl.querySelector<HTMLElement>('.claudian-user-msg-actions');
    if (existing) return existing;
    return msgEl.createDiv({ cls: 'claudian-user-msg-actions' });
  }

  private addUserCopyButton(msgEl: HTMLElement, content: string): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const copyBtn = toolbar.createSpan({ cls: 'claudian-user-msg-copy-btn' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttribute('aria-label', 'Copy message');

    let feedbackTimeout: number | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          return;
        }
        if (feedbackTimeout) window.clearTimeout(feedbackTimeout);
        copyBtn.empty();
        copyBtn.setText('Copied!');
        copyBtn.classList.add('copied');
        feedbackTimeout = window.setTimeout(() => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  private addRewindButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.getCapabilities().supportsRewind) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'claudian-message-rewind-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'rotate-ccw');
    btn.setAttribute('aria-label', t('chat.rewind.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRewindMenu(e, messageId);
    });
  }

  private showRewindMenu(event: MouseEvent, messageId: string): void {
    const menu = new Menu();
    this.addRewindMenuItem(menu, messageId, 'conversation');
    this.addRewindMenuItem(menu, messageId, 'code-and-conversation');
    menu.showAtMouseEvent(event);
  }

  private addRewindMenuItem(menu: Menu, messageId: string, mode: ChatRewindMode): void {
    menu.addItem((item) => {
      item
        .setTitle(
          mode === 'conversation'
            ? t('chat.rewind.menuConversationOnly')
            : t('chat.rewind.menuCodeAndConversation')
        )
        .setIcon(mode === 'conversation' ? 'message-square' : 'rotate-ccw')
        .onClick(() => {
          runRendererAction(async () => {
            try {
              await this.rewindCallback?.(messageId, mode);
            } catch (err) {
              new Notice(t('chat.rewind.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
            }
          });
        });
    });
  }

  private addForkButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.getCapabilities().supportsFork) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'claudian-message-fork-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'git-fork');
    btn.setAttribute('aria-label', t('chat.fork.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await this.forkCallback?.(messageId);
        } catch (err) {
          new Notice(t('chat.fork.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
        }
      });
    });
  }

  // ============================================
  // Utilities
  // ============================================

  /** Scrolls messages container to bottom. */
  scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Scrolls to bottom if already near bottom (within threshold). */
  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      window.requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }

}
