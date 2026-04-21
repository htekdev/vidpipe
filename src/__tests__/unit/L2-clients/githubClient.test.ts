import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIssuesCreate = vi.hoisted(() => vi.fn())
const mockIssuesUpdate = vi.hoisted(() => vi.fn())
const mockIssuesGet = vi.hoisted(() => vi.fn())
const mockIssuesListForRepo = vi.hoisted(() => vi.fn())
const mockIssuesAddLabels = vi.hoisted(() => vi.fn())
const mockIssuesRemoveLabel = vi.hoisted(() => vi.fn())
const mockIssuesSetLabels = vi.hoisted(() => vi.fn())
const mockIssuesCreateComment = vi.hoisted(() => vi.fn())
const mockIssuesListComments = vi.hoisted(() => vi.fn())
const mockSearchIssues = vi.hoisted(() => vi.fn())
const mockPaginate = vi.hoisted(() => vi.fn())
const mockOctokitInit = vi.hoisted(() => vi.fn())
const mockOctokitInstance = vi.hoisted(() => ({
  rest: {
    issues: {
      create: mockIssuesCreate,
      update: mockIssuesUpdate,
      get: mockIssuesGet,
      listForRepo: mockIssuesListForRepo,
      addLabels: mockIssuesAddLabels,
      removeLabel: mockIssuesRemoveLabel,
      setLabels: mockIssuesSetLabels,
      createComment: mockIssuesCreateComment,
      listComments: mockIssuesListComments,
    },
    search: {
      issuesAndPullRequests: mockSearchIssues,
    },
  },
  paginate: mockPaginate,
}))

vi.mock('octokit', () => ({
  Octokit: class {
    constructor(options: unknown) {
      mockOctokitInit(options)
      return mockOctokitInstance
    }
  },
}))

import { initConfig } from '../../../L1-infra/config/environment.js'
import logger from '../../../L1-infra/logger/configLogger.js'
import {
  getGitHubClient,
  GitHubClient,
  resetGitHubClient,
} from '../../../L2-clients/github/githubClient.js'

function makeIssue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    number: 42,
    title: 'Issue title',
    body: 'Issue body',
    state: 'open',
    labels: [{ name: 'triage' }],
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    html_url: 'https://github.com/example/repo/issues/42',
    ...overrides,
  }
}

function makeComment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 99,
    body: 'Looks good',
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    user: { login: 'octocat' },
    ...overrides,
  }
}

describe('GitHubClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGitHubClient()
    initConfig({ githubToken: 'config-token', ideasRepo: 'config-owner/config-repo' })
  })

  describe('githubClient.REQ-001 - constructor resolves auth and validates repo configuration', () => {
    it('uses explicit constructor args when provided', () => {
      const client = new GitHubClient('direct-token', 'owner/repo')

      expect(client).toBeInstanceOf(GitHubClient)
      expect(mockOctokitInit).toHaveBeenCalledWith({ auth: 'direct-token' })
    })

    it('throws when no token is available', () => {
      const savedToken = process.env.GITHUB_TOKEN
      delete process.env.GITHUB_TOKEN
      try {
        initConfig({ githubToken: '', ideasRepo: 'owner/repo' })

        expect(() => new GitHubClient('', 'owner/repo')).toThrow(
          'GITHUB_TOKEN is required for GitHub API access',
        )
      } finally {
        if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken
      }
    })

    it('throws when repo format is invalid', () => {
      expect(() => new GitHubClient('token', 'invalid-repo')).toThrow(/owner\/repo/)
    })
  })

  describe('githubClient.REQ-002 - createIssue creates normalized issues', () => {
    it('githubClient.REQ-002 - creates an issue and maps the response', async () => {
      mockIssuesCreate.mockResolvedValueOnce({ data: makeIssue() })
      const client = new GitHubClient('token', 'owner/repo')

      const issue = await client.createIssue({
        title: 'New issue',
        body: 'Details',
        labels: ['triage'],
      })

      expect(mockIssuesCreate).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        title: 'New issue',
        body: 'Details',
        labels: ['triage'],
      })
      expect(issue).toEqual({
        number: 42,
        title: 'Issue title',
        body: 'Issue body',
        state: 'open',
        labels: ['triage'],
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-03-02T00:00:00Z',
        html_url: 'https://github.com/example/repo/issues/42',
      })
      expect(logger.debug).toHaveBeenCalledWith(
        '[GitHubClient] Creating issue in owner/repo: New issue',
      )
      expect(logger.info).toHaveBeenCalledWith('[GitHubClient] Created issue #42: New issue')
    })

    it('githubClient.REQ-002 - normalizes optional labels before creating the issue', async () => {
      mockIssuesCreate.mockResolvedValueOnce({ data: makeIssue() })
      const client = new GitHubClient('token', 'owner/repo')

      await client.createIssue({
        title: 'New issue',
        body: 'Details',
        labels: [' triage ', '', 'triage', 'bug '],
      })

      expect(mockIssuesCreate).toHaveBeenCalledWith(expect.objectContaining({
        labels: ['triage', 'bug'],
      }))
    })
  })

  describe('githubClient.REQ-003 - updateIssue forwards partial updates and normalizes labels', () => {
    it('githubClient.REQ-003 - updates an issue with partial fields and normalized labels', async () => {
      mockIssuesUpdate.mockResolvedValueOnce({
        data: makeIssue({
          title: 'Updated issue',
          body: 'Updated body',
          state: 'closed',
          labels: [{ name: 'bug' }],
        }),
      })
      const client = new GitHubClient('token', 'owner/repo')

      const issue = await client.updateIssue(42, {
        title: 'Updated issue',
        body: 'Updated body',
        state: 'closed',
        labels: [' bug ', '', 'bug', 'triage '],
      })

      expect(mockIssuesUpdate).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        title: 'Updated issue',
        body: 'Updated body',
        state: 'closed',
        labels: ['bug', 'triage'],
      })
      expect(issue).toMatchObject({
        number: 42,
        title: 'Updated issue',
        body: 'Updated body',
        state: 'closed',
        labels: ['bug'],
      })
    })
  })

  describe('githubClient.REQ-012 - public operations log and wrap API failures', () => {
    it('githubClient.REQ-012 - updateIssue wraps API errors with descriptive messages and preserves status', async () => {
      mockIssuesUpdate.mockRejectedValueOnce({ status: 500, message: 'boom' })
      const client = new GitHubClient('token', 'owner/repo')

      await expect(client.updateIssue(42, { state: 'closed' })).rejects.toMatchObject({
        name: 'GitHubClientError',
        status: 500,
        message: 'Failed to update GitHub issue #42: boom',
      })
      expect(logger.error).toHaveBeenCalledWith(
        '[GitHubClient] Failed to update issue #42 in owner/repo: boom',
      )
    })
  })

  describe('githubClient.REQ-004 - getIssue fetches and normalizes issue fields', () => {
    it('githubClient.REQ-004 - fetches an issue by number', async () => {
      mockIssuesGet.mockResolvedValueOnce({ data: makeIssue({ number: 7 }) })
      const client = new GitHubClient('token', 'owner/repo')

      const issue = await client.getIssue(7)

      expect(mockIssuesGet).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', issue_number: 7 })
      expect(issue.number).toBe(7)
    })

    it('githubClient.REQ-004 - maps nullable bodies and trimmed non-empty labels', async () => {
      mockIssuesGet.mockResolvedValueOnce({
        data: makeIssue({
          body: null,
          labels: [' bug ', { name: 'needs-review ' }, { name: '' }, { name: null }],
        }),
      })
      const client = new GitHubClient('token', 'owner/repo')

      const issue = await client.getIssue(42)

      expect(issue.body).toBe('')
      expect(issue.labels).toEqual(['bug', 'needs-review'])
    })
  })

  describe('githubClient.REQ-005 - listIssues paginates, filters pull requests, and honors maxResults', () => {
    it('githubClient.REQ-005 - uses default paging and filters out pull requests', async () => {
      mockIssuesListForRepo.mockResolvedValueOnce({
        data: [makeIssue({ number: 1 }), makeIssue({ number: 2, pull_request: { url: 'pr' } })],
      })
      const client = new GitHubClient('token', 'owner/repo')

      const issues = await client.listIssues()

      expect(mockIssuesListForRepo).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        state: 'all',
        labels: undefined,
        sort: undefined,
        direction: undefined,
        per_page: 100,
        page: undefined,
      })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.number).toBe(1)
    })

    it('githubClient.REQ-005 - normalizes label filters, paginates in batches of 100, and honors maxResults', async () => {
      const firstPage = Array.from({ length: 100 }, (_, index) => makeIssue({ number: index + 1 }))
      const secondPage = [makeIssue({ number: 101 }), makeIssue({ number: 102 })]
      mockIssuesListForRepo
        .mockResolvedValueOnce({ data: firstPage })
        .mockResolvedValueOnce({ data: secondPage })
      const client = new GitHubClient('token', 'owner/repo')

      const issues = await client.listIssues({ labels: [' bug ', '', 'bug'], maxResults: 101 })

      expect(mockIssuesListForRepo).toHaveBeenNthCalledWith(1, {
        owner: 'owner',
        repo: 'repo',
        state: 'all',
        labels: 'bug',
        sort: undefined,
        direction: undefined,
        per_page: 100,
        page: undefined,
      })
      expect(mockIssuesListForRepo).toHaveBeenNthCalledWith(2, {
        owner: 'owner',
        repo: 'repo',
        state: 'all',
        labels: 'bug',
        sort: undefined,
        direction: undefined,
        per_page: 100,
        page: 2,
      })
      expect(issues.map((issue) => issue.number)).toEqual(Array.from({ length: 101 }, (_, index) => index + 1))
    })

    it('githubClient.REQ-005 - passes state option to GitHub API', async () => {
      mockIssuesListForRepo.mockResolvedValueOnce({ data: [makeIssue({ number: 1 })] })
      const client = new GitHubClient('token', 'owner/repo')

      await client.listIssues({ state: 'closed' })

      expect(mockIssuesListForRepo).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'closed' }),
      )
    })
  })

  describe('githubClient.REQ-006 - searchIssues scopes queries, paginates, filters PRs, and honors maxResults', () => {
    it('githubClient.REQ-006 - prefixes the repo and issue qualifiers', async () => {
      mockPaginate.mockResolvedValueOnce([
        makeIssue({ number: 3, labels: ['bug', { name: 'needs-review' }] }),
      ])
      const client = new GitHubClient('token', 'owner/repo')

      const issues = await client.searchIssues('label:bug')

      expect(mockPaginate).toHaveBeenCalledWith(mockSearchIssues, {
        q: 'repo:owner/repo is:issue label:bug',
        per_page: 100,
      })
      expect(issues).toEqual([
        {
          number: 3,
          title: 'Issue title',
          body: 'Issue body',
          state: 'open',
          labels: ['bug', 'needs-review'],
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-02T00:00:00Z',
          html_url: 'https://github.com/example/repo/issues/42',
        },
      ])
    })

    it('githubClient.REQ-006 - filters pull requests and honors maxResults', async () => {
      mockPaginate.mockResolvedValueOnce([
        makeIssue({ number: 3 }),
        makeIssue({ number: 4, pull_request: { url: 'pr' } }),
        makeIssue({ number: 5 }),
      ])
      const client = new GitHubClient('token', 'owner/repo')

      const issues = await client.searchIssues('label:bug', { maxResults: 1 })

      expect(issues.map((issue) => issue.number)).toEqual([3])
    })
  })

  describe('label helpers', () => {
    it('githubClient.REQ-007 - skips addLabels when no labels are provided', async () => {
      const client = new GitHubClient('token', 'owner/repo')

      await client.addLabels(42, [])

      expect(mockIssuesAddLabels).not.toHaveBeenCalled()
    })

    it('githubClient.REQ-007 - addLabels appends provided labels to an issue', async () => {
      const client = new GitHubClient('token', 'owner/repo')

      await client.addLabels(42, ['bug', 'triage'])

      expect(mockIssuesAddLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        labels: ['bug', 'triage'],
      })
    })

    it('githubClient.REQ-008 - ignores 404 when removing a missing label', async () => {
      mockIssuesRemoveLabel.mockRejectedValueOnce({ status: 404, message: 'Not Found' })
      const client = new GitHubClient('token', 'owner/repo')

      await expect(client.removeLabel(42, 'missing')).resolves.toBeUndefined()
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('githubClient.REQ-008 - removeLabel sends a single label removal request', async () => {
      const client = new GitHubClient('token', 'owner/repo')

      await client.removeLabel(42, 'bug')

      expect(mockIssuesRemoveLabel).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        name: 'bug',
      })
    })

    it('githubClient.REQ-012 - rethrows non-404 label removal errors as GitHubClientError', async () => {
      mockIssuesRemoveLabel.mockRejectedValueOnce({ status: 500, message: 'Server Error' })
      const client = new GitHubClient('token', 'owner/repo')

      await expect(client.removeLabel(42, 'bug')).rejects.toMatchObject({
        name: 'GitHubClientError',
        status: 500,
        message: 'Failed to remove label from GitHub issue #42: Server Error',
      })
    })

    it('githubClient.REQ-009 - replaces labels with setLabels', async () => {
      const client = new GitHubClient('token', 'owner/repo')

      await client.setLabels(42, ['a', 'b'])

      expect(mockIssuesSetLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        labels: ['a', 'b'],
      })
    })
  })

  describe('comments', () => {
    it('githubClient.REQ-010 - adds a comment and maps nullable bodies to empty strings', async () => {
      mockIssuesCreateComment.mockResolvedValueOnce({ data: makeComment({ body: null }) })
      const client = new GitHubClient('token', 'owner/repo')

      const comment = await client.addComment(42, 'Thanks')

      expect(mockIssuesCreateComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'Thanks',
      })
      expect(comment.body).toBe('')
    })

    it('githubClient.REQ-011 - lists all comments via paginate', async () => {
      mockPaginate.mockResolvedValueOnce([makeComment({ id: 1 }), makeComment({ id: 2 })])
      const client = new GitHubClient('token', 'owner/repo')

      const comments = await client.listComments(42)

      expect(mockPaginate).toHaveBeenCalledWith(mockIssuesListComments, {
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        per_page: 100,
      })
      expect(comments.map((comment) => comment.id)).toEqual([1, 2])
    })

    it('githubClient.REQ-011 - listComments maps nullable comment bodies to empty strings', async () => {
      mockPaginate.mockResolvedValueOnce([makeComment({ id: 1, body: null })])
      const client = new GitHubClient('token', 'owner/repo')

      const comments = await client.listComments(42)

      expect(comments[0]?.body).toBe('')
    })
  })

  describe('githubClient.REQ-013 - singleton factory caches by repo and token', () => {
    it('githubClient.REQ-013 - reuses and resets the singleton instance', () => {
      const first = getGitHubClient()
      const second = getGitHubClient()

      expect(first).toBe(second)
      expect(mockOctokitInit).toHaveBeenCalledTimes(1)

      resetGitHubClient()
      const third = getGitHubClient()
      expect(third).not.toBe(first)
      expect(mockOctokitInit).toHaveBeenCalledTimes(2)
    })

    it('githubClient.REQ-013 - creates a new singleton when IDEAS_REPO or GITHUB_TOKEN changes', () => {
      const first = getGitHubClient()

      initConfig({ githubToken: 'other-token', ideasRepo: 'other-owner/other-repo' })
      const second = getGitHubClient()

      expect(second).not.toBe(first)
      expect(mockOctokitInit).toHaveBeenCalledTimes(2)
    })
  })
})
