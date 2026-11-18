# StorageService Specification

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Azure remains the default; AWS selection requires no Azure settings and preserves public storage signatures | P0 |
| REQ-002 | Content uploads preserve original files and metadata, support images and intentional text-only records (including legacy video-typed records with a null sourceMediaPath), skip existing identities, and expose records only after every asset succeeds | P0 |
| REQ-003 | Racing uploads isolate assets in unique attempt prefixes and clean only their owned files on failure or conditional conflict; uncertain metadata-write outcomes are strongly reconciled before cleanup so committed records never lose referenced assets | P0 |
| REQ-004 | Item lookup queries the base partition and deterministically selects the newest duplicate; filtered index results are revalidated with strong reads | P0 |
| REQ-005 | Migration processes published before pending, preserves source metadata and identities, skips duplicates/existing without resetting statuses, supports no-write dry runs including metadata-size validation, reports uploaded/skipped/eligible/invalid/failed counts and per-item errors, and never modifies local sources | P0 |
| REQ-006 | Local source relationships resolve explicit slugs, Windows/Unix source basenames, and unambiguous legacy platform suffixes; malformed or missing required media is reported | P0 |
| REQ-007 | Cloud URL downloads accept only the selected backend scheme; S3 URLs require the exact configured bucket/prefix, decode once while preserving literal percent-encoded key text, reject credentials/query/fragment/traversal, and remove the configured prefix before downloading. Prefix normalization removes only leading/trailing slashes in linear time without relaxing path or namespace validation | P0 |
| REQ-008 | Publish-queue uploads increment an existing video's content count only for newly created content, without recounting skipped records or requiring a video record for local pipeline uploads | P1 |
| REQ-009 | Azure migration serializes retained arrays and nested metadata into supported scalar Table properties while preserving the original metadata blob unchanged | P0 |
| REQ-010 | Queue upload optionally selects the original source-video slug independently of its destination-video slug for both providers; existing three-argument callers retain their behavior | P0 |
