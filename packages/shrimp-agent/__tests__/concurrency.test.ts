import { describe, it, expect } from 'vitest';
import { LaneQueue, CommandQueue, LANE_MAIN, LANE_CRON, LANE_HEARTBEAT } from '../src/concurrency.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LaneQueue', () => {
  it('executes tasks in FIFO order with max concurrency 1', async () => {
    const lane = new LaneQueue('test', 1);
    const order: number[] = [];

    const p1 = lane.enqueue(async () => { await sleep(10); order.push(1); return 'a'; });
    const p2 = lane.enqueue(async () => { order.push(2); return 'b'; });
    const p3 = lane.enqueue(async () => { order.push(3); return 'c'; });

    expect(await p1).toBe('a');
    expect(await p2).toBe('b');
    expect(await p3).toBe('c');
    expect(order).toEqual([1, 2, 3]);
  });

  it('runs tasks in parallel with higher concurrency', async () => {
    const lane = new LaneQueue('parallel', 3);
    const started: number[] = [];
    const finished: number[] = [];

    const tasks = [1, 2, 3].map((i) =>
      lane.enqueue(async () => {
        started.push(i);
        await sleep(20);
        finished.push(i);
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([1, 2, 3]);
    expect(started).toHaveLength(3);
  });

  it('waitForIdle resolves when empty', async () => {
    const lane = new LaneQueue('idle-test', 1);
    lane.enqueue(async () => { await sleep(10); return 'done'; });

    const idle = await lane.waitForIdle(5000);
    expect(idle).toBe(true);
  });

  it('waitForIdle times out', async () => {
    const lane = new LaneQueue('timeout-test', 1);
    lane.enqueue(async () => { await sleep(1000); return 'slow'; });

    const idle = await lane.waitForIdle(10);
    expect(idle).toBe(false);
  });

  it('reports stats', async () => {
    const lane = new LaneQueue('stats-test', 2);
    const stats = lane.stats();
    expect(stats.name).toBe('stats-test');
    expect(stats.queueDepth).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.maxConcurrency).toBe(2);
    expect(stats.generation).toBe(0);
  });

  it('generation tracking prevents stale pump', async () => {
    const lane = new LaneQueue('gen-test', 1);
    const results: string[] = [];

    lane.enqueue(async () => {
      await sleep(50);
      results.push('old-gen');
      return 'old';
    });

    lane.enqueue(async () => {
      results.push('new-gen');
      return 'new';
    });

    lane.generation = 1;

    await sleep(100);
    expect(results).toContain('old-gen');
  });

  it('handles task errors', async () => {
    const lane = new LaneQueue('error-test', 1);
    const p = lane.enqueue(async () => { throw new Error('boom'); });
    await expect(p).rejects.toThrow('boom');

    const p2 = lane.enqueue(async () => 'recovered');
    expect(await p2).toBe('recovered');
  });
});

describe('CommandQueue', () => {
  it('creates lanes lazily', () => {
    const cq = new CommandQueue();
    expect(cq.laneNames()).toHaveLength(0);

    cq.getOrCreateLane('main');
    expect(cq.laneNames()).toEqual(['main']);

    cq.getOrCreateLane('main');
    expect(cq.laneNames()).toEqual(['main']);
  });

  it('enqueues work into named lanes', async () => {
    const cq = new CommandQueue();
    const result = await cq.enqueue('main', () => 42);
    expect(result).toBe(42);
  });

  it('different lanes run independently', async () => {
    const cq = new CommandQueue();
    const order: string[] = [];

    const p1 = cq.enqueue('lane-a', async () => {
      await sleep(20);
      order.push('a');
      return 'a';
    });

    const p2 = cq.enqueue('lane-b', async () => {
      order.push('b');
      return 'b';
    });

    await Promise.all([p1, p2]);
    expect(order[0]).toBe('b');
  });

  it('same lane serializes work', async () => {
    const cq = new CommandQueue();
    cq.getOrCreateLane('serial', 1);
    const order: number[] = [];

    const p1 = cq.enqueue('serial', async () => { await sleep(10); order.push(1); return 1; });
    const p2 = cq.enqueue('serial', async () => { order.push(2); return 2; });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('resetAll increments generation on all lanes', () => {
    const cq = new CommandQueue();
    cq.getOrCreateLane(LANE_MAIN);
    cq.getOrCreateLane(LANE_CRON);
    cq.getOrCreateLane(LANE_HEARTBEAT);

    const result = cq.resetAll();
    expect(result[LANE_MAIN]).toBe(1);
    expect(result[LANE_CRON]).toBe(1);
    expect(result[LANE_HEARTBEAT]).toBe(1);

    const result2 = cq.resetAll();
    expect(result2[LANE_MAIN]).toBe(2);
  });

  it('waitForAll returns true when all idle', async () => {
    const cq = new CommandQueue();
    cq.getOrCreateLane('a');
    cq.getOrCreateLane('b');

    await cq.enqueue('a', () => 'done');
    await cq.enqueue('b', () => 'done');

    const idle = await cq.waitForAll(5000);
    expect(idle).toBe(true);
  });

  it('stats aggregates all lanes', () => {
    const cq = new CommandQueue();
    cq.getOrCreateLane('main', 1);
    cq.getOrCreateLane('cron', 2);

    const stats = cq.stats();
    expect(stats.main.maxConcurrency).toBe(1);
    expect(stats.cron.maxConcurrency).toBe(2);
  });
});

describe('Lane constants', () => {
  it('has standard lane names', () => {
    expect(LANE_MAIN).toBe('main');
    expect(LANE_CRON).toBe('cron');
    expect(LANE_HEARTBEAT).toBe('heartbeat');
  });
});
