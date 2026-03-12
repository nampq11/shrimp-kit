/**
 * Section 01: The Agent Loop
 * "An agent is just while + stopReason"
 *
 *   User Input --> [messages[]] --> LLM API --> stopReason?
 *                                               /        \
 *                                         "end_turn"  "tool_use"
 *                                             |           |
 *                                          return      dispatch
 */

import type {
  LLMProvider,
  LLMResponse,
  Message,
  ContentBlock,
  TextBlock,
  ToolDefinition,
  ToolHandler,
  ToolResultBlock,
} from './types.js';

export interface AgentLoopOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  maxIterations?: number;
  tools?: ToolDefinition[];
  toolHandlers?: Map<string, ToolHandler>;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
}

export interface AgentLoopResult {
  text: string;
  response: LLMResponse;
  messages: Message[];
}

export function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Core agent loop — the foundation of every agent.
 *
 * Sends messages to the LLM, checks stopReason:
 *   - "end_turn" → return the text
 *   - "tool_use" → dispatch tools, feed results back, loop
 */
export class AgentLoop {
  private provider: LLMProvider;
  private model: string;
  private systemPrompt: string;
  private maxTokens: number;
  private maxIterations: number;
  private tools: ToolDefinition[];
  private toolHandlers: Map<string, ToolHandler>;
  private onToolCall?: (name: string, input: Record<string, unknown>) => void;

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.maxTokens = options.maxTokens ?? 8096;
    this.maxIterations = options.maxIterations ?? 15;
    this.tools = options.tools ?? [];
    this.toolHandlers = options.toolHandlers ?? new Map();
    this.onToolCall = options.onToolCall;
  }

  async run(messages: Message[]): Promise<AgentLoopResult> {
    const current = [...messages];

    for (let i = 0; i < this.maxIterations; i++) {
      const response = await this.provider.createMessage({
        model: this.model,
        maxTokens: this.maxTokens,
        system: this.systemPrompt,
        messages: current,
        tools: this.tools.length > 0 ? this.tools : undefined,
      });

      current.push({ role: 'assistant', content: response.content });

      if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
        return {
          text: extractText(response.content),
          response,
          messages: current,
        };
      }

      if (response.stopReason === 'tool_use') {
        const toolResults: ToolResultBlock[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          this.onToolCall?.(block.name, block.input);

          const handler = this.toolHandlers.get(block.name);
          let result: string;
          if (handler) {
            try {
              result = await handler(block.input);
            } catch (err) {
              result = `Error: ${block.name} failed: ${err}`;
            }
          } else {
            result = `Error: Unknown tool '${block.name}'`;
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }

        current.push({ role: 'user', content: toolResults });
        continue;
      }

      return {
        text: extractText(response.content),
        response,
        messages: current,
      };
    }

    throw new Error(`Agent loop exceeded ${this.maxIterations} iterations`);
  }
}
