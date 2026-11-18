# AWS Clients Specification

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | DynamoDB queries and administrative scans consume every continuation page, including empty pages; base reads are strong and index reads eventual | P0 |
| REQ-002 | Conditional creates never replace existing identities; updates require an existing record and metadata exceeding a conservative 390 KiB limit is rejected | P0 |
| REQ-003 | S3 uploads stream using native multipart upload and abort failed uploads; downloads preserve byte-range response headers and reject invalid ranges | P0 |
| REQ-004 | AWS clients use the SDK default credential chain and configured namespace without Azure initialization; namespace normalization removes only leading/trailing slashes in linear time, preserving interior slashes and literal percent-encoded key text | P0 |
| REQ-005 | Returned S3 upload URLs encode each literal object-key segment, including percent signs, spaces and fragments, so one URL decode resolves the exact uploaded key | P0 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | AWS SDK packages are imported only through the L1 AWS facade | P0 |

## API References

- [Node.js default credential chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)
- [DynamoDB query pagination](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html)
- [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)
- [Conditional writes and composite keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [S3 multipart upload and abort](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [S3 GetObject range requests](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
