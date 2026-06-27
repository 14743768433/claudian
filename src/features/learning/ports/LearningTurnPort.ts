import type {
  Conversation,
  LearningActivityContentBlock,
  MessageUiBlock,
} from '../../../core/types';

export interface LearningSendHiddenTurnInput {
  conversationId: string;
  content: string;
  displayContent: string;
  learningActivity?: LearningActivityContentBlock;
}

export interface LearningOpenTab {
  isStreaming: boolean;
  messages?: unknown[];
  sendHiddenTurn(input: Omit<LearningSendHiddenTurnInput, 'conversationId'>): Promise<void>;
}

export interface LearningTurnPort {
  createConversation(title?: string): Promise<{ id: string }>;
  renameConversation(conversationId: string, title: string): Promise<void>;
  getConversation(conversationId: string): Promise<Conversation | null>;
  getConversationSync(conversationId: string): Conversation | null;
  updateConversation(conversationId: string, patch: Partial<Conversation>): Promise<void>;
  hasConversation(conversationId: string): boolean;
  findOpenTabForConversation(conversationId: string, attempts?: number): Promise<LearningOpenTab | null>;
  persistUiMessageBlocks(conversationId: string, assistantMessageId: string, blocks: MessageUiBlock[]): Promise<void>;
  hasAssistantResponse(conversationId: string): Promise<boolean>;
  generateConciseSummary(conversationId: string, prompt: string): Promise<string | null>;
}
