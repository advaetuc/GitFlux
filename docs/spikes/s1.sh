#!/usr/bin/env bash
set -euo pipefail

echo "=== Running Spike S1: Git CLI flags and commit --only semantics ==="
echo "Git version: $(git --version)"

TMPDIR=$(mktemp -d /tmp/git-spike-s1-XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

cd "$TMPDIR"
git init -b main
git config user.name "Spike S1"
git config user.email "spike-s1@example.com"

# 1. Base commit
echo "file A base" > a.txt
echo "file B base" > b.txt
echo "file to rename" > rename_me.txt
echo "file to delete" > delete_me.txt
git add a.txt b.txt rename_me.txt delete_me.txt
git commit -m "initial commit"

# 2. Modify files
echo "file A modified (we want to commit this)" > a.txt
echo "file B staged unrelated (MUST REMAIN STAGED)" > b.txt
git add b.txt # b.txt is pre-staged

# Rename file
git mv rename_me.txt renamed.txt

# Delete file
rm delete_me.txt

# Create untracked file
echo "untracked content" > untracked.txt

echo "--- Pre-commit git status ---"
git status -s

# Test: add untracked with --pathspec-from-file=- --pathspec-file-nul
printf "untracked.txt\0" | git --literal-pathspecs add --pathspec-from-file=- --pathspec-file-nul
echo "Untracked added via stdin pathspecs."

# Test date format: YYYY-MM-DDTHH:MM:SS+0530
TEST_DATE="2026-03-02T10:41:07+0530"

# Commit only: a.txt, renamed.txt, rename_me.txt, delete_me.txt, untracked.txt
# Notice: b.txt is NOT in the pathspecs!
printf "a.txt\0renamed.txt\0rename_me.txt\0delete_me.txt\0untracked.txt\0" | \
  GIT_AUTHOR_DATE="$TEST_DATE" \
  GIT_COMMITTER_DATE="$TEST_DATE" \
  git --literal-pathspecs commit --only --cleanup=whitespace -m "spike commit" --pathspec-from-file=- --pathspec-file-nul

echo "--- Post-commit git status ---"
git status -s

# Assertion 1: b.txt must still be staged in index
B_STATUS=$(git status --porcelain | grep "M  b.txt" || true)
if [[ -z "$B_STATUS" ]]; then
  echo "FAIL: b.txt is not staged!"
  exit 1
else
  echo "PASS: pre-staged b.txt remained staged: $B_STATUS"
fi

# Assertion 2: verify commit date and raw format
LOG_RAW=$(git log -1 --format="%H%x00%ad%x00%cd" --date=raw)
echo "Commit verify raw: $LOG_RAW"
AUTHOR_DATE=$(git log -1 --format="%ad" --date=raw)
COMMITTER_DATE=$(git log -1 --format="%cd" --date=raw)
echo "Author raw date: $AUTHOR_DATE"
echo "Committer raw date: $COMMITTER_DATE"

# Check offset matches +0530
if [[ "$AUTHOR_DATE" =~ \+0530$ ]] && [[ "$COMMITTER_DATE" =~ \+0530$ ]]; then
  echo "PASS: Date offset +0530 recorded correctly in author and committer"
else
  echo "FAIL: Date offset mismatch!"
  exit 1
fi

# Test rollback command: rm --cached
echo "test rollback" > to_rollback.txt
printf "to_rollback.txt\0" | git --literal-pathspecs add --pathspec-from-file=- --pathspec-file-nul
echo "Added to_rollback.txt to index"
printf "to_rollback.txt\0" | git --literal-pathspecs rm --cached -q --ignore-unmatch --pathspec-from-file=- --pathspec-file-nul
echo "Rolled back to_rollback.txt"
ROLLBACK_STATUS=$(git status --porcelain to_rollback.txt)
if [[ "$ROLLBACK_STATUS" == "??"* ]]; then
  echo "PASS: to_rollback.txt is untracked again after rollback: $ROLLBACK_STATUS"
else
  echo "FAIL: to_rollback.txt status: $ROLLBACK_STATUS"
  exit 1
fi

echo "=== Spike S1 SUCCESS ==="
