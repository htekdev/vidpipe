# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | ✅ Active support  |
| < 1.0   | ❌ Not supported   |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub's private vulnerability reporting](https://github.com/htekdev/vidpipe/security/advisories/new):

1. Navigate to the **Security** tab of this repository
2. Click **Report a vulnerability**
3. Provide a detailed description of the vulnerability

### What to include

- Type of vulnerability (e.g., injection, exposure of sensitive data)
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix or mitigation:** Depends on severity
  - Critical: Within 72 hours
  - High: Within 1 week
  - Medium/Low: Next release cycle

### Scope

This policy covers:
- The `vidpipe` npm package
- The VidPipe CLI tool
- GitHub Actions workflows in this repository

### API Keys & Secrets

VidPipe requires API keys (OpenAI, Anthropic) stored in `.env` files. These are:
- Excluded from version control via `.gitignore`
- Never logged or transmitted outside their intended API
- Protected by GitHub secret scanning + push protection on this repo
