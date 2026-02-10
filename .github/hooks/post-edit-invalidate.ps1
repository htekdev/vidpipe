# Copilot Hook: Invalidate code review when code changes
# postToolUse — fires after edit/create tools complete
$ErrorActionPreference = "Stop"

try {
    $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $toolName = $inputJson.toolName

    # Only trigger on file-modifying tools
    if ($toolName -ne "edit" -and $toolName -ne "create") {
        exit 0
    }

    # Don't invalidate when the reviewer itself is writing reviewed.md or debt.md
    $toolArgs = $inputJson.toolArgs | ConvertFrom-Json
    $filePath = $toolArgs.path
    if ($filePath -match "reviewed\.md$" -or $filePath -match "debt\.md$") {
        exit 0
    }

    # Delete reviewed.md to invalidate the review
    $reviewedPath = ".github/reviewed.md"
    if (Test-Path $reviewedPath) {
        Remove-Item $reviewedPath -Force
        [Console]::Error.WriteLine("🔄 Code changed — review invalidated (.github/reviewed.md deleted)")
    }
}
catch {
    # Fail silently — postToolUse output is ignored anyway
    exit 0
}
