import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { TitleGenerationResult, TitleGenerationService } from '../../../core/providers/types';
import type { ChatMessage } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import type { LessonSession } from '../state/types';

type TitleServiceFactory = (plugin: ClaudianPlugin) => TitleGenerationService;

export class SummaryService {
  constructor(
    private readonly plugin: ClaudianPlugin,
    private readonly createTitleService: TitleServiceFactory = (plugin) => ProviderRegistry.createTitleGenerationService(plugin),
  ) {}

  async summarizeLesson(lesson: LessonSession): Promise<string> {
    let messages: ChatMessage[] = [];

    try {
      const conversation = await this.plugin.getConversationById(lesson.conversationId);
      messages = conversation?.messages ?? [];
    } catch {
      // Fallback below keeps progression unblocked.
    }

    const assistantText = this.extractAssistantText(messages);
    const generatedFocus = await this.generateSummaryFocus(lesson, messages, assistantText);

    if (generatedFocus && assistantText) {
      return [
        `Summary focus: ${generatedFocus}`,
        assistantText,
      ].join('\n\n');
    }

    if (assistantText) {
      return assistantText;
    }

    if (generatedFocus) {
      return `Summary focus: ${generatedFocus}`;
    }

    return `Covered ${lesson.title} with ${lesson.sections.length} section(s).`;
  }

  private async generateSummaryFocus(
    lesson: LessonSession,
    messages: ChatMessage[],
    assistantText: string | null,
  ): Promise<string | null> {
    if (messages.length === 0 && !assistantText) {
      return null;
    }

    const service = this.createTitleService(this.plugin);
    const conversationId = `ai-tutor-summary:${lesson.lessonId}`;
    const prompt = this.buildSummaryFocusPrompt(lesson, messages, assistantText);

    try {
      const result = await new Promise<TitleGenerationResult>((resolve) => {
        let settled = false;
        const finish = (next: TitleGenerationResult): void => {
          if (!settled) {
            settled = true;
            resolve(next);
          }
        };

        service.generateTitle(conversationId, prompt, async (_id, generationResult) => {
          finish(generationResult);
        }).then(
          () => finish({ success: false, error: 'Title generation completed without a result' }),
          (error: unknown) => finish({
            success: false,
            error: error instanceof Error ? error.message : 'Title generation failed',
          }),
        );
      });

      return result.success ? result.title.trim() || null : null;
    } catch {
      return null;
    } finally {
      service.cancel();
    }
  }

  private buildSummaryFocusPrompt(
    lesson: LessonSession,
    messages: ChatMessage[],
    assistantText: string | null,
  ): string {
    const sections = lesson.sections
      .map((section, index) => `${index + 1}. ${section.title}${section.notePath ? ` (${section.notePath})` : ''}`)
      .join('\n') || 'No planned sections recorded.';
    const transcriptDigest = this.buildTranscriptDigest(messages, assistantText);

    return [
      'Create a concise AI Tutor chapter handoff title for the next lesson.',
      `Chapter: ${lesson.title}`,
      'Sections:',
      sections,
      'Covered material:',
      transcriptDigest,
    ].join('\n');
  }

  private buildTranscriptDigest(messages: ChatMessage[], assistantText: string | null): string {
    if (assistantText) {
      return assistantText;
    }

    const digest = messages
      .slice(-6)
      .map((message) => `${message.role}: ${this.cleanTranscriptText(message.content)}`)
      .filter((line) => !line.endsWith(': '))
      .join('\n')
      .slice(0, 800);

    return digest || 'No assistant summary text was recorded.';
  }

  private extractAssistantText(messages: ChatMessage[]): string | null {
    const assistantMessages = messages
      .filter((message) => message.role === 'assistant' && message.content.trim())
      .slice(-3)
      .map((message) => this.cleanTranscriptText(message.content))
      .filter(Boolean);

    if (assistantMessages.length === 0) return null;

    const joined = assistantMessages.join(' ').slice(0, 800);
    return joined || null;
  }

  private cleanTranscriptText(content: string): string {
    return content
      .replace(/```([^\n`]*)\r?\n([\s\S]*?)```/g, (match, language: string, body: string) => (
        this.isTutorProtocolFence(language, body) ? ' ' : match
      ))
      .trim()
      .replace(/\s+/g, ' ');
  }

  private isTutorProtocolFence(language: string, body: string): boolean {
    const normalized = language.trim().toLowerCase().split(/\s+/)[0] ?? '';
    if (normalized === 'ai-tutor-action' || normalized === 'ai-tutor-next-options') return true;
    if (normalized !== 'ai' && normalized !== 'json' && normalized !== '') return false;

    const trimmed = body.trimStart();
    return /"type"\s*:\s*"(generateSyllabus|planChapter|sectionNoteWritten|advanceSection|startNewLesson)/.test(trimmed)
      || /"options"\s*:/.test(trimmed);
  }
}
