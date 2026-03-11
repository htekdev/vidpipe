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
                return "Layer violation: L0-pure cannot import Node.js builtins ('$importPath'). L0 must be pure functions with zero side effects. If this function needs I/O, it doesn't belong in L0 -- move it to L1-infra or higher."
            }
            if ($importPath -match $builtinPattern) {
                return "Layer violation: L0-pure cannot import Node.js builtin '$importPath'. L0 must be pure functions with zero side effects. If this function needs I/O, it doesn't belong in L0 -- move it to L1-infra or higher."
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
                # Scenario-specific guidance for each (source, target) pair
                $guidanceKey = "${srcLayer}_${targetLayer}"
                $guidanceMap = @{
                    '0_1' = "This code has dependencies, so it doesn't belong in L0-pure. Move it to the layer that matches what it imports."
                    '0_2' = "This code has dependencies, so it doesn't belong in L0-pure. Move it to the layer that matches what it imports."
                    '0_3' = "This code has dependencies, so it doesn't belong in L0-pure. Move it to the layer that matches what it imports."
                    '0_4' = "This code has dependencies, so it doesn't belong in L0-pure. Move it to the layer that matches what it imports."
                    '0_5' = "This code has dependencies, so it doesn't belong in L0-pure. Move it to the layer that matches what it imports."
                    '0_6' = "This code has dependencies, so it doesn't belong in L0-pure. Move it to the layer that matches what it imports."
                    '0_7' = "This code has dependencies, so it doesn't belong in L0-pure. Move it to the layer that matches what it imports."
                    '1_2' = "L1 wraps Node.js builtins only. If this code calls an external API or spawns a process, it belongs in L2-clients, not L1."
                    '1_3' = "This code has service dependencies -- it's placed too low. Move it to the layer that matches its dependencies."
                    '1_4' = "This code has agent dependencies -- it's placed too low. Move it to the layer that matches its dependencies."
                    '1_5' = "This code has asset dependencies -- it's placed too low. Move it to the layer that matches its dependencies."
                    '1_6' = "This code has pipeline dependencies -- it's placed too low. Move it to the layer that matches its dependencies."
                    '1_7' = "This code has app dependencies -- it's placed too low. Move it to the layer that matches its dependencies."
                    '2_3' = "L2 is for thin client wrappers with no business logic. If you're adding orchestration or business rules, this function belongs in L3-services."
                    '2_4' = "This code depends on agents -- it's placed too low. The function likely belongs in a higher layer."
                    '2_5' = "This code depends on assets -- it's placed too low. The function likely belongs in a higher layer."
                    '2_6' = "This code depends on pipeline -- it's placed too low. The function likely belongs in a higher layer."
                    '2_7' = "This code depends on app -- it's placed too low. The function likely belongs in a higher layer."
                    '3_4' = "Services cannot use agents. If you need agent logic in L3, the function in L4 is probably misplaced -- consider moving it down to L3 as a service function."
                    '3_5' = "Services cannot use assets. If you need this functionality in L3, the code in L5 may be placed wrong -- consider refactoring it down to L3."
                    '3_6' = "This code depends on pipeline -- it's placed too low. Consider whether the function belongs in a higher layer."
                    '3_7' = "This code depends on app -- it's placed too low. Consider whether the function belongs in a higher layer."
                    '4_2' = "Agents cannot import clients directly. Create or use an L3-services wrapper function (not a re-export) to expose the L2 client functionality. If no L3 service exists for this client yet, create one."
                    '4_5' = "Agents cannot import assets. If you need this asset logic in L4, the function in L5 may be placed wrong -- consider moving it down to L4 or L3."
                    '4_6' = "Agents cannot import pipeline. If you need pipeline logic in an agent, the function in L6 may be placed wrong -- consider moving it to L3-services."
                    '4_7' = "Agents cannot import app. This function is misplaced -- consider restructuring."
                    '5_2' = "Assets cannot import clients. Use an L4 bridge module (videoServiceBridge, analysisServiceBridge, pipelineServiceBridge). If no bridge exists for this client, create one in L4."
                    '5_3' = "Assets cannot import services directly. Use an L4 bridge module that wraps the needed service. If the bridge doesn't expose what you need, extend it."
                    '5_6' = "Assets cannot import pipeline. If you need pipeline functionality in L5, the function in L6 likely belongs in L5 instead."
                    '5_7' = "Assets cannot import app. This function is misplaced -- consider restructuring."
                    '6_2' = "Pipeline cannot import clients. Access through L5 asset methods. If the asset doesn't expose what you need, add a method to the asset or extend a bridge."
                    '6_3' = "Pipeline cannot import services. Access through L5 asset methods. If the service isn't available via L5, add an L5 loader or extend a bridge module."
                    '6_4' = "Pipeline cannot import agents. Access through L5 asset methods and loaders. If the agent isn't exposed via L5, add a loader in L5/loaders.ts."
                    '6_7' = "Pipeline cannot import app. If you need this app logic in pipeline, the function in L7 likely belongs in L6 or lower."
                    '7_2' = "App cannot import clients directly. Create or use an L3-services wrapper function (not a re-export). If no L3 service exists for this client, create one."
                    '7_4' = "App cannot import agents. Access through L6-pipeline. If you need agent logic outside the pipeline, the function may belong in L3-services instead of L4."
                    '7_5' = "App cannot import assets. Access through L6-pipeline. If you need asset data outside the pipeline, the function in L5 may be placed wrong."
                }
                $guidance = $guidanceMap[$guidanceKey]
                if (-not $guidance) {
                    $allowedStr = ($allowed | ForEach-Object { "L$_" }) -join ', '
                    if (-not $allowedStr) { $allowedStr = "self only" }
                    $guidance = "L$srcLayer may only import: $allowedStr."
                }
                return "Layer violation: L$srcLayer cannot import from L$targetLayer. $guidance"
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
