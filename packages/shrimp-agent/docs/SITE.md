# shrimp-agent SDK — Documentation Index

Provider-agnostic TypeScript AI agent gateway with 11 modules progressing from core agent loops to production-ready features including routing, persistence, intelligence, delivery, resilience, and concurrency.

## Quick Reference

| Need to find | Read doc |
|-------------|----------|
| Architecture overview | [00-architecture-overview](00-architecture-overview.md) |
| Core agent execution loop | [01-core-loop](01-core-loop.md) |
| Tool dispatch mechanism | [02-tool-system](02-tool-system.md) |
| Session persistence and context guard | [03-session-persistence](03-session-persistence.md) |
| Multi-platform channel abstraction | [04-channels](04-channels.md) |
| 5-tier routing and agent management | [05-gateway-routing](05-gateway-routing.md) |
| System prompt assembly and memory search | [06-intelligence](06-intelligence.md) |
| Proactive heartbeat and cron scheduling | [07-heartbeat](07-heartbeat.md) |
| Reliable message delivery queue | [08-delivery](08-delivery.md) |
| 3-layer retry with auth rotation | [09-resilience](09-resilience.md) |
| Concurrent task lane execution | [10-concurrency](10-concurrency.md) |
| Workspace configuration loading | [11-workspace](11-workspace.md) |
| Azure OpenAI provider | [12-providers](12-providers.md) |

## Doc Map

| # | Doc | Responsibility | Depends On |
|---|-----|----------------|------------|
| 00 | [architecture-overview](00-architecture-overview.md) | System shape, module dependencies | - |
| 01 | [core-loop](01-core-loop.md) | Agent while loop with tool dispatch | 00 |
| 02 | [tool-system](02-tool-system.md) | Schema and handler registry | 00 |
| 03 | [session-persistence](03-session-persistence.md) | JSONL storage, overflow retry | 00 |
| 04 | [channels](04-channels.md) | Platform abstraction | 00 |
| 05 | [gateway-routing](05-gateway-routing.md) | 5-tier route resolution, agent management | 00, 01, 03, 04 |
| 06 | [intelligence](06-intelligence.md) | 8-layer prompt assembly, memory search | 00, 11 |
| 07 | [heartbeat](07-heartbeat.md) | Timer-based proactive checks, cron jobs | 00 |
| 08 | [delivery](08-delivery.md) | Write-ahead queue with exponential backoff | 00, 04 |
| 09 | [resilience](09-resilience.md) | Auth rotation, overflow recovery, model fallback | 00, 01, 03, 12 |
| 10 | [concurrency](10-concurrency.md) | Named FIFO lanes with generation tracking | 00 |
| 11 | [workspace](11-workspace.md) | Config file loading and caching | 00 |
| 12 | [providers](12-providers.md) | Azure OpenAI LLM client | 00 |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Runtime | Node.js (Bun-compatible) |
| Dependencies | Zero runtime dependencies |
| Build | tsup |
| Test | vitest |

## Start Here

If you're an AI agent new to this codebase:
1. Read [00-architecture-overview](00-architecture-overview.md) to understand the module layout
2. Read the doc related to your task (see Quick Reference)
3. Follow Cross-References in each doc to understand context

If you're a new developer:
1. Start with [00-architecture-overview](00-architecture-overview.md)
2. Read [01-core-loop](01-core-loop.md) for the foundation pattern
3. Follow the dependency chain 02 → 03 → 04 → 05...
