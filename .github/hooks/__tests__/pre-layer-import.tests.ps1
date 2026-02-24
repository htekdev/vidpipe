# Tests for .github/hooks/pre-layer-import.ps1
# Run: pwsh -NoProfile -File .github/hooks/__tests__/pre-layer-import.tests.ps1

$ErrorActionPreference = 'Stop'
$script:failures = 0
$script:passed = 0
$hookPath = Join-Path $PSScriptRoot '..' 'pre-layer-import.ps1'

function Invoke-Hook {
    param(
        [string]$ToolName,
        [string]$FilePath,
        [string]$Content,
        [string]$ToolAction = "new_str"
    )
    $key = if ($ToolAction -eq "file_text") { "file_text" } else { "new_str" }
    $argsJson = @{ path = $FilePath; $key = $Content } | ConvertTo-Json -Compress
    $inputJson = @{ toolName = $ToolName; toolArgs = ($argsJson) } | ConvertTo-Json -Compress
    $result = $inputJson | pwsh -NoProfile -File $hookPath 2>$null
    return $result
}

function Assert-Allowed {
    param([string]$Result, [string]$Label)
    if (-not $Result) {
        Write-Host "  PASS: $Label"
        $script:passed++
    } else {
        Write-Host "  FAIL: $Label -- got: $Result"
        $script:failures++
    }
}

function Assert-Denied {
    param([string]$Result, [string]$Label)
    if ($Result -match '"deny"') {
        Write-Host "  PASS: $Label"
        $script:passed++
    } else {
        Write-Host "  FAIL: $Label -- expected deny, got: $Result"
        $script:failures++
    }
}

# ── ALLOW cases ──────────────────────────────────────────────

Write-Host "`nALLOW cases:"

# 1. L3 imports from L2 (downward)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L3-services/foo/bar.ts" `
    -Content "import { x } from '../../L2-clients/ffmpeg/ffmpeg.js'"
Assert-Allowed $r "L3 imports from L2 (downward)"

# 2. L3 imports from L1 (downward)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L3-services/foo/bar.ts" `
    -Content "import { getConfig } from '../../L1-infra/config/environment.js'"
Assert-Allowed $r "L3 imports from L1 (downward)"

# 3. L3 imports from L0 (downward)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L3-services/foo/bar.ts" `
    -Content "import type { Transcript } from '../../L0-pure/types/index.js'"
Assert-Allowed $r "L3 imports from L0 (type-only, downward)"

# 4. import type crossing boundaries (L2 importing type from L5)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L2-clients/llm/provider.ts" `
    -Content "import type { LLMProvider } from '../../L5-assets/types.js'"
Assert-Allowed $r "import type crossing boundaries (L2->L5)"

# 5. export type re-export crossing boundaries
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L2-clients/llm/index.ts" `
    -Content "export type { LLMProvider } from '../../L5-assets/types.js'"
Assert-Allowed $r "export type re-export crossing boundaries"

# 6. Test file importing from any layer
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/__tests__/unit/L2-clients/ffmpeg.test.ts" `
    -Content "import { runStage } from '../../../L6-pipeline/runStage.js'"
Assert-Allowed $r "Test file importing from any layer"

# 7. Non-TS file (.json)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L0-pure/data/config.json" `
    -Content '{"key": "value"}'
Assert-Allowed $r "Non-TS file (.json) ignored"

# 7b. Non-TS file (.md)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L0-pure/README.md" `
    -Content "import { x } from '../../L3-services/foo.js'"
Assert-Allowed $r "Non-TS file (.md) ignored"

# 8. Non-edit tool (bash)
$r = Invoke-Hook -ToolName "bash" `
    -FilePath "src/L0-pure/utils.ts" `
    -Content "import { readFileSync } from 'node:fs'"
Assert-Allowed $r "Non-edit tool (bash) passes through"

# 9. BaseAgent.ts importing from L2-clients/llm/ (no longer exempt — L4 cannot import L2)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L4-agents/BaseAgent.ts" `
    -Content "import { CopilotProvider } from '../../L2-clients/llm/CopilotProvider.js'"
Assert-Denied $r "BaseAgent.ts importing from L2-clients/llm/ (L4 cannot import L2)"

# 10. L7 imports from L0 through L6 (all allowed)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L7-app/cli.ts" `
    -Content "import { formatTimestamp } from '../../L0-pure/formatting/time.js'"
Assert-Allowed $r "L7 imports from L0 (allowed)"

$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L7-app/cli.ts" `
    -Content "import { runStage } from '../../L6-pipeline/runStage.js'"
Assert-Allowed $r "L7 imports from L6 (allowed)"

# 10b. L7 imports from L3 (allowed under strict rules)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L7-app/cli.ts" `
    -Content "import { costTracker } from '../../L3-services/costTracking/costTracker.js'"
Assert-Allowed $r "L7 imports from L3 (allowed)"

# 10c. L6 imports from L5 (allowed under strict rules)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L6-pipeline/stages/shorts.ts" `
    -Content "import { VideoAsset } from '../../L5-assets/VideoAsset.js'"
Assert-Allowed $r "L6 imports from L5 (allowed)"

# 10d. L5 imports from L4 (allowed under strict rules)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L5-assets/loaders.ts" `
    -Content "import { SilenceAgent } from '../../L4-agents/SilenceAgent.js'"
Assert-Allowed $r "L5 imports from L4 (allowed)"

# 10e. L4 imports from L3 (allowed under strict rules)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L4-agents/ShortsAgent.ts" `
    -Content "import { extractClip } from '../../L3-services/video/clipExtractor.js'"
Assert-Allowed $r "L4 imports from L3 (allowed)"

# 11. Dynamic import downward
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L3-services/foo/bar.ts" `
    -Content "const mod = await import('./L1-infra/foo.js')"
Assert-Allowed $r "Dynamic import downward (L3->L1)"

# ── DENY cases ───────────────────────────────────────────────

Write-Host "`nDENY cases:"

# 12. L2 imports from L3 (upward)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L2-clients/ffmpeg/ffmpeg.ts" `
    -Content "import { costTracker } from '../../L3-services/costTracker.js'"
Assert-Denied $r "L2 imports from L3 (upward)"

# 13. L1 imports from L2 (upward via re-export)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L1-infra/config/paths.ts" `
    -Content "export { getFFmpegPath } from '../../L2-clients/ffmpeg/ffmpeg.js'"
Assert-Denied $r "L1 re-exports from L2 (upward)"

# 14. L0 imports Node.js builtin (node: prefix)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L0-pure/utils/helpers.ts" `
    -Content "import { readFileSync } from 'node:fs'"
Assert-Denied $r "L0 imports Node.js builtin (node:fs)"

# 15. L0 imports bare builtin
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L0-pure/utils/helpers.ts" `
    -Content "import path from 'path'"
Assert-Denied $r "L0 imports bare builtin (path)"

# 16. L5 imports from L2 directly (strict rule: L5 can only import L0, L1, L4)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L5-assets/clip/clipAsset.ts" `
    -Content "import { extractClip } from '../../L2-clients/ffmpeg/clipExtraction.js'"
Assert-Denied $r "L5 imports from L2 directly (strict rule)"

# 17. L4 imports from L2 directly (strict rule: L4 can only import L0, L1, L3)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L4-agents/ShortsAgent.ts" `
    -Content "import { detectSilence } from '../../L2-clients/ffmpeg/silenceDetection.js'"
Assert-Denied $r "L4 imports from L2 directly (strict rule)"

# 18. L5 imports from L6 (upward)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L5-assets/video/videoAsset.ts" `
    -Content "import { runStage } from '../../L6-pipeline/runStage.js'"
Assert-Denied $r "L5 imports from L6 (upward)"

# 19. Dynamic import upward (L3->L4)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L3-services/transcription/transcription.ts" `
    -Content "const m = await import('../../L4-agents/ShortsAgent.js')"
Assert-Denied $r "Dynamic import upward (L3->L4)"

# 20. L0 imports from L1 (upward)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L0-pure/formatting/time.ts" `
    -Content "import logger from '../../L1-infra/logger/configLogger.js'"
Assert-Denied $r "L0 imports from L1 (upward)"

# 21. L6 imports from L3 (strict rule: L6 can only import L0, L1, L5)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L6-pipeline/stages/shorts.ts" `
    -Content "import { costTracker } from '../../L3-services/costTracking/costTracker.js'"
Assert-Denied $r "L6 imports from L3 (strict rule)"

# 22. L6 imports from L4 (strict rule: L6 can only import L0, L1, L5)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L6-pipeline/stages/shorts.ts" `
    -Content "import { ShortsAgent } from '../../L4-agents/ShortsAgent.js'"
Assert-Denied $r "L6 imports from L4 (strict rule)"

# 23. L6 imports from L2 (strict rule: L6 can only import L0, L1, L5)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L6-pipeline/stages/shorts.ts" `
    -Content "import { runFFmpeg } from '../../L2-clients/ffmpeg/ffmpegClient.js'"
Assert-Denied $r "L6 imports from L2 (strict rule)"

# 24. L7 imports from L2 (strict rule: L7 can only import L0, L1, L3, L6)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L7-app/cli.ts" `
    -Content "import { runFFmpeg } from '../../L2-clients/ffmpeg/ffmpegClient.js'"
Assert-Denied $r "L7 imports from L2 (strict rule)"

# 25. L7 imports from L4 (strict rule: L7 can only import L0, L1, L3, L6)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L7-app/cli.ts" `
    -Content "import { ShortsAgent } from '../../L4-agents/ShortsAgent.js'"
Assert-Denied $r "L7 imports from L4 (strict rule)"

# 26. L7 imports from L5 (strict rule: L7 can only import L0, L1, L3, L6)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L7-app/cli.ts" `
    -Content "import { VideoAsset } from '../../L5-assets/VideoAsset.js'"
Assert-Denied $r "L7 imports from L5 (strict rule)"

# 27. L5 imports from L3 (strict rule: L5 can only import L0, L1, L4)
$r = Invoke-Hook -ToolName "edit" `
    -FilePath "src/L5-assets/loaders.ts" `
    -Content "import { costTracker } from '../../L3-services/costTracking/costTracker.js'"
Assert-Denied $r "L5 imports from L3 (strict rule)"

# ── Summary ──────────────────────────────────────────────────

Write-Host "`n────────────────────────────────────────"
$total = $script:passed + $script:failures
Write-Host "Results: $script:passed/$total passed, $script:failures failed"

if ($script:failures -gt 0) {
    Write-Host "FAILED" -ForegroundColor Red
    exit 1
} else {
    Write-Host "ALL PASSED" -ForegroundColor Green
    exit 0
}
