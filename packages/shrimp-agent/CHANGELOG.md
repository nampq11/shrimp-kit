# Changelog

## 0.1.0 (2026-03-12)

Initial release. All 10 modules implemented with full test coverage (113 tests).

### Added

- **Agent Loop** (`AgentLoop`) — Core `while` + `stopReason` dispatch loop with configurable iteration limits and tool call observer hook.
- **Tool Use** (`ToolRegistry`) — Paired schema/handler registry with `dispatch()`, supports async handlers.
- **Sessions** (`SessionStore`) — JSONL-based conversation persistence with session indexing. `ContextGuard` provides 3-stage overflow protection: truncate tool results → compact history via LLM summary → fail.
- **Channels** (`Channel`, `ChannelManager`) — Abstract channel interface with `CLIChannel`, `TelegramChannel` (long-polling, dedup, chunking), and `FeishuChannel` (webhook parsing, tenant token refresh).
- **Gateway & Routing** (`BindingTable`, `AgentManager`) — 5-tier route resolution (peer > guild > account > channel > default), deterministic session keys with 4 DM scopes, `runAgent` end-to-end executor.
- **Intelligence** (`BootstrapLoader`, `SkillsManager`, `MemoryStore`) — 8-layer system prompt assembly from workspace files, skill discovery from `SKILL.md` frontmatter, two-tier memory (evergreen + daily JSONL) with TF-IDF keyword search, hash-vector search, temporal decay, and MMR reranking.
- **Heartbeat & Cron** (`HeartbeatRunner`, `CronService`) — Timer-based proactive checks with active-hours gating and output deduplication. Cron scheduler with auto-disable after 5 consecutive errors.
- **Delivery** (`DeliveryQueue`, `DeliveryRunner`) — Disk-persisted write-ahead queue with atomic rename writes, exponential backoff (5s → 25s → 2min → 10min), per-channel message chunking, failed message tracking and retry.
- **Resilience** (`ResilienceRunner`, `ProfileManager`) — 3-layer retry onion: auth rotation across multiple API key profiles, overflow recovery via context compaction, tool-use loop. Falls back to alternate models when all profiles exhausted.
- **Concurrency** (`LaneQueue`, `CommandQueue`) — Named FIFO lanes with configurable `maxConcurrency`, generation tracking for stale task invalidation, `waitForIdle`/`waitForAll` for graceful shutdown.
- **Shared Types** — Provider-agnostic `LLMProvider` interface, discriminated union `ContentBlock`, `Message`, `ToolDefinition`, `InboundMessage`, `AgentConfig`, `FailoverReason` enum.
