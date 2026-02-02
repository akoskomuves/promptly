#!/bin/bash
# Sync gitignored files from public root to private cloud repo
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLOUD="$ROOT/cloud"

cp "$ROOT/CLAUDE.md" "$CLOUD/CLAUDE.md"
cp "$ROOT/ROADMAP.md" "$CLOUD/ROADMAP.md"

cd "$CLOUD"
git add CLAUDE.md ROADMAP.md
if git diff --cached --quiet; then
  echo "No changes to sync."
else
  git commit -m "Sync CLAUDE.md and ROADMAP.md from public repo"
  git push
  echo "Synced and pushed to private repo."
fi
