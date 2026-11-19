# commitGate Specification

Source: `cicd/lib/commitGate.ts`

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | After gate checks succeed, invoke Git directly with `execFileSync('git', ['commit', ...commitArgs])` and shell execution disabled. Forward each argument unchanged, including message separators, embedded quotes, Windows file paths and trailer angle brackets; do not reconstruct or escape a shell command string. | P0 |
| REQ-002 | A dry run must not invoke the Git commit subprocess. Existing staged-change analysis and gate validation remain unchanged. | P0 |
| REQ-003 | If the Git commit subprocess fails, report its stderr (or error message) and return false without retrying through a shell. | P0 |

These requirements cover only the final commit invocation. Git's own option handling and hooks, and the gate's existing test/coverage/typecheck stages, are unchanged.
