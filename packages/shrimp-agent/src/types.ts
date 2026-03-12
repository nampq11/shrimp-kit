// ---------------------------------------------------------------------------
// Core LLM types — provider-agnostic interfaces
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
}

export interface CreateMessageParams {
  model: string;
  maxTokens: number;
  system: string;
  messages: Message[];
  tools?: ToolDefinition[];
}

/**
 * Provider-agnostic LLM client interface.
 * Implement this to plug in Anthropic, OpenAI, or any compatible provider.
 */
export interface LLMProvider {
  createMessage(params: CreateMessageParams): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Tool handler types
// ---------------------------------------------------------------------------

export type ToolHandler = (input: Record<string, unknown>) => string | Promise<string>;

export interface ToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

// ---------------------------------------------------------------------------
// Channel types
// ---------------------------------------------------------------------------

export interface InboundMessage {
  text: string;
  senderId: string;
  channel: string;
  accountId: string;
  peerId: string;
  isGroup: boolean;
  media: Array<{ type: string; key?: string; fileId?: string }>;
  raw: Record<string, unknown>;
}

export interface ChannelAccount {
  channel: string;
  accountId: string;
  token: string;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent config types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  id: string;
  name: string;
  personality?: string;
  model?: string;
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
}

// ---------------------------------------------------------------------------
// Delivery types
// ---------------------------------------------------------------------------

export interface QueuedDeliveryData {
  id: string;
  channel: string;
  to: string;
  text: string;
  retryCount: number;
  lastError: string | null;
  enqueuedAt: number;
  nextRetryAt: number;
}

// ---------------------------------------------------------------------------
// Resilience types
// ---------------------------------------------------------------------------

export enum FailoverReason {
  RateLimit = 'rate_limit',
  Auth = 'auth',
  Timeout = 'timeout',
  Billing = 'billing',
  Overflow = 'overflow',
  Unknown = 'unknown',
}

export interface AuthProfileData {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Cron types
// ---------------------------------------------------------------------------

export interface CronJobDefinition {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'at' | 'every' | 'cron';
    at?: string;
    everySeconds?: number;
    anchor?: string;
    expr?: string;
  };
  payload: {
    kind: string;
    message?: string;
    text?: string;
  };
  deleteAfterRun?: boolean;
}
