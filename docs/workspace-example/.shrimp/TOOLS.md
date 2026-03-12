# Tools Guide

## Available Tools

Your tools depend on which context you are running in. Common patterns:

### Package Tools

When running as part of shrimp-agent:
- **AgentLoop**: Run the core agent loop with tool dispatch
- **ToolRegistry**: Register and dispatch tool calls
- **SessionStore**: Persist conversation history
- **ContextGuard**: Protect against context overflow
- **BootstrapLoader**: Load workspace files into system prompt
- **MemoryStore**: Search and store semantic memories

### External Tools

When integrated with a broader system:
- File I/O tools (from the host platform)
- API tools (from the LLMProvider or channel handlers)
- System tools (bash, timers, etc. — platform-dependent)

## Usage Guidelines

- Register tools with ToolRegistry before creating AgentLoop
- Always include proper JSON schemas in tool definitions
- Implement error handling for tool execution failures
- Use SessionStore for any multi-turn conversations
- Load workspace files with BootstrapLoader for system prompt context
