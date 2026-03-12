---
name: shrimp-agent
description: Build and extend the @nampham1106/shrimp-agent TypeScript SDK — an 11-module AI agent gateway covering agent loops, tool use, sessions, channels, routing, intelligence, heartbeat, delivery, resilience, concurrency, and workspace. Use when creating new agent modules, adding features to existing modules, writing tests, or understanding the SDK architecture.
---

# shrimp-agent SDK

TypeScript SDK implementing 11 progressive AI agent gateway concepts. Provider-agnostic, zero runtime dependencies.

## Quick Reference

| Module | File | Core Class/Function | Concept |
|--------|------|-------------------|---------|
| s01 | `src/agent-loop.ts` | `AgentLoop` | `while` + `stopReason` dispatch |
| s02 | `src/tool-use.ts` | `ToolRegistry` | schema dict + handler map |
| s03 | `src/sessions.ts` | `SessionStore`, `ContextGuard` | JSONL persistence, 3-stage overflow |
| s04 | `src/channels.ts` | `Channel`, `ChannelManager`, `buildChannelSessionKey` | Platform abstraction |
| s05 | `src/gateway.ts` | `BindingTable`, `AgentManager`, `runAgent`, `normalizeAgentId` | 5-tier routing |
| s06 | `src/intelligence.ts` | `BootstrapLoader`, `SkillsManager`, `MemoryStore`, `buildSystemPrompt` | 8-layer prompt, TF-IDF search |
| s07 | `src/heartbeat.ts` | `HeartbeatRunner`, `CronService` | Proactive behavior |
| s08 | `src/delivery.ts` | `DeliveryQueue`, `DeliveryRunner`, `chunkMessage`, `computeBackoffMs` | Write-ahead queue, backoff |
| s09 | `src/resilience.ts` | `ResilienceRunner`, `ProfileManager`, `classifyFailure` | 3-layer retry onion |
| s10 | `src/concurrency.ts` | `LaneQueue`, `CommandQueue`, `LANE_MAIN`, `LANE_CRON`, `LANE_HEARTBEAT` | Named FIFO lanes |
| s11 | `src/workspace.ts` | `Workspace` | `.shrimp` coordinator, discover(), factory methods |

## Architecture

```
s01 --> s02 --> s03 --> s04 --> s05
                 |               |
                 v               v
                s06 ----------> s07 --> s08
                 |               |
                 v               v
                s09 ----------> s10
                 |
                 v
                s11 (Workspace)
```

All source lives in `packages/shrimp-agent/src/`. Tests in `packages/shrimp-agent/tests/`. Barrel export via `src/index.ts`. Built-in providers in `src/providers/` (e.g. `AzureOpenAIProvider`).

## Key Design Decisions

### Provider-Agnostic LLMProvider Interface

All LLM interaction goes through a single interface in `src/types.ts`:

```typescript
interface LLMProvider {
  createMessage(params: CreateMessageParams): Promise<LLMResponse>;
}
```

Never import provider-specific SDKs. Consumers implement this interface to plug in Anthropic, OpenAI, or any compatible provider.

### Content Block Union Type

Messages use a discriminated union for content blocks:

```typescript
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface Message { role: 'user' | 'assistant'; content: string | ContentBlock[]; }
```

The `string` shorthand is for simple text messages; `ContentBlock[]` for tool interactions.

### Shared Types in types.ts

All cross-module interfaces live in `src/types.ts`. Module files import from `./types.js`. Never define shared interfaces in module files.

### Node16 Module Resolution

The project uses `"module": "Node16"` in tsconfig. All local imports must use `.js` extensions (`import { X } from './types.js'`).

## Instructions

### Adding a New Module

1. Create `src/my-module.ts` with a JSDoc header explaining the concept
2. Import shared types from `./types.js`
3. Export public classes/functions/types
4. Add re-exports to `src/index.ts` in a labeled section
5. Create `tests/my-module.test.ts` with `import { describe, it, expect } from 'vitest'`
6. Run `npm run typecheck` and `npx vitest run`

### Adding a New Tool

Register with `ToolRegistry`:

```typescript
const registry = new ToolRegistry();
registry.register(
  { name: 'my_tool', description: '...', input_schema: { type: 'object', properties: { ... } } },
  async (input) => { return 'result'; }
);
```

Pass `registry.getDefinitions()` and `registry.getHandlers()` to `AgentLoop`.

### Adding a New Channel

1. Extend the abstract `Channel` class
2. Implement `receive(): Promise<InboundMessage | null>` and `send(to, text): Promise<boolean>`
3. Register with `ChannelManager`
4. Add channel-specific message limit to `CHANNEL_LIMITS` in `src/delivery.ts`
5. Use `buildChannelSessionKey(channel, accountId)` for session keys

### Using Workspace

A workspace is a `.shrimp` directory that coordinates sessions, memory, skills, bootstrap files, and delivery queues:

```typescript
import { Workspace } from '@nampham1106/shrimp-agent';

const ws = new Workspace({ rootDir: process.cwd() });
ws.init('default-agent');

const store = ws.createSessionStore();
const memory = ws.createMemoryStore();
const loader = ws.createBootstrapLoader();
const skills = ws.createSkillsManager();
const queue = ws.createDeliveryQueue();

// Discover workspace from nested path (like git)
const found = Workspace.discover('/some/nested/path');
```

### Writing Tests

- Test file pattern: `tests/<module>.test.ts`
- Use `vitest` globals: `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach`
- Mock `LLMProvider` with `vi.fn()` returning `{ content: [...], stopReason: 'end_turn' }`
- Use `fs.mkdtempSync` for tests that touch the filesystem, clean up in `afterEach`
- No real network calls — mock all HTTP/API interactions

### Building and Testing

```sh
cd packages/shrimp-agent
npm install                  # install deps
npm run typecheck            # type check
npx vitest run               # run all tests
npx tsc                      # build to dist/
```

## Module Details

For detailed API reference and implementation patterns, see [api-reference.md](api-reference.md).

## Project Configuration

- **Package**: `@nampham1106/shrimp-agent` at `packages/shrimp-agent/`
- **TypeScript**: ES2022 target, Node16 module, strict mode
- **Testing**: Vitest with globals enabled
- **Entry**: `dist/index.js` (ESM only)
- **Providers**: `AzureOpenAIProvider`, `createAzureOpenAIProvider` for Azure OpenAI
- **No runtime dependencies** — only `typescript`, `vitest`, `@types/node` as devDeps
