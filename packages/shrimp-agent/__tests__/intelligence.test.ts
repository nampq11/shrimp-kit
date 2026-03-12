import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BootstrapLoader, SkillsManager, MemoryStore, buildSystemPrompt } from '../src/intelligence.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrimp-intel-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('BootstrapLoader', () => {
  it('loads files from workspace', () => {
    fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), 'Be kind and helpful.');
    fs.writeFileSync(path.join(tmpDir, 'IDENTITY.md'), 'You are Luna.');

    const loader = new BootstrapLoader(tmpDir);
    const files = loader.loadAll('full');
    expect(files['SOUL.md']).toBe('Be kind and helpful.');
    expect(files['IDENTITY.md']).toBe('You are Luna.');
  });

  it('skips missing files', () => {
    const loader = new BootstrapLoader(tmpDir);
    const files = loader.loadAll('full');
    expect(Object.keys(files)).toHaveLength(0);
  });

  it('truncates oversized files', () => {
    const loader = new BootstrapLoader(tmpDir);
    const long = 'x'.repeat(50000);
    const truncated = loader.truncateFile(long, 1000);
    expect(truncated.length).toBeLessThan(long.length);
    expect(truncated).toContain('truncated');
  });

  it('minimal mode loads only AGENTS.md and TOOLS.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), 'soul');
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'agents');
    fs.writeFileSync(path.join(tmpDir, 'TOOLS.md'), 'tools');

    const loader = new BootstrapLoader(tmpDir);
    const files = loader.loadAll('minimal');
    expect(files['AGENTS.md']).toBe('agents');
    expect(files['TOOLS.md']).toBe('tools');
    expect(files['SOUL.md']).toBeUndefined();
  });
});

describe('SkillsManager', () => {
  it('discovers skills from directories', () => {
    const skillsDir = path.join(tmpDir, 'skills', 'my-skill');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: A test skill\ninvocation: /myskill\n---\nSkill body here.',
    );

    const mgr = new SkillsManager(tmpDir);
    mgr.discover();
    expect(mgr.skills).toHaveLength(1);
    expect(mgr.skills[0].name).toBe('my-skill');
    expect(mgr.skills[0].description).toBe('A test skill');
    expect(mgr.skills[0].body).toBe('Skill body here.');
  });

  it('formats prompt block', () => {
    const skillsDir = path.join(tmpDir, 'skills', 'greeting');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      '---\nname: greeting\ndescription: Greet the user\ninvocation: /greet\n---\nSay hello warmly.',
    );

    const mgr = new SkillsManager(tmpDir);
    mgr.discover();
    const block = mgr.formatPromptBlock();
    expect(block).toContain('greeting');
    expect(block).toContain('Greet the user');
  });
});

describe('MemoryStore', () => {
  it('writes and searches memory', () => {
    const store = new MemoryStore(tmpDir);
    store.writeMemory('User prefers dark mode', 'preference');
    store.writeMemory('User works at Acme Corp', 'fact');

    const results = store.searchMemory('dark mode');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain('dark mode');
  });

  it('loads evergreen memory', () => {
    fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), 'Important fact: the sky is blue.');
    const store = new MemoryStore(tmpDir);
    const evergreen = store.loadEvergreen();
    expect(evergreen).toContain('sky is blue');
  });

  it('hybrid search works', () => {
    fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), 'User likes Python programming.\n\nUser dislikes Java.');
    const store = new MemoryStore(tmpDir);
    store.writeMemory('User is learning TypeScript', 'fact');

    const results = store.hybridSearch('programming language');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns stats', () => {
    const store = new MemoryStore(tmpDir);
    store.writeMemory('test entry');
    const stats = store.getStats();
    expect(stats.dailyFiles).toBe(1);
    expect(stats.dailyEntries).toBe(1);
  });

  it('tokenize works for English and CJK', () => {
    expect(MemoryStore.tokenize('hello world')).toEqual(['hello', 'world']);
    expect(MemoryStore.tokenize('你好世界')).toEqual(['你', '好', '世', '界']);
    expect(MemoryStore.tokenize('a')).toEqual([]);
  });
});

describe('buildSystemPrompt', () => {
  it('builds an 8-layer prompt', () => {
    const prompt = buildSystemPrompt({
      mode: 'full',
      bootstrap: {
        'IDENTITY.md': 'You are Luna, an AI assistant.',
        'SOUL.md': 'Warm and curious.',
      },
      skillsBlock: '## Skills\n- greeting',
      memoryContext: '- User likes coffee',
      agentId: 'luna',
      channel: 'terminal',
      model: 'test-model',
    });

    expect(prompt).toContain('Luna');
    expect(prompt).toContain('Warm and curious');
    expect(prompt).toContain('Skills');
    expect(prompt).toContain('coffee');
    expect(prompt).toContain('luna');
    expect(prompt).toContain('terminal');
    expect(prompt).toContain('Runtime Context');
    expect(prompt).toContain('Channel');
  });

  it('minimal mode skips soul and skills', () => {
    const prompt = buildSystemPrompt({
      mode: 'minimal',
      bootstrap: {
        'SOUL.md': 'Should not appear',
        'AGENTS.md': 'Agent config here',
      },
    });

    expect(prompt).not.toContain('Should not appear');
    expect(prompt).toContain('Agent config here');
  });
});
