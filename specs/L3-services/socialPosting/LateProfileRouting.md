# LateProfileRouting Specification

## Overview

Account mappings, queue ownership, and review identity must use the same Late publishing profile.

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Explicit `LATE_PROFILE_ID` restricts active account mappings to that profile, accepting string and populated account profile references; missing accounts never fall back to another profile. | P0 |
| REQ-002 | Account memory and file caches must match the configured profile scope; legacy unscoped caches must be discarded. | P0 |
| REQ-003 | Queues and queue ownership must use the selected profile, never another profile when the explicit profile is unavailable. | P0 |
| REQ-004 | Queue memory and file caches must match the configured profile scope and resolved owner; legacy unscoped caches must be discarded. | P0 |
| REQ-005 | Without an explicit profile, select the sole profile or unique default profile; ambiguous profiles must fail closed. | P0 |
| REQ-006 | Review initialization, profile, and account endpoints must show only the selected profile and its accounts, with caches isolated by configured profile. | P0 |
