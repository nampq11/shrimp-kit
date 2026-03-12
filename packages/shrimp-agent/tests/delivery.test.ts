import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DeliveryQueue, QueuedDelivery, chunkMessage, computeBackoffMs } from '../src/delivery.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrimp-delivery-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('computeBackoffMs', () => {
  it('returns 0 for first attempt', () => {
    expect(computeBackoffMs(0)).toBe(0);
  });

  it('returns increasing backoff with jitter', () => {
    const b1 = computeBackoffMs(1);
    const b2 = computeBackoffMs(2);
    const b3 = computeBackoffMs(3);
    expect(b1).toBeGreaterThan(0);
    expect(b1).toBeLessThan(10_000);
    expect(b2).toBeGreaterThan(b1 - 5000);
  });

  it('caps at max backoff', () => {
    const b10 = computeBackoffMs(10);
    expect(b10).toBeLessThanOrEqual(800_000);
  });
});

describe('chunkMessage', () => {
  it('returns single chunk for short messages', () => {
    expect(chunkMessage('Hello')).toEqual(['Hello']);
  });

  it('splits long messages', () => {
    const long = 'x'.repeat(5000);
    const chunks = chunkMessage(long, 'telegram');
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('splits at paragraph boundaries when possible', () => {
    const text = 'First paragraph.\n\n' + 'x'.repeat(3000) + '\n\nThird paragraph.';
    const chunks = chunkMessage(text, 'discord');
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('returns empty array for empty input', () => {
    expect(chunkMessage('')).toEqual([]);
  });

  it('respects channel-specific limits', () => {
    const text = 'x'.repeat(3000);
    const discordChunks = chunkMessage(text, 'discord');
    const telegramChunks = chunkMessage(text, 'telegram');
    expect(discordChunks.length).toBeGreaterThan(telegramChunks.length);
  });
});

describe('DeliveryQueue', () => {
  it('enqueues and loads pending', () => {
    const queue = new DeliveryQueue(tmpDir);
    const id = queue.enqueue('telegram', 'user-1', 'Hello there');
    expect(id).toHaveLength(12);

    const pending = queue.loadPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe('Hello there');
    expect(pending[0].channel).toBe('telegram');
  });

  it('ack removes from queue', () => {
    const queue = new DeliveryQueue(tmpDir);
    const id = queue.enqueue('cli', 'user', 'msg');
    expect(queue.loadPending()).toHaveLength(1);
    queue.ack(id);
    expect(queue.loadPending()).toHaveLength(0);
  });

  it('fail increments retry count and schedules next retry', () => {
    const queue = new DeliveryQueue(tmpDir);
    const id = queue.enqueue('cli', 'user', 'msg');
    queue.fail(id, 'connection refused');

    const pending = queue.loadPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].retryCount).toBe(1);
    expect(pending[0].lastError).toBe('connection refused');
    expect(pending[0].nextRetryAt).toBeGreaterThan(0);
  });

  it('moves to failed after max retries', () => {
    const queue = new DeliveryQueue(tmpDir);
    const id = queue.enqueue('cli', 'user', 'msg');
    for (let i = 0; i < 5; i++) {
      queue.fail(id, `error ${i}`);
    }

    expect(queue.loadPending()).toHaveLength(0);
    expect(queue.loadFailed()).toHaveLength(1);
  });

  it('retryFailed moves entries back to queue', () => {
    const queue = new DeliveryQueue(tmpDir);
    const id = queue.enqueue('cli', 'user', 'msg');
    for (let i = 0; i < 5; i++) queue.fail(id, 'err');
    expect(queue.loadFailed()).toHaveLength(1);

    const count = queue.retryFailed();
    expect(count).toBe(1);
    expect(queue.loadPending()).toHaveLength(1);
    expect(queue.loadFailed()).toHaveLength(0);
    expect(queue.loadPending()[0].retryCount).toBe(0);
  });

  it('preserves queue across restarts', () => {
    const queue1 = new DeliveryQueue(tmpDir);
    queue1.enqueue('telegram', 'user-1', 'message 1');
    queue1.enqueue('telegram', 'user-2', 'message 2');

    const queue2 = new DeliveryQueue(tmpDir);
    expect(queue2.loadPending()).toHaveLength(2);
  });
});

describe('QueuedDelivery', () => {
  it('serializes and deserializes', () => {
    const delivery = new QueuedDelivery({
      id: 'abc123',
      channel: 'telegram',
      to: 'user-1',
      text: 'Hello',
      retryCount: 2,
      lastError: 'timeout',
      enqueuedAt: 1000,
      nextRetryAt: 2000,
    });

    const json = delivery.toJSON();
    expect(json.id).toBe('abc123');
    expect(json.retryCount).toBe(2);
  });
});
