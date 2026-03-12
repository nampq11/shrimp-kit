/**
 * Section 09: Resilience
 * "When one call fails, rotate and retry."
 *
 * 3-layer retry onion:
 *   Layer 1: Auth Rotation — cycle through API key profiles
 *   Layer 2: Overflow Recovery — compact messages on context overflow
 *   Layer 3: Tool-Use Loop — standard while + stopReason dispatch
 */

import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
  ToolHandler,
  ToolResultBlock,
  AuthProfileData,
} from './types.js';
import { FailoverReason } from './types.js';
import { ContextGuard } from './sessions.js';

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export function classifyFailure(err: unknown): FailoverReason {
  const msg = String(err).toLowerCase();
  if (msg.includes('rate') || msg.includes('429')) return FailoverReason.RateLimit;
  if (msg.includes('auth') || msg.includes('401') || msg.includes('key')) return FailoverReason.Auth;
  if (msg.includes('timeout') || msg.includes('timed out')) return FailoverReason.Timeout;
  if (msg.includes('billing') || msg.includes('quota') || msg.includes('402')) return FailoverReason.Billing;
  if (msg.includes('context') || msg.includes('token') || msg.includes('overflow')) return FailoverReason.Overflow;
  return FailoverReason.Unknown;
}

// ---------------------------------------------------------------------------
// AuthProfile — one API key with cooldown tracking
// ---------------------------------------------------------------------------

export class AuthProfile {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  cooldownUntil = 0;
  failureReason: string | null = null;
  lastGoodAt = 0;

  constructor(data: AuthProfileData) {
    this.name = data.name;
    this.provider = data.provider;
    this.apiKey = data.apiKey;
    this.baseUrl = data.baseUrl;
  }
}

// ---------------------------------------------------------------------------
// ProfileManager — select, mark, and list profiles
// ---------------------------------------------------------------------------

export class ProfileManager {
  profiles: AuthProfile[];

  constructor(profiles: AuthProfile[]) {
    this.profiles = profiles;
  }

  selectProfile(): AuthProfile | null {
    const now = Date.now() / 1000;
    return this.profiles.find((p) => now >= p.cooldownUntil) ?? null;
  }

  selectAllAvailable(): AuthProfile[] {
    const now = Date.now() / 1000;
    return this.profiles.filter((p) => now >= p.cooldownUntil);
  }

  markFailure(profile: AuthProfile, reason: FailoverReason, cooldownSeconds = 300): void {
    profile.cooldownUntil = Date.now() / 1000 + cooldownSeconds;
    profile.failureReason = reason;
  }

  markSuccess(profile: AuthProfile): void {
    profile.failureReason = null;
    profile.lastGoodAt = Date.now() / 1000;
  }

  listProfiles(): Array<{
    name: string;
    provider: string;
    status: string;
    failureReason: string | null;
    lastGood: string;
  }> {
    const now = Date.now() / 1000;
    return this.profiles.map((p) => {
      const remaining = Math.max(0, p.cooldownUntil - now);
      return {
        name: p.name,
        provider: p.provider,
        status: remaining === 0 ? 'available' : `cooldown (${Math.round(remaining)}s)`,
        failureReason: p.failureReason,
        lastGood: p.lastGoodAt > 0 ? new Date(p.lastGoodAt * 1000).toISOString() : 'never',
      };
    });
  }
}

// ---------------------------------------------------------------------------
// ProviderFactory — creates LLMProvider from an AuthProfile
// ---------------------------------------------------------------------------

export type ProviderFactory = (profile: AuthProfile) => LLMProvider;

// ---------------------------------------------------------------------------
// ResilienceRunner — the 3-layer retry onion
// ---------------------------------------------------------------------------

const BASE_RETRY = 24;
const PER_PROFILE = 8;
const MAX_OVERFLOW_COMPACTION = 3;

export interface ResilienceRunnerOptions {
  profileManager: ProfileManager;
  providerFactory: ProviderFactory;
  modelId: string;
  fallbackModels?: string[];
  contextGuard?: ContextGuard;
  maxIterations?: number;
  tools?: ToolDefinition[];
  toolHandlers?: Map<string, ToolHandler>;
}

export interface ResilienceStats {
  totalAttempts: number;
  totalSuccesses: number;
  totalFailures: number;
  totalCompactions: number;
  totalRotations: number;
  maxIterations: number;
}

export class ResilienceRunner {
  private profileManager: ProfileManager;
  private providerFactory: ProviderFactory;
  private modelId: string;
  private fallbackModels: string[];
  private guard: ContextGuard;
  private maxIterations: number;
  private tools: ToolDefinition[];
  private toolHandlers: Map<string, ToolHandler>;

  private stats: ResilienceStats;

  constructor(options: ResilienceRunnerOptions) {
    this.profileManager = options.profileManager;
    this.providerFactory = options.providerFactory;
    this.modelId = options.modelId;
    this.fallbackModels = options.fallbackModels ?? [];
    this.guard = options.contextGuard ?? new ContextGuard();
    this.tools = options.tools ?? [];
    this.toolHandlers = options.toolHandlers ?? new Map();

    const numProfiles = options.profileManager.profiles.length;
    this.maxIterations = options.maxIterations ??
      Math.min(Math.max(BASE_RETRY + PER_PROFILE * numProfiles, 32), 160);

    this.stats = {
      totalAttempts: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      totalCompactions: 0,
      totalRotations: 0,
      maxIterations: this.maxIterations,
    };
  }

  async run(
    system: string,
    messages: Message[],
  ): Promise<{ response: LLMResponse; messages: Message[] }> {
    let currentMessages = [...messages];
    const profilesTried = new Set<string>();

    // LAYER 1: Auth Rotation
    for (let _rotation = 0; _rotation < this.profileManager.profiles.length; _rotation++) {
      const profile = this.profileManager.selectProfile();
      if (!profile || profilesTried.has(profile.name)) break;
      profilesTried.add(profile.name);

      if (profilesTried.size > 1) this.stats.totalRotations++;

      const provider = this.providerFactory(profile);

      // LAYER 2: Overflow Recovery
      let layer2Messages = [...currentMessages];
      for (let compactAttempt = 0; compactAttempt < MAX_OVERFLOW_COMPACTION; compactAttempt++) {
        try {
          this.stats.totalAttempts++;

          // LAYER 3: Tool-Use Loop
          const result = await this.runAttempt(provider, this.modelId, system, layer2Messages);
          this.profileManager.markSuccess(profile);
          this.stats.totalSuccesses++;
          return result;
        } catch (err) {
          const reason = classifyFailure(err);
          this.stats.totalFailures++;

          if (reason === FailoverReason.Overflow) {
            if (compactAttempt < MAX_OVERFLOW_COMPACTION - 1) {
              this.stats.totalCompactions++;
              layer2Messages = this.guard.truncateToolResults(layer2Messages);
              layer2Messages = await this.guard.compactHistory(layer2Messages, provider, this.modelId);
              continue;
            }
            this.profileManager.markFailure(profile, reason, 600);
            break;
          }

          if (reason === FailoverReason.Auth || reason === FailoverReason.Billing) {
            this.profileManager.markFailure(profile, reason, 300);
            break;
          }
          if (reason === FailoverReason.RateLimit) {
            this.profileManager.markFailure(profile, reason, 120);
            break;
          }
          if (reason === FailoverReason.Timeout) {
            this.profileManager.markFailure(profile, reason, 60);
            break;
          }
          this.profileManager.markFailure(profile, reason, 120);
          break;
        }
      }
    }

    for (const fallbackModel of this.fallbackModels) {
      const profile = this.profileManager.selectProfile();
      if (!profile) {
        for (const p of this.profileManager.profiles) {
          p.cooldownUntil = 0;
        }
      }
      const fbProfile = this.profileManager.selectProfile();
      if (!fbProfile) continue;

      const provider = this.providerFactory(fbProfile);
      try {
        this.stats.totalAttempts++;
        const result = await this.runAttempt(provider, fallbackModel, system, currentMessages);
        this.profileManager.markSuccess(fbProfile);
        this.stats.totalSuccesses++;
        return result;
      } catch {
        this.stats.totalFailures++;
        continue;
      }
    }

    throw new Error(
      `All profiles and fallback models exhausted. Tried ${profilesTried.size} profiles, ${this.fallbackModels.length} fallback models.`,
    );
  }

  private async runAttempt(
    provider: LLMProvider,
    model: string,
    system: string,
    messages: Message[],
  ): Promise<{ response: LLMResponse; messages: Message[] }> {
    const current = [...messages];
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const response = await provider.createMessage({
        model,
        maxTokens: 8096,
        system,
        messages: current,
        tools: this.tools.length > 0 ? this.tools : undefined,
      });
      current.push({ role: 'assistant', content: response.content });

      if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
        return { response, messages: current };
      }

      if (response.stopReason === 'tool_use') {
        const toolResults: ToolResultBlock[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const handler = this.toolHandlers.get(block.name);
          let result: string;
          if (handler) {
            try { result = await handler(block.input); }
            catch (err) { result = `Error: ${block.name} failed: ${err}`; }
          } else {
            result = `Error: Unknown tool '${block.name}'`;
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }
        current.push({ role: 'user', content: toolResults });
        continue;
      }

      return { response, messages: current };
    }

    throw new Error(`Tool-use loop exceeded ${this.maxIterations} iterations`);
  }

  getStats(): ResilienceStats {
    return { ...this.stats };
  }
}
