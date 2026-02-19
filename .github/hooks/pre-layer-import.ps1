# Copilot Hook: Enforce strict layer import boundaries (L0–L7)
#
# Rules enforced:
#   1. STRICT LAYER IMPORTS -- Each layer has an explicit set of allowed imports:
#      L0: self only       L1: L0           L2: L0, L1       L3: L0, L1, L2
#      L4: L0, L1, L3      L5: L0, L1, L4   L6: L0, L1, L5   L7: L0, L1, L3, L6
#   2. L0 BUILTIN BAN -- L0-pure cannot import Node.js builtins (node:*, fs, path, etc.)
#   3. DYNAMIC IMPORTS -- import('...') follows the same rules as static imports
#
# Exemptions:
#   - `import type ...` statements (type-only imports from any layer)
#   - `export type { ... }` re-exports (type-only re-exports from any layer)
#   - Test files (__tests__/) -- tests can import from any layer
#
# Known limitations:
#   - Multi-line imports: `from '...'` on a separate line from `import type` is not recognized as type-only
#   - Inline type annotations: `import { type Foo }` is NOT exempted -- use `import type { Foo }` instead
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

    # Exempt test files -- tests can import from any layer
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

    # Node.js builtins that L0 cannot import
    $nodeBuiltins = @('assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto',
        'dgram', 'dns', 'events', 'fs', 'http', 'http2', 'https', 'net', 'os', 'path',
        'perf_hooks', 'process', 'readline', 'stream', 'string_decoder', 'timers', 'tls',
        'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib')
    $builtinPattern = '^(' + ($nodeBuiltins -join '|') + ')(/|$)'

    # Helper: check a single import path against layer rules
    function Test-ImportViolation {
        param([string]$importPath, [int]$srcLayer, [string]$srcPath)

        # Rule: L0 cannot import Node.js builtins
        if ($srcLayer -eq 0) {
            if ($importPath -match '^node:') {
                return "Layer violation: L0-pure cannot import Node.js builtins ('$importPath'). L0 must be pure -- no I/O."
            }
            if ($importPath -match $builtinPattern) {
                return "Layer violation: L0-pure cannot import Node.js builtin '$importPath'. L0 must be pure -- no I/O."
            }
        }

        # Only check imports that reference a layer folder
        if ($importPath -match '/L(\d)-') {
            $targetLayer = [int]$Matches[1]

            # Strict layer import rules (L0/L1 are foundation, accessible from any layer above them)
            switch ($srcLayer) {
                0 { $allowed = @() }
                1 { $allowed = @(0) }
                2 { $allowed = @(0, 1) }
                3 { $allowed = @(0, 1, 2) }
                4 { $allowed = @(0, 1, 3) }
                5 { $allowed = @(0, 1, 4) }
                6 { $allowed = @(0, 1, 5) }
                7 { $allowed = @(0, 1, 3, 6) }
                default { $allowed = @() }
            }

            if ($allowed -notcontains $targetLayer) {
                $allowedStr = ($allowed | ForEach-Object { "L$_" }) -join ', '
                if (-not $allowedStr) { $allowedStr = "self only" }
                return "Layer violation: L$srcLayer cannot import from L$targetLayer. L$srcLayer may only import: $allowedStr."
            }
        }

        return $null
    }

    function Deny-WithReason {
        param([string]$reason, [string]$path)
        [Console]::Error.WriteLine("$reason ($path)")
        "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
        exit 0
    }

    $lines = $content -split "`n"
    foreach ($line in $lines) {
        # Skip type-only imports: import type { ... }, import type Foo, import type * as Foo
        if ($line -match '^\s*import\s+type\s+') {
            continue
        }

        # Skip type-only re-exports: export type { ... } from '...'
        if ($line -match '^\s*export\s+type\s+\{') {
            continue
        }

        # Check static imports and re-exports: from 'something' or from "something"
        if ($line -match "from\s+['""]([^'""]+)['""]") {
            $importPath = $Matches[1]
            $violation = Test-ImportViolation -importPath $importPath -srcLayer $sourceLayer -srcPath $normalizedPath
            if ($violation) {
                Deny-WithReason -reason $violation -path $filePath
            }
        }

        # Check dynamic imports: import('something') or import("something")
        if ($line -match "import\(['""]([^'""]+)['""]\)") {
            $importPath = $Matches[1]
            $violation = Test-ImportViolation -importPath $importPath -srcLayer $sourceLayer -srcPath $normalizedPath
            if ($violation) {
                Deny-WithReason -reason $violation -path $filePath
            }
        }
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("Layer-import hook error: $($_.Exception.Message). Allowing (fail-open).")
    exit 0
}
