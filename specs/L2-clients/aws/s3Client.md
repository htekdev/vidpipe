# S3 Client Specification

S3 transport behavior is specified in [awsClients](awsClients.md), covering streaming multipart uploads, abort/stream cleanup, namespace selection, downloads, single byte ranges, cancellation, and preserved response headers. Tests reside in `src/__tests__/unit/L2-clients/awsClients.test.ts`.

The configured prefix is applied exactly once to backend-relative keys. Upload URLs contain the configured bucket and complete S3 key. HTTP 416 errors retain an explicit `statusCode` for the review route.
