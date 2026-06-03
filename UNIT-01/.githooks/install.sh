#!/bin/bash
set -euo pipefail

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing UNIT-01 git hooks..."
git config core.hooksPath "$HOOKS_DIR"
echo "HooksPath set to: $HOOKS_DIR"
echo "Installed hooks:"
for hook in "$HOOKS_DIR"/*; do
    [ -f "$hook" ] && [ -x "$hook" ] && echo "  $(basename "$hook")"
done
