# modelConfig Specification

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Built-in pipeline agents using Copilot must default to GPT-6.1 Sol (`gpt-6.1-sol`) instead of retired `claude-opus-4.5`. | P0 |
| REQ-002 | Without an explicit override, built-in agents using direct Claude or OpenAI providers must leave the session model unset so the provider uses its own default. Standalone resolution uses the configured provider. | P0 |
| REQ-003 | Agent model resolution must use the actual provider, including an injected provider that differs from global configuration. | P0 |
| REQ-004 | Explicit constructor/session models and per-agent overrides must be preserved unchanged. Per-agent overrides take precedence over mapped defaults; global LLM_MODEL remains the fallback when no provider-specific agent mapping applies. | P0 |
