# CopilotProvider Specification

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Sessions without an explicit model must request the shared built-in agent model, GPT-6.1 Sol (`gpt-6.1-sol`), rather than rely on an implicit CLI default or request retired Opus 4.5. | P0 |
| REQ-002 | Sessions with an explicit model must pass that model unchanged to the SDK. | P0 |
