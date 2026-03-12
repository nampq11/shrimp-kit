/**
 * Workspace — central coordinator for agent state, config, and memory.
 *
 * A workspace is a `.shrimp` directory containing:
 * - config files (SOUL.md, IDENTITY.md, TOOLS.md, etc.)
 * - sessions/ (per-agent conversation history)
 * - memory/ (daily memory + evergreen context)
 * - skills/ (discovered skill definitions)
 * - delivery/ (message queue and failed deliveries)
 *
 * Workspace.discover(startDir) walks up the directory tree to find
 * an existing workspace, similar to how `git` finds `.git/`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionStore } from './sessions.js';
import { MemoryStore, BootstrapLoader, SkillsManager } from './intelligence.js';
import { DeliveryQueue } from './delivery.js';

export interface WorkspaceOptions {
  rootDir: string;
}

export interface WorkspaceMetadata {
  version: number;
  createdAt: string;
  defaultAgentId: string;
}

export class Workspace {
  readonly rootDir: string;
  readonly shrimpDir: string;

  constructor(options: WorkspaceOptions) {
    this.rootDir = options.rootDir;
    this.shrimpDir = path.join(this.rootDir, '.shrimp');
  }

  /** Initialize workspace directory structure and metadata. */
  init(defaultAgentId = 'default'): void {
    fs.mkdirSync(this.shrimpDir, { recursive: true });
    fs.mkdirSync(path.join(this.shrimpDir, 'sessions', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(this.shrimpDir, 'memory', 'daily'), { recursive: true });
    fs.mkdirSync(path.join(this.shrimpDir, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(this.shrimpDir, 'delivery', 'failed'), { recursive: true });

    const metadataPath = path.join(this.shrimpDir, 'workspace.json');
    if (!fs.existsSync(metadataPath)) {
      const metadata: WorkspaceMetadata = {
        version: 1,
        createdAt: new Date().toISOString(),
        defaultAgentId,
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    }
  }

  /** Read workspace metadata. */
  readMetadata(): WorkspaceMetadata {
    const metadataPath = path.join(this.shrimpDir, 'workspace.json');
    try {
      if (fs.existsSync(metadataPath)) {
        return JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as WorkspaceMetadata;
      }
    } catch {
      // corrupted or missing, return defaults
    }
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      defaultAgentId: 'default',
    };
  }

  /** Write workspace metadata. */
  writeMetadata(metadata: WorkspaceMetadata): void {
    const metadataPath = path.join(this.shrimpDir, 'workspace.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  /** Get path to shrimp directory (same as configDir). */
  get configDir(): string {
    return this.shrimpDir;
  }

  /** Get path to sessions directory. */
  get sessionsDir(): string {
    return path.join(this.shrimpDir, 'sessions');
  }

  /** Get path to memory directory. */
  get memoryDir(): string {
    return path.join(this.shrimpDir, 'memory');
  }

  /** Get path to skills directory. */
  get skillsDir(): string {
    return path.join(this.shrimpDir, 'skills');
  }

  /** Get path to delivery queue directory. */
  get deliveryDir(): string {
    return path.join(this.shrimpDir, 'delivery');
  }

  /** Create a SessionStore for the given agent (defaults to workspace default). */
  createSessionStore(agentId?: string): SessionStore {
    return new SessionStore({
      agentId: agentId ?? this.readMetadata().defaultAgentId,
      baseDir: this.rootDir,
      sessionsRoot: this.sessionsDir,
    });
  }

  /** Create a MemoryStore for this workspace. */
  createMemoryStore(): MemoryStore {
    return new MemoryStore(this.shrimpDir);
  }

  /** Create a BootstrapLoader for this workspace. */
  createBootstrapLoader(): BootstrapLoader {
    return new BootstrapLoader(this.shrimpDir);
  }

  /** Create a SkillsManager for this workspace. */
  createSkillsManager(): SkillsManager {
    return new SkillsManager(this.shrimpDir);
  }

  /** Create a DeliveryQueue for this workspace. */
  createDeliveryQueue(): DeliveryQueue {
    return new DeliveryQueue(this.deliveryDir);
  }

  /**
   * Walk up the directory tree from startDir, looking for .shrimp/workspace.json.
   * Return a Workspace if found, null otherwise.
   */
  static discover(startDir: string): Workspace | null {
    let current = path.resolve(startDir);
    const root = path.parse(current).root;

    while (current !== root) {
      const shrimpPath = path.join(current, '.shrimp', 'workspace.json');
      if (fs.existsSync(shrimpPath)) {
        return new Workspace({ rootDir: current });
      }
      current = path.dirname(current);
    }

    return null;
  }
}
