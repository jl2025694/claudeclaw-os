# Personal Agent Config

ClaudeClaw keeps runtime agent config outside the repo:

```bash
/Users/hernan/.claudeclaw/agents
```

That directory is intentionally not committed because it can contain personal paths, bot-token env names, local prompt edits, avatars, and other machine-specific state.

The repo keeps the recoverable baseline here:

```bash
/Users/hernan/Git/claudeclaw-os/agents
```

Current baseline names:

```text
main      Ivonne
comms     Charlie
content   Jennifer
ops       Taylor
research  Laura
```

## Restore Agent Prompts

To restore the tracked prompt templates into the external config:

```bash
PROJECT_ROOT=/Users/hernan/Git/claudeclaw-os
CONFIG_ROOT=/Users/hernan/.claudeclaw

for agent in comms content ops research; do
  mkdir -p "$CONFIG_ROOT/agents/$agent"
  cp "$PROJECT_ROOT/agents/$agent/CLAUDE.md" "$CONFIG_ROOT/agents/$agent/CLAUDE.md"
done
```

Main has its own external prompt:

```bash
cp "$PROJECT_ROOT/CLAUDE.md" "$CONFIG_ROOT/agents/main/CLAUDE.md"
```

Review that file after copying because main often contains personal assistant context.

## Restore Agent YAML

Do not blindly overwrite existing `agent.yaml` files unless bot-token env names and vault paths are correct.

To seed missing YAML files from the tracked examples:

```bash
PROJECT_ROOT=/Users/hernan/Git/claudeclaw-os
CONFIG_ROOT=/Users/hernan/.claudeclaw

for agent in comms content ops research; do
  mkdir -p "$CONFIG_ROOT/agents/$agent"
  if [ ! -f "$CONFIG_ROOT/agents/$agent/agent.yaml" ]; then
    cp "$PROJECT_ROOT/agents/$agent/agent.yaml.example" "$CONFIG_ROOT/agents/$agent/agent.yaml"
  fi
done
```

## Scheduler Rule

Agents must use the repo as the app root, not `~/.claudeclaw`:

```bash
PROJECT_ROOT=/Users/hernan/Git/claudeclaw-os
cd "$PROJECT_ROOT"
node "$PROJECT_ROOT/dist/schedule-cli.js" list
```

This matters because runtime tools need the repo `dist/`, `store/`, and `.env`.
