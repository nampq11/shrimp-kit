import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../src/tool-use.js';

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'read_file', description: 'Read a file', input_schema: { type: 'object', properties: {} } },
      async (input) => `content of ${input.path}`,
    );

    expect(registry.has('read_file')).toBe(true);
    expect(registry.size).toBe(1);
    expect(registry.names()).toEqual(['read_file']);

    const def = registry.getDefinition('read_file');
    expect(def?.name).toBe('read_file');
  });

  it('returns all definitions for LLM tools param', () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'bash', description: 'Run command', input_schema: { type: 'object', properties: {} } },
      async () => 'ok',
    );
    registry.register(
      { name: 'read_file', description: 'Read file', input_schema: { type: 'object', properties: {} } },
      async () => 'ok',
    );

    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.name)).toEqual(['bash', 'read_file']);
  });

  it('dispatches tool calls', async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn(async (input: Record<string, unknown>) => `Hello ${input.name}`);
    registry.register(
      { name: 'greet', description: 'Greet', input_schema: { type: 'object', properties: {} } },
      handler,
    );

    const result = await registry.dispatch('greet', { name: 'World' });
    expect(result).toBe('Hello World');
    expect(handler).toHaveBeenCalledWith({ name: 'World' });
  });

  it('returns error for unknown tools', async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch('nonexistent', {});
    expect(result).toContain('Unknown tool');
  });

  it('catches handler errors', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'fail', description: 'Fail', input_schema: { type: 'object', properties: {} } },
      async () => { throw new Error('boom'); },
    );

    const result = await registry.dispatch('fail', {});
    expect(result).toContain('Error');
    expect(result).toContain('boom');
  });

  it('unregisters tools', () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'temp', description: 'Temporary', input_schema: { type: 'object', properties: {} } },
      async () => 'ok',
    );
    expect(registry.has('temp')).toBe(true);
    expect(registry.unregister('temp')).toBe(true);
    expect(registry.has('temp')).toBe(false);
    expect(registry.unregister('temp')).toBe(false);
  });

  it('getHandlers returns a map', () => {
    const registry = new ToolRegistry();
    const h1 = async () => 'a';
    const h2 = async () => 'b';
    registry.register({ name: 'a', description: '', input_schema: {} }, h1);
    registry.register({ name: 'b', description: '', input_schema: {} }, h2);

    const handlers = registry.getHandlers();
    expect(handlers.size).toBe(2);
    expect(handlers.get('a')).toBe(h1);
    expect(handlers.get('b')).toBe(h2);
  });
});
