import { describe, it, expect, vi } from 'vitest';
import { AzureOpenAIProvider, createAzureOpenAIProvider } from '../src/providers/azure-openai.js';
import type { CreateMessageParams } from '../src/types.js';

// Mock the openai SDK
vi.mock('openai', () => {
  return {
    AzureOpenAI: vi.fn(function (this: any) {
      this.chat = {
        completions: {
          create: vi.fn(),
        },
      };
      return this;
    }),
  };
});

describe('AzureOpenAIProvider', () => {
  it('initializes with config', () => {
    const provider = new AzureOpenAIProvider({
      apiKey: 'test-key',
      endpoint: 'https://test.openai.azure.com/',
      apiVersion: '2024-08-01-preview',
    });
    expect(provider).toBeDefined();
  });

  it('handles text response', async () => {
    const mockCreate = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: 'Hello, world!',
            tool_calls: undefined,
          },
          finish_reason: 'stop',
        },
      ],
    }));

    const { AzureOpenAI } = await import('openai');
    vi.mocked(AzureOpenAI).mockImplementation(function (this: any) {
      this.chat = { completions: { create: mockCreate } };
      return this;
    });

    const provider = new AzureOpenAIProvider({
      apiKey: 'test-key',
      endpoint: 'https://test.openai.azure.com/',
    });

    const params: CreateMessageParams = {
      model: 'gpt-4',
      maxTokens: 1000,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const response = await provider.createMessage(params);

    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
    if (response.content[0].type === 'text') {
      expect(response.content[0].text).toBe('Hello, world!');
    }
    expect(response.stopReason).toBe('end_turn');
  });

  it('normalizes stop_reason correctly', async () => {
    const testCases = [
      { input: 'stop', expected: 'end_turn' },
      { input: 'length', expected: 'max_tokens' },
      { input: 'tool_calls', expected: 'tool_use' },
      { input: 'unknown', expected: 'unknown' },
      { input: null, expected: 'end_turn' },
    ];

    for (const testCase of testCases) {
      const mockCreate = vi.fn(async () => ({
        choices: [
          {
            message: {
              content: 'test',
              tool_calls: undefined,
            },
            finish_reason: testCase.input,
          },
        ],
      }));

      const { AzureOpenAI } = await import('openai');
      vi.mocked(AzureOpenAI).mockImplementation(function (this: any) {
        this.chat = { completions: { create: mockCreate } };
        return this;
      });

      const provider = new AzureOpenAIProvider({
        apiKey: 'test-key',
        endpoint: 'https://test.openai.azure.com/',
      });

      const response = await provider.createMessage({
        model: 'gpt-4',
        maxTokens: 1000,
        system: 'test',
        messages: [],
      });

      expect(response.stopReason).toBe(testCase.expected);
    }
  });

  it('parses tool calls correctly', async () => {
    const mockCreate = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: 'Let me call a tool.',
            tool_calls: [
              {
                id: 'call-123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city": "Tokyo"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }));

    const { AzureOpenAI } = await import('openai');
    vi.mocked(AzureOpenAI).mockImplementation(function (this: any) {
      this.chat = { completions: { create: mockCreate } };
      return this;
    });

    const provider = new AzureOpenAIProvider({
      apiKey: 'test-key',
      endpoint: 'https://test.openai.azure.com/',
    });

    const response = await provider.createMessage({
      model: 'gpt-4',
      maxTokens: 1000,
      system: 'test',
      messages: [{ role: 'user', content: 'Get weather' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });

    expect(response.content).toHaveLength(2);
    expect(response.content[0].type).toBe('text');
    expect(response.content[1].type).toBe('tool_use');

    if (response.content[1].type === 'tool_use') {
      expect(response.content[1].id).toBe('call-123');
      expect(response.content[1].name).toBe('get_weather');
      expect(response.content[1].input).toEqual({ city: 'Tokyo' });
    }

    expect(response.stopReason).toBe('tool_use');
  });

  it('handles malformed tool argument JSON gracefully', async () => {
    const mockCreate = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call-bad',
                type: 'function',
                function: {
                  name: 'broken_tool',
                  arguments: 'not valid json',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }));

    const { AzureOpenAI } = await import('openai');
    vi.mocked(AzureOpenAI).mockImplementation(function (this: any) {
      this.chat = { completions: { create: mockCreate } };
      return this;
    });

    const provider = new AzureOpenAIProvider({
      apiKey: 'test-key',
      endpoint: 'https://test.openai.azure.com/',
    });

    const response = await provider.createMessage({
      model: 'gpt-4',
      maxTokens: 1000,
      system: 'test',
      messages: [],
    });

    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('tool_use');

    if (response.content[0].type === 'tool_use') {
      expect(response.content[0].input).toEqual({ raw: 'not valid json' });
    }
  });

  it('sends tools in request when provided', async () => {
    const mockCreate = vi.fn(async () => ({
      choices: [
        {
          message: { content: 'response', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
    }));

    const { AzureOpenAI } = await import('openai');
    vi.mocked(AzureOpenAI).mockImplementation(function (this: any) {
      this.chat = { completions: { create: mockCreate } };
      return this;
    });

    const provider = new AzureOpenAIProvider({
      apiKey: 'test-key',
      endpoint: 'https://test.openai.azure.com/',
    });

    const tools = [
      {
        name: 'test_tool',
        description: 'A test tool',
        input_schema: { type: 'object', properties: { arg: { type: 'string' } } },
      },
    ];

    await provider.createMessage({
      model: 'gpt-4',
      maxTokens: 1000,
      system: 'test',
      messages: [{ role: 'user', content: 'test' }],
      tools,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tools).toBeDefined();
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tools[0].function.name).toBe('test_tool');
  });

  it('creates provider with factory function', () => {
    const provider = createAzureOpenAIProvider({
      apiKey: 'test-key',
      endpoint: 'https://test.openai.azure.com/',
    });
    expect(provider).toBeDefined();
  });

  it('handles empty response gracefully', async () => {
    const mockCreate = vi.fn(async () => ({
      choices: [],
    }));

    const { AzureOpenAI } = await import('openai');
    vi.mocked(AzureOpenAI).mockImplementation(function (this: any) {
      this.chat = { completions: { create: mockCreate } };
      return this;
    });

    const provider = new AzureOpenAIProvider({
      apiKey: 'test-key',
      endpoint: 'https://test.openai.azure.com/',
    });

    await expect(
      provider.createMessage({
        model: 'gpt-4',
        maxTokens: 1000,
        system: 'test',
        messages: [],
      }),
    ).rejects.toThrow('No response from Azure OpenAI');
  });

  it('converts message content blocks correctly', async () => {
    const mockCreate = vi.fn(async () => ({
      choices: [
        {
          message: { content: 'Got it', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
    }));

    const { AzureOpenAI } = await import('openai');
    vi.mocked(AzureOpenAI).mockImplementation(function (this: any) {
      this.chat = { completions: { create: mockCreate } };
      return this;
    });

    const provider = new AzureOpenAIProvider({
      apiKey: 'test-key',
      endpoint: 'https://test.openai.azure.com/',
    });

    await provider.createMessage({
      model: 'gpt-4',
      maxTokens: 1000,
      system: 'test',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'response' },
            { type: 'tool_use', id: 'c1', name: 'tool', input: { x: 1 } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'result' }],
        },
      ],
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toHaveLength(4); // system + 3 user messages
  });
});
