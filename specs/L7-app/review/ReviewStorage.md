# ReviewStorage Specification

The review app uses the explicitly selected cloud storage provider while preserving Azure as the default.

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Storage failures during initialization return HTTP 503 with an actionable error instead of a successful empty queue. | P0 |
| REQ-002 | Media requests forward byte ranges and the storage response's content type, length, range, and status; disconnects stop upstream streams. | P0 |
| REQ-003 | Pending/grouped queries, edits, rejection, approval, and publication storage access use the selected provider without requiring Azure credentials in AWS mode. | P0 |
| REQ-004 | The frontend presents initialization failures as an error rather than a completed or empty review queue. | P0 |
| REQ-005 | Displayed items retain their video/item identity through frontend bulk requests, scoped reads/edits/rejections/media, and approval jobs; jobs publish and update the displayed row using its raw stored item ID, never a different-status duplicate. | P0 |

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | Review routes and the approval worker access storage through L3 services, never AWS SDK clients directly. | P0 |
