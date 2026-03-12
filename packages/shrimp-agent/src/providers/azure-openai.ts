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
  ToolResultBlock,
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
// Internal OpenAI message shape
// ---------------------------------------------------------------------------

interface AzureToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<{ type: string; [key: string]: unknown }> }
  | { role: 'assistant'; content: string | null; tool_calls?: AzureToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

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

/**
 * Converts a provider-agnostic Message to one or more OpenAI-format messages.
 *
 * Tool results (role=user, content=ToolResultBlock[]) become individual
 * role='tool' messages. Assistant tool-use blocks become tool_calls.
 */
function convertToOpenAIMessages(msg: Message): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content }];
  }

  // User message carrying tool results → one role='tool' message per result
  const toolResults = msg.content.filter((b): b is ToolResultBlock => b.type === 'tool_result');
  if (toolResults.length > 0) {
    return toolResults.map((b) => ({
      role: 'tool' as const,
      tool_call_id: b.tool_use_id,
      content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
    }));
  }

  // Assistant message with tool calls → tool_calls array
  const toolUseBlocks = msg.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
  if (msg.role === 'assistant' && toolUseBlocks.length > 0) {
    const textContent =
      msg.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('') || null;

    return [
      {
        role: 'assistant' as const,
        content: textContent,
        tool_calls: toolUseBlocks.map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        })),
      },
    ];
  }

  // Regular text message
  const textParts = msg.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => ({ type: 'text' as const, text: b.text }));

  const content: string | Array<{ type: string; [key: string]: unknown }> =
    textParts.length > 0 ? textParts : '';

  if (msg.role === 'assistant') {
    return [{ role: 'assistant' as const, content: content as string | null }];
  }
  return [{ role: 'user' as const, content }];
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
      endpoint: config.endpoint,
      apiVersion: this.apiVersion,
      defaultHeaders: {
        'User-Agent': 'shrimp-agent/0.1.0',
      },
    });
  }

  async createMessage(params: CreateMessageParams): Promise<LLMResponse> {
    const messages: OpenAIMessage[] = [{ role: 'system', content: params.system }];

    for (const msg of params.messages) {
      messages.push(...convertToOpenAIMessages(msg));
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
      max_completion_tokens: params.maxTokens,
      tools,
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
