/**
 * Section 03: Sessions & Context Guard
 * "Sessions are JSONL files. Append on write, replay on read. When too big, summarize."
 *
 * SessionStore — JSONL persistence (append on write, replay on read)
 * ContextGuard — 3-stage overflow retry:
 *   try normal → truncate tool results → compact history (50%) → fail
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message, ContentBlock, TextBlock, LLMProvider, LLMResponse } from './types.js';

// ---------------------------------------------------------------------------
// SessionStore — JSONL-based conversation persistence
// ---------------------------------------------------------------------------

export interface SessionMeta {
  label: string;
  createdAt: string;
  lastActive: string;
  messageCount: number;
}

export interface SessionStoreOptions {
  agentId?: string;
  baseDir: string;
  sessionsRoot?: string;
}

export class SessionStore {
  readonly agentId: string;
  private baseDir: string;
  private sessionsDir: string;
  private indexPath: string;
  private index: Record<string, SessionMeta>;
  currentSessionId: string | null = null;

  constructor(options: SessionStoreOptions) {
    this.agentId = options.agentId ?? 'default';
    const root = options.sessionsRoot ?? path.join(options.baseDir, '.sessions');
    this.baseDir = path.join(root, 'agents', this.agentId);
    this.sessionsDir = path.join(this.baseDir, 'sessions');
    this.indexPath = path.join(this.baseDir, 'sessions.json');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    this.index = this.loadIndex();
  }

  private loadIndex(): Record<string, SessionMeta> {
    try {
      if (fs.existsSync(this.indexPath)) {
        return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
      }
    } catch {
      // corrupted index, start fresh
    }
    return {};
  }

  private saveIndex(): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf-8');
  }

  private sessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  createSession(label = ''): string {
    const sessionId = randomUUID().replace(/-/g, '').slice(0, 12);
    const now = new Date().toISOString();
    this.index[sessionId] = {
      label,
      createdAt: now,
      lastActive: now,
      messageCount: 0,
    };
    this.saveIndex();
    fs.writeFileSync(this.sessionPath(sessionId), '', 'utf-8');
    this.currentSessionId = sessionId;
    return sessionId;
  }

  loadSession(sessionId: string): Message[] {
    const filePath = this.sessionPath(sessionId);
    if (!fs.existsSync(filePath)) return [];
    this.currentSessionId = sessionId;
    return this.rebuildHistory(filePath);
  }

  saveTurn(role: string, content: string | ContentBlock[]): void {
    if (!this.currentSessionId) return;
    this.appendTranscript(this.currentSessionId, {
      type: role,
      content,
      ts: Date.now() / 1000,
    });
  }

  saveToolResult(toolUseId: string, name: string, input: Record<string, unknown>, result: string): void {
    if (!this.currentSessionId) return;
    const ts = Date.now() / 1000;
    this.appendTranscript(this.currentSessionId, {
      type: 'tool_use',
      tool_use_id: toolUseId,
      name,
      input,
      ts,
    });
    this.appendTranscript(this.currentSessionId, {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: result,
      ts,
    });
  }

  private appendTranscript(sessionId: string, record: Record<string, unknown>): void {
    const filePath = this.sessionPath(sessionId);
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
    if (this.index[sessionId]) {
      this.index[sessionId].lastActive = new Date().toISOString();
      this.index[sessionId].messageCount += 1;
      this.saveIndex();
    }
  }

  private rebuildHistory(filePath: string): Message[] {
    const messages: Message[] = [];
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return messages;

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      const rtype = record.type as string;

      if (rtype === 'user') {
        messages.push({ role: 'user', content: record.content as string });
      } else if (rtype === 'assistant') {
        let content = record.content;
        if (typeof content === 'string') {
          content = [{ type: 'text', text: content }];
        }
        messages.push({ role: 'assistant', content: content as ContentBlock[] });
      } else if (rtype === 'tool_use') {
        const block = {
          type: 'tool_use' as const,
          id: record.tool_use_id as string,
          name: record.name as string,
          input: record.input as Record<string, unknown>,
        };
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant' && Array.isArray(last.content)) {
          (last.content as ContentBlock[]).push(block);
        } else {
          messages.push({ role: 'assistant', content: [block] });
        }
      } else if (rtype === 'tool_result') {
        const resultBlock = {
          type: 'tool_result' as const,
          tool_use_id: record.tool_use_id as string,
          content: record.content as string,
        };
        const last = messages[messages.length - 1];
        if (
          last?.role === 'user' &&
          Array.isArray(last.content) &&
          (last.content as ContentBlock[])[0]?.type === 'tool_result'
        ) {
          (last.content as ContentBlock[]).push(resultBlock);
        } else {
          messages.push({ role: 'user', content: [resultBlock] });
        }
      }
    }

    return messages;
  }

  listSessions(): Array<[string, SessionMeta]> {
    return Object.entries(this.index).sort(
      (a, b) => (b[1].lastActive > a[1].lastActive ? 1 : -1),
    );
  }
}

// ---------------------------------------------------------------------------
// ContextGuard — context overflow protection
// ---------------------------------------------------------------------------

export interface ContextGuardOptions {
  maxTokens?: number;
}

export class ContextGuard {
  readonly maxTokens: number;

  constructor(options?: ContextGuardOptions) {
    this.maxTokens = options?.maxTokens ?? 180_000;
  }

  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  estimateMessagesTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += ContextGuard.estimateTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            total += ContextGuard.estimateTokens(block.text);
          } else if (block.type === 'tool_result') {
            total += ContextGuard.estimateTokens(block.content);
          } else if (block.type === 'tool_use') {
            total += ContextGuard.estimateTokens(JSON.stringify(block.input));
          }
        }
      }
    }
    return total;
  }

  truncateToolResult(result: string, maxFraction = 0.3): string {
    const maxChars = Math.floor(this.maxTokens * 4 * maxFraction);
    if (result.length <= maxChars) return result;
    const head = result.slice(0, maxChars);
    return `${head}\n\n[... truncated (${result.length} chars total, showing first ${head.length}) ...]`;
  }

  truncateToolResults(messages: Message[]): Message[] {
    const maxChars = Math.floor(this.maxTokens * 4 * 0.3);
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      const newBlocks = msg.content.map((block) => {
        if (
          block.type === 'tool_result' &&
          typeof block.content === 'string' &&
          block.content.length > maxChars
        ) {
          return {
            ...block,
            content: this.truncateToolResult(block.content),
          };
        }
        return block;
      });
      return { ...msg, content: newBlocks };
    });
  }

  async compactHistory(
    messages: Message[],
    provider: LLMProvider,
    model: string,
  ): Promise<Message[]> {
    const total = messages.length;
    if (total <= 4) return messages;

    const keepCount = Math.max(4, Math.floor(total * 0.2));
    let compressCount = Math.max(2, Math.floor(total * 0.5));
    compressCount = Math.min(compressCount, total - keepCount);
    if (compressCount < 2) return messages;

    const oldMessages = messages.slice(0, compressCount);
    const recentMessages = messages.slice(compressCount);

    const oldText = serializeMessagesForSummary(oldMessages);
    const summaryPrompt = `Summarize the following conversation concisely, preserving key facts and decisions. Output only the summary, no preamble.\n\n${oldText}`;

    try {
      const summaryResp = await provider.createMessage({
        model,
        maxTokens: 2048,
        system: 'You are a conversation summarizer. Be concise and factual.',
        messages: [{ role: 'user', content: summaryPrompt }],
      });

      const summaryText = summaryResp.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      return [
        { role: 'user', content: `[Previous conversation summary]\n${summaryText}` },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Understood, I have the context from our previous conversation.' }],
        },
        ...recentMessages,
      ];
    } catch {
      return recentMessages;
    }
  }

  /**
   * 3-stage retry guard around an LLM call.
   * Stage 0: normal call
   * Stage 1: truncate oversized tool results
   * Stage 2: compact history via LLM summary
   */
  async guardApiCall(
    provider: LLMProvider,
    model: string,
    system: string,
    messages: Message[],
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
    maxRetries = 2,
  ): Promise<{ response: LLMResponse; messages: Message[] }> {
    let current = messages;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await provider.createMessage({
          model,
          maxTokens: 8096,
          system,
          messages: current,
          tools,
        });
        return { response, messages: current };
      } catch (err) {
        const errorStr = String(err).toLowerCase();
        const isOverflow = errorStr.includes('context') || errorStr.includes('token');

        if (!isOverflow || attempt >= maxRetries) throw err;

        if (attempt === 0) {
          current = this.truncateToolResults(current);
        } else if (attempt === 1) {
          current = await this.compactHistory(current, provider, model);
        }
      }
    }

    throw new Error('guardApiCall: exhausted retries');
  }
}

function serializeMessagesForSummary(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      parts.push(`[${msg.role}]: ${msg.content}`);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push(`[${msg.role}]: ${block.text}`);
        } else if (block.type === 'tool_use') {
          parts.push(`[${msg.role} called ${block.name}]: ${JSON.stringify(block.input)}`);
        } else if (block.type === 'tool_result') {
          const preview = block.content.slice(0, 500);
          parts.push(`[tool_result]: ${preview}`);
        }
      }
    }
  }
  return parts.join('\n');
}
