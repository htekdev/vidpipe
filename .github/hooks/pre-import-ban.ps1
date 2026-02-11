# Copilot Hook: Block non-relative imports outside src/core/
try {
    $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $toolName = $inputJson.toolName

    if ($toolName -ne "edit" -and $toolName -ne "create") {
        exit 0
    }

    $toolArgs = $inputJson.toolArgs | ConvertFrom-Json
    $filePath = $toolArgs.path
    if (-not $filePath) { exit 0 }

    # Normalize path separators
    $normalizedPath = $filePath -replace '\\', '/'

    # Exempt: core/, __tests__/, cicd/
    if ($normalizedPath -match 'src/core/' -or $normalizedPath -match '__tests__/' -or $normalizedPath -match 'cicd/') {
        exit 0
    }

    # Only check .ts and .js files
    if ($normalizedPath -notmatch '\.(ts|js|tsx|jsx)$') {
        exit 0
    }

    # Get the content being added
    $content = $null
    if ($toolName -eq "edit") {
        $content = $toolArgs.new_str
    } elseif ($toolName -eq "create") {
        $content = $toolArgs.file_text
    }

    if (-not $content) { exit 0 }

    # Check for non-relative imports: from 'xxx' or from "xxx" where xxx doesn't start with .
    # Also check require('xxx') or require("xxx")
    $lines = $content -split "`n"
    foreach ($line in $lines) {
        # Match: from 'something' or from "something" where something doesn't start with .
        if ($line -match "from\s+['""]([^.][^'""]*)['""]") {
            $spec = $Matches[1]
            [Console]::Error.WriteLine("Blocked non-relative import: '$spec' in $filePath")
            $reason = "Non-relative import ``from '$spec'`` is not allowed outside src/core/. Import from a core/ module instead (e.g., core/fileSystem, core/paths, core/process, etc.)."
            "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
            exit 0
        }
        # Match: require('something') or require("something") where something doesn't start with .
        if ($line -match "require\(['""]([^.][^'""]*)['""]") {
            $spec = $Matches[1]
            [Console]::Error.WriteLine("Blocked non-relative require: '$spec' in $filePath")
            $reason = "Non-relative require ``require('$spec')`` is not allowed outside src/core/. Import from a core/ module instead."
            "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
            exit 0
        }
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("Import-ban hook error: $($_.Exception.Message). Allowing (fail-open).")
    exit 0
}
