import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getConfig } from '../../L1-infra/config/environment.js'
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, Upload } from '../../L1-infra/aws/awsSdk.js'

function client(): S3Client {
  return new S3Client({ region: getConfig().AWS_REGION })
}

function location(key: string): { Bucket: string; Key: string } {
  const config = getConfig()
  if (!config.AWS_REGION || !config.AWS_S3_BUCKET) throw new Error('AWS storage requires AWS_REGION and AWS_S3_BUCKET.')
  const prefix = config.AWS_S3_PREFIX.replace(/^\/+|\/+$/g, '')
  return { Bucket: config.AWS_S3_BUCKET, Key: [prefix, key.replace(/^\/+/, '')].filter(Boolean).join('/') }
}

/** Upload a stream via native multipart upload, aborting incomplete parts on failure. */
export async function uploadBody(key: string, body: Readable, contentType?: string): Promise<string> {
  let upload: Upload | undefined
  try {
    const target = location(key)
    upload = new Upload({
      client: client(), params: { ...target, Body: body, ContentType: contentType },
      queueSize: 4, partSize: 8 * 1024 * 1024, leavePartsOnError: false,
    })
    await upload.done()
    return `s3://${target.Bucket}/${target.Key}`
  } catch (error) {
    await upload?.abort().catch(() => {})
    throw error
  } finally {
    body.destroy()
  }
}

/** Stream a local file without buffering the recording. */
export async function uploadFile(key: string, path: string, contentType?: string): Promise<string> {
  return uploadBody(key, createReadStream(path), contentType)
}

/** Upload a small text or metadata object. */
export async function uploadBuffer(key: string, body: Buffer, contentType?: string): Promise<string> {
  const target = location(key)
  await client().send(new PutObjectCommand({ ...target, Body: body, ContentType: contentType }))
  return `s3://${target.Bucket}/${target.Key}`
}

/** Return the original Node stream so caller cancellation destroys the HTTP body. */
export async function getMediaStream(key: string, range?: string): Promise<{
  stream: Readable; contentType: string; contentLength?: number; contentRange?: string; statusCode: number; acceptRanges: string
}> {
  if (range && (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range)
    || (() => { const match = /^bytes=(\d+)-(\d+)$/.exec(range); return !!match && Number(match[1]) > Number(match[2]) })())) {
    throw Object.assign(new Error('Invalid byte range'), { statusCode: 416 })
  }
  const result = await client().send(new GetObjectCommand({ ...location(key), Range: range })).catch((error: unknown) => {
    if (error instanceof Error && '$metadata' in error
      && (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 416) {
      Object.assign(error, { statusCode: 416 })
    }
    throw error
  })
  if (!(result.Body instanceof Readable)) throw new Error(`S3 returned no readable body: ${key}`)
  return {
    stream: result.Body, contentType: result.ContentType ?? 'application/octet-stream',
    contentLength: result.ContentLength, contentRange: result.ContentRange,
    statusCode: result.$metadata.httpStatusCode ?? (result.ContentRange ? 206 : 200), acceptRanges: 'bytes',
  }
}

/** Download an object as a stream. */
export async function downloadStream(key: string): Promise<Readable> {
  return (await getMediaStream(key)).stream
}

/** Buffer small objects such as post markdown. */
export async function downloadToBuffer(key: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of await downloadStream(key)) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** Stream an object to disk. */
export async function downloadToFile(key: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await pipeline(await downloadStream(key), createWriteStream(path))
}

/** Delete an explicitly owned upload-attempt object. */
export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand(location(key)))
}
