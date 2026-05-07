#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="/Users/hernan"

VAULT_DIR="${OBSIDIAN_VAULT_DIR:-/Users/hernan/Documents/Ivonne}"
REMOTE="${OBSIDIAN_GIT_REMOTE:-origin}"
BRANCH="${OBSIDIAN_GIT_BRANCH:-main}"
LOCK_DIR="/tmp/claudeclaw-obsidian-git-sync.lock"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Obsidian git sync already running; skipping."
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

cd "$VAULT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository: $VAULT_DIR" >&2
  exit 1
fi

git fetch "$REMOTE" "$BRANCH"
git pull --rebase --autostash "$REMOTE" "$BRANCH"

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "No Obsidian changes to sync."
  exit 0
fi

git add -A

if git diff --cached --quiet; then
  echo "No staged Obsidian changes after add."
  exit 0
fi

git commit -m "Auto-sync Obsidian vault"
git push "$REMOTE" "HEAD:$BRANCH"
