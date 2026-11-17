# SpecGovernance Specification

Restores the spec hooks registered in `.github/hooks/hooks.json` without disabling the existing git, architecture, or Hookflow gates.

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Every configured hook entrypoint must exist and allow an unrelated read-only tool event on Windows without a command error. | P0 |
| REQ-002 | Before a commit or push command, added or modified staged spec requirements must have matching `{SpecName}.REQ-XXX` references in staged test changes; otherwise return a descriptive JSON denial. Both the hook and commit gate must recognize regression tests in `src/__tests__/unit/hooks/`. | P0 |
| REQ-003 | Allow ordinary reads, edits, commands without spec changes, and staged spec changes with corresponding test references. Accept JSON-string or object arguments for applicable tools, allow FREEFORM apply_patch input, and do not parse arguments belonging to unrelated tools. | P0 |
| REQ-004 | After editing, creating, or applying a patch to a spec markdown file, emit a reminder to update tests under `src/__tests__/`; do not emit reminders for unrelated files or tools. Accept FREEFORM and JSON-wrapped patches, including moved spec files. | P1 |
| REQ-005 | Report evaluation errors as actionable JSON denials for pre-tool validation and diagnostic stderr for post-tool reminders, rather than crashing all tool entrypoints. Malformed shell arguments must still fail closed. | P1 |
