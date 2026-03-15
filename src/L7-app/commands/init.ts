import { createReadlineInterface } from '../../L1-infra/cli/cli.js'
import { writeTextFile, readTextFile, fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
import { join } from '../../L1-infra/paths/paths.js'
import { getFFmpegPath, getFFprobePath } from '../../L3-services/diagnostics/diagnostics.js'
import { createLateApiClient } from '../../L3-services/lateApi/lateApiService.js'
import { getDefaultScheduleConfig } from '../../L3-services/scheduler/scheduleConfig'

const rl = createReadlineInterface({ input: process.stdin, output: process.stdout })

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer))
  })
}

export async function runInit(): Promise<void> {
  // Gracefully handle Ctrl+C
  rl.on('close', () => {
    console.log('\n')
    process.exit(0)
  })

  console.log('\n🎬 Welcome to vidpipe setup!\n')
  console.log('💡 Tip: Use "vidpipe configure" to save credentials globally\n'
    + '   (shared across all projects). This wizard writes a local .env file.\n')

  const envPath = join(process.cwd(), '.env')
  const envVars: Record<string, string> = {}

  // Load existing .env if present
  let existingEnv = ''
  try {
    existingEnv = await readTextFile(envPath)
  } catch {
    // No existing .env
  }

  // Parse existing env values for hints
  const existingVars: Record<string, string> = {}
  for (const line of existingEnv.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match) existingVars[match[1]] = match[2]
  }

  // Step 1: FFmpeg
  console.log('Step 1/5: FFmpeg')
  try {
    const ffmpeg = getFFmpegPath()
    console.log(`  ✅ FFmpeg found at: ${ffmpeg}`)
  } catch {
    console.log('  ❌ FFmpeg not found — install from https://ffmpeg.org/')
  }
  try {
    const ffprobe = getFFprobePath()
    console.log(`  ✅ FFprobe found at: ${ffprobe}`)
  } catch {
    console.log('  ❌ FFprobe not found')
  }

  // Step 2: OpenAI
  console.log('\nStep 2/5: OpenAI (Required for transcription)')
  const currentOpenAI = existingVars.OPENAI_API_KEY || process.env.OPENAI_API_KEY
  const hint = currentOpenAI ? ` (current: ${currentOpenAI.slice(0, 8)}...)` : ''
  const openaiKey = await ask(`  ? OpenAI API key${hint}: `)
  if (openaiKey.trim()) {
    envVars.OPENAI_API_KEY = openaiKey.trim()
    console.log('  ✅ API key saved')
  } else if (currentOpenAI) {
    console.log('  ✅ Keeping current key')
  } else {
    console.log('  ⚠️  No key set — transcription will not work')
  }

  // Step 3: LLM Provider
  console.log('\nStep 3/5: LLM Provider')
  const provider = await ask('  ? Provider [copilot/openai/claude] (copilot): ')
  envVars.LLM_PROVIDER = provider.trim() || 'copilot'
  console.log(`  ✅ Using ${envVars.LLM_PROVIDER}`)

  // If claude, ask for ANTHROPIC_API_KEY
  if (envVars.LLM_PROVIDER === 'claude') {
    const claudeKey = await ask('  ? Anthropic API key: ')
    if (claudeKey.trim()) envVars.ANTHROPIC_API_KEY = claudeKey.trim()
  }

  // Step 4: Exa (optional)
  console.log('\nStep 4/5: Web Search (Optional — enriches social posts)')
  const exaKey = await ask('  ? Exa API key (press Enter to skip): ')
  if (exaKey.trim()) {
    envVars.EXA_API_KEY = exaKey.trim()
    console.log('  ✅ Exa configured')
  } else {
    console.log('  ⏭️  Skipped')
  }

  // Step 5: Late API (optional)
  console.log('\nStep 5/5: Social Publishing (Optional)')
  const setupLate = await ask('  ? Set up social media publishing? [y/N]: ')

  if (setupLate.toLowerCase() === 'y') {
    const lateKey = await ask('  ? Late API key (get one at https://getlate.dev): ')
    if (lateKey.trim()) {
      envVars.LATE_API_KEY = lateKey.trim()
      // Validate connection
      try {
        const client = createLateApiClient(lateKey.trim())
        const validation = await client.validateConnection()
        if (validation.valid) {
          console.log(`  ✅ Connected to profile "${validation.profileName}"`)
          const accounts = await client.listAccounts()
          if (accounts.length > 0) {
            console.log('  Connected accounts:')
            for (const acc of accounts) {
              console.log(`    ✅ ${acc.platform} — ${acc.username || acc.displayName}`)
            }
          }
        } else {
          console.log(`  ❌ Connection failed: ${validation.error}`)
        }
      } catch (err) {
        console.log(`  ⚠️  Could not validate key: ${err instanceof Error ? err.message : String(err)}`)
      }

      // Schedule.json
      const createSchedule = await ask('  ? Create default schedule.json? [Y/n]: ')
      if (createSchedule.toLowerCase() !== 'n') {
        const schedulePath = join(process.cwd(), 'schedule.json')
        if (await fileExists(schedulePath)) {
          console.log('  ✅ schedule.json already exists')
        } else {
          await writeTextFile(schedulePath, JSON.stringify(getDefaultScheduleConfig(), null, 2))
          console.log('  ✅ schedule.json created with optimal posting times')
        }
      }
    }
  } else {
    console.log('  ⏭️  Skipped')
  }

  // Write .env — merge new values with existing
  for (const [key, value] of Object.entries(envVars)) {
    const regex = new RegExp(`^${key}=.*$`, 'm')
    if (regex.test(existingEnv)) {
      existingEnv = existingEnv.replace(regex, `${key}=${value}`)
    } else {
      existingEnv += `\n${key}=${value}`
    }
  }
  await writeTextFile(envPath, existingEnv.trim() + '\n')

  console.log('\n✅ Setup complete! Configuration saved to .env')
  console.log('   Run `vidpipe doctor` to verify everything is working.')
  console.log('   Run `vidpipe <video.mp4>` to process your first video.\n')

  rl.close()
}
