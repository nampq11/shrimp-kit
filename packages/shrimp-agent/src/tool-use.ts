/**
 * Section 02: Tool Use
 * "Tools = schema dict + handler map. Model picks a name, you look it up."
 *
 * TOOLS array tells the model what tools exist (JSON schema).
 * TOOL_HANDLERS map tells our code what to call (name -> function).
 */

import type { ToolDefinition, ToolHandler, ToolEntry } from './types.js';

export class ToolRegistry {
  private entries = new Map<string, ToolEntry>();

  register(
    definition: ToolDefinition,
    handler: ToolHandler,
  ): void {
    this.entries.set(definition.name, { definition, handler });
  }

  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.entries.get(name)?.handler;
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.entries.get(name)?.definition;
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.entries.values()].map((e) => e.definition);
  }

  getHandlers(): Map<string, ToolHandler> {
    const map = new Map<string, ToolHandler>();
    for (const [name, entry] of this.entries) {
      map.set(name, entry.handler);
    }
    return map;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get size(): number {
    return this.entries.size;
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Dispatch a tool call: look up handler by name, call it.
   */
  async dispatch(name: string, input: Record<string, unknown>): Promise<string> {
    const handler = this.getHandler(name);
    if (!handler) {
      return `Error: Unknown tool '${name}'`;
    }
    try {
      return await handler(input);
    } catch (err) {
      return `Error: ${name} failed: ${err}`;
    }
  }
}
