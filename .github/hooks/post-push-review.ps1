# Copilot Hook (postToolUse): After git push, check for PR and wait for Copilot code review
# When review is found, output instructions for the agent to run review-triage

$ErrorActionPreference = "SilentlyContinue"

try {
    $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $toolName = $inputJson.toolName

    # Only handle bash/powershell tool completions
    if ($toolName -ne "bash" -and $toolName -ne "powershell") {
        exit 0
    }

    # Parse tool args to get the command
    $toolArgs = $inputJson.toolArgs | ConvertFrom-Json
    $command = $toolArgs.command

    if (-not $command) {
        exit 0
    }

    # Check if the command was a git push
    if ($command -notmatch "git\s+push") {
        exit 0
    }

    # Check if the push succeeded
    $resultType = $inputJson.toolResult.resultType
    if ($resultType -ne "success") {
        Write-Host "⏭️ Git push did not succeed, skipping review check." -ForegroundColor Yellow
        exit 0
    }

    # Get current branch
    $branch = & git rev-parse --abbrev-ref HEAD 2>$null
    if (-not $branch -or $branch -eq "HEAD") {
        Write-Host "⏭️ Could not determine current branch, skipping review check." -ForegroundColor Yellow
        exit 0
    }

    Write-Host "🔍 Post-push hook: Checking for PR associated with branch '$branch'..." -ForegroundColor Cyan

    # Find associated PR using gh CLI
    $prJson = & gh pr list --head $branch --state open --json number 2>$null
    $prList = $prJson | ConvertFrom-Json
    if (-not $prList -or $prList.Count -eq 0) {
        Write-Host "ℹ️ No open PR found for branch '$branch'. Skipping review wait." -ForegroundColor Gray
        exit 0
    }

    $prNumber = $prList[0].number
    Write-Host "📋 Found PR #$prNumber. Waiting for Copilot code review..." -ForegroundColor Cyan

    # Get the latest commit SHA
    $headSha = & git rev-parse HEAD 2>$null

    # Poll for Copilot code review (up to 4 minutes, checking every 15 seconds)
    $maxAttempts = 16
    $attempt = 0

    while ($attempt -lt $maxAttempts) {
        $attempt++

        # Check for review from copilot-pull-request-reviewer
        $reviewsJson = & gh api "repos/{owner}/{repo}/pulls/$prNumber/reviews" 2>$null
        $reviews = $reviewsJson | ConvertFrom-Json

        $copilotReviews = $reviews | Where-Object {
            $_.user.login -eq "copilot-pull-request-reviewer" -and $_.commit_id -eq $headSha
        }

        if ($copilotReviews -and @($copilotReviews).Count -gt 0) {
            Write-Host "✅ Copilot code review received on PR #$prNumber!" -ForegroundColor Green

            # Count unresolved review threads via GraphQL
            $graphqlQuery = @"
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100) {
        nodes { isResolved }
      }
    }
  }
}
"@
            $threadsJson = & gh api graphql -f query=$graphqlQuery 2>$null
            $threadsData = $threadsJson | ConvertFrom-Json
            $threads = $threadsData.data.repository.pullRequest.reviewThreads.nodes
            $unresolved = @($threads | Where-Object { $_.isResolved -eq $false }).Count

            if ($unresolved -gt 0) {
                Write-Host "" -ForegroundColor White
                Write-Host "⚠️ ===== COPILOT CODE REVIEW COMPLETE =====" -ForegroundColor Yellow
                Write-Host "PR #$prNumber has $unresolved unresolved review thread(s)." -ForegroundColor Yellow
                Write-Host "🔧 ACTION REQUIRED: Run the review-triage custom agent to address these comments." -ForegroundColor Cyan
                Write-Host "   Dispatch: task agent_type=review-triage for PR #$prNumber" -ForegroundColor Cyan
                Write-Host "=============================================" -ForegroundColor Yellow
            }
            else {
                Write-Host "✨ All review threads are resolved. No action needed." -ForegroundColor Green
            }
            exit 0
        }

        Write-Host "  ⏳ Attempt $attempt/$maxAttempts — No review yet, waiting 15s..." -ForegroundColor Gray
        Start-Sleep -Seconds 15
    }

    Write-Host "⏰ Timed out waiting for Copilot code review on PR #$prNumber (waited 4 minutes)." -ForegroundColor Yellow
    Write-Host "   The review may still arrive. You can manually trigger review-triage later." -ForegroundColor Gray
}
catch {
    # Fail-open: don't block on hook errors
    Write-Error $_.Exception.Message
    exit 0
}
