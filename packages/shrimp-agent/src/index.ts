// @nampham1106/shrimp-agent
// AI Agent Gateway SDK — 10 progressive concepts from loop to production

// s01: Agent Loop
export { AgentLoop, extractText } from './agent-loop.js';
export type { AgentLoopOptions, AgentLoopResult } from './agent-loop.js';

// s02: Tool Use
export { ToolRegistry } from './tool-use.js';

// s03: Sessions & Context Guard
export { SessionStore, ContextGuard } from './sessions.js';
export type { SessionMeta, SessionStoreOptions, ContextGuardOptions } from './sessions.js';

// s04: Channels
export {
  Channel,
  ChannelManager,
  CLIChannel,
  TelegramChannel,
  FeishuChannel,
  buildChannelSessionKey,
} from './channels.js';
export type { TelegramChannelOptions, FeishuChannelOptions } from './channels.js';

// s05: Gateway & Routing
export {
  normalizeAgentId,
  BindingTable,
  buildSessionKey,
  AgentManager,
  resolveRoute,
  runAgent,
} from './gateway.js';
export type { Binding, DmScope, ManagedAgent } from './gateway.js';

// s06: Intelligence
export {
  BootstrapLoader,
  SkillsManager,
  MemoryStore,
  buildSystemPrompt,
} from './intelligence.js';
export type {
  Skill,
  MemoryEntry,
  MemorySearchResult,
  BuildSystemPromptOptions,
} from './intelligence.js';

// s07: Heartbeat & Cron
export { HeartbeatRunner, CronService } from './heartbeat.js';
export type { HeartbeatRunnerOptions, CronServiceOptions } from './heartbeat.js';

// s08: Delivery
export {
  DeliveryQueue,
  DeliveryRunner,
  QueuedDelivery,
  chunkMessage,
  computeBackoffMs,
} from './delivery.js';
export type { DeliverFn } from './delivery.js';

// s09: Resilience
export {
  classifyFailure,
  AuthProfile,
  ProfileManager,
  ResilienceRunner,
} from './resilience.js';
export type { ProviderFactory, ResilienceRunnerOptions, ResilienceStats } from './resilience.js';

// s10: Concurrency
export {
  LaneQueue,
  CommandQueue,
  LANE_MAIN,
  LANE_CRON,
  LANE_HEARTBEAT,
} from './concurrency.js';
export type { LaneStats } from './concurrency.js';

// Shared types
export type {
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  Message,
  ToolDefinition,
  LLMResponse,
  CreateMessageParams,
  LLMProvider,
  ToolHandler,
  ToolEntry,
  InboundMessage,
  ChannelAccount,
  AgentConfig,
  QueuedDeliveryData,
  AuthProfileData,
  CronJobDefinition,
} from './types.js';
export { FailoverReason } from './types.js';
