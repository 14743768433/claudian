import { TFile, type App } from 'obsidian';

import { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { VaultPort } from '../ports/VaultPort';

export class ObsidianVaultAdapter extends VaultFileAdapter implements VaultPort {
  constructor(private readonly appRef: App) {
    super(appRef);
  }

  override async exists(path: string): Promise<boolean> {
    const adapter = this.appRef.vault.adapter as { exists?: (path: string) => Promise<boolean> };
    if (typeof adapter.exists === 'function') {
      return adapter.exists(path);
    }
    return !!this.appRef.vault.getAbstractFileByPath?.(path);
  }

  override async read(path: string): Promise<string> {
    const adapter = this.appRef.vault.adapter as { read?: (path: string) => Promise<string> };
    if (typeof adapter.read === 'function') {
      return adapter.read(path);
    }
    const file = this.appRef.vault.getAbstractFileByPath?.(path);
    const vault = this.appRef.vault as typeof this.appRef.vault & {
      cachedRead?: (file: TFile) => Promise<string>;
    };
    if (file instanceof TFile && typeof vault.cachedRead === 'function') {
      return vault.cachedRead(file);
    }
    throw new Error(`Missing file: ${path}`);
  }

  override async write(path: string, content: string): Promise<void> {
    const adapter = this.appRef.vault.adapter as { write?: (path: string, content: string) => Promise<void> };
    if (typeof adapter.write === 'function') {
      await super.write(path, content);
      return;
    }
    throw new Error('Vault adapter does not support write.');
  }

  async boundedRead(path: string, maxChars: number): Promise<string | null> {
    if (!(await this.exists(path))) return null;
    const markdown = await this.read(path);
    return markdown
      .replace(/\r\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
      .slice(0, maxChars);
  }

  async openInMainSplit(path: string): Promise<void> {
    const file = this.appRef.vault.getAbstractFileByPath?.(path);
    if (!(file instanceof TFile)) {
      throw new Error('File is missing.');
    }
    const leaf = this.appRef.workspace.getLeaf('split', 'vertical');
    await leaf.openFile(file);
  }

  resolveLinkpath(linkOrWikilink: string, sourcePath = ''): string | null {
    const trimmed = linkOrWikilink.trim();
    if (!trimmed) return null;

    const wiki = trimmed.match(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]/);
    const linkpath = wiki?.[1]?.trim() || trimmed.replace(/\.md$/i, '');
    const file = this.appRef.metadataCache.getFirstLinkpathDest?.(linkpath, sourcePath);
    return file?.path ?? null;
  }

  onRename(cb: (oldPath: string, newPath: string) => void): () => void {
    const handler = (...data: unknown[]): void => {
      const [file, oldPath] = data;
      if (file instanceof TFile && typeof oldPath === 'string') cb(oldPath, file.path);
    };
    this.appRef.vault.on('rename', handler);
    return () => this.appRef.vault.off('rename', handler);
  }

  onDelete(cb: (path: string) => void): () => void {
    const handler = (file: unknown): void => {
      if (file instanceof TFile) cb(file.path);
    };
    this.appRef.vault.on('delete', handler);
    return () => this.appRef.vault.off('delete', handler);
  }
}
