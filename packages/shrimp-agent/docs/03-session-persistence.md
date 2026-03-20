# 03-session-persistence

The SessionStore module persists conversations as JSONL files with append-on-write and replay-on-read semantics. ContextGuard provides three-stage overflow protection: normal call, truncate tool results, compact history via summarization.

## System Diagram

```mermaid
flowchart TB
    Msg[Incoming Message] --> Append[Append to JSONL]
    Append --> File[session/{id}.jsonl]
    Load[loadSession] --> Replay[Replay JSONL]
    Replay --> History[Message Array]

    History --> Guard[ContextGuard.guardApiCall]
    Guard -->|Attempt 1| Normal[Normal LLM Call]
    Guard -->|Overflow| Trunc[Truncate Tool Results]
    Guard -->|Still Overflow| Compact[Summarize History]
```

## 1. SessionStore Options

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| baseDir | string | required | Base directory for data |
| sessionsRoot | string | .sessions | Custom sessions path |
| agentId | string | "default" | Agent identifier |

## 2. File Structure

```
baseDir/
├── .sessions/
│   └── agents/
│       └── {agentId}/
│           ├── sessions.json        # Session index
│           └── sessions/
│               ├── {id1}.jsonl      # Conversation history
│               └── {id2}.jsonl
```

## 3. SessionMeta Fields

| Field | Type | Purpose |
|-------|------|---------|
| label | string | User-visible label |
| createdAt | string | ISO timestamp |
| lastActive | string | ISO timestamp |
| messageCount | number | Turns in conversation |

## 4. ContextGuard Stages

| Stage | Action | Trigger |
|-------|--------|---------|
| 0 | Normal LLM call | Initial attempt |
| 1 | Truncate tool results to 30% maxTokens | Context overflow error |
| 2 | Compact history to 20% old + 50% recent | Still overflowing |
| 3 | Throw error | Max retries exceeded |

## 5. Token Estimation

| Method | Calculation |
|--------|-------------|
| estimateTokens(text) | Math.ceil(text.length / 4) |
| estimateMessagesTokens(messages) | Sum of all content blocks |

## File Reference

| File | Purpose |
|------|---------|
| `src/sessions.ts` | SessionStore, ContextGuard classes |

## Cross-References

| Doc | Relation |
|-----|----------|
| [00-architecture](00-architecture-overview.md) | Parent context |
| [01-core-loop](01-core-loop.md) | Loop needs session persistence |
| [05-gateway-routing](05-gateway-routing.md) | Uses session keys |
