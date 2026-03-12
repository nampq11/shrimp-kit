import { describe, it, expect, vi } from 'vitest';
import { HeartbeatRunner, CronService } from '../src/heartbeat.js';
import type { LLMProvider } from '../src/types.js';

function mockProvider(text: string): LLMProvider {
  return {
    createMessage: vi.fn(async () => ({
      content: [{ type: 'text' as const, text }],
      stopReason: 'end_turn' as const,
    })),
  };
}

describe('HeartbeatRunner', () => {
  it('shouldRun checks all preconditions', () => {
    const runner = new HeartbeatRunner({
      provider: mockProvider('ok'),
      model: 'test',
      interval: 10,
      activeHours: [0, 24],
      loadInstructions: () => 'Check status',
      buildSystemPrompt: () => 'system prompt',
    });

    const { ok, reason } = runner.shouldRun();
    expect(ok).toBe(true);
    expect(reason).toBe('all checks passed');
  });

  it('shouldRun fails when no instructions', () => {
    const runner = new HeartbeatRunner({
      provider: mockProvider('ok'),
      model: 'test',
      loadInstructions: () => '',
      buildSystemPrompt: () => 'system',
    });

    const { ok } = runner.shouldRun();
    expect(ok).toBe(false);
  });

  it('shouldRun respects interval', async () => {
    const runner = new HeartbeatRunner({
      provider: mockProvider('HEARTBEAT_OK'),
      model: 'test',
      interval: 3600,
      activeHours: [0, 24],
      loadInstructions: () => 'Check',
      buildSystemPrompt: () => 'system',
    });

    await runner.execute();
    const { ok, reason } = runner.shouldRun();
    expect(ok).toBe(false);
    expect(reason).toContain('interval');
  });

  it('execute returns meaningful output', async () => {
    const runner = new HeartbeatRunner({
      provider: mockProvider('Important update: system degraded'),
      model: 'test',
      loadInstructions: () => 'Check the system',
      buildSystemPrompt: () => 'system',
    });

    const result = await runner.execute();
    expect(result).toBe('Important update: system degraded');
  });

  it('HEARTBEAT_OK suppresses output', async () => {
    const runner = new HeartbeatRunner({
      provider: mockProvider('HEARTBEAT_OK'),
      model: 'test',
      loadInstructions: () => 'Check the system',
      buildSystemPrompt: () => 'system',
    });

    const result = await runner.execute();
    expect(result).toBeNull();
  });

  it('drainOutput returns and clears queue', async () => {
    const runner = new HeartbeatRunner({
      provider: mockProvider('Alert!'),
      model: 'test',
      interval: 0,
      activeHours: [0, 24],
      loadInstructions: () => 'Check',
      buildSystemPrompt: () => 'sys',
    });

    await runner.tick();
    const items = runner.drainOutput();
    expect(items).toHaveLength(1);
    expect(items[0]).toBe('Alert!');
    expect(runner.drainOutput()).toHaveLength(0);
  });

  it('status returns complete info', () => {
    const runner = new HeartbeatRunner({
      provider: mockProvider('ok'),
      model: 'test',
      interval: 1800,
      activeHours: [9, 22],
      loadInstructions: () => 'Check',
      buildSystemPrompt: () => 'sys',
    });

    const status = runner.status();
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('interval');
    expect(status).toHaveProperty('activeHours');
    expect(status.interval).toBe('1800s');
  });
});

describe('CronService', () => {
  it('loads and lists jobs', () => {
    const cron = new CronService({
      provider: mockProvider('ok'),
      model: 'test',
      jobs: [
        {
          id: 'j1',
          name: 'Hourly Check',
          enabled: true,
          schedule: { kind: 'every', everySeconds: 3600 },
          payload: { kind: 'agent_turn', message: 'Check status' },
        },
      ],
    });

    const jobs = cron.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('Hourly Check');
    expect(jobs[0].everySeconds).toBe(3600);
  });

  it('triggers a specific job', async () => {
    const provider = mockProvider('Job completed successfully');
    const cron = new CronService({
      provider,
      model: 'test',
      jobs: [
        {
          id: 'j1',
          name: 'Test Job',
          enabled: true,
          schedule: { kind: 'every', everySeconds: 3600 },
          payload: { kind: 'agent_turn', message: 'Run test' },
        },
      ],
    });

    const result = await cron.triggerJob('j1');
    expect(result).toContain('Test Job');
    const output = cron.drainOutput();
    expect(output).toHaveLength(1);
    expect(output[0]).toContain('Job completed successfully');
  });

  it('auto-disables after consecutive errors', async () => {
    const failProvider: LLMProvider = {
      createMessage: vi.fn(async () => { throw new Error('API down'); }),
    };

    const cron = new CronService({
      provider: failProvider,
      model: 'test',
      jobs: [
        {
          id: 'j1',
          name: 'Failing Job',
          enabled: true,
          schedule: { kind: 'every', everySeconds: 1 },
          payload: { kind: 'agent_turn', message: 'fail' },
        },
      ],
    });

    for (let i = 0; i < 5; i++) {
      await cron.triggerJob('j1');
    }

    const jobs = cron.listJobs();
    expect(jobs[0].enabled).toBe(false);
  });
});
