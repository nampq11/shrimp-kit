import { describe, it, expect, vi } from 'vitest';
import { AgentLoop, extractText } from '../src/agent-loop.js';
import type { LLMProvider, LLMResponse, ContentBlock } from '../src/types.js';

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    createMessage: vi.fn(async () => {
      if (callIndex >= responses.length) throw new Error('No more mock responses');
      return responses[callIndex++];
    }),
  };
}

describe('AgentLoop', () => {
  it('returns text on end_turn', async () => {
    const provider = mockProvider([
      { content: [{ type: 'text', text: 'Hello world' }], stopReason: 'end_turn' },
    ]);

    const loop = new AgentLoop({
      provider,
      model: 'test-model',
      systemPrompt: 'You are helpful.',
    });

    const result = await loop.run([{ role: 'user', content: 'Hi' }]);
    expect(result.text).toBe('Hello world');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('assistant');
  });

  it('dispatches tool calls and loops', async () => {
    const toolCallResponse: LLMResponse = {
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'call-1', name: 'get_time', input: {} },
      ],
      stopReason: 'tool_use',
    };
    const finalResponse: LLMResponse = {
      content: [{ type: 'text', text: 'The time is 12:00.' }],
      stopReason: 'end_turn',
    };

    const provider = mockProvider([toolCallResponse, finalResponse]);
    const handler = vi.fn(async () => '12:00 UTC');

    const loop = new AgentLoop({
      provider,
      model: 'test',
      systemPrompt: 'test',
      tools: [{ name: 'get_time', description: 'Get time', input_schema: { type: 'object', properties: {} } }],
      toolHandlers: new Map([['get_time', handler]]),
    });

    const result = await loop.run([{ role: 'user', content: 'What time?' }]);
    expect(result.text).toBe('The time is 12:00.');
    expect(handler).toHaveBeenCalledOnce();
    expect(result.messages).toHaveLength(4);
  });

  it('handles unknown tool gracefully', async () => {
    const provider = mockProvider([
      {
        content: [{ type: 'tool_use', id: 'c1', name: 'unknown_tool', input: {} }],
        stopReason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Sorry.' }], stopReason: 'end_turn' },
    ]);

    const loop = new AgentLoop({ provider, model: 'test', systemPrompt: 'test' });
    const result = await loop.run([{ role: 'user', content: 'do something' }]);
    expect(result.text).toBe('Sorry.');

    const toolResultMsg = result.messages[2];
    expect(toolResultMsg.role).toBe('user');
    const blocks = toolResultMsg.content as ContentBlock[];
    expect(blocks[0].type).toBe('tool_result');
    if (blocks[0].type === 'tool_result') {
      expect(blocks[0].content).toContain('Unknown tool');
    }
  });

  it('throws on max iterations exceeded', async () => {
    const infiniteToolCall: LLMResponse = {
      content: [{ type: 'tool_use', id: 'c1', name: 'loop', input: {} }],
      stopReason: 'tool_use',
    };
    const responses = Array(20).fill(infiniteToolCall);
    const provider = mockProvider(responses);

    const loop = new AgentLoop({
      provider,
      model: 'test',
      systemPrompt: 'test',
      maxIterations: 3,
      toolHandlers: new Map([['loop', async () => 'ok']]),
    });

    await expect(loop.run([{ role: 'user', content: 'go' }])).rejects.toThrow('exceeded 3 iterations');
  });

  it('fires onToolCall callback', async () => {
    const provider = mockProvider([
      { content: [{ type: 'tool_use', id: 'c1', name: 'test_tool', input: { x: 1 } }], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'done' }], stopReason: 'end_turn' },
    ]);
    const onToolCall = vi.fn();

    const loop = new AgentLoop({
      provider,
      model: 'test',
      systemPrompt: 'test',
      toolHandlers: new Map([['test_tool', async () => 'result']]),
      onToolCall,
    });

    await loop.run([{ role: 'user', content: 'go' }]);
    expect(onToolCall).toHaveBeenCalledWith('test_tool', { x: 1 });
  });
});

describe('extractText', () => {
  it('extracts text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Hello ' },
      { type: 'tool_use', id: '1', name: 'x', input: {} },
      { type: 'text', text: 'World' },
    ];
    expect(extractText(blocks)).toBe('Hello World');
  });

  it('returns empty string for no text blocks', () => {
    expect(extractText([{ type: 'tool_use', id: '1', name: 'x', input: {} }])).toBe('');
  });
});
