/**
 * Section 04: Channels — "Same brain, many mouths"
 *
 * A Channel encapsulates platform differences so the agent loop only sees
 * a unified InboundMessage. Adding a new platform = implement receive() +
 * send(); the loop stays unchanged.
 *
 *   Telegram ----.                          .---- sendMessage API
 *   Feishu -------+-- InboundMessage ---+---- im/v1/messages
 *   CLI (stdin) --'    Agent Loop        '---- print(stdout)
 */

import type { InboundMessage, ChannelAccount } from './types.js';

// ---------------------------------------------------------------------------
// Channel ABC
// ---------------------------------------------------------------------------

export abstract class Channel {
  abstract readonly name: string;

  abstract receive(): Promise<InboundMessage | null>;
  abstract send(to: string, text: string): Promise<boolean>;
  close(): void {}
}

// ---------------------------------------------------------------------------
// ChannelManager
// ---------------------------------------------------------------------------

export class ChannelManager {
  private channels = new Map<string, Channel>();
  readonly accounts: ChannelAccount[] = [];

  register(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  get(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  listChannels(): string[] {
    return [...this.channels.keys()];
  }

  closeAll(): void {
    for (const ch of this.channels.values()) {
      ch.close();
    }
  }
}

// ---------------------------------------------------------------------------
// CLIChannel — stdin/stdout
// ---------------------------------------------------------------------------

export class CLIChannel extends Channel {
  readonly name = 'cli';
  readonly accountId = 'cli-local';
  private readline: import('node:readline').Interface | null = null;

  async receive(): Promise<InboundMessage | null> {
    const text = await this.readLine();
    if (text === null) return null;
    return {
      text,
      senderId: 'cli-user',
      channel: 'cli',
      accountId: this.accountId,
      peerId: 'cli-user',
      isGroup: false,
      media: [],
      raw: {},
    };
  }

  async send(_to: string, text: string): Promise<boolean> {
    process.stdout.write(`\nAssistant: ${text}\n\n`);
    return true;
  }

  private readLine(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.readline) {
        const readline = require('node:readline');
        this.readline = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        this.readline!.on('close', () => resolve(null));
      }
      this.readline!.question('You > ', (answer: string) => {
        resolve(answer.trim() || null);
      });
    });
  }

  close(): void {
    this.readline?.close();
    this.readline = null;
  }
}

// ---------------------------------------------------------------------------
// TelegramChannel — Bot API long-polling (structure only, no real HTTP)
// ---------------------------------------------------------------------------

export interface TelegramChannelOptions {
  account: ChannelAccount;
  httpClient?: {
    post(url: string, body: unknown): Promise<{ ok: boolean; result?: unknown; description?: string }>;
  };
  allowedChats?: Set<string>;
}

export class TelegramChannel extends Channel {
  readonly name = 'telegram';
  readonly accountId: string;
  private baseUrl: string;
  private httpClient: TelegramChannelOptions['httpClient'];
  private allowedChats: Set<string>;
  private offset = 0;
  private seen = new Set<number>();
  static readonly MAX_MSG_LEN = 4096;

  constructor(options: TelegramChannelOptions) {
    super();
    this.accountId = options.account.accountId;
    this.baseUrl = `https://api.telegram.org/bot${options.account.token}`;
    this.httpClient = options.httpClient;
    this.allowedChats = options.allowedChats ?? new Set();
  }

  async receive(): Promise<InboundMessage | null> {
    const msgs = await this.poll();
    return msgs[0] ?? null;
  }

  async poll(): Promise<InboundMessage[]> {
    if (!this.httpClient) return [];
    const result = await this.httpClient.post(`${this.baseUrl}/getUpdates`, {
      offset: this.offset,
      timeout: 30,
      allowed_updates: ['message'],
    });
    if (!result.ok || !Array.isArray(result.result)) return [];

    const inbounds: InboundMessage[] = [];
    for (const update of result.result as Array<Record<string, unknown>>) {
      const uid = update.update_id as number;
      if (uid >= this.offset) this.offset = uid + 1;
      if (this.seen.has(uid)) continue;
      this.seen.add(uid);
      if (this.seen.size > 5000) this.seen.clear();

      const msg = update.message as Record<string, unknown> | undefined;
      if (!msg) continue;

      const parsed = this.parse(msg, update);
      if (!parsed) continue;
      if (this.allowedChats.size > 0 && !this.allowedChats.has(parsed.peerId)) continue;
      inbounds.push(parsed);
    }
    return inbounds;
  }

  private parse(msg: Record<string, unknown>, raw: Record<string, unknown>): InboundMessage | null {
    const chat = (msg.chat ?? {}) as Record<string, unknown>;
    const chatType = chat.type as string;
    const chatId = String(chat.id ?? '');
    const from = (msg.from ?? {}) as Record<string, unknown>;
    const userId = String(from.id ?? '');
    const text = (msg.text as string) ?? (msg.caption as string) ?? '';
    if (!text) return null;

    const isGroup = chatType === 'group' || chatType === 'supergroup';
    const peerId = chatType === 'private' ? userId : chatId;

    return {
      text,
      senderId: userId,
      channel: 'telegram',
      accountId: this.accountId,
      peerId,
      isGroup,
      media: [],
      raw,
    };
  }

  async send(to: string, text: string): Promise<boolean> {
    if (!this.httpClient) return false;
    const chunks = this.chunk(text);
    let ok = true;
    for (const chunk of chunks) {
      const result = await this.httpClient.post(`${this.baseUrl}/sendMessage`, {
        chat_id: to,
        text: chunk,
      });
      if (!result.ok) ok = false;
    }
    return ok;
  }

  private chunk(text: string): string[] {
    if (text.length <= TelegramChannel.MAX_MSG_LEN) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= TelegramChannel.MAX_MSG_LEN) {
        chunks.push(remaining);
        break;
      }
      let cut = remaining.lastIndexOf('\n', TelegramChannel.MAX_MSG_LEN);
      if (cut <= 0) cut = TelegramChannel.MAX_MSG_LEN;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).replace(/^\n+/, '');
    }
    return chunks;
  }
}

// ---------------------------------------------------------------------------
// FeishuChannel — Lark/Feishu webhook-based (structure for SDK)
// ---------------------------------------------------------------------------

export interface FeishuChannelOptions {
  account: ChannelAccount;
  httpClient?: {
    post(url: string, body: unknown, headers?: Record<string, string>): Promise<{ code: number; msg?: string; data?: unknown }>;
  };
}

export class FeishuChannel extends Channel {
  readonly name = 'feishu';
  readonly accountId: string;
  private appId: string;
  private appSecret: string;
  private botOpenId: string;
  private apiBase: string;
  private httpClient: FeishuChannelOptions['httpClient'];
  private tenantToken = '';
  private tokenExpiresAt = 0;

  constructor(options: FeishuChannelOptions) {
    super();
    this.accountId = options.account.accountId;
    const cfg = options.account.config;
    this.appId = (cfg.app_id as string) ?? '';
    this.appSecret = (cfg.app_secret as string) ?? '';
    this.botOpenId = (cfg.bot_open_id as string) ?? '';
    const isLark = cfg.is_lark === true || cfg.is_lark === 'true';
    this.apiBase = isLark
      ? 'https://open.larksuite.com/open-apis'
      : 'https://open.feishu.cn/open-apis';
    this.httpClient = options.httpClient;
  }

  async receive(): Promise<InboundMessage | null> {
    return null;
  }

  parseEvent(payload: Record<string, unknown>): InboundMessage | null {
    if ('challenge' in payload) return null;
    const event = (payload.event ?? {}) as Record<string, unknown>;
    const message = (event.message ?? {}) as Record<string, unknown>;
    const sender = (event.sender ?? {}) as Record<string, unknown>;
    const senderId = ((sender.sender_id ?? {}) as Record<string, string>).open_id ?? '';
    const chatId = message.chat_id as string ?? '';
    const chatType = message.chat_type as string ?? '';
    const isGroup = chatType === 'group';
    const text = this.parseContent(message);
    if (!text) return null;

    return {
      text,
      senderId,
      channel: 'feishu',
      accountId: this.accountId,
      peerId: chatType === 'p2p' ? senderId : chatId,
      isGroup,
      media: [],
      raw: payload,
    };
  }

  private parseContent(message: Record<string, unknown>): string {
    const msgType = message.msg_type as string ?? 'text';
    let raw = message.content as string | Record<string, unknown>;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { return ''; }
    }
    if (msgType === 'text') return (raw as Record<string, string>).text ?? '';
    return '';
  }

  async send(to: string, text: string): Promise<boolean> {
    if (!this.httpClient) return false;
    const token = await this.refreshToken();
    if (!token) return false;
    const result = await this.httpClient.post(
      `${this.apiBase}/im/v1/messages?receive_id_type=chat_id`,
      { receive_id: to, msg_type: 'text', content: JSON.stringify({ text }) },
      { Authorization: `Bearer ${token}` },
    );
    return result.code === 0;
  }

  private async refreshToken(): Promise<string> {
    if (this.tenantToken && Date.now() / 1000 < this.tokenExpiresAt) {
      return this.tenantToken;
    }
    if (!this.httpClient) return '';
    const result = await this.httpClient.post(
      `${this.apiBase}/auth/v3/tenant_access_token/internal`,
      { app_id: this.appId, app_secret: this.appSecret },
    );
    if (result.code !== 0) return '';
    const data = result as Record<string, unknown>;
    this.tenantToken = data.tenant_access_token as string ?? '';
    this.tokenExpiresAt = Date.now() / 1000 + ((data.expire as number) ?? 7200) - 300;
    return this.tenantToken;
  }
}

// ---------------------------------------------------------------------------
// Session key builder (from channels context)
// ---------------------------------------------------------------------------

export function buildChannelSessionKey(channel: string, accountId: string, peerId: string): string {
  return `agent:main:direct:${channel}:${peerId}`;
}
