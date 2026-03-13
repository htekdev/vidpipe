import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { homedir } from '../../L1-infra/paths/paths.js'
import { join } from '../../L1-infra/paths/paths.js'

/**
 * E2E tests for MCP server components.
 * No mocking — tests real module resolution and L1 infrastructure.
 */
describe('MCP Server E2E', () => {
  describe('L1 homedir integration', () => {
    it('homedir returns a real directory that exists', () => {
      const home = homedir()
      expect(existsSync(home)).toBe(true)
    })

    it('vidpipe config directory can be derived from homedir', () => {
      const configDir = join(homedir(), '.vidpipe')
      // The directory may or may not exist yet — we just verify the path is valid
      expect(configDir).toContain('.vidpipe')
    })
  })

  describe('MCP module exports', () => {
    it('server module exports startMcpServer', async () => {
      const mod = await import('../../L7-app/mcp/server.js')
      expect(typeof mod.startMcpServer).toBe('function')
    })

    it('jobs module exports CRUD functions', async () => {
      const mod = await import('../../L7-app/mcp/jobs.js')
      expect(typeof mod.createJob).toBe('function')
      expect(typeof mod.getJob).toBe('function')
      expect(typeof mod.updateJob).toBe('function')
      expect(typeof mod.listJobs).toBe('function')
      expect(typeof mod.cancelJob).toBe('function')
      expect(typeof mod.cleanupOldJobs).toBe('function')
      expect(typeof mod.heartbeat).toBe('function')
    })

    it('tool registration modules export register functions', async () => {
      const query = await import('../../L7-app/mcp/tools/query.js')
      const action = await import('../../L7-app/mcp/tools/action.js')
      const system = await import('../../L7-app/mcp/tools/system.js')
      const pipeline = await import('../../L7-app/mcp/tools/pipeline.js')

      expect(typeof query.registerQueryTools).toBe('function')
      expect(typeof action.registerActionTools).toBe('function')
      expect(typeof system.registerSystemTools).toBe('function')
      expect(typeof pipeline.registerPipelineTools).toBe('function')
    })
  })
})
