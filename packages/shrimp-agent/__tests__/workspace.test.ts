import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Workspace } from '../src/workspace.js';

describe('Workspace', () => {
  let testDir: string;
  let workspace: Workspace;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.cwd(), 'test-workspace-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('init', () => {
    it('creates directory structure', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      expect(fs.existsSync(workspace.shrimpDir)).toBe(true);
      expect(fs.existsSync(workspace.sessionsDir)).toBe(true);
      expect(fs.existsSync(path.join(workspace.sessionsDir, 'agents'))).toBe(true);
      expect(fs.existsSync(workspace.memoryDir)).toBe(true);
      expect(fs.existsSync(path.join(workspace.memoryDir, 'daily'))).toBe(true);
      expect(fs.existsSync(workspace.skillsDir)).toBe(true);
      expect(fs.existsSync(workspace.deliveryDir)).toBe(true);
      expect(fs.existsSync(path.join(workspace.deliveryDir, 'failed'))).toBe(true);
    });

    it('creates workspace.json with default metadata', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const metadata = workspace.readMetadata();
      expect(metadata.version).toBe(1);
      expect(metadata.defaultAgentId).toBe('default');
      expect(metadata.createdAt).toBeTruthy();
    });

    it('creates workspace.json with custom defaultAgentId', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init('myagent');

      const metadata = workspace.readMetadata();
      expect(metadata.defaultAgentId).toBe('myagent');
    });

    it('does not overwrite existing workspace.json', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init('agent1');

      const createdAt1 = workspace.readMetadata().createdAt;

      // Initialize again
      workspace.init('agent2');
      const metadata = workspace.readMetadata();

      expect(metadata.defaultAgentId).toBe('agent1');
      expect(metadata.createdAt).toBe(createdAt1);
    });
  });

  describe('readMetadata / writeMetadata', () => {
    beforeEach(() => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();
    });

    it('round-trips metadata', () => {
      const original: Parameters<typeof workspace.writeMetadata>[0] = {
        version: 2,
        createdAt: '2026-03-12T00:00:00Z',
        defaultAgentId: 'test-agent',
      };

      workspace.writeMetadata(original);
      const read = workspace.readMetadata();

      expect(read).toEqual(original);
    });

    it('handles missing metadata file gracefully', () => {
      const dir2 = fs.mkdtempSync(path.join(process.cwd(), 'test-no-meta-'));
      try {
        const ws = new Workspace({ rootDir: dir2 });
        const metadata = ws.readMetadata();

        expect(metadata.version).toBe(1);
        expect(metadata.defaultAgentId).toBe('default');
      } finally {
        fs.rmSync(dir2, { recursive: true });
      }
    });
  });

  describe('path accessors', () => {
    beforeEach(() => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();
    });

    it('returns correct shrimpDir', () => {
      expect(workspace.shrimpDir).toBe(path.join(testDir, '.shrimp'));
    });

    it('returns correct configDir', () => {
      expect(workspace.configDir).toBe(workspace.shrimpDir);
    });

    it('returns correct sessionsDir', () => {
      expect(workspace.sessionsDir).toBe(path.join(testDir, '.shrimp', 'sessions'));
    });

    it('returns correct memoryDir', () => {
      expect(workspace.memoryDir).toBe(path.join(testDir, '.shrimp', 'memory'));
    });

    it('returns correct skillsDir', () => {
      expect(workspace.skillsDir).toBe(path.join(testDir, '.shrimp', 'skills'));
    });

    it('returns correct deliveryDir', () => {
      expect(workspace.deliveryDir).toBe(path.join(testDir, '.shrimp', 'delivery'));
    });
  });

  describe('createSessionStore', () => {
    beforeEach(() => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init('myagent');
    });

    it('creates SessionStore with default agent', () => {
      const store = workspace.createSessionStore();
      expect(store.agentId).toBe('myagent');
    });

    it('creates SessionStore with custom agent', () => {
      const store = workspace.createSessionStore('custom');
      expect(store.agentId).toBe('custom');
    });

    it('SessionStore sessions root points to workspace', () => {
      const store = workspace.createSessionStore();
      const sessionId = store.createSession('test');

      const expectedPath = path.join(
        workspace.sessionsDir,
        'agents',
        'myagent',
        'sessions',
        `${sessionId}.jsonl`,
      );
      expect(fs.existsSync(expectedPath)).toBe(true);
    });
  });

  describe('createMemoryStore', () => {
    beforeEach(() => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();
    });

    it('creates MemoryStore with workspace directory', () => {
      const store = workspace.createMemoryStore();
      store.writeMemory('test memory', 'test');

      const today = new Date().toISOString().slice(0, 10);
      const expectedPath = path.join(workspace.memoryDir, 'daily', `${today}.jsonl`);
      expect(fs.existsSync(expectedPath)).toBe(true);
    });
  });

  describe('createBootstrapLoader', () => {
    beforeEach(() => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      fs.writeFileSync(path.join(workspace.shrimpDir, 'SOUL.md'), '# Test Soul', 'utf-8');
    });

    it('creates BootstrapLoader with workspace directory', () => {
      const loader = workspace.createBootstrapLoader();
      const soul = loader.loadFile('SOUL.md');
      expect(soul).toBe('# Test Soul');
    });
  });

  describe('createSkillsManager', () => {
    beforeEach(() => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const skillDir = path.join(workspace.skillsDir, 'test-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: TestSkill\ndescription: A test skill\n---\nBody content',
        'utf-8',
      );
    });

    it('creates SkillsManager with workspace directory', () => {
      const manager = workspace.createSkillsManager();
      manager.discover();
      expect(manager.skills.length).toBeGreaterThan(0);
    });
  });

  describe('createDeliveryQueue', () => {
    beforeEach(() => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();
    });

    it('creates DeliveryQueue with workspace directory', () => {
      const queue = workspace.createDeliveryQueue();
      const deliveryId = queue.enqueue('test-channel', 'recipient', 'test message');

      const expectedPath = path.join(workspace.deliveryDir, `${deliveryId}.json`);
      expect(fs.existsSync(expectedPath)).toBe(true);
    });
  });

  describe('discover', () => {
    it('finds workspace in current directory', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const found = Workspace.discover(testDir);
      expect(found).not.toBeNull();
      expect(found?.rootDir).toBe(testDir);
    });

    it('finds workspace in parent directories', () => {
      workspace = new Workspace({ rootDir: testDir });
      workspace.init();

      const nestedDir = path.join(testDir, 'nested', 'deep', 'dir');
      fs.mkdirSync(nestedDir, { recursive: true });

      const found = Workspace.discover(nestedDir);
      expect(found).not.toBeNull();
      expect(found?.rootDir).toBe(testDir);
    });

    it('returns null when no workspace exists', () => {
      const found = Workspace.discover(testDir);
      expect(found).toBeNull();
    });

    it('stops at first workspace found', () => {
      const outerDir = fs.mkdtempSync(path.join(process.cwd(), 'test-outer-'));
      try {
        const innerDir = path.join(outerDir, 'inner');
        fs.mkdirSync(innerDir, { recursive: true });

        const outer = new Workspace({ rootDir: outerDir });
        outer.init('outer');

        const inner = new Workspace({ rootDir: innerDir });
        inner.init('inner');

        const found = Workspace.discover(innerDir);
        expect(found).not.toBeNull();
        expect(found?.rootDir).toBe(innerDir);
      } finally {
        fs.rmSync(outerDir, { recursive: true });
      }
    });
  });
});
