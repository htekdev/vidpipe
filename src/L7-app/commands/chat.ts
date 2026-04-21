import { initConfig } from '../../L1-infra/config/environment.js'
import { setChatMode } from '../../L1-infra/logger/configLogger.js'
import { AltScreenChat } from '../../L1-infra/terminal/altScreenChat.js'
import { createScheduleAgent } from '../../L6-pipeline/scheduleChat.js'
import type { UserInputRequest, UserInputResponse } from '../../L3-services/llm/providerFactory.js'

export async function runChat(): Promise<void> {
  initConfig()
  setChatMode(true)

  const chat = new AltScreenChat({
    title: '💬 VidPipe Chat',
    subtitle: 'Schedule management assistant. Type exit or quit to leave.',
    inputPrompt: 'vidpipe> ',
  })

  // Wire user input handler for agent ask_user tool
  const handleUserInput = (request: UserInputRequest): Promise<UserInputResponse> => {
    chat.addMessage('agent', request.question)

    if (request.choices && request.choices.length > 0) {
      const choiceText = request.choices
        .map((c, i) => `  ${i + 1}. ${c}`)
        .join('\n')
      chat.addMessage('system', choiceText + (request.allowFreeform !== false ? '\n  (or type a custom answer)' : ''))
    }

    return new Promise((resolve) => {
      chat.promptInput('> ').then((answer) => {
        const trimmed = answer.trim()
        chat.addMessage('user', trimmed)

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

  const agent = createScheduleAgent(handleUserInput)

  agent.setChatOutput((message: string) => {
    chat.setStatus(message)
  })

  chat.enter()
  chat.addMessage('system', 'Ask me about your posting schedule, reschedule posts, check what\'s coming up, or reprioritize content.')

  try {
    while (true) {
      const input = await chat.promptInput()
      const trimmed = input.trim()
      if (!trimmed) continue
      if (trimmed === 'exit' || trimmed === 'quit') {
        chat.addMessage('system', 'Goodbye! 👋')
        break
      }

      chat.addMessage('user', trimmed)
      chat.setStatus('🤔 Thinking...')

      try {
        const response = await agent.run(trimmed)
        chat.clearStatus()
        if (response) {
          chat.addMessage('agent', response)
        }
      } catch (err) {
        chat.clearStatus()
        const message = err instanceof Error ? err.message : String(err)
        chat.addMessage('error', message)
      }
    }
  } finally {
    await agent.destroy()
    chat.destroy()
    setChatMode(false)
  }
}
