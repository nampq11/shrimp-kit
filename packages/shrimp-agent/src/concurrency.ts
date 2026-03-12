/**
 * Section 10: Concurrency
 * "Named lanes serialize the chaos"
 *
 * LaneQueue — a single named FIFO lane with concurrency control
 * CommandQueue — central dispatcher that routes callables into named LaneQueues
 *
 * Each lane is a FIFO queue with configurable maxConcurrency. Tasks enqueue as
 * callables, execute, and return results through Promises.
 */

// ---------------------------------------------------------------------------
// Deferred — a Promise with external resolve/reject
// ---------------------------------------------------------------------------

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

// ---------------------------------------------------------------------------
// LaneQueue — FIFO with concurrency control + generation tracking
// ---------------------------------------------------------------------------

interface QueueEntry<T> {
  fn: () => T | Promise<T>;
  deferred: Deferred<T>;
  generation: number;
}

export interface LaneStats {
  name: string;
  queueDepth: number;
  active: number;
  maxConcurrency: number;
  generation: number;
}

export class LaneQueue {
  readonly name: string;
  maxConcurrency: number;
  private queue: Array<QueueEntry<unknown>> = [];
  private activeCount = 0;
  private _generation = 0;

  constructor(name: string, maxConcurrency = 1) {
    this.name = name;
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  get generation(): number {
    return this._generation;
  }

  set generation(value: number) {
    this._generation = value;
  }

  enqueue<T>(fn: () => T | Promise<T>, generation?: number): Promise<T> {
    const deferred = new Deferred<T>();
    const gen = generation ?? this._generation;
    this.queue.push({ fn, deferred, generation: gen } as QueueEntry<unknown>);
    this.pump();
    return deferred.promise;
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.activeCount++;
      this.runTask(entry);
    }
  }

  private async runTask(entry: QueueEntry<unknown>): Promise<void> {
    try {
      const result = await entry.fn();
      entry.deferred.resolve(result);
    } catch (err) {
      entry.deferred.reject(err);
    } finally {
      this.taskDone(entry.generation);
    }
  }

  private taskDone(gen: number): void {
    this.activeCount--;
    if (gen === this._generation) {
      this.pump();
    }
  }

  waitForIdle(timeoutMs?: number): Promise<boolean> {
    if (this.activeCount === 0 && this.queue.length === 0) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = () => {
        if (this.activeCount === 0 && this.queue.length === 0) {
          resolve(true);
          return;
        }
        if (timeoutMs !== undefined && Date.now() - startTime >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
  }

  stats(): LaneStats {
    return {
      name: this.name,
      queueDepth: this.queue.length,
      active: this.activeCount,
      maxConcurrency: this.maxConcurrency,
      generation: this._generation,
    };
  }
}

// ---------------------------------------------------------------------------
// CommandQueue — routes work into named lanes
// ---------------------------------------------------------------------------

export const LANE_MAIN = 'main';
export const LANE_CRON = 'cron';
export const LANE_HEARTBEAT = 'heartbeat';

export class CommandQueue {
  private lanes = new Map<string, LaneQueue>();

  getOrCreateLane(name: string, maxConcurrency = 1): LaneQueue {
    let lane = this.lanes.get(name);
    if (!lane) {
      lane = new LaneQueue(name, maxConcurrency);
      this.lanes.set(name, lane);
    }
    return lane;
  }

  enqueue<T>(laneName: string, fn: () => T | Promise<T>): Promise<T> {
    const lane = this.getOrCreateLane(laneName);
    return lane.enqueue(fn);
  }

  resetAll(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, lane] of this.lanes) {
      lane.generation++;
      result[name] = lane.generation;
    }
    return result;
  }

  async waitForAll(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (const lane of this.lanes.values()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      if (!(await lane.waitForIdle(remaining))) return false;
    }
    return true;
  }

  stats(): Record<string, LaneStats> {
    const result: Record<string, LaneStats> = {};
    for (const [name, lane] of this.lanes) {
      result[name] = lane.stats();
    }
    return result;
  }

  laneNames(): string[] {
    return [...this.lanes.keys()];
  }
}
