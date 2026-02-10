#!/bin/bash
# Copilot Hook (postToolUse): After git push, check for PR and wait for Copilot code review
# When review is found, output instructions for the agent to run review-triage

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')

# Only handle bash/powershell tool completions
if [ "$TOOL_NAME" != "bash" ] && [ "$TOOL_NAME" != "powershell" ]; then
  exit 0
fi

# Check if the command was a git push
COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command // empty')
if [ -z "$COMMAND" ]; then
  exit 0
fi

if ! echo "$COMMAND" | grep -q "git push"; then
  exit 0
fi

# Check if the push succeeded
RESULT_TYPE=$(echo "$INPUT" | jq -r '.toolResult.resultType // empty')
if [ "$RESULT_TYPE" != "success" ]; then
  echo "⏭️ Git push did not succeed, skipping review check." >&2
  exit 0
fi

# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
  echo "⏭️ Could not determine current branch, skipping review check." >&2
  exit 0
fi

echo "🔍 Post-push hook: Checking for PR associated with branch '$BRANCH'..." >&2

# Find associated PR using gh CLI
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null)
if [ -z "$PR_NUMBER" ]; then
  echo "ℹ️ No open PR found for branch '$BRANCH'. Skipping review wait." >&2
  exit 0
fi

echo "📋 Found PR #$PR_NUMBER. Waiting for Copilot code review..." >&2

# Get the latest commit SHA (the one we just pushed)
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null)

# Poll for Copilot code review (up to 4 minutes, checking every 15 seconds)
MAX_ATTEMPTS=16
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))

  # Check for review comments from copilot-pull-request-reviewer
  REVIEW_COUNT=$(gh api "repos/{owner}/{repo}/pulls/$PR_NUMBER/reviews" \
    --jq "[.[] | select(.user.login == \"copilot-pull-request-reviewer\" and .commit_id == \"$HEAD_SHA\")] | length" 2>/dev/null)

  if [ -n "$REVIEW_COUNT" ] && [ "$REVIEW_COUNT" -gt 0 ]; then
    echo "✅ Copilot code review received on PR #$PR_NUMBER!" >&2

    # Count unresolved review threads
    UNRESOLVED=$(gh api graphql -f query='
      query($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100) {
              nodes { isResolved }
            }
          }
        }
      }
    ' -f owner="{owner}" -f repo="{repo}" -F pr="$PR_NUMBER" \
      --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length' 2>/dev/null)

    if [ -n "$UNRESOLVED" ] && [ "$UNRESOLVED" -gt 0 ]; then
      echo "" >&2
      echo "⚠️ ===== COPILOT CODE REVIEW COMPLETE =====" >&2
      echo "PR #$PR_NUMBER has $UNRESOLVED unresolved review thread(s)." >&2
      echo "🔧 ACTION REQUIRED: Run the review-triage custom agent to address these comments." >&2
      echo "   Dispatch: task agent_type=review-triage for PR #$PR_NUMBER" >&2
      echo "=============================================" >&2
    else
      echo "✨ All review threads are resolved. No action needed." >&2
    fi
    exit 0
  fi

  echo "  ⏳ Attempt $ATTEMPT/$MAX_ATTEMPTS — No review yet, waiting 15s..." >&2
  sleep 15
done

echo "⏰ Timed out waiting for Copilot code review on PR #$PR_NUMBER (waited 4 minutes)." >&2
echo "   The review may still arrive. You can manually trigger review-triage later." >&2
exit 0
