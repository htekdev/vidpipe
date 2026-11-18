# ReviewDataSource Specification

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Shared review listing, grouping, editing, approval, rejection, and publication operate through selected storage and preserve Azure response shapes | P0 |
| REQ-002 | Media access resolves recorded attempt prefixes, only permits recorded media/thumbnail filenames, and forwards byte range stream metadata | P0 |
| REQ-003 | Edits update the recorded post path and metadata; unexpected storage failures propagate rather than appearing as an empty queue | P0 |
| REQ-004 | Review media URLs carry the complete video/item identity; scoped text, media and download lookups resolve that exact row even when a newer published duplicate exists, while unscoped backend lookup retains its newest-record contract | P0 |
