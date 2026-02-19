/**
 * Media Upload Flow (verified via live testing 2026-02-09):
 * - Step 1: POST /media/presign { filename, contentType } → { uploadUrl, publicUrl, key, expiresIn }
 * - Step 2: PUT file bytes to uploadUrl (presigned Cloudflare R2 URL) with Content-Type header
 * - Step 3: Use publicUrl (https://media.getlate.dev/temp/...) in createPost({ mediaItems: [{ type, url }] })
 *
 * Notes:
 * - The old POST /media/upload endpoint exists but requires an "upload token" (not an API key).
 *   It is likely used internally by Late's web UI; the presign flow is the correct API approach.
 * - Presigned URLs expire in 3600s (1 hour).
 * - Public URLs are served from media.getlate.dev CDN and are immediately accessible after PUT.
 * - No confirmation step is needed after uploading to the presigned URL.
 */
import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getFileStats, openReadStream } from '../../L1-infra/fileSystem/fileSystem.js'
import { Readable } from '../../L1-infra/http/network.js'
import { basename, extname } from '../../L1-infra/paths/paths.js'
import { fetchRaw } from '../../L1-infra/http/httpClient.js'

// ── Types ──────────────────────────────────────────────────────────────

export interface LateAccount {
  _id: string
  platform: string // 'tiktok' | 'youtube' | 'instagram' | 'linkedin' | 'twitter'
  displayName: string
  username: string
  isActive: boolean
  profileId: { _id: string; name: string }
}

export interface LateProfile {
  _id: string
  name: string
}

export interface LatePost {
  _id: string
  content: string
  status: string // 'draft' | 'scheduled' | 'published' | 'failed'
  platforms: Array<{ platform: string; accountId: string }>
  scheduledFor?: string
  mediaItems?: Array<{ type: string; url: string }>
  isDraft?: boolean
  createdAt: string
  updatedAt: string
}

export interface LateMediaPresignResult {
  uploadUrl: string
  publicUrl: string
  key: string
  expiresIn: number
}

export interface LateMediaUploadResult {
  url: string
  type: 'image' | 'video'
}

export interface CreatePostParams {
  content: string
  platforms: Array<{ platform: string; accountId: string }>
  scheduledFor?: string
  timezone?: string
  isDraft?: boolean
  mediaItems?: Array<{ type: 'image' | 'video'; url: string; thumbnail?: { url: string } }>
  platformSpecificData?: Record<string, unknown>
  tiktokSettings?: {
    privacy_level: string
    allow_comment: boolean
    allow_duet?: boolean
    allow_stitch?: boolean
    content_preview_confirmed: boolean
    express_consent_given: boolean
    [key: string]: unknown
  }
}

// ── Client ─────────────────────────────────────────────────────────────

export class LateApiClient {
  private baseUrl = 'https://getlate.dev/api/v1'
  private apiKey: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? getConfig().LATE_API_KEY
    if (!this.apiKey) {
      throw new Error('LATE_API_KEY is required — set it in environment or pass to constructor')
    }
  }

  // ── Private request helper ───────────────────────────────────────────

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 3,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      ...(options.headers as Record<string, string> | undefined),
    }

    // Only set Content-Type for non-FormData bodies
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    logger.debug(`Late API ${options.method ?? 'GET'} ${endpoint}`)

    for (let attempt = 1; attempt <= retries; attempt++) {
      const response = await fetchRaw(url, { ...options, headers })

      if (response.ok) {
        // 204 No Content
        if (response.status === 204) return undefined as T
        return (await response.json()) as T
      }

      // 429 — rate limited, retry
      if (response.status === 429 && attempt < retries) {
        const retryAfter = Number(response.headers.get('Retry-After')) || 2
        logger.warn(`Late API rate limited, retrying in ${retryAfter}s (attempt ${attempt}/${retries})`)
        await new Promise((r) => setTimeout(r, retryAfter * 1000))
        continue
      }

      // 401 — bad API key
      if (response.status === 401) {
        throw new Error(
          'Late API authentication failed (401). Check that LATE_API_KEY is valid.',
        )
      }

      // Other errors
      const body = await response.text().catch(() => '<no body>')
      throw new Error(
        `Late API error ${response.status} ${options.method ?? 'GET'} ${endpoint}: ${body}`,
      )
    }

    // Should not reach here, but satisfy TS
    throw new Error(`Late API request failed after ${retries} retries`)
  }

  // ── Core methods ─────────────────────────────────────────────────────

  async listProfiles(): Promise<LateProfile[]> {
    const data = await this.request<{ profiles: LateProfile[] }>('/profiles')
    return data.profiles ?? []
  }

  async listAccounts(): Promise<LateAccount[]> {
    const data = await this.request<{ accounts: LateAccount[] }>('/accounts')
    return data.accounts ?? []
  }

  async getScheduledPosts(platform?: string): Promise<LatePost[]> {
    const params = new URLSearchParams({ status: 'scheduled' })
    if (platform) params.set('platform', platform)
    const data = await this.request<{ posts: LatePost[] }>(`/posts?${params}`)
    return data.posts ?? []
  }

  async getDraftPosts(platform?: string): Promise<LatePost[]> {
    const params = new URLSearchParams({ status: 'draft' })
    if (platform) params.set('platform', platform)
    const data = await this.request<{ posts: LatePost[] }>(`/posts?${params}`)
    return data.posts ?? []
  }

  async createPost(params: CreatePostParams): Promise<LatePost> {
    const data = await this.request<{ post: LatePost }>('/posts', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return data.post
  }

  async deletePost(postId: string): Promise<void> {
    await this.request<void>(`/posts/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
    })
  }

  async updatePost(postId: string, updates: Record<string, unknown>): Promise<LatePost> {
    const data = await this.request<{ post: LatePost }>(`/posts/${encodeURIComponent(postId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
    return data.post
  }

  async uploadMedia(filePath: string): Promise<LateMediaUploadResult> {
    const fileStats = await getFileStats(filePath)
    const fileName = basename(filePath)
    const ext = extname(fileName).toLowerCase()
    const contentType =
      ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4'

    logger.info(`Late API uploading ${String(fileName).replace(/[\r\n]/g, '')} (${(fileStats.size / 1024 / 1024).toFixed(1)} MB)`)

    // Step 1: Get presigned upload URL
    const presign = await this.request<LateMediaPresignResult>('/media/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: fileName, contentType }),
    })
    logger.debug(`Late API presigned URL obtained for ${String(fileName).replace(/[\r\n]/g, '')} (expires in ${presign.expiresIn}s)`)

    // Step 2: Stream file to presigned URL (avoids loading entire file into memory)
    const nodeStream = openReadStream(filePath)
    try {
      const webStream = Readable.toWeb(nodeStream) as ReadableStream
      const uploadResp = await fetchRaw(presign.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileStats.size),
        },
        body: webStream,
        // Node.js-specific property for streaming request bodies (not in standard RequestInit type)
        duplex: 'half',
      } as RequestInit)
      if (!uploadResp.ok) {
        throw new Error(`Late media upload failed: ${uploadResp.status} ${uploadResp.statusText}`)
      }
    } finally {
      // Ensure file handle is released so the folder can be renamed/moved on Windows
      nodeStream.destroy()
    }
    logger.debug(`Late API media uploaded → ${presign.publicUrl}`)

    const type: 'image' | 'video' = contentType.startsWith('image/') ? 'image' : 'video'
    return { url: presign.publicUrl, type }
  }

  /**
   * Fetch posts with pagination, iterating pages until all results are collected.
   * Supports filtering by status and platform.
   */
  async listPosts(options: {
    status?: string
    platform?: string
    limit?: number
  } = {}): Promise<LatePost[]> {
    const limit = options.limit ?? 100
    const allPosts: LatePost[] = []
    let page = 1

    while (true) {
      const params = new URLSearchParams()
      if (options.status) params.set('status', options.status)
      if (options.platform) params.set('platform', options.platform)
      params.set('limit', String(limit))
      params.set('page', String(page))

      const data = await this.request<{ posts?: LatePost[]; data?: LatePost[] }>(
        `/posts?${params}`,
      )
      const posts = data.posts ?? data.data ?? []
      allPosts.push(...posts)

      if (posts.length < limit) break
      page++
    }

    return allPosts
  }

  // ── Helper ───────────────────────────────────────────────────────────

  async validateConnection(): Promise<{ valid: boolean; profileName?: string; error?: string }> {
    try {
      const profiles = await this.listProfiles()
      const name = profiles[0]?.name
      logger.info(`Late API connection valid — profile: ${name ?? 'unknown'}`)
      return { valid: true, profileName: name }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`Late API connection failed: ${message}`)
      return { valid: false, error: message }
    }
  }
}
