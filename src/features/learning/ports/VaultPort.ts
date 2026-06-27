export interface VaultPort {
  read(path: string): Promise<string>;
  boundedRead(path: string, maxChars: number): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  openInMainSplit(path: string): Promise<void>;
  resolveLinkpath(linkOrWikilink: string, sourcePath?: string): string | null;
  onRename(cb: (oldPath: string, newPath: string) => void): () => void;
  onDelete(cb: (path: string) => void): () => void;
}
