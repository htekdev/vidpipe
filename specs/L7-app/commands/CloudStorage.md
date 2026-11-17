# CloudStorage Specification

Cloud commands and SDK operations use the configured storage provider.

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Migration accepts a source directory and dry-run mode, reports uploaded/skipped/errors, and returns a failing exit status when any item fails. | P0 |
| REQ-002 | AWS mode rejects remote processing and configuration synchronization before any upload, Azure access, or workflow dispatch. | P0 |
| REQ-003 | AWS status queries the selected content/video backend without querying Azure configuration files. | P0 |
| REQ-004 | S3 downloads require AWS mode, the configured bucket, and a key within the configured prefix; blob URLs remain Azure-specific. | P0 |
| REQ-005 | Recording uploads store the video record and upload its queue through the selected provider, propagating item failures. | P0 |
| REQ-006 | SDK configuration supports AWS provider/resource options and its migration/status methods use the selected backend without breaking existing no-argument callers. | P0 |
