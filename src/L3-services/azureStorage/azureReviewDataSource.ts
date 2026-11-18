/** Compatibility entrypoint. Review business logic is shared across storage providers. */
export * from '../storage/reviewDataSource.js'
import * as blobClient from '../../L2-clients/azure/blobClient.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getContentType } from '../storage/contentMetadata.js'
import type { MediaStreamResult } from '../storage/reviewDataSource.js'

/** Legacy direct Azure media API, retained for consumers with reconstructed blob paths. */
export async function getMediaStream(itemId: string, filename: string): Promise<MediaStreamResult> {
  return { stream: await blobClient.downloadStream(`content/${itemId}/${filename}`), contentType: getContentType(filename) }
}

/** Legacy markdown blob retrieval; new review callers use authoritative record content. */
export async function getPostContent(itemId: string): Promise<string> {
  try { return (await blobClient.downloadToBuffer(`content/${itemId}/post.md`)).toString('utf8') }
  catch { logger.warn(`No post.md found for ${itemId}`); return '' }
}

/** Legacy direct Azure download API. */
export async function downloadMediaToFile(itemId: string, filename: string, localPath: string): Promise<void> {
  await blobClient.downloadToFile(`content/${itemId}/${filename}`, localPath)
}
