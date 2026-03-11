# Copilot Hook: Block cross-layer re-exports (L0--L7 architecture)
#
# Cross-layer re-exports (`export { foo } from '../../L{N}-...'`) bypass the
# layer boundary and hide the real dependency. This hook enforces that re-exports
# only reference the same layer -- cross-layer access must use wrapper functions.
#
# Exemptions:
#   - `export type { ... }` re-exports (type-only re-exports from any layer)
#   - Same-layer re-exports (target layer == source layer)
#   - Third-party/builtin re-exports (no /L{digit}-/ in path)
#   - Test files (__tests__/) -- tests are exempt
#   - Non-source files (only checks src/L{digit}-*)
#
# Multi-line exports (`export {\n  foo\n} from '...'`) are handled via
# multiline regex matching.
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

    # Only check .ts and .js files
    if ($normalizedPath -notmatch '\.(ts|js)$') {
        exit 0
    }

    # Exempt test files
    if ($normalizedPath -match '__tests__/') {
        exit 0
    }

    # Extract source layer from file path: src/L(\d)-
    if ($normalizedPath -notmatch 'src/L(\d)-') {
        exit 0
    }
    $sourceLayer = [int]$Matches[1]

    # Get the content being added
    $content = $null
    if ($toolName -eq "edit") {
        $content = $toolArgs.new_str
    } elseif ($toolName -eq "create") {
        $content = $toolArgs.file_text
    }

    if (-not $content) { exit 0 }

    function Deny-WithReason {
        param([string]$reason, [string]$path)
        [Console]::Error.WriteLine("Re-export violation: $reason ($path)")
        "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
        exit 0
    }

    # Match: export { ... } from '...' (multiline-safe via [regex]::Matches)
    # Also match: export * from '...'
    # Skip: export type { ... } from '...'

    # Pattern 1: export { ... } from '...' -- multiline-safe
    $namedReexports = [regex]::Matches($content, "export\s+\{[^}]*\}\s*from\s+['""]([^'""]+)['""]")
    foreach ($m in $namedReexports) {
        $fullMatch = $m.Value
        # Skip type-only re-exports
        if ($fullMatch -match '^\s*export\s+type\s+\{') { continue }

        $importPath = $m.Groups[1].Value
        if ($importPath -match '/L(\d)-') {
            $targetLayer = [int]$Matches[1]
            if ($targetLayer -ne $sourceLayer) {
                $reason = "Cross-layer re-exports are not allowed. Instead of re-exporting from L$targetLayer, create a wrapper function that calls the inner function. Wrappers provide a real seam for testing, logging, and future business logic."
                Deny-WithReason -reason $reason -path $filePath
            }
        }
    }

    # Pattern 2: export * from '...'
    $starReexports = [regex]::Matches($content, "export\s+\*\s+from\s+['""]([^'""]+)['""]")
    foreach ($m in $starReexports) {
        $importPath = $m.Groups[1].Value
        if ($importPath -match '/L(\d)-') {
            $targetLayer = [int]$Matches[1]
            if ($targetLayer -ne $sourceLayer) {
                $reason = "Cross-layer re-exports are not allowed. Instead of re-exporting from L$targetLayer, create a wrapper function that calls the inner function. Wrappers provide a real seam for testing, logging, and future business logic."
                Deny-WithReason -reason $reason -path $filePath
            }
        }
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("Re-export hook error: $($_.Exception.Message). Allowing (fail-open).")
    exit 0
}
