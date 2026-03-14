import { Octokit } from 'octokit'

import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'

const DEFAULT_PER_PAGE = 100

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
}

export interface SearchGitHubIssuesOptions {
  maxResults?: number
}

interface GitHubLabelResponse {
  name?: string | null
}

interface GitHubIssueResponse {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: Array<string | GitHubLabelResponse>
  created_at: string
  updated_at: string
  html_url: string
  pull_request?: unknown
}

interface GitHubCommentResponse {
  id: number
  body: string | null
  created_at: string
  updated_at: string
  html_url: string
}

interface RequestErrorLike {
  status?: number
  message?: string
}

function getErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object'
    && error !== null
    && 'status' in error
    && typeof (error as RequestErrorLike).status === 'number'
  ) {
    return (error as RequestErrorLike).status
  }

  return undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof (error as RequestErrorLike).message === 'string'
  ) {
    return (error as RequestErrorLike).message ?? 'Unknown GitHub API error'
  }

  return String(error)
}

function normalizeLabels(labels: readonly string[]): string[] {
  return Array.from(new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0)))
}

export class GitHubClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GitHubClientError'
  }
}

function isIssueResponse(value: GitHubIssueResponse): boolean {
  return !('pull_request' in value)
}

export class GitHubClient {
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly repo: string

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
      const issue = this.mapIssue(response.data as GitHubIssueResponse)
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
      return this.mapIssue(response.data as GitHubIssueResponse)
    } catch (error: unknown) {
      this.logError(`update issue #${issueNumber}`, error)
      throw new GitHubClientError(
        `Failed to update GitHub issue #${issueNumber}: ${getErrorMessage(error)}`,
        getErrorStatus(error),
      )
    }
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    logger.debug(`[GitHubClient] Fetching issue #${issueNumber} from ${this.owner}/${this.repo}`)

    try {
      const response = await this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      })
      return this.mapIssue(response.data as GitHubIssueResponse)
    } catch (error: unknown) {
      this.logError(`get issue #${issueNumber}`, error)
      throw new GitHubClientError(
        `Failed to fetch GitHub issue #${issueNumber}: ${getErrorMessage(error)}`,
        getErrorStatus(error),
      )
    }
  }

  async listIssues(options: ListGitHubIssuesOptions = {}): Promise<GitHubIssue[]> {
    logger.debug(`[GitHubClient] Listing issues for ${this.owner}/${this.repo}`)

    const issues: GitHubIssue[] = []
    let page: number | undefined
    const maxResults = options.maxResults ?? Number.POSITIVE_INFINITY

    try {
      while (issues.length < maxResults) {
        const response = await this.octokit.rest.issues.listForRepo({
          owner: this.owner,
          repo: this.repo,
          state: 'open',
          labels: options.labels && options.labels.length > 0 ? normalizeLabels(options.labels).join(',') : undefined,
          sort: undefined,
          direction: undefined,
          per_page: DEFAULT_PER_PAGE,
          page,
        })

        const pageItems = (response.data as GitHubIssueResponse[])
          .filter(isIssueResponse)
          .map((issue) => this.mapIssue(issue))
        issues.push(...pageItems)

        if (pageItems.length < DEFAULT_PER_PAGE) {
          break
        }

        page = (page ?? 1) + 1
      }

      return issues.slice(0, maxResults)
    } catch (error: unknown) {
      this.logError('list issues', error)
      throw new GitHubClientError(`Failed to list GitHub issues: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async searchIssues(query: string, options: SearchGitHubIssuesOptions = {}): Promise<GitHubIssue[]> {
    const searchQuery = `repo:${this.owner}/${this.repo} is:issue ${query}`.trim()
    logger.debug(`[GitHubClient] Searching issues in ${this.owner}/${this.repo}: ${query}`)

    try {
      const items = await this.octokit.paginate(this.octokit.rest.search.issuesAndPullRequests, {
        q: searchQuery,
        per_page: DEFAULT_PER_PAGE,
      })
      return (items as GitHubIssueResponse[])
        .filter(isIssueResponse)
        .map((issue) => this.mapIssue(issue))
        .slice(0, options.maxResults ?? Number.POSITIVE_INFINITY)
    } catch (error: unknown) {
      this.logError('search issues', error)
      throw new GitHubClientError(`Failed to search GitHub issues: ${getErrorMessage(error)}`, getErrorStatus(error))
    }
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    if (labels.length === 0) {
      return
    }

    logger.debug(`[GitHubClient] Adding labels to issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      await this.octokit.rest.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels,
      })
    } catch (error: unknown) {
      this.logError(`add labels to issue #${issueNumber}`, error)
      throw new GitHubClientError(
        `Failed to add labels to GitHub issue #${issueNumber}: ${getErrorMessage(error)}`,
        getErrorStatus(error),
      )
    }
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    logger.debug(`[GitHubClient] Removing label "${label}" from issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      await this.octokit.rest.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        name: label,
      })
    } catch (error: unknown) {
      if (getErrorStatus(error) === 404) {
        return
      }

      this.logError(`remove label from issue #${issueNumber}`, error)
      throw new GitHubClientError(
        `Failed to remove label from GitHub issue #${issueNumber}: ${getErrorMessage(error)}`,
        getErrorStatus(error),
      )
    }
  }

  async setLabels(issueNumber: number, labels: string[]): Promise<void> {
    logger.debug(`[GitHubClient] Setting labels on issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      await this.octokit.rest.issues.setLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels,
      })
    } catch (error: unknown) {
      this.logError(`set labels on issue #${issueNumber}`, error)
      throw new GitHubClientError(
        `Failed to set labels on GitHub issue #${issueNumber}: ${getErrorMessage(error)}`,
        getErrorStatus(error),
      )
    }
  }

  async addComment(issueNumber: number, body: string): Promise<GitHubComment> {
    logger.debug(`[GitHubClient] Adding comment to issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      const response = await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body,
      })
      return this.mapComment(response.data as GitHubCommentResponse)
    } catch (error: unknown) {
      this.logError(`add comment to issue #${issueNumber}`, error)
      throw new GitHubClientError(
        `Failed to add comment to GitHub issue #${issueNumber}: ${getErrorMessage(error)}`,
        getErrorStatus(error),
      )
    }
  }

  async listComments(issueNumber: number): Promise<GitHubComment[]> {
    logger.debug(`[GitHubClient] Listing comments for issue #${issueNumber} in ${this.owner}/${this.repo}`)

    try {
      const comments = await this.octokit.paginate(this.octokit.rest.issues.listComments, {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        per_page: DEFAULT_PER_PAGE,
      })
      return (comments as GitHubCommentResponse[]).map((comment) => this.mapComment(comment))
    } catch (error: unknown) {
      this.logError(`list comments for issue #${issueNumber}`, error)
      throw new GitHubClientError(
        `Failed to list comments for GitHub issue #${issueNumber}: ${getErrorMessage(error)}`,
        getErrorStatus(error),
      )
    }
  }

  private mapIssue(issue: GitHubIssueResponse): GitHubIssue {
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      state: issue.state,
      labels: issue.labels
        .map((label) => typeof label === 'string' ? label : label.name ?? '')
        .map((label) => label.trim())
        .filter((label) => label.length > 0),
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      html_url: issue.html_url,
    }
  }

  private mapComment(comment: GitHubCommentResponse): GitHubComment {
    return {
      id: comment.id,
      body: comment.body ?? '',
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      html_url: comment.html_url,
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
