import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIssuesCreate = vi.hoisted(() => vi.fn())
const mockIssuesUpdate = vi.hoisted(() => vi.fn())
const mockIssuesAddLabels = vi.hoisted(() => vi.fn())
const mockIssuesRemoveLabel = vi.hoisted(() => vi.fn())
const mockIssuesSetLabels = vi.hoisted(() => vi.fn())
const mockIssuesCreateComment = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn())
const mockOctokitInit = vi.hoisted(() => vi.fn())
const mockOctokitInstance = vi.hoisted(() => ({
  rest: {
    issues: {
      create: mockIssuesCreate,
      update: mockIssuesUpdate,
      addLabels: mockIssuesAddLabels,
      removeLabel: mockIssuesRemoveLabel,
      setLabels: mockIssuesSetLabels,
      createComment: mockIssuesCreateComment,
    },
  },
  request: mockRequest,
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

// GraphQL response helpers
function makeGqlIssueNode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    number: 42,
    title: 'Issue title',
    body: 'Issue body',
    state: 'OPEN',
    labels: { nodes: [{ name: 'triage' }] },
    comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-02T00:00:00Z',
    url: 'https://github.com/example/repo/issues/42',
    ...overrides,
  }
}

function makeGqlCommentNode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    databaseId: 99,
    body: 'Looks good',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-02T00:00:00Z',
    url: 'https://github.com/example/repo/issues/42#issuecomment-99',
    ...overrides,
  }
}

function gqlResponse(data: unknown) {
  return { data: { data }, headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '9999999999' } }
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

  describe('githubClient.REQ-004 - getIssue fetches via GraphQL and caches comments', () => {
    it('githubClient.REQ-004 - fetches an issue by number via GraphQL', async () => {
      const node = makeGqlIssueNode({ number: 7 })
      mockRequest.mockResolvedValueOnce(gqlResponse({ repository: { issue: node } }))
      const client = new GitHubClient('token', 'owner/repo')

      const issue = await client.getIssue(7)

      expect(mockRequest).toHaveBeenCalledWith('POST /graphql', expect.objectContaining({
        variables: { owner: 'owner', repo: 'repo', number: 7 },
      }))
      expect(issue.number).toBe(7)
    })

    it('githubClient.REQ-004 - maps nullable bodies and labels from GraphQL', async () => {
      const node = makeGqlIssueNode({
        body: null,
        labels: { nodes: [{ name: 'bug' }, { name: 'needs-review' }] },
      })
      mockRequest.mockResolvedValueOnce(gqlResponse({ repository: { issue: node } }))
      const client = new GitHubClient('token', 'owner/repo')

      const issue = await client.getIssue(42)

      expect(issue.body).toBe('')
      expect(issue.labels).toEqual(['bug', 'needs-review'])
    })

    it('githubClient.REQ-004 - returns cached issue on second call', async () => {
      const node = makeGqlIssueNode({ number: 10 })
      mockRequest.mockResolvedValueOnce(gqlResponse({ repository: { issue: node } }))
      const client = new GitHubClient('token', 'owner/repo')

      await client.getIssue(10)
      const second = await client.getIssue(10)

      expect(mockRequest).toHaveBeenCalledTimes(1) // only one API call
      expect(second.number).toBe(10)
    })

    it('githubClient.REQ-004 - throws 404 when issue is null', async () => {
      mockRequest.mockResolvedValueOnce(gqlResponse({ repository: { issue: null } }))
      const client = new GitHubClient('token', 'owner/repo')

      await expect(client.getIssue(999)).rejects.toMatchObject({
        name: 'GitHubClientError',
        status: 404,
      })
    })
  })

  describe('githubClient.REQ-005 - listIssues paginates via GraphQL and populates comment cache', () => {
    it('githubClient.REQ-005 - fetches issues with comments in one query', async () => {
      const comment = makeGqlCommentNode({ databaseId: 55 })
      const node = makeGqlIssueNode({
        number: 1,
        comments: { nodes: [comment], pageInfo: { hasNextPage: false, endCursor: null } },
      })
      mockRequest.mockResolvedValueOnce(gqlResponse({
        repository: { issues: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } } },
      }))
      const client = new GitHubClient('token', 'owner/repo')

      const issues = await client.listIssues()

      expect(issues).toHaveLength(1)
      expect(issues[0]?.number).toBe(1)
      // Comments should be cached — listComments should NOT trigger another API call
      const comments = await client.listComments(1)
      expect(comments).toHaveLength(1)
      expect(comments[0]?.id).toBe(55)
      expect(mockRequest).toHaveBeenCalledTimes(1) // only one API call total!
    })

    it('githubClient.REQ-005 - honors maxResults', async () => {
      const nodes = Array.from({ length: 5 }, (_, i) => makeGqlIssueNode({ number: i + 1 }))
      mockRequest.mockResolvedValueOnce(gqlResponse({
        repository: { issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } },
      }))
      const client = new GitHubClient('token', 'owner/repo')

      const issues = await client.listIssues({ maxResults: 3 })

      expect(issues).toHaveLength(3)
    })

    it('githubClient.REQ-005 - returns cached list on second call', async () => {
      mockRequest.mockResolvedValueOnce(gqlResponse({
        repository: { issues: { nodes: [makeGqlIssueNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
      }))
      const client = new GitHubClient('token', 'owner/repo')

      await client.listIssues()
      await client.listIssues()

      expect(mockRequest).toHaveBeenCalledTimes(1)
    })
  })

  describe('githubClient.REQ-006 - searchIssues uses GraphQL search and populates comment cache', () => {
    it('githubClient.REQ-006 - searches with repo scope', async () => {
      const node = { __typename: 'Issue', ...makeGqlIssueNode({ number: 3 }) }
      mockRequest.mockResolvedValueOnce(gqlResponse({ search: { nodes: [node] } }))
      const client = new GitHubClient('token', 'owner/repo')

      const issues = await client.searchIssues('label:bug')

      expect(mockRequest).toHaveBeenCalledWith('POST /graphql', expect.objectContaining({
        variables: { q: 'repo:owner/repo is:issue label:bug' },
      }))
      expect(issues).toHaveLength(1)
      expect(issues[0]?.number).toBe(3)
    })

    it('githubClient.REQ-006 - filters non-Issue types and honors maxResults', async () => {
      mockRequest.mockResolvedValueOnce(gqlResponse({
        search: { nodes: [
          { __typename: 'Issue', ...makeGqlIssueNode({ number: 3 }) },
          { __typename: 'PullRequest' },
          { __typename: 'Issue', ...makeGqlIssueNode({ number: 5 }) },
        ] },
      }))
      const client = new GitHubClient('token', 'owner/repo')

      const issues = await client.searchIssues('label:bug', { maxResults: 1 })

      expect(issues.map((i) => i.number)).toEqual([3])
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

    it('githubClient.REQ-011 - listComments returns cached comments from getIssue', async () => {
      const commentNode = makeGqlCommentNode({ databaseId: 1 })
      const issueNode = makeGqlIssueNode({
        comments: { nodes: [commentNode], pageInfo: { hasNextPage: false, endCursor: null } },
      })
      mockRequest.mockResolvedValueOnce(gqlResponse({ repository: { issue: issueNode } }))
      const client = new GitHubClient('token', 'owner/repo')

      // getIssue populates the comment cache
      await client.getIssue(42)
      const comments = await client.listComments(42)

      expect(comments).toHaveLength(1)
      expect(comments[0]?.id).toBe(1)
      expect(mockRequest).toHaveBeenCalledTimes(1) // no extra API call
    })

    it('githubClient.REQ-011 - listComments fetches via GraphQL on cache miss', async () => {
      const commentNode = makeGqlCommentNode({ databaseId: 5 })
      const issueNode = makeGqlIssueNode({
        comments: { nodes: [commentNode], pageInfo: { hasNextPage: false, endCursor: null } },
      })
      mockRequest.mockResolvedValueOnce(gqlResponse({ repository: { issue: issueNode } }))
      const client = new GitHubClient('token', 'owner/repo')

      const comments = await client.listComments(42)

      expect(comments).toHaveLength(1)
      expect(comments[0]?.id).toBe(5)
    })

    it('githubClient.REQ-011 - listComments maps nullable comment bodies to empty strings', async () => {
      const commentNode = makeGqlCommentNode({ databaseId: 1, body: null })
      const issueNode = makeGqlIssueNode({
        comments: { nodes: [commentNode], pageInfo: { hasNextPage: false, endCursor: null } },
      })
      mockRequest.mockResolvedValueOnce(gqlResponse({ repository: { issue: issueNode } }))
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
