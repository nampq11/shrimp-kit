import { describe, it, expect } from 'vitest';
import { ChannelManager, CLIChannel, TelegramChannel, FeishuChannel, buildChannelSessionKey } from '../src/channels.js';

describe('ChannelManager', () => {
  it('registers and lists channels', () => {
    const mgr = new ChannelManager();
    const cli = new CLIChannel();
    mgr.register(cli);
    expect(mgr.listChannels()).toEqual(['cli']);
    expect(mgr.get('cli')).toBe(cli);
    expect(mgr.get('telegram')).toBeUndefined();
  });
});

describe('TelegramChannel', () => {
  it('parses poll results into InboundMessages', async () => {
    const mockHttp = {
      post: async (_url: string, _body: unknown) => ({
        ok: true,
        result: [
          {
            update_id: 100,
            message: {
              text: 'Hello bot',
              chat: { id: 123, type: 'private' },
              from: { id: 456 },
            },
          },
        ],
      }),
    };

    const tg = new TelegramChannel({
      account: { channel: 'telegram', accountId: 'tg1', token: 'test-token', config: {} },
      httpClient: mockHttp,
    });

    const msgs = await tg.poll();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('Hello bot');
    expect(msgs[0].senderId).toBe('456');
    expect(msgs[0].peerId).toBe('456');
    expect(msgs[0].channel).toBe('telegram');
  });

  it('filters by allowed chats', async () => {
    const mockHttp = {
      post: async () => ({
        ok: true,
        result: [
          {
            update_id: 200,
            message: { text: 'hi', chat: { id: 999, type: 'private' }, from: { id: 999 } },
          },
        ],
      }),
    };

    const tg = new TelegramChannel({
      account: { channel: 'telegram', accountId: 'tg1', token: 'test', config: {} },
      httpClient: mockHttp,
      allowedChats: new Set(['123']),
    });

    const msgs = await tg.poll();
    expect(msgs).toHaveLength(0);
  });

  it('chunks long messages', async () => {
    const sent: Array<{ text: string }> = [];
    const mockHttp = {
      post: async (_url: string, body: unknown) => {
        sent.push(body as { text: string });
        return { ok: true };
      },
    };

    const tg = new TelegramChannel({
      account: { channel: 'telegram', accountId: 'tg1', token: 'test', config: {} },
      httpClient: mockHttp,
    });

    await tg.send('123', 'x'.repeat(5000));
    expect(sent.length).toBeGreaterThan(1);
  });
});

describe('FeishuChannel', () => {
  it('parses event payload', () => {
    const feishu = new FeishuChannel({
      account: {
        channel: 'feishu', accountId: 'fs1', token: '',
        config: { app_id: 'test', app_secret: 'test' },
      },
    });

    const msg = feishu.parseEvent({
      event: {
        message: {
          chat_id: 'chat-123',
          chat_type: 'p2p',
          msg_type: 'text',
          content: JSON.stringify({ text: 'Hello from feishu' }),
        },
        sender: { sender_id: { open_id: 'user-1' } },
      },
    });

    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('Hello from feishu');
    expect(msg!.channel).toBe('feishu');
  });

  it('returns null for challenge events', () => {
    const feishu = new FeishuChannel({
      account: {
        channel: 'feishu', accountId: 'fs1', token: '',
        config: { app_id: 'test', app_secret: 'test' },
      },
    });
    expect(feishu.parseEvent({ challenge: 'abc' })).toBeNull();
  });
});

describe('buildChannelSessionKey', () => {
  it('builds correct key', () => {
    expect(buildChannelSessionKey('telegram', 'tg1', 'user-42')).toBe('agent:main:direct:telegram:user-42');
  });
});
