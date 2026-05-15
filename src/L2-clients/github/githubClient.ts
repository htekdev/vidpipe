import { Octokit } from 'octokit'

import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'

// ── Public types ─────────────────────────────────────────────────────────

export interface GitHubIssue {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  labels: string[]
  created_at: string
  updated_at: string
  html_url: string
}

export interface GitHubComment {
  id: number
  body: string
  created_at: string
  updated_at: string
  html_url: string
}

export interface CreateGitHubIssueInput {
  title: string
  body: string
  labels?: readonly string[]
}

export interface UpdateGitHubIssueInput {
  title?: string
  body?: string
  state?: 'open' | 'closed'
  labels?: readonly string[]
}

export interface ListGitHubIssuesOptions {
  labels?: readonly string[]
  maxResults?: number
  /** GitHub issue state filter. Default: 'all'. */
  state?: 'open' | 'closed' | 'all'
}

export interface SearchGitHubIssuesOptions {
  maxResults?: number
}

// ── Internal types ───────────────────────────────────────────────────────

interface RequestErrorLike {
  status?: number
  message?: string
}

interface CacheEntry<T> {
  data: T
  cachedAt: number
}

// GraphQL response shapes
interface GqlLabelNode { name: string }
interface GqlCommentNode { databaseId: number; body: string; createdAt: string; updatedAt: string; url: string }
interface GqlIssueNode {
  number: number
  title: string
  body: string
  state: 'OPEN' | 'CLOSED'
  labels: { nodes: GqlLabelNode[] }
  comments: { nodes: GqlCommentNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
  createdAt: string
  updatedAt: string
  url: string
}

// ── Constants ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CONCURRENT = 4
const THROTTLE_WARN_REMAINING = 200
const THROTTLE_SLOW_REMAINING = 100
const THROTTLE_CRITICAL_REMAINING = 50
const MAX_RETRIES = 3

// ── GraphQL fragments ────────────────────────────────────────────────────

const ISSUE_WITH_COMMENTS_FRAGMENT = `
  number
  title
  body
  state
  labels(first: 50) { nodes { name } }
  comments(first: 100) {
    nodes { databaseId body createdAt updatedAt url }
    pageInfo { hasNextPage endCursor }
  }
  createdAt
  updatedAt
  url
`

// ── Helpers ──────────────────────────────────────────────────────────────

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof (error as RequestErrorLike).status === 'number') {
    return (error as RequestErrorLike).status
  }
  return undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as RequestErrorLike).message === 'string') {
    return (error as RequestErrorLike).message ?? 'Unknown GitHub API error'
  }
  return String(error)
}

function normalizeLabels(labels: readonly string[]): string[] {
  return Array.from(new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class GitHubClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GitHubClientError'
  }
}

// ── Semaphore — limits concurrent API requests ───────────────────────────

class Semaphore {
  private queue: Array<() => void> = []
  private running = 0
  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => { this.running++; resolve() })
    })
  }

  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) next()
  }
}

// ── Client ───────────────────────────────────────────────────────────────

export class GitHubClient {
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly repo: string

  // Rate limiting
  private rateLimitRemaining = 5000
  private rateLimitReset = 0
  private readonly semaphore = new Semaphore(MAX_CONCURRENT)

  // Response cache — keyed by "type:identifier"
  private readonly cache = new Map<string, CacheEntry<unknown>>()

  constructor(token?: string, repoFullName?: string) {
    const config = getConfig()
    const authToken = token || config.GITHUB_TOKEN
    if (!authToken) {
      throw new Error('GITHUB_TOKEN is required for GitHub API access')
    }

    const fullName = repoFullName || config.IDEAS_REPO
    const [owner, repo] = fullName.split('/').map((part) => part.trim())
    if (!owner || !repo) {
      throw new Error(`Invalid IDEAS_REPO format: "${fullName}" — expected "owner/repo"`)
    }

    this.owner = owner
    this.repo = repo
    this.octokit = new Octokit({ auth: authToken })
  }

  // ── Cache helpers ────────────────────────────────────────────────────

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data as T
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, cachedAt: Date.now() })
  }

  private invalidateIssue(issueNumber: number): void {
    this.cache.delete(`issue:${issueNumber}`)
    this.cache.delete(`comments:${issueNumber}`)
    // Invalidate list caches (simple approach: clear all list caches)
    for (const key of this.cache.keys()) {
      if (key.startsWith('issues:') || key.startsWith('search:')) {
        this.cache.delete(key)
      }
    }
  }

  /** Clear all cached data. Useful after bulk writes. */
  clearCache(): void {
    this.cache.clear()
  }

  // ── Throttle / rate limit ────────────────────────────────────────────

  private async throttle(): Promise<void> {
    if (this.rateLimitRemaining < THROTTLE_CRITICAL_REMAINING) {
      const waitMs = Math.max(0, (this.rateLimitReset * 1000) - Date.now()) + 1000
      logger.warn(`[GitHubClient] Rate limit critical (${this.rateLimitRemaining} remaining) — waiting ${Math.round(waitMs / 1000)}s`)
      await sleep(Math.min(waitMs, 60_000))
    } else if (this.rateLimitRemaining < THROTTLE_SLOW_REMAINING) {
      await sleep(500)
    } else if (this.rateLimitRemaining < THROTTLE_WARN_REMAINING) {
      await sleep(100)
    }
  }

  private updateRateLimit(headers: Record<string, string | undefined>): void {
    const remaining = headers['x-ratelimit-remaining']
    const reset = headers['x-ratelimit-reset']
    if (remaining !== undefined) this.rateLimitRemaining = parseInt(remaining, 10) || 0
    if (reset !== undefined) this.rateLimitReset = parseInt(reset, 10) || 0
  }

  // ── GraphQL transport ────────────────────────────────────────────────

  private async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    await this.semaphore.acquire()
    try {
      await this.throttle()

      let lastError: unknown
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const response = await this.octokit.request('POST /graphql', { query, variables })
          this.updateRateLimit(response.headers as Record<string, string | undefined>)

          const body = response.data as { data?: T; errors?: Array<{ message: string; type?: string }> }
          if (body.errors?.length) {
            const rateLimited = body.errors.some((e) => e.type === 'RATE_LIMITED')
            if (rateLimited && attempt < MAX_RETRIES - 1) {
              const waitMs = Math.max(0, (this.rateLimitReset * 1000) - Date.now()) + 1000
              logger.warn(`[GitHubClient] GraphQL rate limited — retrying in ${Math.round(waitMs / 1000)}s`)
              await sleep(Math.min(waitMs, 60_000))
              continue
            }
            throw new GitHubClientError(`GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`)
          }

          if (!body.data) throw new GitHubClientError('GraphQL returned no data')
          return body.data
        } catch (error: unknown) {
          lastError = error
          if (error instanceof GitHubClientError) throw error
          const status = getErrorStatus(error)
          if (status === 403 && attempt < MAX_RETRIES - 1) {
            const backoff = Math.pow(2, attempt) * 1000
            logger.warn(`[GitHubClient] 403 — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
            await sleep(backoff)
            continue
          }
          throw error
        }
      }
      throw lastError
    } finally {
      this.semaphore.release()
    }
  }

  // ── GraphQL mappers ──────────────────────────────────────────────────

  private mapGqlIssue(node: GqlIssueNode): GitHubIssue {
    return {
      number: node.number,
      title: node.title,
      body: node.body ?? '',
      state: node.state === 'OPEN' ? 'open' : 'closed',
      labels: node.labels.nodes.map((l) => l.name).filter(Boolean),
      created_at: node.createdAt,
      updated_at: node.updatedAt,
      html_url: node.url,
    }
  }

  private mapGqlComment(node: GqlCommentNode): GitHubComment {
    return {
      id: node.databaseId,
      body: node.body ?? '',
      created_at: node.createdAt,
      updated_at: node.updatedAt,
      html_url: node.url,
    }
  }

  private mapGqlComments(node: GqlIssueNode): GitHubComment[] {
    return node.comments.nodes.map((c) => this.mapGqlComment(c))
  }

  // ── Read operations (GraphQL) ────────────────────────────────────────

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const cached = this.getCached<GitHubIssue>(`issue:${issueNumber}`)
    if (cached) return cached

    logger.debug(`[GitHubClient] Fetching issue #${issueNumber} from ${this.owner}/${this.repo}`)

    try {
      const data = await this.graphql<{ repository: { issue: GqlIssueNode | null } }>(
        `query($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            issue(number: $number) { ${ISSUE_WITH_COMMENTS_FRAGMENT} }
          }
        }`,
        { owner: this.owner, repo: this.repo, number: issueNumber },
      )

      if (!data.repository.issue) {
        throw new GitHubClientError(`Issue #${issueNumber} not found`, 404)
      }

      const issue = this.mapGqlIssue(data.repository.issue)
      const comments = this.mapGqlComments(data.repository.issue)

      this.setCache(`issue:${issueNumber}`, issue)
      this.setCache(`comments:${issueNumber}`, comments)

      return issue
    } catch (error: unknown) {
      this.logError(`get issue #${issueNumber}`, error)
      throw error instanceof GitHubClientError ? error
        : new GitHubClientError(`Failed to fetch GitHub issue #${issueNumber}: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async listIssues(options: ListGitHubIssuesOptions = {}): Promise<GitHubIssue[]> {
    const labels = options.labels && options.labels.length > 0 ? normalizeLabels(options.labels) : []
    const stateFilter = options.state ?? 'all'
    const cacheKey = `issues:${labels.sort().join(',')}:${stateFilter}`
    const cached = this.getCached<GitHubIssue[]>(cacheKey)
    if (cached) return options.maxResults ? cached.slice(0, options.maxResults) : cached

    logger.debug(`[GitHubClient] Listing issues for ${this.owner}/${this.repo}`)
    const maxResults = options.maxResults ?? Number.POSITIVE_INFINITY

    const gqlStates = stateFilter === 'all' ? '[OPEN, CLOSED]' : stateFilter === 'open' ? '[OPEN]' : '[CLOSED]'
    const labelsArg = labels.length > 0 ? `, labels: ${JSON.stringify(labels)}` : ''

    try {
      const allIssues: GitHubIssue[] = []
      let cursor: string | null = null
      let hasNext = true

      while (hasNext && allIssues.length < maxResults) {
        type ListResult = { repository: { issues: { nodes: GqlIssueNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } }
        const afterArg: string = cursor ? `, after: "${cursor}"` : ''
        const data: ListResult = await this.graphql<ListResult>(
          `query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              issues(first: 100, states: ${gqlStates}${labelsArg}${afterArg}, orderBy: {field: UPDATED_AT, direction: DESC}) {
                nodes { ${ISSUE_WITH_COMMENTS_FRAGMENT} }
                pageInfo { hasNextPage endCursor }
              }
            }
          }`,
          { owner: this.owner, repo: this.repo },
        )

        const pageData = data.repository.issues
        for (const node of pageData.nodes) {
          const issue = this.mapGqlIssue(node)
          const comments = this.mapGqlComments(node)
          allIssues.push(issue)
          // Populate per-issue cache so subsequent listComments() calls are free
          this.setCache(`issue:${issue.number}`, issue)
          this.setCache(`comments:${issue.number}`, comments)
        }

        hasNext = pageData.pageInfo.hasNextPage
        cursor = pageData.pageInfo.endCursor
      }

      const result = allIssues.slice(0, maxResults)
      this.setCache(cacheKey, result)
      return result
    } catch (error: unknown) {
      this.logError('list issues', error)
      throw new GitHubClientError(`Failed to list GitHub issues: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async searchIssues(query: string, options: SearchGitHubIssuesOptions = {}): Promise<GitHubIssue[]> {
    const searchQuery = `repo:${this.owner}/${this.repo} is:issue ${query}`.trim()
    const cacheKey = `search:${searchQuery}`
    const cached = this.getCached<GitHubIssue[]>(cacheKey)
    if (cached) return options.maxResults ? cached.slice(0, options.maxResults) : cached

    logger.debug(`[GitHubClient] Searching issues in ${this.owner}/${this.repo}: ${query}`)

    try {
      const data = await this.graphql<{ search: { nodes: Array<GqlIssueNode & { __typename: string }> } }>(
        `query($q: String!) {
          search(query: $q, type: ISSUE, first: 100) {
            nodes {
              ... on Issue { __typename ${ISSUE_WITH_COMMENTS_FRAGMENT} }
            }
          }
        }`,
        { q: searchQuery },
      )

      const issues = data.search.nodes
        .filter((n) => n.__typename === 'Issue')
        .map((node) => {
          const issue = this.mapGqlIssue(node)
          const comments = this.mapGqlComments(node)
          this.setCache(`issue:${issue.number}`, issue)
          this.setCache(`comments:${issue.number}`, comments)
          return issue
        })

      const result = issues.slice(0, options.maxResults ?? Number.POSITIVE_INFINITY)
      this.setCache(cacheKey, result)
      return result
    } catch (error: unknown) {
      this.logError('search issues', error)
      throw new GitHubClientError(`Failed to search GitHub issues: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async listComments(issueNumber: number): Promise<GitHubComment[]> {
    // Check cache first — populated by getIssue/listIssues/searchIssues
    const cached = this.getCached<GitHubComment[]>(`comments:${issueNumber}`)
    if (cached) return cached

    logger.debug(`[GitHubClient] Listing comments for issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      // Fetch via getIssue which gets both issue + comments in one call
      await this.getIssue(issueNumber)
      return this.getCached<GitHubComment[]>(`comments:${issueNumber}`) ?? []
    } catch (error: unknown) {
      this.logError(`list comments for issue #${issueNumber}`, error)
      throw error instanceof GitHubClientError ? error
        : new GitHubClientError(`Failed to list comments for GitHub issue #${issueNumber}: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  // ── Write operations (REST — infrequent, keep on separate quota) ─────

  async createIssue(input: CreateGitHubIssueInput): Promise<GitHubIssue> {
    logger.debug(`[GitHubClient] Creating issue in ${this.owner}/${this.repo}: ${input.title}`)

    try {
      const response = await this.octokit.rest.issues.create({
        owner: this.owner,
        repo: this.repo,
        title: input.title,
        body: input.body,
        labels: input.labels ? normalizeLabels(input.labels) : undefined,
      })
      const issue = this.mapRestIssue(response.data)
      logger.info(`[GitHubClient] Created issue #${issue.number}: ${input.title}`)
      return issue
    } catch (error: unknown) {
      this.logError('create issue', error)
      throw new GitHubClientError(`Failed to create GitHub issue: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async updateIssue(issueNumber: number, input: UpdateGitHubIssueInput): Promise<GitHubIssue> {
    logger.debug(`[GitHubClient] Updating issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      const response = await this.octokit.rest.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        title: input.title,
        body: input.body,
        state: input.state,
        labels: input.labels ? normalizeLabels(input.labels) : undefined,
      })
      const issue = this.mapRestIssue(response.data)
      this.invalidateIssue(issueNumber)
      return issue
    } catch (error: unknown) {
      this.logError(`update issue #${issueNumber}`, error)
      throw new GitHubClientError(`Failed to update GitHub issue #${issueNumber}: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return

    logger.debug(`[GitHubClient] Adding labels to issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      await this.octokit.rest.issues.addLabels({
        owner: this.owner, repo: this.repo, issue_number: issueNumber, labels,
      })
      this.invalidateIssue(issueNumber)
    } catch (error: unknown) {
      this.logError(`add labels to issue #${issueNumber}`, error)
      throw new GitHubClientError(`Failed to add labels to GitHub issue #${issueNumber}: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    logger.debug(`[GitHubClient] Removing label "${label}" from issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      await this.octokit.rest.issues.removeLabel({
        owner: this.owner, repo: this.repo, issue_number: issueNumber, name: label,
      })
      this.invalidateIssue(issueNumber)
    } catch (error: unknown) {
      if (getErrorStatus(error) === 404) return

      this.logError(`remove label from issue #${issueNumber}`, error)
      throw new GitHubClientError(`Failed to remove label from GitHub issue #${issueNumber}: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async setLabels(issueNumber: number, labels: string[]): Promise<void> {
    logger.debug(`[GitHubClient] Setting labels on issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      await this.octokit.rest.issues.setLabels({
        owner: this.owner, repo: this.repo, issue_number: issueNumber, labels,
      })
      this.invalidateIssue(issueNumber)
    } catch (error: unknown) {
      this.logError(`set labels on issue #${issueNumber}`, error)
      throw new GitHubClientError(`Failed to set labels on GitHub issue #${issueNumber}: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async addComment(issueNumber: number, body: string): Promise<GitHubComment> {
    logger.debug(`[GitHubClient] Adding comment to issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      const response = await this.octokit.rest.issues.createComment({
        owner: this.owner, repo: this.repo, issue_number: issueNumber, body,
      })
      this.invalidateIssue(issueNumber)
      return this.mapRestComment(response.data)
    } catch (error: unknown) {
      this.logError(`add comment to issue #${issueNumber}`, error)
      throw new GitHubClientError(`Failed to add comment to GitHub issue #${issueNumber}: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  // ── REST mappers (for write operations) ──────────────────────────────

  private mapRestIssue(data: Record<string, unknown>): GitHubIssue {
    const labels = Array.isArray(data.labels) ? data.labels : []
    return {
      number: data.number as number,
      title: data.title as string,
      body: (data.body as string) ?? '',
      state: data.state as 'open' | 'closed',
      labels: labels
        .map((l: unknown) => typeof l === 'string' ? l : (l as { name?: string })?.name ?? '')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0),
      created_at: data.created_at as string,
      updated_at: data.updated_at as string,
      html_url: data.html_url as string,
    }
  }

  private mapRestComment(data: Record<string, unknown>): GitHubComment {
    return {
      id: data.id as number,
      body: (data.body as string) ?? '',
      created_at: data.created_at as string,
      updated_at: data.updated_at as string,
      html_url: data.html_url as string,
    }
  }

  private logError(action: string, error: unknown): void {
    logger.error(`[GitHubClient] Failed to ${action} in ${this.owner}/${this.repo}: ${getErrorMessage(error)}`)
  }
}

let clientInstance: GitHubClient | null = null
let clientKey = ''

export function getGitHubClient(): GitHubClient {
  const config = getConfig()
  const nextKey = `${config.IDEAS_REPO}:${config.GITHUB_TOKEN}`

  if (!clientInstance || clientKey !== nextKey) {
    clientInstance = new GitHubClient(config.GITHUB_TOKEN, config.IDEAS_REPO)
    clientKey = nextKey
  }
  return clientInstance
}

export function resetGitHubClient(): void {
  clientInstance = null
  clientKey = ''
}
