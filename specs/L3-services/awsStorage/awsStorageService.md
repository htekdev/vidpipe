# AWS Storage Service Specification

The AWS implementation satisfies the provider-neutral requirements in [storageService](../storage/storageService.md). Tests reside in `src/__tests__/unit/L3-services/storageService.test.ts` and mock L2 only.

Content is keyed by `itemId` and `videoSlug`. Each upload uses a unique attempt prefix. Records contain compatibility `partitionKey`/`rowKey` aliases when returned to callers, and preserve original source metadata/files. Status queries use `status-createdAt-index`; video queries use `videoSlug-itemId-index`; item-ID lookup uses the strongly consistent base partition.

Failed uploads clean only owned objects. An uncertain metadata response is reconciled by a strong read before cleanup. If that read also fails, assets are retained rather than deleting files that may already be referenced by a committed record; the caller receives the original error and can safely retry.
