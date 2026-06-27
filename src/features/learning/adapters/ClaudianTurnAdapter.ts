import type {
  Conversation,
  LearningActivityContentBlock,
  MessageUiBlock,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import type {
  LearningOpenTab,
  LearningSendHiddenTurnInput,
  LearningTurnPort,
} from '../ports/LearningTurnPort';

type LearningChatTab = {
  id: string;
  conversationId: string | null;
  state: {
    currentConversationId?: string | null;
    isStreaming?: boolean;
    messages?: unknown[];
  };
  controllers: {
    inputController?: {
      sendMessage: (options?: {
        content?: string;
        displayContent?: string;
        hideUserMessage?: boolean;
        learningActivity?: LearningActivityContentBlock;
      }) => Promise<void> | void;
    } | null;
  };
};

type LearningChatTabManager = {
  getAllTabs: () => LearningChatTab[];
  switchToTab?: (id: string) => Promise<void> | void;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function messageLooksLikeAssistantResponse(message: unknown): boolean {
  if (!isRecord(message) || message.role !== 'assistant') return false;
  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    return true;
  }
  if (!Array.isArray(message.contentBlocks)) return false;
  return message.contentBlocks.some((block) => (
    isRecord(block)
    && block.type !== 'learning_activity'
    && block.type !== 'context_compacted'
  ));
}

function messagesHaveAssistantResponse(messages: unknown[] | undefined): boolean {
  return Array.isArray(messages) && messages.some(messageLooksLikeAssistantResponse);
}

function conversationHasAssistantResponse(conversation: Pick<Conversation, 'lastResponseAt' | 'messages'> | null | undefined): boolean {
  return !!conversation?.lastResponseAt || messagesHaveAssistantResponse(conversation?.messages);
}

export class ClaudianTurnAdapter implements LearningTurnPort {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async createConversation(title?: string): Promise<{ id: string }> {
    const conversation = await this.plugin.createConversation();
    if (title) {
      await this.renameConversation(conversation.id, title).catch(() => {});
    }
    return { id: conversation.id };
  }

  async renameConversation(conversationId: string, title: string): Promise<void> {
    await this.plugin.renameConversation?.(conversationId, title);
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    return this.plugin.getConversationSync?.(conversationId)
      ?? await this.plugin.getConversationById?.(conversationId)
      ?? null;
  }

  getConversationSync(conversationId: string): Conversation | null {
    return this.plugin.getConversationSync?.(conversationId) ?? null;
  }

  async updateConversation(conversationId: string, patch: Partial<Conversation>): Promise<void> {
    await this.plugin.updateConversation(conversationId, patch);
  }

  hasConversation(conversationId: string): boolean {
    return !!this.plugin.getConversationSync?.(conversationId);
  }

  async findOpenTabForConversation(conversationId: string, attempts = 1): Promise<LearningOpenTab | null> {
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
      for (const view of this.plugin.getAllViews()) {
        const tabManager = view.getTabManager() as LearningChatTabManager | null;
        const tab = tabManager?.getAllTabs()
          .find((candidate) => (
            candidate.conversationId === conversationId
            || candidate.state.currentConversationId === conversationId
          )) ?? null;
        if (tab) {
          await tabManager?.switchToTab?.(tab.id);
          return {
            isStreaming: tab.state.isStreaming === true,
            messages: tab.state.messages,
            sendHiddenTurn: async (input: Omit<LearningSendHiddenTurnInput, 'conversationId'>) => {
              await tab.controllers.inputController?.sendMessage({
                content: input.content,
                displayContent: input.displayContent,
                hideUserMessage: true,
                learningActivity: input.learningActivity,
              });
            },
          };
        }
      }
      if (attempt < attempts - 1) {
        await sleep(120);
      }
    }
    return null;
  }

  async persistUiMessageBlocks(
    conversationId: string,
    assistantMessageId: string,
    blocks: MessageUiBlock[],
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return;

    const existingBlocks = conversation.uiMessageBlocks?.[assistantMessageId] ?? [];
    const nextBlocks = [...existingBlocks, ...blocks];
    await this.updateConversation(conversationId, {
      uiMessageBlocks: {
        ...(conversation.uiMessageBlocks ?? {}),
        [assistantMessageId]: nextBlocks,
      },
    });
  }

  async hasAssistantResponse(conversationId: string): Promise<boolean> {
    const syncConversation = this.getConversationSync(conversationId);
    if (conversationHasAssistantResponse(syncConversation)) {
      return true;
    }
    const conversation = await this.getConversation(conversationId);
    return conversationHasAssistantResponse(conversation);
  }
}
