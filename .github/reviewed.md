# Code Review

**Reviewed:** 2026-02-22T08:23:54-06:00
**Reviewer:** code-reviewer
**Branch:** feature/hook-first-clips

## Files Reviewed

### Modified Files
- src/L2-clients/llm/CopilotProvider.ts
- src/L4-agents/BlogAgent.ts
- src/L4-agents/MediumVideoAgent.ts
- src/L4-agents/ShortsAgent.ts
- src/L5-assets/Asset.ts
- src/L5-assets/MainVideoAsset.ts
- src/L6-pipeline/pipeline.ts
- src/L7-app/cli.ts
- src/__tests__/unit/L5-assets/Asset.test.ts
- src/__tests__/unit/L5-assets/MainVideoAsset.test.ts
- src/__tests__/unit/L6-pipeline/pipeline.test.ts
- .github/agents/review-triage.agent.md
- .github/hooks/hooks.json
- schedule.json

### New Files
- .github/hooks/post-spec-change.ps1
- .github/hooks/post-spec-change.sh
- src/L6-pipeline/regenerate.ts
- src/L7-app/commands/regenerate.ts
- specs/L4-agents/VisualEnhancement.md
- specs/L7-app/CLI.md

## Findings

### ❌ Blocking Issues

#### 1. Missing Abstract Method Implementation
**Severity:** CRITICAL — Code does not compile with `tsc --noEmit`

- **src/L5-assets/MainVideoAsset.ts**: Missing `getCompletionMarkerPath()` implementation
- **src/L5-assets/BlogAsset.ts**: Missing `getCompletionMarkerPath()` implementation
- **src/L5-assets/MediumClipAsset.ts**: Missing `getCompletionMarkerPath()` implementation
- **src/L5-assets/ShortVideoAsset.ts**: Missing `getCompletionMarkerPath()` implementation
- **src/L5-assets/SocialPostAsset.ts**: Missing `getCompletionMarkerPath()` implementation
- **src/L5-assets/SummaryAsset.ts**: Missing `getCompletionMarkerPath()` implementation

The `Asset` base class now requires all concrete classes to implement `getCompletionMarkerPath(): string`. While the **spec-driven completion marker pattern** is architecturally sound, the implementation is **incomplete**.

**Impact:**
- TypeScript compilation fails with `tsc --noEmit` (22 errors total)
- Tests pass because they use `tsup` which may not enforce strict type checking
- Runtime errors likely if completion marker methods are called on these assets

**Required fix:**
Each asset class must implement `getCompletionMarkerPath()` returning the appropriate `.complete` marker path. For example:

```typescript
// MainVideoAsset.ts
getCompletionMarkerPath(): string {
  return join(this.videoDir, 'pipeline.complete')
}

// BlogAsset.ts  
getCompletionMarkerPath(): string {
  return this.parentAsset.blogCompletionMarkerPath
}
```

#### 2. Type Errors in Tests
**Severity:** HIGH

Multiple test files have type errors that would prevent TypeScript compilation:
- `src/__tests__/unit/L5-assets/TextAsset.test.ts`: Test class missing `getCompletionMarkerPath`
- `src/__tests__/unit/L5-assets/VideoAsset.test.ts`: Test class missing `getCompletionMarkerPath`
- `src/__tests__/unit/L3-services/lateApi/lateApiService.test.ts`: Accessing private property
- `src/__tests__/unit/L4-agents/analysisServiceBridge.test.ts`: Type mismatches (5 errors)
- `src/__tests__/unit/L4-agents/pipelineServiceBridge.test.ts`: Argument count mismatches
- `src/__tests__/unit/L6-pipeline/visualEnhancement.test.ts`: Argument count mismatch

#### 3. Service Type Errors
**Severity:** HIGH

- **src/L4-agents/pipelineServiceBridge.ts:23**: Property `recordCall` does not exist on type `CostTracker`
- **src/L5-assets/MainVideoAsset.ts:803**: Condition always returns true (Promise<boolean> check issue)

### ✅ Architecture & Patterns — Excellent

1. **✅ Completion Marker Pattern**: The addition of `.complete` marker files for idempotent asset generation is a solid architectural improvement. Each asset stage (shorts, medium clips, social posts, blog) now has:
   - `isComplete()` — check if generation finished successfully
   - `markComplete()` — write marker after successful generation
   - `clearCompletion()` — remove marker for forced regeneration

2. **✅ Provider Abstraction Compliance**: CopilotProvider changes properly use the `LLMProvider` interface. No direct SDK imports outside the provider layer.

3. **✅ Error Handling Improvement**: The "missing finish_reason" SDK bug workaround in CopilotProvider, MediumVideoAgent, and ShortsAgent is well-documented and defensive:
   - Tracks `toolsCompleted` count to detect partial success
   - Only treats as success if tools actually ran
   - Re-throws error if no work was done

4. **✅ Pipeline Simplification**: The pipeline.ts refactor delegates responsibility to asset methods (`getTranscript()`, `getShorts()`, etc.) instead of orchestrating low-level logic. This is cleaner and more testable.

5. **✅ Regenerate Command**: New `vidpipe regenerate <stage>` CLI command enables re-running failed pipeline stages without full re-processing. Uses the same asset.get*({ force: true }) pattern as the pipeline.

### ⚠️ Code Quality Issues (Non-Blocking)

#### 1. Incomplete Spec Coverage
**Location:** `specs/` directory

New spec files added (`specs/L4-agents/VisualEnhancement.md`, `specs/L7-app/CLI.md`) but no corresponding test files detected. The pre-push hook `pre-spec-test-coverage.ps1` should enforce this.

**Recommendation:** Verify hook is running, or add test files:
- `specs/__tests__/L4-agents/VisualEnhancement.test.ts`
- `specs/__tests__/L7-app/CLI.test.ts`

#### 2. BlogAgent Return Type Change
**Location:** src/L4-agents/BlogAgent.ts:330

Changed from returning file path (`string`) to returning markdown content (`string`). While the return type is the same, this is a **semantic breaking change**:

```typescript
// Before: returned path
return outputPath  // "/path/to/devto.md"

// After: returns content
return renderBlogMarkdown(blogContent)  // "# Blog Title\n..."
```

**Impact:** Any code expecting a file path will break. The pipeline test mocks still expect paths.

**Recommendation:** Update the return type to be more explicit (e.g., `BlogContent` type) or update all callers to handle content instead of paths.

#### 3. Schedule.json Changes
**Location:** schedule.json

Substantial changes to posting schedule (time slots, labels). This appears to be configuration tuning rather than code change, but should be verified as intentional.

### ✅ Testing

- All 1442 tests pass (vitest run)
- Test coverage appears maintained
- Pipeline test mocks updated to match new asset-oriented architecture
- Asset.test.ts updated with completion marker assertions

### ✅ Documentation

- Completion marker pattern well-documented in Asset.ts JSDoc
- Hook comments clear in post-spec-change.ps1/sh
- Pipeline comments updated to reflect asset delegation pattern

## Summary

**BLOCKING:** This code **cannot be merged** until the missing `getCompletionMarkerPath()` implementations are added to all asset classes. TypeScript compilation fails with 22 type errors.

**Architecture:** The completion marker pattern and asset-oriented refactor are excellent improvements. The SDK bug workaround is pragmatic and well-documented.

**Next Steps:**
1. Implement `getCompletionMarkerPath()` in all asset classes
2. Fix test type errors (mock/stub updates needed)
3. Fix `recordCall` type error in pipelineServiceBridge.ts
4. Verify BlogAgent semantic change doesn't break pipeline
5. Re-run `npx tsc --noEmit` to confirm all type errors resolved
