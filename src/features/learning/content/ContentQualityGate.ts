export interface ContentQualityResult {
  pass: boolean;
  reasons: string[];
}

export interface ContentQualityGateOptions {
  minChars?: number;
  requireCitation?: boolean;
}

const BANNED_PHRASES = [
  '作为一个AI',
  '作为 AI',
  '作为一名AI',
  '总之',
  '综上所述',
  '首先',
  '其次',
  '最后',
];

function countHeadings(markdown: string): number {
  return markdown.split(/\r?\n/).filter((line) => /^#{1,3}\s+\S/.test(line)).length;
}

function hasAnalogy(markdown: string): boolean {
  return /(类比|就像|好像|像是|可以把|想象|analogy|like a|as if)/i.test(markdown);
}

function hasConcreteNumber(markdown: string): boolean {
  return /\d+(\.\d+)?\s*(%|ms|s|秒|分钟|小时|KB|MB|GB|kSPS|bit|位|个|次|章|节|行|tokens?)?/i.test(markdown);
}

function hasReviewLoop(markdown: string): boolean {
  return /(自测|检查理解|Check Yourself|练习|问题|回顾|review)/i.test(markdown);
}

function hasCitation(markdown: string): boolean {
  return /\[[0-9]+\]|\[Source block\]/.test(markdown);
}

export class ContentQualityGate {
  check(markdown: string, options: ContentQualityGateOptions = {}): ContentQualityResult {
    const reasons: string[] = [];
    const minChars = options.minChars ?? 600;
    const trimmed = markdown.trim();

    if (trimmed.length < minChars) {
      reasons.push(`Note is too short; expected at least ${minChars} characters.`);
    }
    if (countHeadings(trimmed) < 4) {
      reasons.push('Note needs a clearer multi-section structure.');
    }
    if (!hasAnalogy(trimmed)) {
      reasons.push('Note needs at least one explanatory analogy.');
    }
    if (!hasConcreteNumber(trimmed)) {
      reasons.push('Note needs concrete numbers, counts, or measurable examples.');
    }
    if (!hasReviewLoop(trimmed)) {
      reasons.push('Note needs a review or check-your-understanding loop.');
    }
    const banned = BANNED_PHRASES.find((phrase) => trimmed.includes(phrase));
    if (banned) {
      reasons.push(`Note uses generic AI-sounding phrase: ${banned}.`);
    }
    if (options.requireCitation && !hasCitation(trimmed)) {
      reasons.push('Note needs citations for supplied source snippets.');
    }

    return {
      pass: reasons.length === 0,
      reasons,
    };
  }
}

