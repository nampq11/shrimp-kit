# shrimp-agent API Reference

Detailed module-by-module reference for the `@nampham1106/shrimp-agent` SDK.

## s01: Agent Loop (`src/agent-loop.ts`)

The foundation. A `while` loop that sends messages to an LLM, checks `stopReason`, and dispatches tool calls.

### AgentLoop

```typescript
new AgentLoop({
  provider: LLMProvider,       // required — the LLM client
  model: string,               // required — model identifier
  systemPrompt: string,        // required — system instructions
  maxTokens?: number,          // default 8096
  maxIterations?: number,      // default 15 — safety cap on tool loops
  tools?: ToolDefinition[],    // JSON schemas for available tools
  toolHandlers?: Map<string, ToolHandler>,  // name → async handler
  onToolCall?: (name, input) => void,       // optional observer
})
```

- `run(messages: Message[]): Promise<AgentLoopResult>` — runs the full loop, returns `{ text, response, messages }`
- `extractText(content: ContentBlock[]): string` — helper to pull text from content blocks

### Loop Behavior

1. Call `provider.createMessage` with current messages
2. If `stopReason === 'end_turn' | 'max_tokens'` → return
3. If `stopReason === 'tool_use'` → dispatch each tool block, push results as user message, continue loop
4. Throws after `maxIterations` to prevent infinite loops

## s02: Tool Use (`src/tool-use.ts`)

### ToolRegistry

Paired schema + handler storage. The model sees the schema; the code calls the handler.

- `register(definition, handler)` — add a tool
- `unregister(name)` — remove a tool
- `dispatch(name, input): Promise<string>` — look up and call handler, catches errors
- `getDefinitions(): ToolDefinition[]` — all schemas (pass to AgentLoop)
- `getHandlers(): Map<string, ToolHandler>` — all handlers (pass to AgentLoop)
- `has(name)`, `size`, `names()` — inspection

## s03: Sessions & Context Guard (`src/sessions.ts`)

### SessionStore

JSONL-based conversation persistence. Append on write, replay on read.

- `constructor({ baseDir, agentId? })` — creates directory structure under `baseDir/.sessions/agents/<agentId>/`
- `createSession(label?): string` — returns a 12-char session ID
- `loadSession(sessionId): Message[]` — replays JSONL into Message array
- `saveTurn(role, content)` — appends a user/assistant turn
- `saveToolResult(toolUseId, name, input, result)` — appends tool_use + tool_result pair
- `listSessions()` — returns all sessions sorted by last active

### ContextGuard

3-stage overflow protection for LLM context windows.

- `constructor({ maxTokens? })` — default 180,000
- `estimateTokens(text): number` — chars / 4 heuristic (static)
- `estimateMessagesTokens(messages): number` — total estimate
- `truncateToolResults(messages): Message[]` — stage 1: trim oversized tool results to 30% of budget
- `compactHistory(messages, provider, model): Promise<Message[]>` — stage 2: summarize oldest 50% via LLM
- `guardApiCall(provider, model, system, messages, tools?, maxRetries?)` — full 3-stage retry wrapper

## s04: Channels (`src/channels.ts`)

### Channel (abstract)

```typescript
abstract class Channel {
  abstract readonly name: string;
  abstract receive(): Promise<InboundMessage | null>;
  abstract send(to: string, text: string): Promise<boolean>;
  close(): void {}
}
```

### Concrete Channels

- **CLIChannel** — reads from stdin, writes to stdout
- **TelegramChannel** — Bot API long-polling via injectable `httpClient`, deduplication, message chunking at 4096 chars
- **FeishuChannel** — Lark/Feishu webhook parsing, tenant token refresh, `parseEvent()` for incoming webhooks

### ChannelManager

Registry for multiple channels. `register(channel)`, `get(name)`, `listChannels()`, `closeAll()`.

## s05: Gateway & Routing (`src/gateway.ts`)

### normalizeAgentId(value): string

Lowercases, strips invalid chars, defaults empty to `'main'`. Valid: `[a-z0-9][a-z0-9_-]{0,63}`.

### BindingTable

5-tier route resolution. Bindings are sorted by tier (ascending) then priority (descending).

| Tier | matchKey | Example |
|------|----------|---------|
| 1 | `peer_id` | `discord:admin-001` or `admin-001` |
| 2 | `guild_id` | `guild-abc` |
| 3 | `account_id` | `bot-1` |
| 4 | `channel` | `telegram` |
| 5 | `default` | `*` |

- `add(binding)`, `remove(agentId, matchKey, matchValue)`, `listAll()`
- `resolve({ channel?, accountId?, guildId?, peerId? }): { agentId, binding }`

### buildSessionKey

Generates deterministic session keys based on `DmScope`:

- `per-peer` → `agent:<aid>:direct:<pid>`
- `per-channel-peer` → `agent:<aid>:<ch>:direct:<pid>`
- `per-account-channel-peer` → `agent:<aid>:<ch>:<acc>:direct:<pid>`
- `main` → `agent:<aid>:main`

### AgentManager

In-memory agent config + session store. `register(config)`, `getAgent(id)`, `getSession(key)`, `listSessions()`.

### runAgent

End-to-end: looks up agent, builds system prompt, runs AgentLoop, returns response text.

## s06: Intelligence (`src/intelligence.ts`)

### BootstrapLoader

Loads system prompt files from a workspace directory. Files: `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `AGENTS.md`, `MEMORY.md`.

- `loadAll(mode: 'full' | 'minimal' | 'none')` — full loads all 8, minimal loads AGENTS+TOOLS only
- `truncateFile(content, maxChars?)` — per-file cap at 20,000 chars, total cap at 150,000

### SkillsManager

Discovers skills from `skills/`, `.skills/`, `.agents/skills/` directories. Each skill is a subdirectory with a `SKILL.md` containing YAML frontmatter (`name`, `description`, `invocation`).

- `discover(extraDirs?)` — scans directories, deduplicates by name, caps at 150 skills
- `formatPromptBlock()` — renders skills into a prompt section, capped at 30,000 chars

### MemoryStore

Two-tier storage: evergreen (`MEMORY.md`) + daily JSONL logs (`memory/daily/<date>.jsonl`).

- `writeMemory(content, category?)` — appends to today's JSONL
- `searchMemory(query, topK?)` — TF-IDF cosine similarity search
- `hybridSearch(query, topK?)` — keyword + hash-vector + temporal decay + MMR reranking
- `tokenize(text): string[]` — splits English words (2+ chars) and individual CJK characters (static)

### buildSystemPrompt

Assembles an 8-layer system prompt:

1. Identity (`IDENTITY.md`)
2. Soul/personality (`SOUL.md`, full mode only)
3. Tools guidance (`TOOLS.md`)
4. Skills block (full mode only)
5. Memory (evergreen + recalled, full mode only)
6. Bootstrap context (other .md files)
7. Runtime context (agent ID, model, channel, time)
8. Channel hints (platform-specific formatting guidance)

## s07: Heartbeat & Cron (`src/heartbeat.ts`)

### HeartbeatRunner

Timer-based proactive checks. Configurable interval (default 30min) and active hours.

- `shouldRun()` — checks instructions exist, interval elapsed, within active hours, not already running
- `execute()` — calls LLM with heartbeat instructions, parses response for meaningful output
- `tick()` — shouldRun + execute + deduplicate output
- `start()` / `stop()` — manage 1-second interval timer
- `drainOutput()` — pop queued outputs

### CronService

Schedule-based jobs with auto-disable after 5 consecutive errors.

- `loadJobs(definitions: CronJobDefinition[])` — parses `everySeconds` schedules
- `tick()` — runs all due jobs
- `triggerJob(jobId)` — manual trigger
- `start()` / `stop()` — manage timer
- `drainOutput()` — pop queued outputs

## s08: Delivery (`src/delivery.ts`)

### DeliveryQueue

Disk-persisted write-ahead queue. JSON files in a queue directory with atomic rename writes.

- `enqueue(channel, to, text): string` — write to disk, return ID
- `ack(deliveryId)` — delete on success
- `fail(deliveryId, error)` — increment retry, compute backoff, move to failed after 5 retries
- `loadPending()` / `loadFailed()` — list entries sorted by enqueue time
- `retryFailed()` — move all failed entries back to pending

### DeliveryRunner

Background processor with 1-second poll interval.

- `start()` / `stop()` — manage timer
- `getStats()` — pending, failed, attempted, succeeded, failed counts

### Utilities

- `computeBackoffMs(retryCount)` — exponential: 5s → 25s → 2min → 10min, with ±20% jitter
- `chunkMessage(text, channel?)` — splits by platform limit (telegram=4096, discord=2000)

## s09: Resilience (`src/resilience.ts`)

### classifyFailure(err): FailoverReason

Maps error strings to: `RateLimit`, `Auth`, `Timeout`, `Billing`, `Overflow`, `Unknown`.

### AuthProfile / ProfileManager

Multiple API key management with cooldown tracking.

- `selectProfile()` — first profile not on cooldown
- `markFailure(profile, reason, cooldownSeconds)` — set cooldown
- `markSuccess(profile)` — clear failure state

### ResilienceRunner

3-layer retry onion:

1. **Auth Rotation** — cycles through all profiles
2. **Overflow Recovery** — truncate tool results → compact history (up to 3 times per profile)
3. **Tool-Use Loop** — standard while + stopReason dispatch

Falls back to `fallbackModels` when all profiles exhausted (resets all cooldowns for fallback attempts).

```typescript
new ResilienceRunner({
  profileManager, providerFactory, modelId,
  fallbackModels?: string[],
  contextGuard?: ContextGuard,
  tools?, toolHandlers?,
})
```

- `run(system, messages): Promise<{ response, messages }>` — full resilient execution
- `getStats()` — attempts, successes, failures, compactions, rotations

## s10: Concurrency (`src/concurrency.ts`)

### LaneQueue

Named FIFO queue with configurable `maxConcurrency` (default 1 = serial).

- `enqueue(fn, generation?): Promise<T>` — add callable, returns result Promise
- `waitForIdle(timeoutMs?): Promise<boolean>` — wait for all tasks to complete
- `generation` — increment to invalidate stale tasks (old generation tasks won't pump new work)
- `stats()` — queue depth, active count, max concurrency, generation

### CommandQueue

Central dispatcher routing work into named lanes.

- `getOrCreateLane(name, maxConcurrency?)` — lazy lane creation
- `enqueue(laneName, fn): Promise<T>` — route to lane
- `resetAll()` — bump all lane generations
- `waitForAll(timeoutMs?)` — wait for all lanes to idle
- `stats()` — per-lane stats

### Standard Lane Names

- `LANE_MAIN = 'main'` — user message processing
- `LANE_CRON = 'cron'` — scheduled tasks
- `LANE_HEARTBEAT = 'heartbeat'` — proactive checks
