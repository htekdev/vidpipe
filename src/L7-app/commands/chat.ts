import { initConfig } from '../../L1-infra/config/environment.js'
import { setChatMode } from '../../L1-infra/logger/configLogger.js'
import { createChatInterface } from '../../L1-infra/readline/readline.js'
import { loadScheduleAgent } from '../../L6-pipeline/scheduleChat.js'
import type { UserInputRequest, UserInputResponse } from '../../L3-services/llm/providerFactory.js'

export async function runChat(): Promise<void> {
  initConfig()

  const { ScheduleAgent } = await loadScheduleAgent()

  // Suppress Winston console transport so it doesn't corrupt readline
  setChatMode(true)

  const rl = createChatInterface()

  // CLI-based user input handler for ask_user tool
  const handleUserInput = (request: UserInputRequest): Promise<UserInputResponse> => {
    return new Promise((resolve) => {
      console.log()
      console.log(`\x1b[33m🤖 Agent asks:\x1b[0m ${request.question}`)

      if (request.choices && request.choices.length > 0) {
        for (let i = 0; i < request.choices.length; i++) {
          console.log(`  ${i + 1}. ${request.choices[i]}`)
        }
        if (request.allowFreeform !== false) {
          console.log(`  (or type a custom answer)`)
        }
      }

      rl.question('\x1b[33m> \x1b[0m', (answer) => {
        const trimmed = answer.trim()

        if (request.choices && request.choices.length > 0) {
          const num = parseInt(trimmed, 10)
          if (num >= 1 && num <= request.choices.length) {
            resolve({ answer: request.choices[num - 1], wasFreeform: false })
            return
          }
        }

        resolve({ answer: trimmed, wasFreeform: true })
      })
    })
  }

  const agent = new ScheduleAgent(handleUserInput)

  // Wire clean chat output for tool progress
  agent.setChatOutput((message: string) => {
    process.stderr.write(`${message}\n`)
  })

  console.log(`
\x1b[36m╔══════════════════════════════════════╗
║   VidPipe Chat                       ║
╚══════════════════════════════════════╝\x1b[0m

Schedule management assistant. Ask me about your posting schedule,
reschedule posts, check what's coming up, or reprioritize content.

Type \x1b[33mexit\x1b[0m or \x1b[33mquit\x1b[0m to leave. Press Ctrl+C to stop.
`)

  const prompt = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      rl.question('\x1b[32mvidpipe>\x1b[0m ', (answer) => {
        resolve(answer)
      })
      rl.once('close', () => reject(new Error('readline closed')))
    })
  }

  try {
    while (true) {
      let input: string
      try {
        input = await prompt()
      } catch {
        break
      }

      const trimmed = input.trim()
      if (!trimmed) continue
      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('\nGoodbye! 👋')
        break
      }

      try {
        await agent.run(trimmed)
        console.log('\n') // newline after streamed response
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`\n\x1b[31mError: ${message}\x1b[0m\n`)
      }
    }
  } finally {
    await agent.destroy()
    rl.close()
    setChatMode(false)
  }
}
