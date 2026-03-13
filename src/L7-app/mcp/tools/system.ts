import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getConfig } from '../../../L1-infra/config/environment.js'
import { fileExistsSync, readTextFileSync } from '../../../L1-infra/fileSystem/fileSystem.js'
import { spawnCommand } from '../../../L1-infra/process/process.js'
import { join, projectRoot } from '../../../L1-infra/paths/paths.js'
import { loadScheduleConfig } from '../../../L3-services/scheduler/scheduleConfig.js'
import { normalizeProviderName } from '../../commands/doctor.js'
import type { ProviderName } from '../../../L3-services/llm/index.js'

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function checkBinary(command: string, args: string[]): { ok: boolean; version?: string } {
  try {
    const result = spawnCommand(command, args, { timeout: 10_000 })
    if (result.status === 0 && result.stdout) {
      const match = result.stdout.match(/(\d+\.\d+(?:\.\d+)?)/)
      return { ok: true, version: match ? match[1] : 'unknown' }
    }
  } catch { /* spawn failed */ }
  return { ok: false }
}

export function registerSystemTools(server: McpServer): void {
  server.tool(
    'get_config',
    'Get the current VidPipe configuration — output directory, watch folder, active provider, feature flags.',
    {},
    async () => {
      const config = getConfig()
      const pkg = JSON.parse(readTextFileSync(join(projectRoot(), 'package.json')))

      return textResult({
        version: pkg.version,
        outputDir: config.OUTPUT_DIR,
        watchFolder: config.WATCH_FOLDER,
        llmProvider: normalizeProviderName(config.LLM_PROVIDER),
        llmModel: config.LLM_MODEL || 'default',
        featureFlags: {
          git: !config.SKIP_GIT,
          silenceRemoval: !config.SKIP_SILENCE_REMOVAL,
          shorts: !config.SKIP_SHORTS,
          mediumClips: !config.SKIP_MEDIUM_CLIPS,
          social: !config.SKIP_SOCIAL,
          captions: !config.SKIP_CAPTIONS,
          visualEnhancement: !config.SKIP_VISUAL_ENHANCEMENT,
          socialPublish: !config.SKIP_SOCIAL_PUBLISH,
        },
        hasApiKeys: {
          openai: !!config.OPENAI_API_KEY,
          exa: !!config.EXA_API_KEY,
          anthropic: !!config.ANTHROPIC_API_KEY,
          lateApi: !!config.LATE_API_KEY,
        },
      })
    },
  )

  server.tool(
    'doctor',
    'Run diagnostics — check FFmpeg, API keys, Node.js version, schedule config, and other prerequisites.',
    {},
    async () => {
      const config = getConfig()
      const checks: Array<{ label: string; ok: boolean; required: boolean; message: string }> = []

      // Node.js
      const major = parseInt(process.version.slice(1), 10)
      checks.push({
        label: 'Node.js',
        ok: major >= 20,
        required: true,
        message: `Node.js ${process.version} (required: ≥20)`,
      })

      // FFmpeg
      const ffmpeg = checkBinary('ffmpeg', ['-version'])
      checks.push({
        label: 'FFmpeg',
        ok: ffmpeg.ok,
        required: true,
        message: ffmpeg.ok ? `FFmpeg ${ffmpeg.version}` : 'FFmpeg not found',
      })

      // FFprobe
      const ffprobe = checkBinary('ffprobe', ['-version'])
      checks.push({
        label: 'FFprobe',
        ok: ffprobe.ok,
        required: true,
        message: ffprobe.ok ? `FFprobe ${ffprobe.version}` : 'FFprobe not found',
      })

      // API keys
      checks.push({
        label: 'OPENAI_API_KEY',
        ok: !!config.OPENAI_API_KEY,
        required: true,
        message: config.OPENAI_API_KEY ? 'Set' : 'Not set',
      })

      checks.push({
        label: 'EXA_API_KEY',
        ok: !!config.EXA_API_KEY,
        required: false,
        message: config.EXA_API_KEY ? 'Set' : 'Not set (optional)',
      })

      // Git
      const git = checkBinary('git', ['--version'])
      checks.push({
        label: 'Git',
        ok: git.ok,
        required: false,
        message: git.ok ? `Git ${git.version}` : 'Not found (optional)',
      })

      // LLM Provider
      const providerName = normalizeProviderName(config.LLM_PROVIDER) as ProviderName
      const validProviders: ProviderName[] = ['copilot', 'openai', 'claude']
      checks.push({
        label: 'LLM Provider',
        ok: validProviders.includes(providerName),
        required: true,
        message: `Provider: ${providerName}`,
      })

      // Schedule config
      const schedulePath = join(process.cwd(), 'schedule.json')
      let scheduleOk = false
      let scheduleMsg = 'schedule.json not found'
      if (fileExistsSync(schedulePath)) {
        try {
          const sc = await loadScheduleConfig(schedulePath)
          const platformCount = Object.keys(sc.platforms).length
          scheduleOk = true
          scheduleMsg = `schedule.json: ${platformCount} platform(s) configured`
        } catch (err) {
          scheduleMsg = `schedule.json invalid: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      checks.push({
        label: 'Schedule Config',
        ok: scheduleOk,
        required: false,
        message: scheduleMsg,
      })

      const failedRequired = checks.filter(c => c.required && !c.ok)

      return textResult({
        allPassed: failedRequired.length === 0,
        failedRequired: failedRequired.length,
        checks,
      })
    },
  )
}
