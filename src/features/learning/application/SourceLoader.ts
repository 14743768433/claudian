import type {
  LearningLessonPlanContentBlock,
  LearningLessonPlanSource,
  MessageUiBlock,
} from '../../../core/types';
import type { LearningTurnPort } from '../ports/LearningTurnPort';
import type { VaultPort } from '../ports/VaultPort';
import type { LessonSession } from '../domain/types';

export interface SourceSnippet {
  label: string;
  path: string;
  text: string;
}

export interface LessonNoteSnippet {
  label: string;
  path: string;
  text: string;
}

export function sourcePathFromText(value: string): string | null {
  const wiki = value.match(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]/);
  if (wiki?.[1]?.trim()) {
    return wiki[1].trim();
  }
  const markdown = value.match(/\]\(([^)]+?\.md)(?:#[^)]+)?\)/i);
  if (markdown?.[1]?.trim()) {
    return markdown[1].trim();
  }
  const direct = value.match(/(^|[\s"'(])([^"'()\r\n]+\.md)(?=$|[\s"')])/i);
  if (direct?.[2]?.trim()) {
    return direct[2].trim();
  }
  return null;
}

function isLessonPlanBlock(block: unknown): block is LearningLessonPlanContentBlock {
  if (!block || typeof block !== 'object') return false;
  const candidate = block as Partial<LearningLessonPlanContentBlock>;
  return candidate.type === 'learning_lesson_plan'
    && typeof candidate.title === 'string'
    && Array.isArray(candidate.parts);
}

export class SourceLoader {
  constructor(
    private readonly vault: VaultPort,
    private readonly turns: LearningTurnPort,
  ) {}

  async loadCurrentSectionSourceSnippets(lesson: LessonSession): Promise<SourceSnippet[]> {
    const plan = await this.loadLatestLessonPlan(lesson);
    const sources = plan?.parts[lesson.currentSectionIndex]?.sources ?? [];
    if (sources.length === 0) return [];

    const snippets: SourceSnippet[] = [];
    const seenPaths = new Set<string>();
    for (const source of sources) {
      const path = this.resolveSourcePath(source);
      if (!path || seenPaths.has(path)) continue;
      seenPaths.add(path);
      const resolvedPath = await this.resolveSourceVaultPath(path);
      if (!resolvedPath) continue;

      const text = await this.readSourceFileSnippet(resolvedPath);
      if (!text) continue;
      snippets.push({
        label: typeof source === 'string' ? source.trim() : source.label.trim(),
        path: resolvedPath,
        text,
      });
      if (snippets.length >= 3) break;
    }
    return snippets;
  }

  async loadLatestLessonPlan(lesson: LessonSession): Promise<LearningLessonPlanContentBlock | null> {
    const conversation = await this.turns.getConversation(lesson.conversationId);
    if (!conversation || typeof conversation !== 'object') return null;

    const blocks: LearningLessonPlanContentBlock[] = [];
    const candidate = conversation as {
      uiMessageBlocks?: Record<string, MessageUiBlock[]>;
      messages?: Array<{ contentBlocks?: unknown[] }>;
    };
    for (const uiBlocks of Object.values(candidate.uiMessageBlocks ?? {})) {
      for (const block of uiBlocks) {
        if (isLessonPlanBlock(block)) blocks.push(block);
      }
    }
    for (const message of candidate.messages ?? []) {
      for (const block of message.contentBlocks ?? []) {
        if (isLessonPlanBlock(block)) blocks.push(block);
      }
    }
    return blocks.at(-1) ?? null;
  }

  async loadLessonNoteSnippets(lesson: LessonSession): Promise<LessonNoteSnippet[]> {
    const snippets: LessonNoteSnippet[] = [];
    const seenPaths = new Set<string>();
    for (const section of lesson.sections) {
      const path = section.notePath?.trim();
      if (!path || seenPaths.has(path)) continue;
      seenPaths.add(path);
      try {
        if (!(await this.vault.exists(path))) continue;
        const markdown = await this.vault.read(path);
        const text = this.compactSourceSnippet(markdown);
        if (!text) continue;
        snippets.push({
          label: section.noteTitle?.trim() || section.title,
          path,
          text,
        });
        if (snippets.length >= 6) break;
      } catch {
        continue;
      }
    }
    return snippets;
  }

  async loadLessonNoteContent(path: string, label: string): Promise<LessonNoteSnippet | null> {
    const trimmedPath = path.trim();
    if (!trimmedPath) return null;

    try {
      if (!(await this.vault.exists(trimmedPath))) return null;
      const text = this.normalizeMarkdown(await this.vault.read(trimmedPath));
      if (!text) return null;
      return {
        label: label.trim() || trimmedPath,
        path: trimmedPath,
        text,
      };
    } catch {
      return null;
    }
  }

  async loadSourceContent(
    source: string | LearningLessonPlanSource,
  ): Promise<SourceSnippet | null> {
    const path = this.resolveSourcePath(source);
    if (!path) return null;

    const resolvedPath = await this.resolveSourceVaultPath(path);
    if (!resolvedPath) return null;

    const text = await this.readSourceFile(resolvedPath);
    if (!text) return null;

    return {
      label: typeof source === 'string' ? source.trim() : source.label.trim(),
      path: resolvedPath,
      text,
    };
  }

  async resolveSourceVaultPath(path: string): Promise<string | null> {
    const trimmed = path.trim();
    if (!trimmed) return null;

    const candidates = [trimmed];
    if (!/\.[^/.\\]+$/.test(trimmed)) {
      candidates.push(`${trimmed}.md`);
    }

    for (const candidate of candidates) {
      if (await this.vault.exists(candidate)) {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      const resolved = this.vault.resolveLinkpath(candidate.replace(/\.md$/i, ''), '');
      if (resolved && await this.vault.exists(resolved)) {
        return resolved;
      }
    }

    return null;
  }

  private resolveSourcePath(source: string | LearningLessonPlanSource): string | null {
    if (typeof source !== 'string' && source.path?.trim()) {
      return source.path.trim();
    }
    const label = typeof source === 'string' ? source.trim() : source.label.trim();
    return sourcePathFromText(label);
  }

  private async readSourceFileSnippet(path: string, maxChars = 2400): Promise<string> {
    try {
      return this.compactSourceSnippet(await this.vault.boundedRead(path, maxChars) ?? '', maxChars);
    } catch {
      return '';
    }
  }

  private async readSourceFile(path: string): Promise<string> {
    try {
      return this.normalizeMarkdown(await this.vault.read(path));
    } catch {
      return '';
    }
  }

  private compactSourceSnippet(markdown: string, maxChars = 2400): string {
    return this.normalizeMarkdown(markdown)
      .slice(0, maxChars);
  }

  private normalizeMarkdown(markdown: string): string {
    return markdown
      .replace(/\r\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }
}
