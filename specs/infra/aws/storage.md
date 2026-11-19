# AwsStorageTemplate Specification

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Content uses itemId HASH and videoSlug RANGE, status-createdAt-index uses status HASH and statusSortKey RANGE, and videoSlug-itemId-index uses videoSlug HASH and itemId RANGE; videos uses runId HASH and status-createdAt-index uses status HASH and createdAt RANGE. All key attributes are strings and indexes project complete records. | P0 |
| REQ-002 | Persistent resources retain data on deletion and replacement; DynamoDB uses on-demand billing, encryption and point-in-time recovery; S3 blocks public access, enables encryption/versioning, requires TLS and only expires abandoned multipart uploads within the configured namespace. | P0 |
| REQ-003 | A runtime managed policy grants explicit S3 object/list/multipart operations scoped to the bucket and optional prefix, and explicit DynamoDB read/write/query/scan/describe operations scoped to the two tables and their indexes, without provisioning credentials or principal trust. | P0 |
| REQ-004 | Stack outputs map exactly to all application storage environment settings and expose a runtime policy ARN; an optional safe object prefix consistently scopes lifecycle rules, object resources and bucket listing. | P0 |
