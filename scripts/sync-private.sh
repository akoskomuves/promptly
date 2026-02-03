#!/bin/bash
# Sync gitignored files from public root to private cloud repo
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLOUD="$ROOT/cloud"

cp "$ROOT/CLAUDE.md" "$CLOUD/CLAUDE.md"
cp "$ROOT/ROADMAP.md" "$CLOUD/ROADMAP.md"
cp "$ROOT/TECHSTACK.md" "$CLOUD/TECHSTACK.md"
cp "$ROOT/BUSINESS.md" "$CLOUD/BUSINESS.md"

cd "$CLOUD"
git add CLAUDE.md ROADMAP.md TECHSTACK.md BUSINESS.md
if git diff --cached --quiet; then
  echo "No changes to sync."
else
  git commit -m "Sync private docs (CLAUDE.md, ROADMAP.md, TECHSTACK.md, BUSINESS.md)"
  git push
  echo "Synced and pushed to private repo."
fi
