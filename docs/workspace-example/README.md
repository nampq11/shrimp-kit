# Workspace Example

This directory demonstrates a complete `.shrimp` workspace for the `@nampham1106/shrimp-agent` SDK.

## Structure

A `.shrimp` workspace contains:

```
.shrimp/
├── workspace.json         # Metadata (version, defaultAgentId, createdAt)
├── SOUL.md               # Personality definition
├── IDENTITY.md           # Role and boundaries
├── TOOLS.md              # Available tools and usage guidelines
├── BOOTSTRAP.md          # Additional startup context
├── AGENTS.md             # Multi-agent configuration notes
├── MEMORY.md             # Evergreen memory (long-term context)
├── HEARTBEAT.md          # Proactive behavior instructions
├── CRON.json             # Scheduled task definitions
├── memory/               # Daily memory logs
│   └── daily/            # YYYY-MM-DD.jsonl files
├── sessions/             # Conversation history
│   └── agents/           # Per-agent session storage
├── skills/               # Skill definitions
│   └── <skill-name>/     # Individual skill directories with SKILL.md
└── delivery/             # Message queue
    └── failed/           # Failed delivery tracking
```

## Creating a Workspace

Use the `Workspace` class from `@nampham1106/shrimp-agent`:

```typescript
import { Workspace } from '@nampham1106/shrimp-agent';

// Initialize a new workspace
const workspace = new Workspace({ rootDir: '/path/to/project' });
workspace.init('default-agent-id');

// Or discover an existing workspace
const found = Workspace.discover(process.cwd());
if (found) {
  console.log('Found workspace at:', found.rootDir);
}
```

## Using Workspace Components

### SessionStore

Persist conversation history:

```typescript
const sessions = workspace.createSessionStore('agent-id');
const sessionId = sessions.createSession('user-123');

sessions.saveTurn('user', 'Hello!');
sessions.saveTurn('assistant', 'Hi there!');

const messages = sessions.loadSession(sessionId);
```

### MemoryStore

Store and search semantic memories:

```typescript
const memory = workspace.createMemoryStore();
memory.writeMemory('User prefers concise explanations', 'preference');

const results = memory.searchMemory('user preferences');
```

### BootstrapLoader

Load configuration files into system prompt:

```typescript
const loader = workspace.createBootstrapLoader();
const soul = loader.loadFile('SOUL.md');
const identity = loader.loadFile('IDENTITY.md');

// Build system prompt with bootstrap context
const systemPrompt = buildSystemPrompt({
  soul,
  identity,
  tools: toolDefinitions,
  memory: relevantMemories,
});
```

### SkillsManager

Discover and manage skills:

```typescript
const skills = workspace.createSkillsManager();
skills.discover();

console.log('Available skills:', skills.skills);
// [
//   { name: 'Calculator', invocation: '/calc', description: '...' },
//   { name: 'Weather', invocation: '/weather', description: '...' },
// ]
```

### DeliveryQueue

Manage outgoing message delivery:

```typescript
const queue = workspace.createDeliveryQueue();
const deliveryId = queue.enqueue('telegram', 'user-123', 'message text');
// Message persists to disk for reliable delivery
```

## Configuration Files

### SOUL.md

Defines the agent's personality and communication style. Used in system prompt.

### IDENTITY.md

Defines the agent's role, capabilities, and boundaries. Used in system prompt.

### TOOLS.md

Documents available tools and usage guidelines for the agent.

### MEMORY.md

Long-term evergreen memory that persists across sessions. Automatically loaded
at startup.

### AGENTS.md

Documentation on multi-agent setups and coordination patterns.

### HEARTBEAT.md

Instructions for proactive checks. Run periodically to detect issues that need
attention.

### CRON.json

Scheduled task definitions. Format:

```json
{
  "jobs": [
    {
      "id": "unique-id",
      "name": "Human Readable Name",
      "enabled": true,
      "schedule": {
        "kind": "cron",
        "expr": "0 9 * * *",
        "tz": "UTC"
      },
      "payload": {
        "kind": "agent_turn",
        "message": "Instructions for the agent"
      },
      "delete_after_run": false
    }
  ]
}
```

Supported schedule kinds:
- `cron`: Cron expression
- `at`: One-time absolute timestamp
- `every`: Interval in seconds with anchor timestamp

## Multi-Agent Workspaces

A single workspace can support multiple agents with isolated sessions:

```typescript
const workspace = new Workspace({ rootDir: '.' });
workspace.init();

// Luna's sessions
const luna = workspace.createSessionStore('luna');
const lunaSession = luna.createSession('chat-1');
luna.saveTurn('user', 'Luna, tell me a story');

// Sage's sessions (isolated from Luna)
const sage = workspace.createSessionStore('sage');
const sageSession = sage.createSession('chat-1');
sage.saveTurn('user', 'Sage, explain quantum mechanics');

// Sessions are completely isolated
const lunaMessages = luna.loadSession(lunaSession);
const sageMessages = sage.loadSession(sageSession);
// Different content, different memory isolation
```

## Testing

The integration tests in `packages/shrimp-agent/tests/workspace-integration.test.ts`
demonstrate:

- Full workspace initialization
- Loading bootstrap files
- Session persistence and isolation
- Memory storage and search
- Skill discovery
- Delivery queue management
- Multi-agent workspaces
- Workspace discovery from nested directories

Run tests:

```bash
cd packages/shrimp-agent
npm test -- tests/workspace-integration.test.ts
```

## Workspace Discovery

`Workspace.discover(startDir)` walks up the directory tree from `startDir`,
looking for `.shrimp/workspace.json`. This allows agents to discover the workspace
from any subdirectory, similar to how `git` finds `.git/`.

```typescript
const workspace = Workspace.discover(process.cwd());
if (workspace) {
  console.log('Workspace found at:', workspace.rootDir);
} else {
  console.log('No workspace found');
}
```
