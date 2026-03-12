/**
 * Azure OpenAI Provider
 * Adapter for Microsoft Azure's OpenAI service using the official openai SDK.
 *
 * Maps Azure chat completions API to the provider-agnostic LLMProvider interface.
 */

import { AzureOpenAI } from 'openai';
import type {
  LLMProvider,
  LLMResponse,
  CreateMessageParams,
  Message,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolDefinition,
} from '../types.js';

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export interface AzureOpenAIConfig {
  apiKey: string;
  endpoint: string;
  apiVersion?: string;
}

// ---------------------------------------------------------------------------
// Response Normalization Helpers
// ---------------------------------------------------------------------------

interface AzureToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface AzureContentPart {
  type: 'text' | 'tool_use';
  text?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

function normalizeStopReason(finishReason: string | null | undefined): string {
  if (!finishReason) return 'end_turn';
  const lower = finishReason.toLowerCase();
  if (lower === 'stop') return 'end_turn';
  if (lower === 'tool_calls') return 'tool_use';
  if (lower === 'length') return 'max_tokens';
  return finishReason;
}

function parseAzureToolCalls(toolCalls: AzureToolCall[]): ToolUseBlock[] {
  return toolCalls.map((call) => {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(call.function.arguments);
    } catch {
      input = { raw: call.function.arguments };
    }
    return {
      type: 'tool_use' as const,
      id: call.id,
      name: call.function.name,
      input,
    };
  });
}

function normalizeAzureResponse(
  textContent: string,
  toolCalls: AzureToolCall[] | undefined,
  finishReason: string | null | undefined,
): LLMResponse {
  const content: ContentBlock[] = [];

  if (textContent) {
    content.push({
      type: 'text' as const,
      text: textContent,
    });
  }

  if (toolCalls && toolCalls.length > 0) {
    const toolUseBlocks = parseAzureToolCalls(toolCalls);
    content.push(...toolUseBlocks);
  }

  return {
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    stopReason: normalizeStopReason(finishReason),
  };
}

// ---------------------------------------------------------------------------
// Message Conversion
// ---------------------------------------------------------------------------

function convertToAzureMessage(
  msg: Message,
): {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; [key: string]: unknown }>;
} {
  if (typeof msg.content === 'string') {
    return {
      role: msg.role,
      content: msg.content,
    };
  }

  const parts: Array<{ type: string; [key: string]: unknown }> = [];
  for (const block of msg.content) {
    if (block.type === 'text') {
      parts.push({
        type: 'text',
        text: block.text,
      });
    } else if (block.type === 'tool_result') {
      parts.push({
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
      });
    } else if (block.type === 'tool_use') {
      parts.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  return {
    role: msg.role,
    content: parts.length > 0 ? parts : '',
  };
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

export class AzureOpenAIProvider implements LLMProvider {
  private client: AzureOpenAI;
  private apiVersion: string;

  constructor(config: AzureOpenAIConfig) {
    this.apiVersion = config.apiVersion ?? '2024-08-01-preview';
    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      baseURL: config.endpoint,
      apiVersion: this.apiVersion,
      defaultHeaders: {
        'User-Agent': 'shrimp-agent/0.1.0',
      },
    });
  }

  async createMessage(params: CreateMessageParams): Promise<LLMResponse> {
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | unknown }> = [
      {
        role: 'system',
        content: params.system,
      },
    ];

    for (const msg of params.messages) {
      const converted = convertToAzureMessage(msg);
      messages.push({
        role: converted.role as 'user' | 'assistant' | 'system',
        content: converted.content,
      });
    }

    const tools = params.tools
      ? params.tools.map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        }))
      : undefined;

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages: messages as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
      max_tokens: params.maxTokens,
      tools,
      temperature: 1,
    });

    const choice = response.choices[0];
    if (!choice) throw new Error('No response from Azure OpenAI');

    const textContent = choice.message.content || '';
    const toolCalls = choice.message.tool_calls as AzureToolCall[] | undefined;
    const finishReason = choice.finish_reason;

    return normalizeAzureResponse(textContent, toolCalls, finishReason);
  }
}

/**
 * Factory function to create an AzureOpenAI provider.
 * Useful for use with ResilienceRunner.providerFactory.
 */
export function createAzureOpenAIProvider(config: AzureOpenAIConfig): LLMProvider {
  return new AzureOpenAIProvider(config);
}
