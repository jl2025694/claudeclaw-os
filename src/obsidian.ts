import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

export interface ObsidianConfig {
  vault: string;
  folders: string[];
  readOnly?: string[];
}

interface ObsidianNote {
  title: string;
  folder: string;
  openTasks: string[];
  text: string;
}

const _cache = new Map<string, { notes: ObsidianNote[]; time: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_TASKS = 14;
const MAX_RELEVANT_NOTES = 4;
const MAX_SNIPPET_CHARS = 520;

export function buildObsidianContext(config: ObsidianConfig | undefined, query = ''): string {
  if (!config) return '';

  // Validate vault path exists on first cache build
  if (!fs.existsSync(config.vault)) {
    logger.warn(
      { vault: config.vault },
      'Obsidian vault path does not exist. Check agent.yaml obsidian.vault setting. Obsidian integration is disabled.',
    );
    return '';
  }

  const cacheKey = cacheKeyFor(config);
  const now = Date.now();
  let cached = _cache.get(cacheKey);
  if (!cached || now - cached.time > CACHE_TTL_MS) {
    cached = { notes: scanFolders(config), time: now };
    _cache.set(cacheKey, cached);
  }

  if (cached.notes.length === 0) return '';

  const lines: string[] = ['[Obsidian context]'];
  const taskLines: string[] = [];
  let currentFolder = '';
  let taskCount = 0;

  for (const note of cached.notes) {
    for (const task of note.openTasks) {
      if (taskCount >= MAX_TASKS) break;
      if (note.folder !== currentFolder) {
        currentFolder = note.folder;
        taskLines.push(`  ${displayFolder(currentFolder)}/`);
      }
      taskLines.push(`    Open: ${task} (${note.title})`);
      taskCount++;
    }
  }

  if (taskLines.length > 0) {
    lines.push('  Open tasks:');
    lines.push(...taskLines);
  }

  const relevant = findRelevantNotes(cached.notes, query);
  if (taskLines.length === 0 && relevant.length === 0) return '';

  if (relevant.length > 0) {
    lines.push('  Relevant notes:');
    for (const note of relevant) {
      lines.push(`    ${displayFolder(note.folder)}/${note.title}: ${snippet(note.text)}`);
    }
  }

  lines.push('[End Obsidian context]');
  return lines.join('\n');
}

function displayFolder(folder: string): string {
  return folder.replace(/\/+$/g, '');
}

function cacheKeyFor(config: ObsidianConfig): string {
  return JSON.stringify({
    vault: path.resolve(config.vault),
    folders: config.folders,
    readOnly: config.readOnly ?? [],
  });
}

function scanFolders(config: ObsidianConfig): ObsidianNote[] {
  const allFolders = [...new Set([...config.folders, ...(config.readOnly ?? [])])];
  const notes: ObsidianNote[] = [];

  for (const folder of allFolders) {
    const folderPath = path.join(config.vault, folder);
    if (!fs.existsSync(folderPath)) continue;

    for (const filePath of listMarkdownFiles(folderPath)) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      // Skip notes tagged as done
      if (/^status:\s*done/mi.test(content)) continue;

      // Extract open tasks: lines matching - [ ]
      const openTasks: string[] = [];
      for (const line of content.split('\n')) {
        const match = line.match(/^-\s+\[\s\]\s+(.+)/);
        if (match) {
          openTasks.push(match[1].trim());
        }
      }

      const text = normalizeNoteText(content);
      const relativePath = path.relative(config.vault, filePath);
      const title = path.basename(filePath).replace(/\.md$/, '');
      const noteFolder = path.dirname(relativePath);
      if (openTasks.length > 0 || text) notes.push({ title, folder: noteFolder, openTasks, text });
    }
  }

  return notes;
}

function listMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(entryPath);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function normalizeNoteText(content: string): string {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line === '---') return false;
      if (/^status:\s*/i.test(line)) return false;
      if (/^-\s+\[[ x]\]\s+/i.test(line)) return false;
      if (/^!\[\[/.test(line)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  const stop = new Set([
    'como', 'para', 'pero', 'porque', 'cuando', 'donde', 'esto', 'esta', 'este',
    'that', 'this', 'with', 'from', 'what', 'when', 'where', 'about', 'have',
  ]);
  return [...new Set(
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 3 && !stop.has(token)),
  )];
}

function findRelevantNotes(notes: ObsidianNote[], query: string): ObsidianNote[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  return notes
    .map((note) => {
      const haystack = `${note.folder} ${note.title} ${note.text}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += note.title.toLowerCase().includes(term) ? 3 : 1;
      }
      return { note, score };
    })
    .filter((row) => row.score > 0 && row.note.text)
    .sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title))
    .slice(0, MAX_RELEVANT_NOTES)
    .map((row) => row.note);
}

function snippet(text: string): string {
  if (text.length <= MAX_SNIPPET_CHARS) return text;
  return text.slice(0, MAX_SNIPPET_CHARS - 1).trimEnd() + '…';
}

/** Reset cache (for testing). */
export function _resetObsidianCache(): void {
  _cache.clear();
}
