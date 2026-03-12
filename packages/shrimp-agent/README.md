# @nampham1106/shrimp-agent

AI Agent Gateway SDK — 10 progressive concepts from loop to production.

Provider-agnostic TypeScript library with zero runtime dependencies. Implements agent loops, tool dispatch, session persistence, multi-channel support, message routing, intelligent prompt assembly, proactive behaviors, reliable delivery, resilient retries, and concurrent task lanes.

## Install

```sh
npm install @nampham1106/shrimp-agent
```

## Quick Start

```typescript
import {
  AgentLoop,
  ToolRegistry,
  SessionStore,
  ContextGuard,
} from '@nampham1106/shrimp-agent';
import type { LLMProvider } from '@nampham1106/shrimp-agent';

// 1. Implement the provider interface for your LLM
const provider: LLMProvider = {
  async createMessage(params) {
    // call Anthropic, OpenAI, or any compatible API
    // return { content: [...], stopReason: 'end_turn' }
  },
};

// 2. Register tools
const tools = new ToolRegistry();
tools.register(
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    input_schema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
  async (input) => `72°F and sunny in ${input.city}`,
);

// 3. Run the agent loop
const loop = new AgentLoop({
  provider,
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful assistant.',
  tools: tools.getDefinitions(),
  toolHandlers: tools.getHandlers(),
});

const result = await loop.run([{ role: 'user', content: 'Weather in Tokyo?' }]);
console.log(result.text);
```

## Modules

| Module | Export | What It Does |
|--------|--------|-------------|
| Agent Loop | `AgentLoop` | Core `while` + `stopReason` loop with tool dispatch |
| Tool Use | `ToolRegistry` | Paired schema + handler storage, `dispatch()` by name |
| Sessions | `SessionStore`, `ContextGuard` | JSONL persistence, 3-stage context overflow protection |
| Channels | `Channel`, `ChannelManager`, `CLIChannel`, `TelegramChannel`, `FeishuChannel` | Platform abstraction for messaging |
| Gateway | `BindingTable`, `AgentManager`, `buildSessionKey`, `resolveRoute` | 5-tier route resolution, session isolation |
| Intelligence | `BootstrapLoader`, `SkillsManager`, `MemoryStore`, `buildSystemPrompt` | 8-layer prompt assembly, TF-IDF + hybrid memory search |
| Heartbeat | `HeartbeatRunner`, `CronService` | Timer-based proactive checks, scheduled jobs |
| Delivery | `DeliveryQueue`, `DeliveryRunner`, `chunkMessage` | Write-ahead disk queue, exponential backoff, platform chunking |
| Resilience | `ResilienceRunner`, `ProfileManager`, `AuthProfile` | 3-layer retry onion: auth rotation → overflow recovery → tool loop |
| Concurrency | `LaneQueue`, `CommandQueue` | Named FIFO lanes with configurable concurrency and generation tracking |

## Usage Examples

### Session Persistence

```typescript
import { SessionStore } from '@nampham1106/shrimp-agent';

const store = new SessionStore({ baseDir: './data' });
const sessionId = store.createSession('chat-with-user-1');

// Save turns as they happen
store.saveTurn('user', 'Hello!');
store.saveTurn('assistant', 'Hi there!');

// Later, reload the full conversation
const messages = store.loadSession(sessionId);
```

### Context Overflow Protection

```typescript
import { ContextGuard } from '@nampham1106/shrimp-agent';

const guard = new ContextGuard({ maxTokens: 100_000 });

// Wrap your LLM call — auto-retries with truncation then summarization
const { response, messages } = await guard.guardApiCall(
  provider, model, systemPrompt, messages, tools,
);
```

### Multi-Agent Routing

```typescript
import { BindingTable, AgentManager, resolveRoute } from '@nampham1106/shrimp-agent';

const agents = new AgentManager();
agents.register({ id: 'luna', name: 'Luna', personality: 'warm and helpful' });
agents.register({ id: 'sage', name: 'Sage', personality: 'analytical' });

const bindings = new BindingTable();
bindings.add({ agentId: 'luna', tier: 5, matchKey: 'default', matchValue: '*', priority: 0 });
bindings.add({ agentId: 'sage', tier: 4, matchKey: 'channel', matchValue: 'telegram', priority: 0 });

// CLI messages → Luna, Telegram messages → Sage
const route = resolveRoute(bindings, agents, 'telegram', 'user-123');
// { agentId: 'sage', sessionKey: 'agent:sage:telegram:direct:user-123' }
```

### Resilient LLM Calls

```typescript
import { ResilienceRunner, ProfileManager, AuthProfile } from '@nampham1106/shrimp-agent';

const profiles = new ProfileManager([
  new AuthProfile({ name: 'primary', provider: 'anthropic', apiKey: 'sk-...' }),
  new AuthProfile({ name: 'backup', provider: 'anthropic', apiKey: 'sk-...' }),
]);

const runner = new ResilienceRunner({
  profileManager: profiles,
  providerFactory: (profile) => createProviderFromKey(profile.apiKey),
  modelId: 'claude-sonnet-4-20250514',
  fallbackModels: ['claude-haiku-4-20250514'],
});

// Automatically rotates keys on auth failure, compacts on overflow, falls back on exhaustion
const result = await runner.run(systemPrompt, messages);
```

### Concurrent Task Lanes

```typescript
import { CommandQueue, LANE_MAIN, LANE_CRON } from '@nampham1106/shrimp-agent';

const queue = new CommandQueue();

// User messages process serially in the main lane
const response = await queue.enqueue(LANE_MAIN, () => handleUserMessage(msg));

// Cron jobs run in a separate lane, won't block user messages
await queue.enqueue(LANE_CRON, () => runScheduledTask());

// Wait for everything to finish
await queue.waitForAll();
```

### Azure OpenAI

```typescript
import { AzureOpenAIProvider, AgentLoop } from '@nampham1106/shrimp-agent';

const provider = new AzureOpenAIProvider({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2024-08-01-preview', // optional, defaults to latest
});

const loop = new AgentLoop({
  provider,
  model: 'gpt-4', // your Azure deployment name
  systemPrompt: 'You are a helpful assistant.',
});

const result = await loop.run([{ role: 'user', content: 'Hi!' }]);
console.log(result.text);
```

## API

The full `LLMProvider` interface you need to implement:

```typescript
interface LLMProvider {
  createMessage(params: {
    model: string;
    maxTokens: number;
    system: string;
    messages: Message[];
    tools?: ToolDefinition[];
  }): Promise<{
    content: ContentBlock[];
    stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
  }>;
}
```

All other types are exported from the package entry point.

### Built-in Providers

- **AzureOpenAIProvider** — Microsoft Azure's OpenAI service. Use `AzureOpenAIProvider` directly or with `createAzureOpenAIProvider()` factory.

## Development

```sh
npm install          # install dev dependencies
npm run typecheck    # type check without emitting
npm test             # run all 113 tests
npm run build        # compile to dist/
```

## License

MIT
