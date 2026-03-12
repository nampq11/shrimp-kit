import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionStore, ContextGuard } from '../src/sessions.js';
import type { Message } from '../src/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrimp-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SessionStore', () => {
  it('creates and loads sessions', () => {
    const store = new SessionStore({ agentId: 'test', baseDir: tmpDir });
    const sid = store.createSession('my session');
    expect(sid).toHaveLength(12);
    expect(store.currentSessionId).toBe(sid);

    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0][0]).toBe(sid);
    expect(sessions[0][1].label).toBe('my session');
  });

  it('persists and replays turns', () => {
    const store = new SessionStore({ agentId: 'test', baseDir: tmpDir });
    const sid = store.createSession();
    store.saveTurn('user', 'Hello');
    store.saveTurn('assistant', [{ type: 'text', text: 'Hi!' }]);

    const store2 = new SessionStore({ agentId: 'test', baseDir: tmpDir });
    const messages = store2.loadSession(sid);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].role).toBe('assistant');
  });

  it('persists tool use and results', () => {
    const store = new SessionStore({ agentId: 'test', baseDir: tmpDir });
    store.createSession();
    store.saveTurn('user', 'do something');
    store.saveTurn('assistant', [
      { type: 'text', text: 'Let me help.' },
      { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'test.txt' } },
    ]);
    store.saveToolResult('call-1', 'read_file', { path: 'test.txt' }, 'file content');

    const store2 = new SessionStore({ agentId: 'test', baseDir: tmpDir });
    const messages = store2.loadSession(store.currentSessionId!);
    expect(messages.length).toBeGreaterThanOrEqual(3);
  });
});

describe('ContextGuard', () => {
  it('estimates tokens', () => {
    expect(ContextGuard.estimateTokens('Hello world')).toBe(3);
    expect(ContextGuard.estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('estimates messages tokens', () => {
    const guard = new ContextGuard();
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'World' }] },
    ];
    const tokens = guard.estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it('truncates tool results', () => {
    const guard = new ContextGuard({ maxTokens: 100 });
    const result = guard.truncateToolResult('x'.repeat(1000));
    expect(result.length).toBeLessThan(1000);
    expect(result).toContain('truncated');
  });

  it('truncateToolResults processes messages', () => {
    const guard = new ContextGuard({ maxTokens: 100 });
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'x'.repeat(10000) },
        ],
      },
    ];
    const truncated = guard.truncateToolResults(messages);
    const block = (truncated[0].content as Array<{ type: string; content: string }>)[0];
    expect(block.content.length).toBeLessThan(10000);
  });
});
