import { BlobServiceClient, StorageSharedKeyCredential, type ContainerClient } from '@azure/storage-blob'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import logger from '../../L1-infra/logger/configLogger.js'
import { getConfig } from '../../L1-infra/config/environment.js'

function getClient(): { blobService: BlobServiceClient; container: ContainerClient } {
  const config = getConfig()
  const accountName = config.AZURE_STORAGE_ACCOUNT_NAME
  const accountKey = config.AZURE_STORAGE_ACCOUNT_KEY
  const containerName = config.AZURE_CONTAINER_NAME

  if (!accountName || !accountKey) {
    throw new Error('Azure Storage credentials not configured. Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY.')
  }

  const credential = new StorageSharedKeyCredential(accountName, accountKey)
  const blobService = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential)
  const container = blobService.getContainerClient(containerName)

  return { blobService, container }
}

export async function uploadBuffer(blobPath: string, data: Buffer, contentType?: string): Promise<string> {
  const { container } = getClient()
  const blockBlob = container.getBlockBlobClient(blobPath)

  await blockBlob.upload(data, data.length, {
    blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
  })

  logger.debug(`Uploaded blob: ${blobPath} (${data.length} bytes)`)
  return blockBlob.url
}

export async function uploadFile(blobPath: string, localFilePath: string, contentType?: string): Promise<string> {
  const { container } = getClient()
  const blockBlob = container.getBlockBlobClient(blobPath)
  const fileStat = await stat(localFilePath)

  await blockBlob.uploadStream(
    createReadStream(localFilePath),
    4 * 1024 * 1024, // 4MB buffer size
    5, // max concurrency
    {
      blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
    },
  )

  logger.debug(`Uploaded file to blob: ${blobPath} (${fileStat.size} bytes)`)
  return blockBlob.url
}

export async function downloadToBuffer(blobPath: string): Promise<Buffer> {
  const { container } = getClient()
  const blockBlob = container.getBlockBlobClient(blobPath)
  return blockBlob.downloadToBuffer()
}

export async function downloadToFile(blobPath: string, localPath: string): Promise<void> {
  const { container } = getClient()
  const blockBlob = container.getBlockBlobClient(blobPath)
  await blockBlob.downloadToFile(localPath)
  logger.debug(`Downloaded blob to file: ${blobPath} → ${localPath}`)
}

export async function downloadStream(blobPath: string): Promise<Readable> {
  const { container } = getClient()
  const blockBlob = container.getBlockBlobClient(blobPath)
  const response = await blockBlob.download(0)

  if (!response.readableStreamBody) {
    throw new Error(`Failed to get readable stream for blob: ${blobPath}`)
  }

  // Convert Node.js web stream to classic Readable
  return Readable.from(response.readableStreamBody as AsyncIterable<Uint8Array>)
}

export async function listBlobs(prefix: string): Promise<string[]> {
  const { container } = getClient()
  const blobs: string[] = []

  for await (const blob of container.listBlobsFlat({ prefix })) {
    blobs.push(blob.name)
  }

  return blobs
}

export async function deleteBlob(blobPath: string): Promise<void> {
  const { container } = getClient()
  const blockBlob = container.getBlockBlobClient(blobPath)
  await blockBlob.deleteIfExists()
  logger.debug(`Deleted blob: ${blobPath}`)
}

export async function blobExists(blobPath: string): Promise<boolean> {
  const { container } = getClient()
  const blockBlob = container.getBlockBlobClient(blobPath)
  return blockBlob.exists()
}

export function getBlobUrl(blobPath: string): string {
  const { container } = getClient()
  const blockBlob = container.getBlockBlobClient(blobPath)
  return blockBlob.url
}

export function isAzureConfigured(): boolean {
  const config = getConfig()
  return Boolean(config.AZURE_STORAGE_ACCOUNT_NAME && config.AZURE_STORAGE_ACCOUNT_KEY)
}
