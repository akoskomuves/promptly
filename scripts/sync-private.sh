#!/bin/bash
# Sync gitignored files from public root to private cloud repo
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLOUD="$ROOT/cloud"

cp "$ROOT/CLAUDE.md" "$CLOUD/CLAUDE.md"
cp "$ROOT/ROADMAP.md" "$CLOUD/ROADMAP.md"
cp "$ROOT/TECHSTACK.md" "$CLOUD/TECHSTACK.md"

cd "$CLOUD"
git add CLAUDE.md ROADMAP.md TECHSTACK.md
if git diff --cached --quiet; then
  echo "No changes to sync."
else
  git commit -m "Sync CLAUDE.md, ROADMAP.md, and TECHSTACK.md from public repo"
  git push
  echo "Synced and pushed to private repo."
fi
