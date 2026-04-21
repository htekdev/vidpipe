# Progress Events Specification

## Overview

Structured JSONL progress events emitted to stderr during `vidpipe process --progress`.
Enables integrating tools (e.g., VidRecord) to display real-time pipeline status without
parsing human-readable log output.

**Source files:**
- `src/L0-pure/types/index.ts` — `ProgressEvent` union, `PIPELINE_STAGES`, `getStageInfo()`
- `src/L1-infra/progress/progressEmitter.ts` — `ProgressEmitter` singleton
- `src/L6-pipeline/pipeline.ts` — emission points in `runStage()` and `processVideo()`
- `src/L7-app/cli.ts` — `--progress` CLI flag

## Behavioral Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `--progress` flag enables structured event output to stderr | P0 |
| REQ-002 | Without `--progress`, no progress events are emitted (zero overhead) | P0 |
| REQ-003 | Events are written as JSONL — one JSON object per line to stderr | P0 |
| REQ-004 | `pipeline:start` event emitted before the first stage begins | P0 |
| REQ-005 | `stage:start` event emitted before each stage executes | P0 |
| REQ-006 | `stage:complete` event emitted when a stage succeeds, with duration | P0 |
| REQ-007 | `stage:error` event emitted when a stage fails, with error message and duration | P0 |
| REQ-008 | `stage:skip` event emitted when a stage is skipped (config flag or empty data), with reason | P0 |
| REQ-009 | `pipeline:complete` event emitted after all stages (including early abort), with summary counts | P0 |
| REQ-010 | All events include an ISO 8601 `timestamp` field | P0 |
| REQ-011 | Stage events include `stageNumber`, `totalStages`, and human-readable `name` | P0 |
| REQ-012 | `totalStages` is derived from `PIPELINE_STAGES` constant, not hardcoded | P1 |
| REQ-013 | `PIPELINE_STAGES` contains exactly one entry per `PipelineStage` enum value | P0 |
| REQ-014 | Stage numbers in `PIPELINE_STAGES` match execution order in `processVideo()` | P1 |
| REQ-015 | Normal stdout log output is unaffected by `--progress` | P0 |
| REQ-016 | `pipeline:complete` counts include completed, failed, and skipped stages | P1 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | Progress event types live in L0-pure (no I/O dependencies) | P0 |
| ARCH-002 | `PIPELINE_STAGES` constant and `getStageInfo()` live in L0-pure | P0 |
| ARCH-003 | `ProgressEmitter` singleton lives in L1-infra (stderr I/O) | P0 |
| ARCH-004 | L6 pipeline imports emitter from L1; all emit calls guarded by `isEnabled()` for zero overhead | P0 |
| ARCH-005 | L7 CLI enables emitter — pipeline code does not read CLI flags | P0 |

## Event Schema

### pipeline:start
```json
{"event":"pipeline:start","videoPath":"/path/to/video.mp4","totalStages":16,"timestamp":"..."}
```

### stage:start
```json
{"event":"stage:start","stage":"ingestion","stageNumber":1,"totalStages":16,"name":"Ingestion","timestamp":"..."}
```

### stage:complete
```json
{"event":"stage:complete","stage":"ingestion","stageNumber":1,"totalStages":16,"name":"Ingestion","duration":423,"success":true,"timestamp":"..."}
```

### stage:error
```json
{"event":"stage:error","stage":"transcription","stageNumber":2,"totalStages":16,"name":"Transcription","duration":1200,"error":"Whisper timeout","timestamp":"..."}
```

### stage:skip
```json
{"event":"stage:skip","stage":"shorts","stageNumber":7,"totalStages":16,"name":"Shorts","reason":"SKIP_SHORTS","timestamp":"..."}
```

### pipeline:complete
```json
{"event":"pipeline:complete","totalDuration":45000,"stagesCompleted":14,"stagesFailed":1,"stagesSkipped":1,"timestamp":"..."}
```

## Notes

- stderr is chosen over stdout to avoid interleaving with Winston log output
- JSONL (newline-delimited JSON) allows line-by-line parsing without buffering
- Skipped stages are still counted in `totalStages` — consumers can calculate progress percentage
- Error events follow the existing pipeline contract: stage failures don't abort the pipeline
