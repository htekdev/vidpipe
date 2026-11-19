# Content Metadata Specification

Directory parsing and source-identity behavior are defined by the content and migration requirements in [storageService](storageService.md). Tests reside in `src/__tests__/unit/L3-services/storageService.test.ts`.

Parsing retains source fields, original timestamps, publishing identifiers, schedule data, and original `metadata.json`. The normalized record identifies media/thumbnail filenames and MIME types, validates required assets, and recognizes legacy intentional text-only records. Source relationships prefer explicit slugs, then cross-platform source-video basenames, then recognized legacy platform suffixes; ambiguous identities are reported.
