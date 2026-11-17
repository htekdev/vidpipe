# AWS SDK Facade Specification

The facade exports AWS SDK v3 S3, multipart-upload, DynamoDB, and document-client constructors and command types without constructing clients or reading credentials.

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | External AWS package imports are centralized here; L2 clients consume this boundary | P0 |
| ARCH-002 | SDK credential resolution is not replaced with VidPipe-managed secrets | P0 |
