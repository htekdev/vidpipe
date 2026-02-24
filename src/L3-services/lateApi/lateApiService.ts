/**
 * L3 service wrapper for the Late API client.
 *
 * Wraps the L2 LateApiClient constructor so that L7 (and higher layers)
 * can access Late functionality without importing L2 directly.
 */
import { LateApiClient as _LateApiClient } from '../../L2-clients/late/lateApi.js'

export function createLateApiClient(
  ...args: ConstructorParameters<typeof _LateApiClient>
): InstanceType<typeof _LateApiClient> {
  return new _LateApiClient(...args)
}

export type { LateApiClient } from '../../L2-clients/late/lateApi.js'
export type {
  LateAccount,
  LateProfile,
  LatePost,
  LateMediaPresignResult,
  LateMediaUploadResult,
  CreatePostParams,
} from '../../L2-clients/late/lateApi.js'
