/**
 * Section 08: Delivery
 * "Write to disk first, then try to send"
 *
 * DeliveryQueue — disk-persisted reliable delivery queue (write-ahead)
 * DeliveryRunner — background delivery with exponential backoff
 * chunkMessage — split by platform limits
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { QueuedDeliveryData } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKOFF_MS = [5_000, 25_000, 120_000, 600_000]; // [5s, 25s, 2min, 10min]
const MAX_RETRIES = 5;

const CHANNEL_LIMITS: Record<string, number> = {
  telegram: 4096,
  telegram_caption: 1024,
  discord: 2000,
  whatsapp: 4096,
  default: 4096,
};

// ---------------------------------------------------------------------------
// Backoff computation
// ---------------------------------------------------------------------------

export function computeBackoffMs(retryCount: number): number {
  if (retryCount <= 0) return 0;
  const idx = Math.min(retryCount - 1, BACKOFF_MS.length - 1);
  const base = BACKOFF_MS[idx];
  const jitter = Math.floor(Math.random() * (base * 0.4)) - Math.floor(base * 0.2);
  return Math.max(0, base + jitter);
}

// ---------------------------------------------------------------------------
// Message chunking
// ---------------------------------------------------------------------------

export function chunkMessage(text: string, channel = 'default'): string[] {
  if (!text) return [];
  const limit = CHANNEL_LIMITS[channel] ?? CHANNEL_LIMITS.default;
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  for (const para of text.split('\n\n')) {
    if (chunks.length > 0 && chunks[chunks.length - 1].length + para.length + 2 <= limit) {
      chunks[chunks.length - 1] += '\n\n' + para;
    } else {
      let remaining = para;
      while (remaining.length > limit) {
        chunks.push(remaining.slice(0, limit));
        remaining = remaining.slice(limit);
      }
      if (remaining) chunks.push(remaining);
    }
  }
  return chunks.length > 0 ? chunks : [text.slice(0, limit)];
}

// ---------------------------------------------------------------------------
// QueuedDelivery
// ---------------------------------------------------------------------------

export class QueuedDelivery {
  id: string;
  channel: string;
  to: string;
  text: string;
  retryCount: number;
  lastError: string | null;
  enqueuedAt: number;
  nextRetryAt: number;

  constructor(data: QueuedDeliveryData) {
    this.id = data.id;
    this.channel = data.channel;
    this.to = data.to;
    this.text = data.text;
    this.retryCount = data.retryCount;
    this.lastError = data.lastError;
    this.enqueuedAt = data.enqueuedAt;
    this.nextRetryAt = data.nextRetryAt;
  }

  toJSON(): QueuedDeliveryData {
    return {
      id: this.id,
      channel: this.channel,
      to: this.to,
      text: this.text,
      retryCount: this.retryCount,
      lastError: this.lastError,
      enqueuedAt: this.enqueuedAt,
      nextRetryAt: this.nextRetryAt,
    };
  }
}

// ---------------------------------------------------------------------------
// DeliveryQueue — disk-persisted reliable delivery queue
// ---------------------------------------------------------------------------

export class DeliveryQueue {
  private queueDir: string;
  private failedDir: string;

  constructor(queueDir: string) {
    this.queueDir = queueDir;
    this.failedDir = path.join(queueDir, 'failed');
    fs.mkdirSync(this.queueDir, { recursive: true });
    fs.mkdirSync(this.failedDir, { recursive: true });
  }

  enqueue(channel: string, to: string, text: string): string {
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const entry = new QueuedDelivery({
      id,
      channel,
      to,
      text,
      retryCount: 0,
      lastError: null,
      enqueuedAt: Date.now() / 1000,
      nextRetryAt: 0,
    });
    this.writeEntry(entry);
    return id;
  }

  private writeEntry(entry: QueuedDelivery): void {
    const finalPath = path.join(this.queueDir, `${entry.id}.json`);
    const tmpPath = path.join(this.queueDir, `.tmp.${process.pid}.${entry.id}.json`);
    fs.writeFileSync(tmpPath, JSON.stringify(entry.toJSON(), null, 2), 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  }

  private readEntry(deliveryId: string): QueuedDelivery | null {
    const filePath = path.join(this.queueDir, `${deliveryId}.json`);
    try {
      if (!fs.existsSync(filePath)) return null;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as QueuedDeliveryData;
      return new QueuedDelivery(data);
    } catch {
      return null;
    }
  }

  ack(deliveryId: string): void {
    const filePath = path.join(this.queueDir, `${deliveryId}.json`);
    try { fs.unlinkSync(filePath); } catch { /* already deleted */ }
  }

  fail(deliveryId: string, error: string): void {
    const entry = this.readEntry(deliveryId);
    if (!entry) return;
    entry.retryCount++;
    entry.lastError = error;
    if (entry.retryCount >= MAX_RETRIES) {
      this.moveToFailed(deliveryId);
      return;
    }
    const backoffMs = computeBackoffMs(entry.retryCount);
    entry.nextRetryAt = Date.now() / 1000 + backoffMs / 1000;
    this.writeEntry(entry);
  }

  moveToFailed(deliveryId: string): void {
    const src = path.join(this.queueDir, `${deliveryId}.json`);
    const dst = path.join(this.failedDir, `${deliveryId}.json`);
    try { fs.renameSync(src, dst); } catch { /* already moved */ }
  }

  loadPending(): QueuedDelivery[] {
    const entries: QueuedDelivery[] = [];
    if (!fs.existsSync(this.queueDir)) return entries;
    for (const file of fs.readdirSync(this.queueDir)) {
      if (!file.endsWith('.json') || file.startsWith('.tmp.')) continue;
      const filePath = path.join(this.queueDir, file);
      try {
        if (!fs.statSync(filePath).isFile()) continue;
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as QueuedDeliveryData;
        entries.push(new QueuedDelivery(data));
      } catch {
        continue;
      }
    }
    entries.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    return entries;
  }

  loadFailed(): QueuedDelivery[] {
    const entries: QueuedDelivery[] = [];
    if (!fs.existsSync(this.failedDir)) return entries;
    for (const file of fs.readdirSync(this.failedDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(this.failedDir, file), 'utf-8'),
        ) as QueuedDeliveryData;
        entries.push(new QueuedDelivery(data));
      } catch {
        continue;
      }
    }
    entries.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    return entries;
  }

  retryFailed(): number {
    let count = 0;
    if (!fs.existsSync(this.failedDir)) return count;
    for (const file of fs.readdirSync(this.failedDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const filePath = path.join(this.failedDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as QueuedDeliveryData;
        const entry = new QueuedDelivery(data);
        entry.retryCount = 0;
        entry.lastError = null;
        entry.nextRetryAt = 0;
        this.writeEntry(entry);
        fs.unlinkSync(filePath);
        count++;
      } catch {
        continue;
      }
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// DeliveryRunner — background delivery thread
// ---------------------------------------------------------------------------

export type DeliverFn = (channel: string, to: string, text: string) => Promise<void> | void;

export class DeliveryRunner {
  private queue: DeliveryQueue;
  private deliverFn: DeliverFn;
  private timer: ReturnType<typeof setInterval> | null = null;
  totalAttempted = 0;
  totalSucceeded = 0;
  totalFailed = 0;

  constructor(queue: DeliveryQueue, deliverFn: DeliverFn) {
    this.queue = queue;
    this.deliverFn = deliverFn;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processPending().catch(() => {});
    }, 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async processPending(): Promise<void> {
    const pending = this.queue.loadPending();
    const now = Date.now() / 1000;

    for (const entry of pending) {
      if (entry.nextRetryAt > now) continue;
      this.totalAttempted++;
      try {
        await this.deliverFn(entry.channel, entry.to, entry.text);
        this.queue.ack(entry.id);
        this.totalSucceeded++;
      } catch (err) {
        this.queue.fail(entry.id, String(err));
        this.totalFailed++;
      }
    }
  }

  getStats(): Record<string, number> {
    return {
      pending: this.queue.loadPending().length,
      failed: this.queue.loadFailed().length,
      totalAttempted: this.totalAttempted,
      totalSucceeded: this.totalSucceeded,
      totalFailed: this.totalFailed,
    };
  }
}
