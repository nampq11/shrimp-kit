import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Workspace,
  SessionStore,
  MemoryStore,
  BootstrapLoader,
  SkillsManager,
  DeliveryQueue,
} from '../src/index.js';

describe('Workspace Integration', () => {
  let testDir: string;
  let workspace: Workspace;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.cwd(), 'test-integration-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('full workspace initialization', () => {
    it('initializes complete workspace structure', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init('test-agent');

      const metadata = workspace.readMetadata();
      expect(metadata.defaultAgentId).toBe('test-agent');

      // Verify all directory structure
      expect(fs.existsSync(workspace.shrimpDir)).toBe(true);
      expect(fs.existsSync(workspace.sessionsDir)).toBe(true);
      expect(fs.existsSync(workspace.memoryDir)).toBe(true);
      expect(fs.existsSync(workspace.skillsDir)).toBe(true);
      expect(fs.existsSync(workspace.deliveryDir)).toBe(true);
    });
  });

  describe('workspace with bootstrap files', () => {
    it('loads SOUL.md from workspace', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      // Create bootstrap file
      const soulContent = '# Personality\n\nYou are helpful and kind.';
      fs.writeFileSync(path.join(workspace.shrimpDir, 'SOUL.md'), soulContent, 'utf-8');

      const loader = workspace.createBootstrapLoader();
      const loaded = loader.loadFile('SOUL.md');

      expect(loaded).toBe(soulContent);
    });

    it('loads multiple bootstrap files', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const files = {
        'SOUL.md': '# Personality\nWarm and helpful',
        'IDENTITY.md': '# Role\nAI Assistant',
        'TOOLS.md': '# Tools\nFile, Memory, System',
      };

      Object.entries(files).forEach(([name, content]) => {
        fs.writeFileSync(path.join(workspace.shrimpDir, name), content, 'utf-8');
      });

      const loader = workspace.createBootstrapLoader();
      Object.entries(files).forEach(([name, content]) => {
        expect(loader.loadFile(name)).toBe(content);
      });
    });

    it('loads workspace.json metadata along with bootstrap files', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init('my-agent');

      const metadata = workspace.readMetadata();
      expect(metadata.defaultAgentId).toBe('my-agent');
      expect(metadata.version).toBe(1);
      expect(metadata.createdAt).toBeTruthy();
    });
  });

  describe('workspace with sessions', () => {
    it('creates and loads sessions in workspace', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init('my-agent');

      const sessionStore = workspace.createSessionStore();
      const sessionId = sessionStore.createSession('user-1');

      sessionStore.saveTurn('user', 'Hello!');
      sessionStore.saveTurn('assistant', 'Hi there!');

      const messages = sessionStore.loadSession(sessionId);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello!');
      expect(messages[1].role).toBe('assistant');
    });

    it('isolates sessions per agent', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init('agent1');

      const store1 = workspace.createSessionStore('agent1');
      const store2 = workspace.createSessionStore('agent2');

      const session1 = store1.createSession('chat1');
      const session2 = store2.createSession('chat1');

      store1.saveTurn('user', 'Agent 1 message');
      store2.saveTurn('user', 'Agent 2 message');

      const messages1 = store1.loadSession(session1);
      const messages2 = store2.loadSession(session2);

      expect(messages1[0].content).toBe('Agent 1 message');
      expect(messages2[0].content).toBe('Agent 2 message');
    });
  });

  describe('workspace with memory', () => {
    it('writes and searches memory within workspace', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const memoryStore = workspace.createMemoryStore();
      memoryStore.writeMemory('user prefers concise answers', 'preference');
      memoryStore.writeMemory('working on typescript project', 'context');

      const results = memoryStore.searchMemory('typescript');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBeTruthy();
    });

    it('handles evergreen memory file', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const evergreenContent = `# Evergreen Memory

- User timezone: Asia/Shanghai
- Prefers technical explanations
- Values code quality`;

      fs.writeFileSync(
        path.join(workspace.shrimpDir, 'MEMORY.md'),
        evergreenContent,
        'utf-8',
      );

      const loader = workspace.createBootstrapLoader();
      const loaded = loader.loadFile('MEMORY.md');

      expect(loaded).toContain('Evergreen Memory');
      expect(loaded).toContain('Asia/Shanghai');
    });
  });

  describe('workspace with skills', () => {
    it('discovers and manages skills in workspace', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      // Create a skill
      const skillDir = path.join(workspace.skillsDir, 'calculator');
      fs.mkdirSync(skillDir, { recursive: true });

      const skillContent = `---
name: Calculator
description: Perform mathematical calculations
invocation: /calc
---

# Calculator Skill

When invoked with /calc, perform the requested calculation.`;

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');

      const skillsManager = workspace.createSkillsManager();
      skillsManager.discover();

      const calcSkill = skillsManager.skills.find((s) => s.name === 'Calculator');
      expect(calcSkill).toBeDefined();
      expect(calcSkill?.invocation).toBe('/calc');
    });
  });

  describe('workspace with delivery queue', () => {
    it('enqueues and processes messages', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const queue = workspace.createDeliveryQueue();
      const deliveryId = queue.enqueue('telegram', 'user-123', 'Test message');

      expect(deliveryId).toBeTruthy();

      const queueFile = path.join(workspace.deliveryDir, `${deliveryId}.json`);
      expect(fs.existsSync(queueFile)).toBe(true);
    });
  });

  describe('workspace discovery', () => {
    it('discovers workspace from nested directory', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      // Create nested directory
      const nestedDir = path.join(testDir, 'src', 'modules', 'agent');
      fs.mkdirSync(nestedDir, { recursive: true });

      const discovered = Workspace.discover(nestedDir);
      expect(discovered).not.toBeNull();
      expect(discovered?.rootDir).toBe(testDir);
    });

    it('loads metadata from discovered workspace', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init('discovered-agent');

      const nestedDir = path.join(testDir, 'nested', 'deep');
      fs.mkdirSync(nestedDir, { recursive: true });

      const discovered = Workspace.discover(nestedDir);
      const metadata = discovered?.readMetadata();

      expect(metadata?.defaultAgentId).toBe('discovered-agent');
    });
  });

  describe('workspace lifecycle', () => {
    it('persists state across workspace instances', () => {
      // Initialize workspace with first instance
      let workspace1 = new Workspace({ rootDir: testDir });
      workspace1.init('persistent-agent');
      workspace1.writeMetadata({
        version: 1,
        createdAt: '2026-03-12T00:00:00Z',
        defaultAgentId: 'persistent-agent',
      });

      // Create a session
      const store1 = workspace1.createSessionStore();
      const sessionId = store1.createSession('chat1');
      store1.saveTurn('user', 'First message');

      // Read with second instance
      const workspace2 = new Workspace({ rootDir: testDir });
      const metadata = workspace2.readMetadata();
      expect(metadata.defaultAgentId).toBe('persistent-agent');

      const store2 = workspace2.createSessionStore();
      const messages = store2.loadSession(sessionId);
      expect(messages[0].content).toBe('First message');
    });

    it('handles multi-agent workspace', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      // Create sessions for different agents
      const luna = workspace.createSessionStore('luna');
      const sage = workspace.createSessionStore('sage');

      const lunaSession = luna.createSession('chat1');
      const sageSession = sage.createSession('chat1');

      luna.saveTurn('user', 'Luna, what is love?');
      sage.saveTurn('user', 'Sage, define wisdom');

      luna.saveTurn('assistant', 'Love is warmth and connection');
      sage.saveTurn('assistant', 'Wisdom is clarity through experience');

      const lunaMessages = luna.loadSession(lunaSession);
      const sageMessages = sage.loadSession(sageSession);

      // Messages are returned as ContentBlock[] for assistant messages
      const lunaContent = lunaMessages[1].content;
      const sageContent = sageMessages[1].content;

      const lunaText = Array.isArray(lunaContent)
        ? lunaContent.find((b) => b.type === 'text')?.text
        : '';
      const sageText = Array.isArray(sageContent)
        ? sageContent.find((b) => b.type === 'text')?.text
        : '';

      expect(lunaText).toContain('warmth');
      expect(sageText).toContain('experience');
    });
  });

  describe('workspace with configuration files', () => {
    it('loads CRON.json for scheduled tasks', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const cronContent = JSON.stringify(
        {
          jobs: [
            {
              id: 'health-check',
              name: 'Health Check',
              enabled: true,
              schedule: { kind: 'every', every_seconds: 3600 },
              payload: { kind: 'agent_turn', message: 'Check health' },
              delete_after_run: false,
            },
          ],
        },
        null,
        2,
      );

      fs.writeFileSync(path.join(workspace.shrimpDir, 'CRON.json'), cronContent, 'utf-8');

      const cronFile = fs.readFileSync(path.join(workspace.shrimpDir, 'CRON.json'), 'utf-8');
      const cron = JSON.parse(cronFile);

      expect(cron.jobs).toHaveLength(1);
      expect(cron.jobs[0].id).toBe('health-check');
    });

    it('loads AGENTS.md for multi-agent configuration', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const agentsContent = `# Agents

## Default Agent
Handles all messages unless routing bindings direct traffic elsewhere.

## Luna
Personality: Warm and helpful

## Sage
Personality: Analytical and thoughtful`;

      fs.writeFileSync(path.join(workspace.shrimpDir, 'AGENTS.md'), agentsContent, 'utf-8');

      const loader = workspace.createBootstrapLoader();
      const loaded = loader.loadFile('AGENTS.md');

      expect(loaded).toContain('Luna');
      expect(loaded).toContain('Sage');
    });
  });
});
