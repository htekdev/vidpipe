import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readTextFileSync } from '../../L1-infra/fileSystem/fileSystem.js'
import { join, projectRoot } from '../../L1-infra/paths/paths.js'
import { registerQueryTools } from './tools/query.js'
import { registerActionTools } from './tools/action.js'
import { registerSystemTools } from './tools/system.js'
import { registerPipelineTools } from './tools/pipeline.js'
import { cleanupOldJobs } from './jobs.js'

export async function startMcpServer(): Promise<void> {
  const pkg = JSON.parse(readTextFileSync(join(projectRoot(), 'package.json')))

  const server = new McpServer({
    name: 'vidpipe',
    version: pkg.version,
  })

  registerQueryTools(server)
  registerActionTools(server)
  registerSystemTools(server)
  registerPipelineTools(server)

  // Clean up jobs older than 24 hours on startup
  await cleanupOldJobs()

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
