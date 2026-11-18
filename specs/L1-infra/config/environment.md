# Environment Specification

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Public application configuration exposes the resolved storage provider and AWS resource settings through initConfig and getConfig without requiring static AWS credentials or Azure credentials in AWS mode. | P0 |
| REQ-002 | A scoped configuration overrides getConfig only for the callback and its asynchronous descendants; overlapping and nested scopes remain isolated and restore the surrounding configuration after success or failure, without changing the process-wide fallback. | P0 |
