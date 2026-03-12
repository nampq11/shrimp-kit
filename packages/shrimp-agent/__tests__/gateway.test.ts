import { describe, it, expect } from 'vitest';
import {
  normalizeAgentId,
  BindingTable,
  buildSessionKey,
  AgentManager,
  resolveRoute,
} from '../src/gateway.js';
import type { Binding } from '../src/gateway.js';

describe('normalizeAgentId', () => {
  it('passes valid IDs', () => {
    expect(normalizeAgentId('luna')).toBe('luna');
    expect(normalizeAgentId('sage-2')).toBe('sage-2');
    expect(normalizeAgentId('agent_01')).toBe('agent_01');
  });

  it('lowercases IDs', () => {
    expect(normalizeAgentId('LUNA')).toBe('luna');
  });

  it('defaults empty strings to main', () => {
    expect(normalizeAgentId('')).toBe('main');
    expect(normalizeAgentId('  ')).toBe('main');
  });

  it('cleans invalid characters', () => {
    expect(normalizeAgentId('hello world!')).toBe('hello-world');
    expect(normalizeAgentId('café bot')).toBe('caf-bot');
  });
});

describe('BindingTable', () => {
  it('resolves 5-tier routing correctly', () => {
    const table = new BindingTable();
    table.add({ agentId: 'luna', tier: 5, matchKey: 'default', matchValue: '*', priority: 0 });
    table.add({ agentId: 'sage', tier: 4, matchKey: 'channel', matchValue: 'telegram', priority: 0 });
    table.add({ agentId: 'admin-bot', tier: 1, matchKey: 'peer_id', matchValue: 'discord:admin-001', priority: 10 });

    // Tier 5 default
    expect(table.resolve({ channel: 'cli', peerId: 'user-1' }).agentId).toBe('luna');

    // Tier 4 channel match
    expect(table.resolve({ channel: 'telegram', peerId: 'user-1' }).agentId).toBe('sage');

    // Tier 1 peer match (most specific)
    expect(table.resolve({ channel: 'discord', peerId: 'admin-001' }).agentId).toBe('admin-bot');
  });

  it('returns null when no bindings match', () => {
    const table = new BindingTable();
    table.add({ agentId: 'sage', tier: 4, matchKey: 'channel', matchValue: 'telegram', priority: 0 });

    const result = table.resolve({ channel: 'discord', peerId: 'user-1' });
    expect(result.agentId).toBeNull();
  });

  it('removes bindings', () => {
    const table = new BindingTable();
    table.add({ agentId: 'luna', tier: 5, matchKey: 'default', matchValue: '*', priority: 0 });
    expect(table.listAll()).toHaveLength(1);
    expect(table.remove('luna', 'default', '*')).toBe(true);
    expect(table.listAll()).toHaveLength(0);
  });

  it('handles priority within same tier', () => {
    const table = new BindingTable();
    table.add({ agentId: 'low', tier: 5, matchKey: 'default', matchValue: '*', priority: 0 });
    table.add({ agentId: 'high', tier: 5, matchKey: 'default', matchValue: '*', priority: 10 });

    expect(table.resolve({ channel: 'cli' }).agentId).toBe('high');
  });
});

describe('buildSessionKey', () => {
  it('builds per-peer key', () => {
    expect(buildSessionKey('luna', { channel: 'telegram', peerId: 'user-1' })).toBe('agent:luna:direct:user-1');
  });

  it('builds per-channel-peer key', () => {
    expect(buildSessionKey('luna', {
      channel: 'telegram', peerId: 'user-1', dmScope: 'per-channel-peer',
    })).toBe('agent:luna:telegram:direct:user-1');
  });

  it('builds per-account-channel-peer key', () => {
    expect(buildSessionKey('luna', {
      channel: 'telegram', accountId: 'bot-1', peerId: 'user-1',
      dmScope: 'per-account-channel-peer',
    })).toBe('agent:luna:telegram:bot-1:direct:user-1');
  });

  it('falls back to main scope', () => {
    expect(buildSessionKey('luna', { dmScope: 'main' })).toBe('agent:luna:main');
  });
});

describe('AgentManager', () => {
  it('registers and retrieves agents', () => {
    const mgr = new AgentManager();
    mgr.register({ id: 'luna', name: 'Luna', personality: 'warm' });
    mgr.register({ id: 'sage', name: 'Sage' });

    expect(mgr.listAgents()).toHaveLength(2);
    expect(mgr.getAgent('luna')?.name).toBe('Luna');
    expect(mgr.getAgent('unknown')).toBeUndefined();
  });

  it('manages sessions', () => {
    const mgr = new AgentManager();
    mgr.register({ id: 'luna', name: 'Luna' });

    const session = mgr.getSession('agent:luna:direct:user-1');
    expect(session).toEqual([]);
    session.push({ role: 'user', content: 'Hi' });

    const same = mgr.getSession('agent:luna:direct:user-1');
    expect(same).toHaveLength(1);

    const sessions = mgr.listSessions('luna');
    expect(Object.keys(sessions)).toHaveLength(1);
    expect(sessions['agent:luna:direct:user-1']).toBe(1);
  });
});

describe('resolveRoute', () => {
  it('resolves routing end-to-end', () => {
    const mgr = new AgentManager();
    mgr.register({ id: 'luna', name: 'Luna', dmScope: 'per-peer' });
    mgr.register({ id: 'sage', name: 'Sage', dmScope: 'per-channel-peer' });

    const bindings = new BindingTable();
    bindings.add({ agentId: 'luna', tier: 5, matchKey: 'default', matchValue: '*', priority: 0 });
    bindings.add({ agentId: 'sage', tier: 4, matchKey: 'channel', matchValue: 'telegram', priority: 0 });

    const r1 = resolveRoute(bindings, mgr, 'cli', 'user-1');
    expect(r1.agentId).toBe('luna');
    expect(r1.sessionKey).toBe('agent:luna:direct:user-1');

    const r2 = resolveRoute(bindings, mgr, 'telegram', 'user-1');
    expect(r2.agentId).toBe('sage');
    expect(r2.sessionKey).toBe('agent:sage:telegram:direct:user-1');
  });
});
