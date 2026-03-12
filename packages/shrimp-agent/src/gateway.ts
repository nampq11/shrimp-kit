/**
 * Section 05: Gateway & Routing
 * "Every message finds its home"
 *
 * BindingTable — 5-tier route resolution (peer > guild > account > channel > default)
 * AgentManager — per-agent config / workspace / sessions
 * GatewayServer — WebSocket JSON-RPC 2.0
 */

import type { AgentConfig, LLMProvider, Message, ToolDefinition } from './types.js';
import { AgentLoop, extractText } from './agent-loop.js';

// ---------------------------------------------------------------------------
// Agent ID Normalization
// ---------------------------------------------------------------------------

const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const DEFAULT_AGENT_ID = 'main';

export function normalizeAgentId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_AGENT_ID;
  if (VALID_ID_RE.test(trimmed)) return trimmed.toLowerCase();
  const cleaned = trimmed.toLowerCase().replace(INVALID_CHARS_RE, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return cleaned || DEFAULT_AGENT_ID;
}

// ---------------------------------------------------------------------------
// Binding — 5-Tier Route Resolution
// ---------------------------------------------------------------------------

export interface Binding {
  agentId: string;
  tier: number;
  matchKey: 'peer_id' | 'guild_id' | 'account_id' | 'channel' | 'default';
  matchValue: string;
  priority: number;
}

export class BindingTable {
  private bindings: Binding[] = [];

  add(binding: Binding): void {
    this.bindings.push(binding);
    this.bindings.sort((a, b) => a.tier - b.tier || b.priority - a.priority);
  }

  remove(agentId: string, matchKey: string, matchValue: string): boolean {
    const before = this.bindings.length;
    this.bindings = this.bindings.filter(
      (b) => !(b.agentId === agentId && b.matchKey === matchKey && b.matchValue === matchValue),
    );
    return this.bindings.length < before;
  }

  listAll(): Binding[] {
    return [...this.bindings];
  }

  resolve(params: {
    channel?: string;
    accountId?: string;
    guildId?: string;
    peerId?: string;
  }): { agentId: string | null; binding: Binding | null } {
    const { channel = '', accountId = '', guildId = '', peerId = '' } = params;
    for (const b of this.bindings) {
      if (b.tier === 1 && b.matchKey === 'peer_id') {
        if (b.matchValue.includes(':')) {
          if (b.matchValue === `${channel}:${peerId}`) return { agentId: b.agentId, binding: b };
        } else if (b.matchValue === peerId) {
          return { agentId: b.agentId, binding: b };
        }
      } else if (b.tier === 2 && b.matchKey === 'guild_id' && b.matchValue === guildId) {
        return { agentId: b.agentId, binding: b };
      } else if (b.tier === 3 && b.matchKey === 'account_id' && b.matchValue === accountId) {
        return { agentId: b.agentId, binding: b };
      } else if (b.tier === 4 && b.matchKey === 'channel' && b.matchValue === channel) {
        return { agentId: b.agentId, binding: b };
      } else if (b.tier === 5 && b.matchKey === 'default') {
        return { agentId: b.agentId, binding: b };
      }
    }
    return { agentId: null, binding: null };
  }
}

// ---------------------------------------------------------------------------
// Session Key Builder
// ---------------------------------------------------------------------------

export type DmScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';

export function buildSessionKey(
  agentId: string,
  options: { channel?: string; accountId?: string; peerId?: string; dmScope?: DmScope } = {},
): string {
  const aid = normalizeAgentId(agentId);
  const ch = (options.channel ?? 'unknown').trim().toLowerCase();
  const acc = (options.accountId ?? 'default').trim().toLowerCase();
  const pid = (options.peerId ?? '').trim().toLowerCase();
  const scope = options.dmScope ?? 'per-peer';

  if (scope === 'per-account-channel-peer' && pid) return `agent:${aid}:${ch}:${acc}:direct:${pid}`;
  if (scope === 'per-channel-peer' && pid) return `agent:${aid}:${ch}:direct:${pid}`;
  if (scope === 'per-peer' && pid) return `agent:${aid}:direct:${pid}`;
  return `agent:${aid}:main`;
}

// ---------------------------------------------------------------------------
// AgentManager
// ---------------------------------------------------------------------------

export interface ManagedAgent extends AgentConfig {
  effectiveModel(defaultModel: string): string;
  systemPrompt(): string;
}

export class AgentManager {
  private agents = new Map<string, AgentConfig>();
  private sessions = new Map<string, Message[]>();

  register(config: AgentConfig): void {
    const aid = normalizeAgentId(config.id);
    config.id = aid;
    this.agents.set(aid, config);
  }

  getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(normalizeAgentId(agentId));
  }

  listAgents(): AgentConfig[] {
    return [...this.agents.values()];
  }

  getSession(sessionKey: string): Message[] {
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, []);
    }
    return this.sessions.get(sessionKey)!;
  }

  listSessions(agentId = ''): Record<string, number> {
    const aid = agentId ? normalizeAgentId(agentId) : '';
    const result: Record<string, number> = {};
    for (const [k, v] of this.sessions) {
      if (!aid || k.startsWith(`agent:${aid}:`)) {
        result[k] = v.length;
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Route Resolution
// ---------------------------------------------------------------------------

export function resolveRoute(
  bindings: BindingTable,
  mgr: AgentManager,
  channel: string,
  peerId: string,
  accountId = '',
  guildId = '',
): { agentId: string; sessionKey: string } {
  const { agentId: resolved } = bindings.resolve({ channel, accountId, guildId, peerId });
  const agentId = resolved ?? DEFAULT_AGENT_ID;
  const agent = mgr.getAgent(agentId);
  const dmScope = agent?.dmScope ?? 'per-peer';
  const sessionKey = buildSessionKey(agentId, { channel, accountId, peerId, dmScope });
  return { agentId, sessionKey };
}

// ---------------------------------------------------------------------------
// Agent Runner
// ---------------------------------------------------------------------------

export async function runAgent(
  mgr: AgentManager,
  provider: LLMProvider,
  agentId: string,
  sessionKey: string,
  userText: string,
  options?: {
    defaultModel?: string;
    tools?: ToolDefinition[];
    toolHandlers?: Map<string, (input: Record<string, unknown>) => string | Promise<string>>;
  },
): Promise<string> {
  const agent = mgr.getAgent(agentId);
  if (!agent) return `Error: agent '${agentId}' not found`;

  const messages = mgr.getSession(sessionKey);
  messages.push({ role: 'user', content: userText });

  const model = agent.model ?? options?.defaultModel ?? 'claude-sonnet-4-20250514';
  const parts = [`You are ${agent.name}.`];
  if (agent.personality) parts.push(`Your personality: ${agent.personality}`);
  parts.push('Answer questions helpfully and stay in character.');

  const loop = new AgentLoop({
    provider,
    model,
    systemPrompt: parts.join(' '),
    tools: options?.tools,
    toolHandlers: options?.toolHandlers,
  });

  const result = await loop.run(messages);

  messages.length = 0;
  messages.push(...result.messages);

  return result.text || '[no text]';
}
