# Bootstrap

This file provides additional context loaded at agent startup.

## Project Context

This agent is part of the @nampham1106/shrimp-agent package, demonstrating
how to build production-grade AI agents with TypeScript.

The workspace directory contains configuration files that shape the agent's behavior:

- SOUL.md: Personality and communication style
- IDENTITY.md: Role definition and boundaries
- TOOLS.md: Available tools and usage guidance
- MEMORY.md: Long-term facts and preferences
- HEARTBEAT.md: Proactive behavior instructions
- BOOTSTRAP.md: This file — additional startup context
- AGENTS.md: Multi-agent coordination notes
- CRON.json: Scheduled task definitions

## Workspace Layout

```
.shrimp/
  workspace.json    -- Metadata
  *.md              -- Bootstrap files (loaded into system prompt)
  CRON.json         -- Cron job definitions
  memory/           -- Daily memory + evergreen context
  sessions/         -- Agent session transcripts
  skills/           -- Skill definitions
  delivery/         -- Message queue
```

## SDK Concepts

The shrimp-agent SDK implements 10 progressive concepts:

1. **Agent Loop**: Core while loop with stopReason handling
2. **Tool Use**: Schema + handler dispatch
3. **Sessions**: JSONL persistence with context overflow guards
4. **Channels**: Multi-platform message abstraction (CLI, Telegram, Feishu)
5. **Gateway & Routing**: 5-tier binding table for session isolation
6. **Intelligence**: 8-layer system prompt with TF-IDF memory search
7. **Heartbeat & Cron**: Proactive behavior and scheduled tasks
8. **Delivery**: Write-ahead queue with exponential backoff
9. **Resilience**: 3-layer retry onion with auth rotation
10. **Concurrency**: Named FIFO lanes with generation tracking

See the README for examples of each concept.
