/**
 * L3 Integration Test — gitOperations service
 *
 * Mock boundary: L1 infrastructure (process, config, logger)
 * Real code:     L3 gitOperations business logic
 *
 * Validates commitAndPush and stageFiles correctly invoke git commands
 * with the configured repo root, and handle "nothing to commit" gracefully.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const mockExecCommandSync = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/process/process.js', () => ({
  execCommandSync: mockExecCommandSync,
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ REPO_ROOT: '/test/repo' }),
}))

// Logger is auto-mocked by global setup.ts

// ── Import after mocks ───────────────────────────────────────────────

import { commitAndPush, stageFiles } from '../../../L3-services/gitOperations/gitOperations.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: gitOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecCommandSync.mockReturnValue('main')
  })

  // ── commitAndPush ─────────────────────────────────────────────────

  describe('commitAndPush', () => {
    it('runs git add, commit, branch detection, and push', async () => {
      mockExecCommandSync.mockReturnValue('main')

      await commitAndPush('my-video')

      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git add -A',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
      expect(mockExecCommandSync).toHaveBeenCalledWith(
        expect.stringContaining('git commit -m'),
        expect.objectContaining({ cwd: '/test/repo' }),
      )
      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git rev-parse --abbrev-ref HEAD',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git push origin main',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
    })

    it('uses custom commit message when provided', async () => {
      await commitAndPush('my-video', 'Custom commit message')

      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git commit -m "Custom commit message"',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
    })

    it('uses default commit message with video slug', async () => {
      await commitAndPush('my-cool-video')

      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git commit -m "Auto-processed video: my-cool-video"',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
    })

    it('handles "nothing to commit" gracefully', async () => {
      mockExecCommandSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git commit')) {
          throw new Error('nothing to commit, working tree clean')
        }
        return 'main'
      })

      // Should not throw
      await expect(commitAndPush('my-video')).resolves.toBeUndefined()
    })

    it('throws on non-"nothing to commit" git errors', async () => {
      mockExecCommandSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git commit')) {
          throw new Error('fatal: unable to access repository')
        }
        return 'main'
      })

      await expect(commitAndPush('my-video')).rejects.toThrow('fatal: unable to access repository')
    })

    it('pushes to the current branch', async () => {
      mockExecCommandSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse')) return 'feature/my-branch'
        return ''
      })

      await commitAndPush('my-video')

      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git push origin feature/my-branch',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
    })
  })

  // ── stageFiles ────────────────────────────────────────────────────

  describe('stageFiles', () => {
    it('stages each pattern individually', async () => {
      await stageFiles(['*.mp4', 'recordings/**/*', 'README.md'])

      expect(mockExecCommandSync).toHaveBeenCalledTimes(3)
      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git add *.mp4',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git add recordings/**/*',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
      expect(mockExecCommandSync).toHaveBeenCalledWith(
        'git add README.md',
        expect.objectContaining({ cwd: '/test/repo' }),
      )
    })

    it('throws when a git add fails', async () => {
      mockExecCommandSync.mockImplementation((cmd: string) => {
        if (cmd.includes('nonexistent')) {
          throw new Error('pathspec did not match any files')
        }
        return ''
      })

      await expect(stageFiles(['nonexistent/**'])).rejects.toThrow('pathspec did not match any files')
    })

    it('handles empty patterns array', async () => {
      await stageFiles([])
      expect(mockExecCommandSync).not.toHaveBeenCalled()
    })
  })
})
