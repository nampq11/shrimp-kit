import { describe, it, expect, vi } from 'vitest';
import { classifyFailure, AuthProfile, ProfileManager, ResilienceRunner } from '../src/resilience.js';
import { FailoverReason } from '../src/types.js';
import type { LLMProvider, LLMResponse } from '../src/types.js';

describe('classifyFailure', () => {
  it('classifies rate limit errors', () => {
    expect(classifyFailure(new Error('429 rate limit exceeded'))).toBe(FailoverReason.RateLimit);
  });

  it('classifies auth errors', () => {
    expect(classifyFailure(new Error('401 authentication failed'))).toBe(FailoverReason.Auth);
  });

  it('classifies timeout errors', () => {
    expect(classifyFailure(new Error('Request timed out'))).toBe(FailoverReason.Timeout);
  });

  it('classifies billing errors', () => {
    expect(classifyFailure(new Error('402 billing quota exceeded'))).toBe(FailoverReason.Billing);
  });

  it('classifies overflow errors', () => {
    expect(classifyFailure(new Error('context window token overflow'))).toBe(FailoverReason.Overflow);
  });

  it('classifies unknown errors', () => {
    expect(classifyFailure(new Error('something weird'))).toBe(FailoverReason.Unknown);
  });
});

describe('AuthProfile', () => {
  it('creates from data', () => {
    const profile = new AuthProfile({
      name: 'main-key',
      provider: 'anthropic',
      apiKey: 'sk-test-123',
    });
    expect(profile.name).toBe('main-key');
    expect(profile.cooldownUntil).toBe(0);
    expect(profile.failureReason).toBeNull();
  });
});

describe('ProfileManager', () => {
  it('selects first available profile', () => {
    const mgr = new ProfileManager([
      new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' }),
      new AuthProfile({ name: 'backup', provider: 'anthropic', apiKey: 'key2' }),
    ]);

    const profile = mgr.selectProfile();
    expect(profile?.name).toBe('main');
  });

  it('skips profiles on cooldown', () => {
    const main = new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' });
    const backup = new AuthProfile({ name: 'backup', provider: 'anthropic', apiKey: 'key2' });
    main.cooldownUntil = Date.now() / 1000 + 3600;

    const mgr = new ProfileManager([main, backup]);
    expect(mgr.selectProfile()?.name).toBe('backup');
  });

  it('returns null when all on cooldown', () => {
    const main = new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' });
    main.cooldownUntil = Date.now() / 1000 + 3600;

    const mgr = new ProfileManager([main]);
    expect(mgr.selectProfile()).toBeNull();
  });

  it('marks failure with cooldown', () => {
    const profile = new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' });
    const mgr = new ProfileManager([profile]);

    mgr.markFailure(profile, FailoverReason.RateLimit, 120);
    expect(profile.failureReason).toBe(FailoverReason.RateLimit);
    expect(profile.cooldownUntil).toBeGreaterThan(Date.now() / 1000);
  });

  it('marks success clears failure', () => {
    const profile = new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' });
    profile.failureReason = FailoverReason.RateLimit;
    const mgr = new ProfileManager([profile]);

    mgr.markSuccess(profile);
    expect(profile.failureReason).toBeNull();
    expect(profile.lastGoodAt).toBeGreaterThan(0);
  });

  it('listProfiles returns status', () => {
    const mgr = new ProfileManager([
      new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' }),
    ]);

    const list = mgr.listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('available');
  });
});

describe('ResilienceRunner', () => {
  function successProvider(): LLMProvider {
    return {
      createMessage: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'Success!' }],
        stopReason: 'end_turn' as const,
      })),
    };
  }

  it('runs successfully on first attempt', async () => {
    const provider = successProvider();
    const runner = new ResilienceRunner({
      profileManager: new ProfileManager([
        new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' }),
      ]),
      providerFactory: () => provider,
      modelId: 'test-model',
    });

    const result = await runner.run('system prompt', [{ role: 'user', content: 'Hi' }]);
    expect(result.response.stopReason).toBe('end_turn');
    const stats = runner.getStats();
    expect(stats.totalSuccesses).toBe(1);
    expect(stats.totalRotations).toBe(0);
  });

  it('rotates profiles on auth failure', async () => {
    let callCount = 0;
    const runner = new ResilienceRunner({
      profileManager: new ProfileManager([
        new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'bad-key' }),
        new AuthProfile({ name: 'backup', provider: 'anthropic', apiKey: 'good-key' }),
      ]),
      providerFactory: (profile) => ({
        createMessage: vi.fn(async () => {
          callCount++;
          if (profile.apiKey === 'bad-key') {
            throw new Error('401 authentication failed');
          }
          return {
            content: [{ type: 'text' as const, text: 'From backup' }],
            stopReason: 'end_turn' as const,
          };
        }),
      }),
      modelId: 'test',
    });

    const result = await runner.run('system', [{ role: 'user', content: 'Hi' }]);
    const text = result.response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
    expect(text).toBe('From backup');

    const stats = runner.getStats();
    expect(stats.totalRotations).toBe(1);
    expect(stats.totalFailures).toBeGreaterThanOrEqual(1);
  });

  it('tries fallback models when all profiles exhausted', async () => {
    const runner = new ResilienceRunner({
      profileManager: new ProfileManager([
        new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' }),
      ]),
      providerFactory: () => {
        let calls = 0;
        return {
          createMessage: vi.fn(async (params) => {
            calls++;
            if (params.model === 'test-model') {
              throw new Error('401 auth failed');
            }
            return {
              content: [{ type: 'text' as const, text: 'Fallback response' }],
              stopReason: 'end_turn' as const,
            };
          }),
        };
      },
      modelId: 'test-model',
      fallbackModels: ['fallback-model'],
    });

    const result = await runner.run('system', [{ role: 'user', content: 'Hi' }]);
    const text = result.response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
    expect(text).toBe('Fallback response');
  });

  it('throws when all profiles and fallbacks exhausted', async () => {
    const runner = new ResilienceRunner({
      profileManager: new ProfileManager([
        new AuthProfile({ name: 'main', provider: 'anthropic', apiKey: 'key1' }),
      ]),
      providerFactory: () => ({
        createMessage: vi.fn(async () => { throw new Error('401 auth failed'); }),
      }),
      modelId: 'test',
      fallbackModels: [],
    });

    await expect(runner.run('system', [{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('exhausted');
  });
});
