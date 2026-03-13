import { initConfig } from '../../L1-infra/config/environment.js'
import { startMcpServer } from '../mcp/server.js'

export async function runMcp(): Promise<void> {
  initConfig()
  await startMcpServer()
}
