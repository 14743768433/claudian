import { Notice } from 'obsidian';

import type { NoticePort } from '../ports/NoticePort';

export class ObsidianNoticeAdapter implements NoticePort {
  notify(message: string): void {
    new Notice(message);
  }
}
