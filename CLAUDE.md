# CLAUDE.md

ShrimpKit: AI Agent Gateway — from tutorial to production SDK. Monorepo with Python teaching sessions (`docs/`) and TypeScript SDK (`packages/shrimp-agent/`).

## Project map

- `docs/` - Python teaching sessions: 10 progressive concepts from agent loop to production
- `packages/shrimp-agent/` - TypeScript SDK implementing all 10 concepts as reusable library
  - `src/modules/` - 10 modules: agent-loop, tool-use, sessions, channels, gateway, intelligence, heartbeat, delivery, resilience, concurrency
  - `tests/` - 113 tests across 10 test files
  - `package.json`, `tsconfig.json`

<important if="you need to run commands to build, test, lint, or check code">

Run from `packages/shrimp-agent/` root (not repo root).

| Command | What it does |
|---|---|
| `npm run check` | Type check + lint — run after code changes, fix all errors before committing |
| `npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts` | Run specific test file only |
| `npm run build` | Compile to dist/ |

Never run: `npm run dev`, `npm test` (full suite), `npm run build` (unless publishing)
</important>

<important if="the user did not give you a concrete task in their first message">

1. Read README.md to understand project structure
2. Ask which module(s) to work on
3. Based on answer, read relevant README.md files in parallel:
   - `packages/shrimp-agent/README.md`
</important>

<important if="you are writing or modifying TypeScript code">

- No `any` types unless absolutely necessary
- Check `node_modules` for external API type definitions instead of guessing
- **NEVER use inline imports** — no `await import("./foo.js")`, no `import("pkg").type` in type positions. Always use standard top-level imports
</important>

<important if="you are removing or refactoring code">

Always ask before removing functionality or code that appears to be intentional
</important>

<important if="you are working with keybindings or keyboard shortcuts">

Never hardcode key checks (e.g., `matchesKey(KeyData, "ctrl+x")`). All keybindings must be configurable. Add default matching object (`DEFAULT_EDITING_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)
</important>

<important if="you are reading GitHub issues">

Always read all comments on the issue. Use this command to get everything in one call:
```bash
gh issue view <number> --json title,body,comments,labels,state
```
</important>

<important if="you are creating GitHub issues">

Add `pkg:*` labels to indicate which package(s) the issue affects:
- `pkg:shrimp-agent` - for SDK changes

If an issue spans multiple packages, add all relevant labels
</important>

<important if="you are posting GitHub issue or PR comments">

- Write the full comment to a temp file and use `gh issue comment --body-file` or `gh pr comment --body-file`
- Never pass multi-line markdown directly via `--body` in shell commands
- Preview the exact comment text before posting
- Post exactly one final comment unless user explicitly asks for multiple
- If a comment is malformed, delete it immediately, then post one corrected comment
- Keep comments concise, technical, and direct
</important>

<important if="you are closing issues via commit">

Include `fixes #<number>` or `closes #<number>` in the commit message. This automatically closes the issue when merged.
</important>

<important if="you are writing Git commit messages">

- No emojis
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")
</important>

<important if="you are analyzing or working on a PR">

1. Analyze PRs without pulling locally first
2. If user approves: create feature branch, pull PR, rebase on main, apply adjustments, commit, merge into main, push, close PR, leave a comment
3. You never open PRs yourself — work in feature branches until ready, then merge to main
</important>

<important if="you are updating a package CHANGELOG.md">

Location: `packages/*/CHANGELOG.md` (each package has its own)

Use sections under `## [Unreleased]`:
- `### Breaking Changes` - API changes requiring migration
- `### Added` - New features
- `### Changed` - Changes to existing functionality
- `### Fixed` - Bug fixes
- `### Removed` - Removed features

Rules:
- Read full `[Unreleased]` section before adding entries
- New entries ALWAYS go under `### [Unreleased]`
- Append to existing subsections, do not create duplicates
- NEVER modify already-released version sections (e.g., `## [0.12.2]`)
</important>

<important if="you are working in a multi-agent environment with parallel development">

Multiple agents may work on different files in the same worktree simultaneously.

**Committing:**
- ONLY commit files YOU changed in THIS session
- Include `fixes #<number>` or `closes #<number>` in commit message when applicable
- NEVER use `git add -A` or `git add .` — these sweep up other agents' changes
- ALWAYS use `git add <specific-file-paths>` listing only files you modified
- Run `git status` before committing to verify you are only staging YOUR files

**Forbidden Git Operations** (destroy other agents' work):
- `git reset --hard` - destroys uncommitted changes
- `git checkout .` - destroys uncommitted changes
- `git clean -fd` - deletes untracked files
- `git stash` - stashes ALL changes including other agents' work
- `git add -A` / `git add .` - stages other agents' uncommitted work
- `git commit --no-verify` - bypasses required checks, never allowed

**Safe Workflow:**
```bash
git status                          # 1. Check status first
git add packages/shrimp-agent/src/modules/agent-loop.ts  # 2. Add only your specific files
git commit -m "feat: add agent loop"  # 3. Commit
git pull --rebase && git push       # 4. Pull rebase if needed, then push
```

**If Rebase Conflicts Occur:**
- Resolve conflicts in YOUR files only
- If conflict is in a file you don't modify, abort and ask the user
- NEVER force push
</important>

<important if="you are reading files to understand code before editing">

- NEVER use sed/cat to read files or file ranges. Always use the Read tool (use offset + limit for ranged reads)
- You MUST read every file you modify in full before editing
</important>
