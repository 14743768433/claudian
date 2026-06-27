import * as fs from 'fs';
import * as path from 'path';

import { getEnhancedPath } from './env';
import { expandHomePath, parsePathEntries } from './path';

export function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveConfiguredCliPath(configuredPath: string | undefined): string | null {
  const trimmed = (configuredPath ?? '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const expandedPath = expandHomePath(trimmed);
    return resolveExistingFileCandidate(expandedPath);
  } catch {
    return null;
  }
}

export function findCliBinaryPath(
  binaryName: string,
  additionalPath?: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const binaryNames = platform === 'win32'
    ? [`${binaryName}.exe`, `${binaryName}.cmd`, binaryName]
    : [binaryName];
  const searchEntries = platform === process.platform
    ? parsePathEntries(getEnhancedPath(additionalPath))
    : parsePathEntriesForPlatform(additionalPath, platform);

  for (const dir of searchEntries) {
    if (!dir) continue;

    for (const candidateName of binaryNames) {
      const candidate = joinForDirectory(dir, candidateName);
      const resolvedCandidate = resolveExistingFileCandidate(candidate);
      if (resolvedCandidate) {
        return resolvedCandidate;
      }
    }
  }

  return null;
}

function parsePathEntriesForPlatform(pathValue: string | undefined, platform: NodeJS.Platform): string[] {
  if (!pathValue) {
    return [];
  }

  if (platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(pathValue.trim())) {
    return [expandHomePath(stripSurroundingQuotes(pathValue.trim()))];
  }

  const delimiter = platform === 'win32' ? ';' : ':';
  return pathValue
    .split(delimiter)
    .map(segment => stripSurroundingQuotes(segment.trim()))
    .filter(segment => {
      if (!segment) return false;
      const upper = segment.toUpperCase();
      return upper !== '$PATH' && upper !== '${PATH}' && upper !== '%PATH%';
    })
    .map(segment => translateMsysPathForPlatform(expandHomePath(segment), platform));
}

function stripSurroundingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function translateMsysPathForPlatform(value: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') {
    return value;
  }

  const msysMatch = value.match(/^\/([c-zC-Z])\/(.+)$/);
  if (!msysMatch) {
    return value;
  }

  const driveLetter = msysMatch[1].toUpperCase();
  const restOfPath = msysMatch[2] ?? '';
  return `${driveLetter}:\\${restOfPath.replace(/\//g, '\\')}`;
}

function resolveExistingFileCandidate(candidate: string): string | null {
  if (isExistingFile(candidate)) {
    return candidate;
  }

  if (process.platform !== 'win32' || !candidate.startsWith('/')) {
    return null;
  }

  const nativeCandidate = path.win32.normalize(candidate);
  if (nativeCandidate !== candidate && isExistingFile(nativeCandidate)) {
    return nativeCandidate;
  }

  return null;
}

function joinForDirectory(dir: string, child: string): string {
  return /^[A-Za-z]:(?:[\\/]|$)/.test(dir) || dir.includes('\\')
    ? path.win32.join(dir, child)
    : path.posix.join(dir, child);
}
