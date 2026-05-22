import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

import { CLAUDECLAW_CONFIG, PROJECT_ROOT } from './config.js';
import { readEnvFile } from './env.js';

// Shared roster path. Written by Node on startup and any time the agent
// roster changes (new agent, deleted agent). Read by the Python Pipecat
// voice stack so new agents propagate into voice War Room without a
// full bot restart.
export const WARROOM_ROSTER_PATH = '/tmp/warroom-agents.json';

/** Single source of truth for "is this string a syntactically valid
 *  agent id?". Lifted out of the various inline copies in the dashboard
 *  HTTP layer so the avatar / chat / agent-files handlers all share one
 *  definition. Lower-case alphanumerics plus `_` and `-`; `i` flag is
 *  kept for backwards compatibility with the historical regex. */
export const AGENT_ID_RE = /^[a-z0-9_-]+$/i;

/** Cheap "does this agent exist on disk?" check. `main` always exists
 *  (it's the root process); any other id needs an `agent.yaml` next to
 *  resolveAgentDir(id). Returns false for syntactically invalid ids so
 *  callers can use this as the only existence check they need. */
export function agentExists(agentId: string): boolean {
  if (!AGENT_ID_RE.test(agentId)) return false;
  if (agentId === 'main') return true;
  try {
    const dir = resolveAgentDir(agentId);
    return fs.existsSync(path.join(dir, 'agent.yaml'));
  } catch {
    return false;
  }
}

export interface AgentConfig {
  name: string;
  description: string;
  botTokenEnv: string;
  botToken: string;
  model?: string;
  mcpServers?: string[];
  /** Per-agent war-room tool allowlist. Tokens are SDK tool names
   *  ("Bash", "Write") or "mcp:<name>" entries to opt an MCP server in.
   *  Overrides the defaults in warroom-tool-policy.ts. Unset = use
   *  defaults. */
  warroomTools?: string[];
  obsidian?: {
    vault: string;
    folders: string[];
    readOnly?: string[];
  };
  /** Pika voice id used when this agent joins a video meeting. Falls back
   *  to the Pika preset English_radiant_girl if unset. */
  meetVoiceId?: string;
  /** Display name shown in the meeting ("Your Agent wants to join"). Falls
   *  back to the agent's name or id with first letter capitalized. */
  meetBotName?: string;
}

const DEFAULT_AGENT_NAMES: Record<string, string> = {
  main: 'Ivonne',
  ops: 'Taylor',
  comms: 'Charlie',
  content: 'Jennifer',
  research: 'Laura',
};

const DEFAULT_AGENT_ROLES: Record<string, string> = {
  main: 'General ops',
  ops: 'ops',
  comms: 'comms',
  content: 'content',
  research: 'research',
};

export function agentDisplayName(agentId: string, name?: string): string {
  const baseName = (name || DEFAULT_AGENT_NAMES[agentId] || agentId).trim();
  return baseName.replace(/\s+-\s+[a-z0-9_-]+$/i, '');
}

export function agentRole(agentId: string): string {
  return DEFAULT_AGENT_ROLES[agentId] || agentId;
}

export function formatAgentDisplayName(agentId: string, name?: string): string {
  return agentDisplayName(agentId, name);
}

/**
 * Resolve the directory for a given agent, checking CLAUDECLAW_CONFIG first,
 * then falling back to PROJECT_ROOT/agents/<id>.
 */
export function resolveAgentDir(agentId: string): string {
  const externalDir = path.join(CLAUDECLAW_CONFIG, 'agents', agentId);
  if (fs.existsSync(path.join(externalDir, 'agent.yaml'))) {
    return externalDir;
  }
  return path.join(PROJECT_ROOT, 'agents', agentId);
}

/**
 * Resolve the CLAUDE.md path for a given agent, checking CLAUDECLAW_CONFIG first,
 * then falling back to PROJECT_ROOT/agents/<id>/CLAUDE.md.
 */
export function resolveAgentClaudeMd(agentId: string): string | null {
  const externalPath = path.join(CLAUDECLAW_CONFIG, 'agents', agentId, 'CLAUDE.md');
  if (fs.existsSync(externalPath)) {
    return externalPath;
  }
  const repoPath = path.join(PROJECT_ROOT, 'agents', agentId, 'CLAUDE.md');
  if (fs.existsSync(repoPath)) {
    return repoPath;
  }
  return null;
}

export function loadAgentConfig(agentId: string): AgentConfig {
  const agentDir = resolveAgentDir(agentId);
  const configPath = path.join(agentDir, 'agent.yaml');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Agent config not found: ${configPath}`);
  }

  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;

  const name = raw['name'] as string;
  const description = (raw['description'] as string) ?? '';
  const botTokenEnv = raw['telegram_bot_token_env'] as string;
  const model = raw['model'] as string | undefined;

  if (!name || !botTokenEnv) {
    throw new Error(`Agent config ${configPath} must have 'name' and 'telegram_bot_token_env'`);
  }

  const env = readEnvFile([botTokenEnv]);
  const botToken = process.env[botTokenEnv] || env[botTokenEnv] || '';
  if (!botToken) {
    throw new Error(`Bot token not found: set ${botTokenEnv} in .env`);
  }

  const obsidian = parseObsidianConfig(raw, agentId);

  const mcpServers = raw['mcp_servers'] as string[] | undefined;
  // War-room tool policy override. If present in agent.yaml, this list
  // overrides the per-agent default in warroom-tool-policy.ts. Tokens
  // can be SDK tool names ("Bash", "Write") or "mcp:<name>" to opt that
  // MCP server into the war-room session.
  const warroomTools = raw['warroom_tools'] as string[] | undefined;
  const meetVoiceId = typeof raw['meet_voice_id'] === 'string' ? (raw['meet_voice_id'] as string) : undefined;
  const meetBotName = typeof raw['meet_bot_name'] === 'string' ? (raw['meet_bot_name'] as string) : undefined;

  return {
    name,
    description,
    botTokenEnv,
    botToken,
    model,
    mcpServers,
    warroomTools,
    obsidian,
    meetVoiceId,
    meetBotName,
  };
}

export function loadAgentObsidianConfig(agentId: string): AgentConfig['obsidian'] {
  const agentDir = resolveAgentDir(agentId);
  const configPath = path.join(agentDir, 'agent.yaml');
  if (!fs.existsSync(configPath)) return undefined;
  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  return parseObsidianConfig(raw, agentId);
}

function parseObsidianConfig(raw: Record<string, unknown>, agentId: string): AgentConfig['obsidian'] {
  const obsRaw = raw['obsidian'] as Record<string, unknown> | undefined;
  if (!obsRaw) return undefined;
  const vault = obsRaw['vault'] as string;
  if (vault && !fs.existsSync(vault)) {
    // eslint-disable-next-line no-console
    console.warn(`[${agentId}] WARNING: Obsidian vault path does not exist: ${vault}`);
    console.warn(`[${agentId}] Update obsidian.vault in agent.yaml to your local vault path.`);
  }
  return {
    vault,
    folders: (obsRaw['folders'] as string[]) ?? [],
    readOnly: (obsRaw['read_only'] as string[]) ?? [],
  };
}

/** Update the model field in an agent's agent.yaml file. */
export function setAgentModel(agentId: string, model: string): void {
  const agentDir = resolveAgentDir(agentId);
  const configPath = path.join(agentDir, 'agent.yaml');
  if (!fs.existsSync(configPath)) throw new Error(`Agent config not found: ${configPath}`);

  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  raw['model'] = model;
  fs.writeFileSync(configPath, yaml.dump(raw, { lineWidth: -1 }), 'utf-8');
}

/** List all configured agent IDs (directories under agents/ with agent.yaml).
 *  Scans both CLAUDECLAW_CONFIG/agents/ and PROJECT_ROOT/agents/, deduplicating.
 */
export function listAgentIds(): string[] {
  const ids = new Set<string>();

  for (const baseDir of [
    path.join(CLAUDECLAW_CONFIG, 'agents'),
    path.join(PROJECT_ROOT, 'agents'),
  ]) {
    if (!fs.existsSync(baseDir)) continue;
    for (const d of fs.readdirSync(baseDir)) {
      if (d.startsWith('_')) continue;
      const yamlPath = path.join(baseDir, d, 'agent.yaml');
      if (fs.existsSync(yamlPath)) ids.add(d);
    }
  }

  return [...ids];
}

/** Return the capabilities (name + description) for a specific agent. */
export function getAgentCapabilities(
  agentId: string,
): { name: string; description: string } | null {
  try {
    const config = loadAgentConfig(agentId);
    return { name: agentDisplayName(agentId, config.name), description: config.description };
  } catch {
    return null;
  }
}

/**
 * List all configured agents with their descriptions.
 * Unlike `listAgentIds()`, this returns richer metadata and silently
 * skips agents whose config fails to load (e.g. missing token).
 */
export function listAllAgents(): Array<{
  id: string;
  name: string;
  description: string;
  model?: string;
}> {
  const ids = listAgentIds();
  const result: Array<{
    id: string;
    name: string;
    description: string;
    model?: string;
  }> = [];

  for (const id of ids) {
    try {
      const config = loadAgentConfig(id);
      result.push({
        id,
        name: agentDisplayName(id, config.name),
        description: config.description,
        model: config.model,
      });
    } catch {
      // Skip agents with broken config
    }
  }

  return result;
}

/**
 * Write the current agent roster to the path the Python Pipecat voice
 * stack reads from. Call this:
 *   - On main-bot startup (index.ts does this already)
 *   - After creating or deleting an agent (agent-create flow)
 *   - Before /warroom/text turns (orchestrator does this cheaply too)
 *
 * The file is read-only metadata: id, name, description. The voice
 * server kills + respawns its subprocess when this changes if callers
 * want the new roster to take effect immediately.
 */
// ── Agent groups ──────────────────────────────────────────────────────
// Groups are stored in CLAUDECLAW_CONFIG/agent-groups.json so they
// persist across deploys without touching individual agent.yaml files.

const AGENT_GROUPS_FILE = path.join(CLAUDECLAW_CONFIG, 'agent-groups.json');

let _groupsCache: Record<string, string> | null = null;
let _groupsMtime = 0;

/** Load agent-to-group mapping. Cached and auto-refreshed on file change. */
export function loadAgentGroups(): Record<string, string> {
  try {
    const stat = fs.statSync(AGENT_GROUPS_FILE);
    if (_groupsCache && stat.mtimeMs === _groupsMtime) return _groupsCache;
    _groupsCache = JSON.parse(fs.readFileSync(AGENT_GROUPS_FILE, 'utf-8'));
    _groupsMtime = stat.mtimeMs;
    return _groupsCache!;
  } catch {
    return {};
  }
}

/** Get the group for a specific agent. Returns undefined if unassigned. */
export function getAgentGroup(agentId: string): string | undefined {
  return loadAgentGroups()[agentId];
}

/** Update the entire groups mapping and write to disk. */
export function saveAgentGroups(groups: Record<string, string>): void {
  fs.writeFileSync(AGENT_GROUPS_FILE, JSON.stringify(groups, null, 2));
  _groupsCache = groups;
  _groupsMtime = Date.now();
}

export function refreshWarRoomRoster(): void {
  try {
    const ids = ['main', ...listAgentIds().filter((id) => id !== 'main')];
    const roster = ids.map((id) => {
      try {
        if (id === 'main') return { id: 'main', name: agentDisplayName('main'), role: agentRole('main'), description: 'General ops and triage' };
        const cfg = loadAgentConfig(id);
        return { id, name: agentDisplayName(id, cfg.name || id), role: agentRole(id), description: cfg.description || '' };
      } catch {
        return { id, name: agentDisplayName(id), role: agentRole(id), description: '' };
      }
    });
    fs.writeFileSync(WARROOM_ROSTER_PATH, JSON.stringify(roster, null, 2));
  } catch {
    // Non-fatal. Voice stack falls back to the built-in default roster
    // if the file is missing.
  }
}
