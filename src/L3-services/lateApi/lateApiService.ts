/**
 * L3 service wrapper for the Late API client.
 *
 * Re-exports the L2 LateApiClient and its types so that L7 (and higher layers)
 * can access Late functionality without importing L2 directly.
 */
export { LateApiClient } from '../../L2-clients/late/lateApi.js'
export type {
  LateAccount,
  LateProfile,
  LatePost,
  LateMediaPresignResult,
  LateMediaUploadResult,
  CreatePostParams,
} from '../../L2-clients/late/lateApi.js'
