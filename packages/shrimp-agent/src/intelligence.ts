/**
 * Section 06: Intelligence
 * "Give it a soul, teach it to remember"
 *
 * BootstrapLoader — load system prompt layers from files on disk
 * SkillsManager — discover skills from SKILL.md files with frontmatter
 * MemoryStore — two-tier storage with TF-IDF + hybrid search
 * buildSystemPrompt — assemble 8-layer system prompt per turn
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// 1. BootstrapLoader — load prompt files from disk
// ---------------------------------------------------------------------------

const BOOTSTRAP_FILES = [
  'SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'USER.md',
  'HEARTBEAT.md', 'BOOTSTRAP.md', 'AGENTS.md', 'MEMORY.md',
];

const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 150_000;

export class BootstrapLoader {
  constructor(private workspaceDir: string) {}

  loadFile(name: string): string {
    const filePath = path.join(this.workspaceDir, name);
    try {
      if (!fs.existsSync(filePath)) return '';
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  truncateFile(content: string, maxChars = MAX_FILE_CHARS): string {
    if (content.length <= maxChars) return content;
    let cut = content.lastIndexOf('\n', maxChars);
    if (cut <= 0) cut = maxChars;
    return `${content.slice(0, cut)}\n\n[... truncated (${content.length} chars total, showing first ${cut}) ...]`;
  }

  loadAll(mode: 'full' | 'minimal' | 'none' = 'full'): Record<string, string> {
    if (mode === 'none') return {};
    const names = mode === 'minimal' ? ['AGENTS.md', 'TOOLS.md'] : [...BOOTSTRAP_FILES];
    const result: Record<string, string> = {};
    let total = 0;

    for (const name of names) {
      const raw = this.loadFile(name);
      if (!raw) continue;
      let truncated = this.truncateFile(raw);
      if (total + truncated.length > MAX_TOTAL_CHARS) {
        const remaining = MAX_TOTAL_CHARS - total;
        if (remaining > 0) {
          truncated = this.truncateFile(raw, remaining);
        } else {
          break;
        }
      }
      result[name] = truncated;
      total += truncated.length;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// 2. SkillsManager — discover skills from disk
// ---------------------------------------------------------------------------

const MAX_SKILLS = 150;
const MAX_SKILLS_PROMPT = 30_000;

export interface Skill {
  name: string;
  description: string;
  invocation: string;
  body: string;
  path: string;
}

export class SkillsManager {
  skills: Skill[] = [];

  constructor(private workspaceDir: string) {}

  private parseFrontmatter(text: string): Record<string, string> {
    const meta: Record<string, string> = {};
    if (!text.startsWith('---')) return meta;
    const parts = text.split('---', 3);
    if (parts.length < 3) return meta;
    for (const line of parts[1].trim().split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return meta;
  }

  private scanDir(base: string): Skill[] {
    const found: Skill[] = [];
    if (!fs.existsSync(base)) return found;
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(base, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        try {
          const content = fs.readFileSync(skillMd, 'utf-8');
          const meta = this.parseFrontmatter(content);
          if (!meta.name) continue;
          let body = '';
          if (content.startsWith('---')) {
            const parts = content.split('---', 3);
            if (parts.length >= 3) body = parts[2].trim();
          }
          found.push({
            name: meta.name,
            description: meta.description ?? '',
            invocation: meta.invocation ?? '',
            body,
            path: path.join(base, entry.name),
          });
        } catch {
          continue;
        }
      }
    } catch {
      // directory not readable
    }
    return found;
  }

  discover(extraDirs?: string[]): void {
    const scanOrder: string[] = [];
    if (extraDirs) scanOrder.push(...extraDirs);
    scanOrder.push(
      path.join(this.workspaceDir, 'skills'),
      path.join(this.workspaceDir, '.skills'),
      path.join(this.workspaceDir, '.agents', 'skills'),
    );

    const seen = new Map<string, Skill>();
    for (const dir of scanOrder) {
      for (const skill of this.scanDir(dir)) {
        seen.set(skill.name, skill);
      }
    }
    this.skills = [...seen.values()].slice(0, MAX_SKILLS);
  }

  formatPromptBlock(): string {
    if (this.skills.length === 0) return '';
    const lines = ['## Available Skills', ''];
    let total = 0;
    for (const skill of this.skills) {
      let block = `### Skill: ${skill.name}\nDescription: ${skill.description}\nInvocation: ${skill.invocation}\n`;
      if (skill.body) block += `\n${skill.body}\n`;
      block += '\n';
      if (total + block.length > MAX_SKILLS_PROMPT) {
        lines.push('(... more skills truncated)');
        break;
      }
      lines.push(block);
      total += block.length;
    }
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// 3. MemoryStore — two-tier storage with hybrid search
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  ts: string;
  category: string;
  content: string;
}

export interface MemorySearchResult {
  path: string;
  score: number;
  snippet: string;
}

interface TextChunk {
  path: string;
  text: string;
}

interface ScoredChunk {
  chunk: TextChunk;
  score: number;
}

export class MemoryStore {
  private memoryDir: string;
  private evergreenPath: string;

  constructor(private workspaceDir: string) {
    this.memoryDir = path.join(workspaceDir, 'memory', 'daily');
    this.evergreenPath = path.join(workspaceDir, 'MEMORY.md');
    fs.mkdirSync(this.memoryDir, { recursive: true });
  }

  writeMemory(content: string, category = 'general'): string {
    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(this.memoryDir, `${today}.jsonl`);
    const entry: MemoryEntry = {
      ts: new Date().toISOString(),
      category,
      content,
    };
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    return `Memory saved to ${today}.jsonl (${category})`;
  }

  loadEvergreen(): string {
    try {
      if (!fs.existsSync(this.evergreenPath)) return '';
      return fs.readFileSync(this.evergreenPath, 'utf-8').trim();
    } catch {
      return '';
    }
  }

  private loadAllChunks(): TextChunk[] {
    const chunks: TextChunk[] = [];
    const evergreen = this.loadEvergreen();
    if (evergreen) {
      for (const para of evergreen.split('\n\n')) {
        const trimmed = para.trim();
        if (trimmed) chunks.push({ path: 'MEMORY.md', text: trimmed });
      }
    }
    if (fs.existsSync(this.memoryDir)) {
      const files = fs.readdirSync(this.memoryDir).filter((f) => f.endsWith('.jsonl')).sort();
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.memoryDir, file), 'utf-8');
          for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            const entry = JSON.parse(line) as MemoryEntry;
            if (entry.content) {
              const label = entry.category ? `${file} [${entry.category}]` : file;
              chunks.push({ path: label, text: entry.content });
            }
          }
        } catch {
          continue;
        }
      }
    }
    return chunks;
  }

  static tokenize(text: string): string[] {
    const matches = text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? [];
    return matches.filter((t) => t.length > 1 || (t >= '\u4e00' && t <= '\u9fff'));
  }

  private static computeDocFrequency(allTokens: string[][]): Map<string, number> {
    const df = new Map<string, number>();
    for (const tokens of allTokens) {
      for (const t of new Set(tokens)) {
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
    return df;
  }

  private static computeTfidf(tokens: string[], df: Map<string, number>, n: number): Map<string, number> {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const result = new Map<string, number>();
    for (const [t, c] of tf) {
      result.set(t, c * (Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1));
    }
    return result;
  }

  private static cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0, na = 0, nb = 0;
    for (const [k, v] of a) {
      na += v * v;
      if (b.has(k)) dot += v * b.get(k)!;
    }
    for (const v of b.values()) nb += v * v;
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
  }

  private static toSearchResult(chunk: TextChunk, score: number): MemorySearchResult {
    return {
      path: chunk.path,
      score: Math.round(score * 10000) / 10000,
      snippet: chunk.text.length > 200 ? chunk.text.slice(0, 200) + '...' : chunk.text,
    };
  }

  searchMemory(query: string, topK = 5): MemorySearchResult[] {
    const chunks = this.loadAllChunks();
    if (chunks.length === 0) return [];
    return this.keywordSearchRaw(query, chunks, topK).map(({ chunk, score }) =>
      MemoryStore.toSearchResult(chunk, score),
    );
  }

  /**
   * Hybrid search: keyword (TF-IDF) + vector (hash-based) + merge + temporal decay + MMR.
   */
  hybridSearch(query: string, topK = 5): MemorySearchResult[] {
    const chunks = this.loadAllChunks();
    if (chunks.length === 0) return [];

    const keywordResults = this.keywordSearchRaw(query, chunks, 10);
    const vectorResults = this.vectorSearch(query, chunks, 10);
    let merged = this.mergeHybridResults(vectorResults, keywordResults);
    merged = this.temporalDecay(merged);
    merged = this.mmrRerank(merged);

    return merged.slice(0, topK).map(({ chunk, score }) =>
      MemoryStore.toSearchResult(chunk, score),
    );
  }

  private keywordSearchRaw(query: string, chunks: TextChunk[], topK: number): ScoredChunk[] {
    const queryTokens = MemoryStore.tokenize(query);
    if (queryTokens.length === 0) return [];
    const chunkTokens = chunks.map((c) => MemoryStore.tokenize(c.text));
    const df = MemoryStore.computeDocFrequency(chunkTokens);
    const n = chunks.length;
    const qvec = MemoryStore.computeTfidf(queryTokens, df, n);
    const scored: ScoredChunk[] = [];
    for (let i = 0; i < chunkTokens.length; i++) {
      if (chunkTokens[i].length === 0) continue;
      const score = MemoryStore.cosineSimilarity(qvec, MemoryStore.computeTfidf(chunkTokens[i], df, n));
      if (score > 0) scored.push({ chunk: chunks[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private static hashVector(text: string, dim = 64): number[] {
    const tokens = MemoryStore.tokenize(text);
    const vec = new Array(dim).fill(0);
    for (const token of tokens) {
      let h = 0;
      for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
      for (let i = 0; i < dim; i++) {
        const bit = (h >> (i % 31)) & 1;
        vec[i] += bit ? 1 : -1;
      }
    }
    const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0)) || 1;
    return vec.map((v: number) => v / norm);
  }

  private vectorSearch(query: string, chunks: TextChunk[], topK: number): ScoredChunk[] {
    const qvec = MemoryStore.hashVector(query);
    const scored: ScoredChunk[] = [];
    for (const chunk of chunks) {
      const cvec = MemoryStore.hashVector(chunk.text);
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < qvec.length; i++) {
        dot += qvec[i] * cvec[i];
        na += qvec[i] * qvec[i];
        nb += cvec[i] * cvec[i];
      }
      const d = Math.sqrt(na) * Math.sqrt(nb);
      const score = d > 0 ? dot / d : 0;
      if (score > 0) scored.push({ chunk, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private mergeHybridResults(
    vectorResults: ScoredChunk[],
    keywordResults: ScoredChunk[],
    vectorWeight = 0.7,
    textWeight = 0.3,
  ): ScoredChunk[] {
    const merged = new Map<string, ScoredChunk>();
    for (const r of vectorResults) {
      const key = r.chunk.text.slice(0, 100);
      merged.set(key, { chunk: r.chunk, score: r.score * vectorWeight });
    }
    for (const r of keywordResults) {
      const key = r.chunk.text.slice(0, 100);
      const existing = merged.get(key);
      if (existing) {
        existing.score += r.score * textWeight;
      } else {
        merged.set(key, { chunk: r.chunk, score: r.score * textWeight });
      }
    }
    const result = [...merged.values()];
    result.sort((a, b) => b.score - a.score);
    return result;
  }

  private temporalDecay(results: ScoredChunk[], decayRate = 0.01): ScoredChunk[] {
    const now = Date.now();
    for (const r of results) {
      const dateMatch = r.chunk.path.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const chunkDate = new Date(dateMatch[1]).getTime();
        const ageDays = (now - chunkDate) / 86_400_000;
        r.score *= Math.exp(-decayRate * ageDays);
      }
    }
    return results;
  }

  private mmrRerank(results: ScoredChunk[], lambda = 0.7): ScoredChunk[] {
    if (results.length <= 1) return results;
    const tokenized = results.map((r) => MemoryStore.tokenize(r.chunk.text));
    const selected: number[] = [];
    const remaining = new Set(results.map((_, i) => i));
    const reranked: typeof results = [];

    while (remaining.size > 0) {
      let bestIdx = -1;
      let bestMmr = -Infinity;
      for (const idx of remaining) {
        const relevance = results[idx].score;
        let maxSim = 0;
        for (const selIdx of selected) {
          const setA = new Set(tokenized[idx]);
          const setB = new Set(tokenized[selIdx]);
          const inter = [...setA].filter((t) => setB.has(t)).length;
          const union = new Set([...setA, ...setB]).size;
          const sim = union > 0 ? inter / union : 0;
          if (sim > maxSim) maxSim = sim;
        }
        const mmr = lambda * relevance - (1 - lambda) * maxSim;
        if (mmr > bestMmr) { bestMmr = mmr; bestIdx = idx; }
      }
      selected.push(bestIdx);
      remaining.delete(bestIdx);
      reranked.push(results[bestIdx]);
    }
    return reranked;
  }

  getStats(): { evergreenChars: number; dailyFiles: number; dailyEntries: number } {
    const evergreen = this.loadEvergreen();
    let dailyFiles = 0;
    let dailyEntries = 0;
    if (fs.existsSync(this.memoryDir)) {
      const files = fs.readdirSync(this.memoryDir).filter((f) => f.endsWith('.jsonl'));
      dailyFiles = files.length;
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.memoryDir, file), 'utf-8');
          dailyEntries += content.split('\n').filter((l) => l.trim()).length;
        } catch { /* ignore */ }
      }
    }
    return { evergreenChars: evergreen.length, dailyFiles, dailyEntries };
  }
}

// ---------------------------------------------------------------------------
// 5. System Prompt Assembly (8 layers)
// ---------------------------------------------------------------------------

export interface BuildSystemPromptOptions {
  mode?: 'full' | 'minimal' | 'none';
  bootstrap?: Record<string, string>;
  skillsBlock?: string;
  memoryContext?: string;
  agentId?: string;
  channel?: string;
  model?: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
  const {
    mode = 'full',
    bootstrap = {},
    skillsBlock = '',
    memoryContext = '',
    agentId = 'main',
    channel = 'terminal',
    model = '',
  } = options;

  const sections: string[] = [];

  // Layer 1: Identity
  const identity = (bootstrap['IDENTITY.md'] ?? '').trim();
  sections.push(identity || 'You are a helpful personal AI assistant.');

  // Layer 2: Soul
  if (mode === 'full') {
    const soul = (bootstrap['SOUL.md'] ?? '').trim();
    if (soul) sections.push(`## Personality\n\n${soul}`);
  }

  // Layer 3: Tools guidance
  const toolsMd = (bootstrap['TOOLS.md'] ?? '').trim();
  if (toolsMd) sections.push(`## Tool Usage Guidelines\n\n${toolsMd}`);

  // Layer 4: Skills
  if (mode === 'full' && skillsBlock) sections.push(skillsBlock);

  // Layer 5: Memory
  if (mode === 'full') {
    const memMd = (bootstrap['MEMORY.md'] ?? '').trim();
    const parts: string[] = [];
    if (memMd) parts.push(`### Evergreen Memory\n\n${memMd}`);
    if (memoryContext) parts.push(`### Recalled Memories (auto-searched)\n\n${memoryContext}`);
    if (parts.length > 0) sections.push(`## Memory\n\n${parts.join('\n\n')}`);
    sections.push(
      '## Memory Instructions\n\n' +
      '- Use memory_write to save important user facts and preferences.\n' +
      '- Reference remembered facts naturally in conversation.\n' +
      '- Use memory_search to recall specific past information.',
    );
  }

  // Layer 6: Bootstrap context
  if (mode === 'full' || mode === 'minimal') {
    for (const name of ['HEARTBEAT.md', 'BOOTSTRAP.md', 'AGENTS.md', 'USER.md']) {
      const content = (bootstrap[name] ?? '').trim();
      if (content) sections.push(`## ${name.replace('.md', '')}\n\n${content}`);
    }
  }

  // Layer 7: Runtime context
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  sections.push(
    `## Runtime Context\n\n` +
    `- Agent ID: ${agentId}\n- Model: ${model}\n` +
    `- Channel: ${channel}\n- Current time: ${now}\n- Prompt mode: ${mode}`,
  );

  // Layer 8: Channel hints
  const hints: Record<string, string> = {
    terminal: 'You are responding via a terminal REPL. Markdown is supported.',
    telegram: 'You are responding via Telegram. Keep messages concise.',
    discord: 'You are responding via Discord. Keep messages under 2000 characters.',
    slack: 'You are responding via Slack. Use Slack mrkdwn formatting.',
  };
  sections.push(`## Channel\n\n${hints[channel] ?? `You are responding via ${channel}.`}`);

  return sections.join('\n\n');
}
