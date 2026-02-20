import { OpenAI as _OpenAI } from '../../L1-infra/ai/openai.js'
import { Anthropic as _Anthropic } from '../../L1-infra/ai/anthropic.js'
import { CopilotClient as _CopilotClient, CopilotSession as _CopilotSession } from '../../L1-infra/ai/copilot.js'

export type { OpenAI } from '../../L1-infra/ai/openai.js'
export type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletion } from '../../L1-infra/ai/openai.js'
export type { Anthropic } from '../../L1-infra/ai/anthropic.js'
export type { CopilotClient, CopilotSession } from '../../L1-infra/ai/copilot.js'
export type { SessionEvent } from '../../L1-infra/ai/copilot.js'

export function createOpenAI(...args: ConstructorParameters<typeof _OpenAI>): InstanceType<typeof _OpenAI> {
  return new _OpenAI(...args)
}

export function createAnthropic(...args: ConstructorParameters<typeof _Anthropic>): InstanceType<typeof _Anthropic> {
  return new _Anthropic(...args)
}

export function createCopilotClient(...args: ConstructorParameters<typeof _CopilotClient>): InstanceType<typeof _CopilotClient> {
  return new _CopilotClient(...args)
}

export function createCopilotSession(...args: ConstructorParameters<typeof _CopilotSession>): InstanceType<typeof _CopilotSession> {
  return new _CopilotSession(...args)
}
