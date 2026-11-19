# ConfigResolver Specification

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Storage defaults to azure and AWS resource strings default to empty; selecting aws does not require credentials or resources during configuration resolution. | P0 |
| REQ-002 | STORAGE_PROVIDER, AWS_REGION, AWS_S3_BUCKET, AWS_S3_PREFIX, AWS_DYNAMODB_CONTENT_TABLE and AWS_DYNAMODB_VIDEOS_TABLE resolve corresponding camelCase options using CLI > environment > global defaults > built-in defaults, preserving explicit empty CLI strings. | P0 |
| REQ-003 | A selected storage provider other than azure or aws fails with a descriptive error instead of falling back. | P0 |
| REQ-004 | AWS_PROFILE and AWS credential-chain environment variables remain untouched and are not added to VidPipe configuration. | P0 |
