/**
 * Section 07: Heartbeat & Cron
 * "Not just reactive — proactive"
 *
 * HeartbeatRunner — timer that checks "should I run?" and queues work
 * CronService — schedule-based job execution with auto-disable on errors
 */

import type { LLMProvider, CronJobDefinition } from './types.js';
import { extractText } from './agent-loop.js';

// ---------------------------------------------------------------------------
// HeartbeatRunner
// ---------------------------------------------------------------------------

export interface HeartbeatRunnerOptions {
  provider: LLMProvider;
  model: string;
  interval?: number;
  activeHours?: [number, number];
  loadInstructions: () => string;
  buildSystemPrompt: () => string;
}

export class HeartbeatRunner {
  private provider: LLMProvider;
  private model: string;
  readonly interval: number;
  private activeHours: [number, number];
  private loadInstructions: () => string;
  private buildSystemPrompt: () => string;
  lastRunAt = 0;
  running = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private outputQueue: string[] = [];
  private lastOutput = '';

  constructor(options: HeartbeatRunnerOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.interval = options.interval ?? 1800;
    this.activeHours = options.activeHours ?? [9, 22];
    this.loadInstructions = options.loadInstructions;
    this.buildSystemPrompt = options.buildSystemPrompt;
  }

  shouldRun(): { ok: boolean; reason: string } {
    const instructions = this.loadInstructions();
    if (!instructions) return { ok: false, reason: 'no instructions' };

    const now = Date.now() / 1000;
    const elapsed = now - this.lastRunAt;
    if (elapsed < this.interval) {
      return { ok: false, reason: `interval not elapsed (${Math.round(this.interval - elapsed)}s remaining)` };
    }

    const hour = new Date().getHours();
    const [s, e] = this.activeHours;
    const inHours = s <= e ? (hour >= s && hour < e) : !(hour >= e && hour < s);
    if (!inHours) return { ok: false, reason: `outside active hours (${s}:00-${e}:00)` };
    if (this.running) return { ok: false, reason: 'already running' };

    return { ok: true, reason: 'all checks passed' };
  }

  private parseResponse(response: string): string | null {
    if (response.includes('HEARTBEAT_OK')) {
      const stripped = response.replace('HEARTBEAT_OK', '').trim();
      return stripped.length > 5 ? stripped : null;
    }
    return response.trim() || null;
  }

  async execute(): Promise<string | null> {
    const instructions = this.loadInstructions();
    if (!instructions) return null;
    const sysPrompt = this.buildSystemPrompt();

    this.running = true;
    try {
      const response = await this.provider.createMessage({
        model: this.model,
        maxTokens: 2048,
        system: sysPrompt,
        messages: [{ role: 'user', content: instructions }],
      });
      return this.parseResponse(extractText(response.content));
    } catch (err) {
      return `[heartbeat error: ${err}]`;
    } finally {
      this.running = false;
      this.lastRunAt = Date.now() / 1000;
    }
  }

  async tick(): Promise<void> {
    const { ok } = this.shouldRun();
    if (!ok) return;

    const meaningful = await this.execute();
    if (meaningful === null) return;
    if (meaningful.trim() === this.lastOutput) return;

    this.lastOutput = meaningful.trim();
    this.outputQueue.push(meaningful);
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      if (!this.stopped) this.tick().catch(() => {});
    }, 1000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  drainOutput(): string[] {
    const items = [...this.outputQueue];
    this.outputQueue = [];
    return items;
  }

  status(): Record<string, unknown> {
    const now = Date.now() / 1000;
    const elapsed = this.lastRunAt > 0 ? now - this.lastRunAt : null;
    const nextIn = elapsed !== null ? Math.max(0, this.interval - elapsed) : this.interval;
    const { ok, reason } = this.shouldRun();
    return {
      running: this.running,
      shouldRun: ok,
      reason,
      lastRun: this.lastRunAt > 0 ? new Date(this.lastRunAt * 1000).toISOString() : 'never',
      nextIn: `${Math.round(nextIn)}s`,
      interval: `${this.interval}s`,
      activeHours: `${this.activeHours[0]}:00-${this.activeHours[1]}:00`,
      queueSize: this.outputQueue.length,
    };
  }
}

// ---------------------------------------------------------------------------
// CronService
// ---------------------------------------------------------------------------

const CRON_AUTO_DISABLE_THRESHOLD = 5;

interface CronJobRuntime {
  id: string;
  name: string;
  enabled: boolean;
  everySeconds: number;
  payload: CronJobDefinition['payload'];
  lastRunAt: number;
  nextRunAt: number;
  consecutiveErrors: number;
}

export interface CronServiceOptions {
  provider: LLMProvider;
  model: string;
  jobs?: CronJobDefinition[];
}

export class CronService {
  private provider: LLMProvider;
  private model: string;
  jobs: CronJobRuntime[] = [];
  private outputQueue: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CronServiceOptions) {
    this.provider = options.provider;
    this.model = options.model;
    if (options.jobs) this.loadJobs(options.jobs);
  }

  loadJobs(definitions: CronJobDefinition[]): void {
    this.jobs = [];
    const now = Date.now() / 1000;
    for (const jd of definitions) {
      const every = jd.schedule.everySeconds;
      if (!every || every <= 0) continue;
      this.jobs.push({
        id: jd.id,
        name: jd.name,
        enabled: jd.enabled,
        everySeconds: every,
        payload: jd.payload,
        lastRunAt: 0,
        nextRunAt: now + every,
        consecutiveErrors: 0,
      });
    }
  }

  async tick(): Promise<void> {
    const now = Date.now() / 1000;
    for (const job of this.jobs) {
      if (!job.enabled || now < job.nextRunAt) continue;
      await this.runJob(job, now);
    }
  }

  private async runJob(job: CronJobRuntime, now: number): Promise<void> {
    const message = job.payload.message;
    if (!message) {
      job.nextRunAt = now + job.everySeconds;
      return;
    }

    try {
      const response = await this.provider.createMessage({
        model: this.model,
        maxTokens: 2048,
        system: `You are performing a scheduled background task. Be concise. Current time: ${new Date().toISOString()}`,
        messages: [{ role: 'user', content: message }],
      });
      const text = extractText(response.content);
      job.consecutiveErrors = 0;
      job.lastRunAt = now;
      job.nextRunAt = now + job.everySeconds;
      if (text) this.outputQueue.push(`[${job.name}] ${text}`);
    } catch (err) {
      job.consecutiveErrors++;
      job.lastRunAt = now;
      job.nextRunAt = now + job.everySeconds;
      this.outputQueue.push(`[${job.name}] error: ${err}`);
      if (job.consecutiveErrors >= CRON_AUTO_DISABLE_THRESHOLD) {
        job.enabled = false;
      }
    }
  }

  async triggerJob(jobId: string): Promise<string> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return `Job '${jobId}' not found`;
    await this.runJob(job, Date.now() / 1000);
    return `'${job.name}' triggered (errors=${job.consecutiveErrors})`;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  drainOutput(): string[] {
    const items = [...this.outputQueue];
    this.outputQueue = [];
    return items;
  }

  listJobs(): Array<Record<string, unknown>> {
    const now = Date.now() / 1000;
    return this.jobs.map((j) => ({
      id: j.id,
      name: j.name,
      enabled: j.enabled,
      everySeconds: j.everySeconds,
      errors: j.consecutiveErrors,
      lastRun: j.lastRunAt > 0 ? new Date(j.lastRunAt * 1000).toISOString() : 'never',
      nextIn: j.nextRunAt > 0 ? Math.max(0, Math.round(j.nextRunAt - now)) : null,
    }));
  }
}
