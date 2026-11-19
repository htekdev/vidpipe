# DynamoDB Client Specification

DynamoDB transport behavior is specified in [awsClients](awsClients.md), covering strong base-table reads, eventual index reads, complete pagination, conditional creation and mutation, atomic existing-record counters, and conservative metadata-size validation. Tests reside in `src/__tests__/unit/L2-clients/awsClients.test.ts`.

Conditional create conflicts return `false`; unrelated failures propagate. Query and scan pagination terminates only after the continuation key is absent or empty.
