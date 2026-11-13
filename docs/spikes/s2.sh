#!/usr/bin/env bash
set -euo pipefail

echo "=== Running Spike S2: Unborn branch commit behavior ==="
echo "Git version: $(git --version)"

TMPDIR=$(mktemp -d /tmp/git-spike-s2-XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

cd "$TMPDIR"
git init -b main
git config user.name "Spike S2"
git config user.email "spike-s2@example.com"

echo "unborn initial file" > first.txt

# Test 1: commit --only on unborn branch
echo "Testing: commit --only on unborn branch"
set +e
printf "first.txt\0" | git --literal-pathspecs commit --only -m "first commit" --pathspec-from-file=- --pathspec-file-nul 2>&1
EXIT_ONLY=$?
set -e
echo "Exit code for commit --only on unborn branch: $EXIT_ONLY"

# Test 2: index strategy (add paths, then commit without --only)
echo "Testing: index strategy on unborn branch"
git --literal-pathspecs add first.txt
git commit -m "first commit via index strategy"
echo "Index strategy succeeded on unborn branch."

git log -1 --oneline

echo "=== Spike S2 SUCCESS ==="
