# ShrimpKit

AI Agent Gateway — from tutorial to production SDK.

## What's Inside

This monorepo contains two things:

1. **`docs/`** — The original [shrimp](docs/README.md) teaching material: 10 progressive Python sessions that build an AI agent gateway from scratch, one concept at a time.

2. **`packages/shrimp-agent/`** — A TypeScript SDK ([`@nampham1106/shrimp-agent`](packages/shrimp-agent/README.md)) that implements all 10 concepts as a reusable, provider-agnostic library.

## The 10 Concepts

```
s01: Agent Loop         while + stopReason — that's an agent
s02: Tool Use           schema dict + handler map
s03: Sessions           JSONL persistence + context overflow guard
s04: Channels           one brain, many mouths (CLI, Telegram, Feishu)
s05: Gateway & Routing  5-tier binding table, session isolation
s06: Intelligence       8-layer system prompt, TF-IDF memory search
s07: Heartbeat & Cron   proactive behavior + scheduled tasks
s08: Delivery           write-ahead queue with exponential backoff
s09: Resilience         3-layer retry onion, auth profile rotation
s10: Concurrency        named FIFO lanes with generation tracking
```

## Quick Start

### TypeScript SDK

```sh
cd packages/shrimp-agent
npm install
npm run build
npm test
```

```typescript
import { AgentLoop, ToolRegistry } from '@nampham1106/shrimp-agent';

const loop = new AgentLoop({
  provider: myLLMProvider,   // implement the LLMProvider interface
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful assistant.',
});

const result = await loop.run([{ role: 'user', content: 'Hello!' }]);
console.log(result.text);
```

### Python Sessions

```sh
pip install -r docs/requirements.txt
cp docs/.env.example .env
# Edit .env: set ANTHROPIC_API_KEY and MODEL_ID
python docs/sessions/s01_agent_loop.py
```

## Repository Structure

```
ShrimpKit/
  packages/
    shrimp-agent/          TypeScript SDK
      src/                 10 modules + types + barrel export
      tests/           113 tests across 10 test files
      package.json
      tsconfig.json
  docs/                    Original Python teaching material
    sessions/              10 .py files + 10 .md companion docs
    workspace/             Sample prompt files (SOUL.md, IDENTITY.md, ...)
    README.md              Detailed walkthrough of all 10 concepts
```

## License

MIT
