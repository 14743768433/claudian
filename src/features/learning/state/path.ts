export function normalizeLearningPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

export function slugifyCourseTitle(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return slug || 'course';
}

export function basenameFromPath(path: string): string {
  const normalized = normalizeLearningPath(path);
  const fileName = normalized.split('/').pop() ?? normalized;
  return fileName.replace(/\.md$/i, '');
}

