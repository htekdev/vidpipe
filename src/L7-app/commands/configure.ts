import { createPromptInterface, type ReadlineInterface } from '../../L1-infra/readline/readlinePromises.js'

import {
  getConfigPath,
  getGlobalConfigValue,
  loadGlobalConfig,
  maskSecret,
  resetGlobalConfig,
  saveGlobalConfig,
  setGlobalConfigValue,
} from '../../L1-infra/config/globalConfig.js'
import type { GlobalConfig, GlobalCredentials, GlobalDefaults } from '../../L1-infra/config/globalConfig.js'

type CredentialKey = keyof GlobalCredentials
type DefaultKey = keyof GlobalDefaults

type ConfigKeyTarget =
  | { readonly section: 'credentials'; readonly key: CredentialKey }
  | { readonly section: 'defaults'; readonly key: DefaultKey }

const credentialKeys = [
  'openaiApiKey',
  'anthropicApiKey',
  'exaApiKey',
  'youtubeApiKey',
  'perplexityApiKey',
  'lateApiKey',
  'githubToken',
  'geminiApiKey',
] as const satisfies readonly CredentialKey[]

const defaultKeys = [
  'llmProvider',
  'llmModel',
  'outputDir',
  'watchFolder',
  'brandPath',
  'ideasRepo',
  'lateProfileId',
  'geminiModel',
] as const satisfies readonly DefaultKey[]

const allowedProviders = ['copilot', 'openai', 'claude'] as const

export const KEY_MAP = {
  'openai-key': { section: 'credentials', key: 'openaiApiKey' },
  'anthropic-key': { section: 'credentials', key: 'anthropicApiKey' },
  'exa-key': { section: 'credentials', key: 'exaApiKey' },
  'youtube-key': { section: 'credentials', key: 'youtubeApiKey' },
  'perplexity-key': { section: 'credentials', key: 'perplexityApiKey' },
  'late-key': { section: 'credentials', key: 'lateApiKey' },
  'github-token': { section: 'credentials', key: 'githubToken' },
  'gemini-key': { section: 'credentials', key: 'geminiApiKey' },
  'llm-provider': { section: 'defaults', key: 'llmProvider' },
  'llm-model': { section: 'defaults', key: 'llmModel' },
  'output-dir': { section: 'defaults', key: 'outputDir' },
  'watch-folder': { section: 'defaults', key: 'watchFolder' },
  'brand-path': { section: 'defaults', key: 'brandPath' },
  'ideas-repo': { section: 'defaults', key: 'ideasRepo' },
  'late-profile-id': { section: 'defaults', key: 'lateProfileId' },
  'gemini-model': { section: 'defaults', key: 'geminiModel' },
} as const satisfies Record<string, ConfigKeyTarget>

function isCredentialTarget(target: ConfigKeyTarget): target is Extract<ConfigKeyTarget, { section: 'credentials' }> {
  return target.section === 'credentials'
}

function isKnownCredentialKey(key: string): key is CredentialKey {
  return credentialKeys.includes(key as CredentialKey)
}

function isKnownDefaultKey(key: string): key is DefaultKey {
  return defaultKeys.includes(key as DefaultKey)
}

function resolveKeyTarget(rawKey: string): ConfigKeyTarget | undefined {
  const mappedTarget = (KEY_MAP as Readonly<Record<string, ConfigKeyTarget>>)[rawKey]
  if (mappedTarget) {
    return mappedTarget
  }

  const [section, ...keyParts] = rawKey.split('.')
  const key = keyParts.join('.')

  if (section === 'credentials' && isKnownCredentialKey(key)) {
    return { section, key }
  }

  if (section === 'defaults' && isKnownDefaultKey(key)) {
    return { section, key }
  }

  return undefined
}

function getConfigValue(config: GlobalConfig, target: ConfigKeyTarget): string | undefined {
  if (target.section === 'credentials') {
    return config.credentials[target.key]
  }

  return config.defaults[target.key]
}

function setConfigValue(config: GlobalConfig, target: ConfigKeyTarget, value: string): void {
  if (target.section === 'credentials') {
    config.credentials[target.key] = value
    return
  }

  config.defaults[target.key] = value
}

function formatValue(value: string | undefined, target: ConfigKeyTarget): string {
  if (!value) {
    return '(not set)'
  }

  return isCredentialTarget(target) ? maskSecret(value) : value
}

function formatCurrentValue(value: string | undefined, target: ConfigKeyTarget): string {
  if (!value) {
    return 'not set'
  }

  return formatValue(value, target)
}

function printTable(rows: ReadonlyArray<{ readonly key: string; readonly value: string }>): void {
  const keyWidth = Math.max('Key'.length, ...rows.map((row) => row.key.length))
  const valueWidth = Math.max('Value'.length, ...rows.map((row) => row.value.length))

  console.log(`${'Key'.padEnd(keyWidth)}  ${'Value'.padEnd(valueWidth)}`)
  console.log(`${'-'.repeat(keyWidth)}  ${'-'.repeat(valueWidth)}`)

  for (const row of rows) {
    console.log(`${row.key.padEnd(keyWidth)}  ${row.value.padEnd(valueWidth)}`)
  }
}

function createAsk(rl: ReadlineInterface): (question: string, defaultValue?: string) => Promise<string> {
  return async function ask(question: string, defaultValue?: string): Promise<string> {
    const answer = (await rl.question(question)).trim()
    if (answer.length > 0) {
      return answer
    }

    return defaultValue ?? ''
  }
}

async function promptForConfigValue(
  ask: (question: string, defaultValue?: string) => Promise<string>,
  config: GlobalConfig,
  stepLabel: string,
  promptLabel: string,
  target: ConfigKeyTarget,
  options?: { readonly required?: boolean }
): Promise<string | undefined> {
  const currentValue = getConfigValue(config, target)
  const currentLabel = formatCurrentValue(currentValue, target)

  console.log(`\n${stepLabel}`)
  console.log(`  Current: ${currentLabel}`)

  while (true) {
    const promptSuffix = options?.required ? '' : ' (press Enter to keep current)'
    const nextValue = await ask(`  ? ${promptLabel}${promptSuffix}: `, currentValue)

    if (!nextValue && options?.required) {
      console.log('  ⚠️  This value is required.')
      continue
    }

    if (!nextValue) {
      console.log('  ⏭️  No value saved')
      return undefined
    }

    setConfigValue(config, target, nextValue)
    saveGlobalConfig(config)
    console.log(`  ✅ Saved ${target.section}.${target.key}`)
    return nextValue
  }
}

async function runInteractiveWizard(): Promise<void> {
  const rl = createPromptInterface()
  const ask = createAsk(rl)
  const config = loadGlobalConfig()

  try {
    console.log('\n🎬 VidPipe global configuration\n')
    console.log(`Config path: ${getConfigPath()}`)

    let stepNumber = 1

    await promptForConfigValue(
      ask,
      config,
      `Step ${stepNumber++}: OpenAI API key`,
      'OpenAI API key',
      { section: 'credentials', key: 'openaiApiKey' },
      { required: true }
    )

    console.log(`\nStep ${stepNumber++}: LLM provider`)
    const currentProvider = config.defaults.llmProvider
    const providerDefault = currentProvider && allowedProviders.includes(currentProvider as (typeof allowedProviders)[number])
      ? currentProvider
      : 'copilot'
    console.log(`  Current: ${providerDefault}`)

    while (true) {
      const provider = await ask('  ? LLM provider [copilot/openai/claude] (press Enter to keep current): ', providerDefault)
      if (!allowedProviders.includes(provider as (typeof allowedProviders)[number])) {
        console.log('  ⚠️  Please choose one of: copilot, openai, claude.')
        continue
      }

      config.defaults.llmProvider = provider
      saveGlobalConfig(config)
      console.log(`  ✅ Saved defaults.llmProvider = ${provider}`)
      break
    }

    if (config.defaults.llmProvider === 'claude') {
      await promptForConfigValue(
        ask,
        config,
        `Step ${stepNumber++}: Anthropic API key`,
        'Anthropic API key',
        { section: 'credentials', key: 'anthropicApiKey' }
      )
    }

    await promptForConfigValue(
      ask,
      config,
      `Step ${stepNumber++}: Exa API key`,
      'Exa API key',
      { section: 'credentials', key: 'exaApiKey' }
    )

    await promptForConfigValue(
      ask,
      config,
      `Step ${stepNumber++}: YouTube API key`,
      'YouTube API key',
      { section: 'credentials', key: 'youtubeApiKey' }
    )

    await promptForConfigValue(
      ask,
      config,
      `Step ${stepNumber++}: Perplexity API key`,
      'Perplexity API key',
      { section: 'credentials', key: 'perplexityApiKey' }
    )

    await promptForConfigValue(
      ask,
      config,
      `Step ${stepNumber++}: Late API key`,
      'Late API key',
      { section: 'credentials', key: 'lateApiKey' }
    )

    await promptForConfigValue(
      ask,
      config,
      `Step ${stepNumber++}: GitHub token`,
      'GitHub token',
      { section: 'credentials', key: 'githubToken' }
    )

    await promptForConfigValue(
      ask,
      config,
      `Step ${stepNumber++}: Gemini API key`,
      'Gemini API key',
      { section: 'credentials', key: 'geminiApiKey' }
    )

    console.log('\n✅ Global configuration updated.')
  } finally {
    rl.close()
  }
}

function listConfig(): void {
  const config = loadGlobalConfig()
  const rows: Array<{ key: string; value: string }> = []

  for (const key of credentialKeys) {
    rows.push({
      key: `credentials.${key}`,
      value: formatValue(config.credentials[key], { section: 'credentials', key }),
    })
  }

  for (const key of defaultKeys) {
    rows.push({
      key: `defaults.${key}`,
      value: formatValue(config.defaults[key], { section: 'defaults', key }),
    })
  }

  printTable(rows)
}

async function confirmReset(): Promise<boolean> {
  const rl = createPromptInterface()
  const ask = createAsk(rl)

  try {
    console.log(`Config path: ${getConfigPath()}`)
    const answer = await ask('Delete the global config file? [y/N]: ')
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
  } finally {
    rl.close()
  }
}

function printUnknownKeyError(rawKey: string): void {
  console.log(`Unknown config key: ${rawKey}`)
  console.log('Use dot notation like credentials.openaiApiKey or a supported shorthand like openai-key.')
  process.exitCode = 1
}

function printUsageError(message: string): void {
  console.log(message)
  process.exitCode = 1
}

export async function runConfigure(subcommand?: string, args: string[] = []): Promise<void> {
  switch (subcommand) {
    case undefined:
    case '':
      await runInteractiveWizard()
      return

    case 'set': {
      const [rawKey, ...valueParts] = args
      const value = valueParts.join(' ')

      if (!rawKey || valueParts.length === 0) {
        printUsageError('Usage: vidpipe configure set <key> <value>')
        return
      }

      const target = resolveKeyTarget(rawKey)
      if (!target) {
        printUnknownKeyError(rawKey)
        return
      }

      setGlobalConfigValue(target.section, target.key, value)
      const savedValue = getGlobalConfigValue(target.section, target.key)
      console.log(`Set ${target.section}.${target.key} = ${formatValue(savedValue, target)}`)
      return
    }

    case 'get': {
      const [rawKey] = args
      if (!rawKey) {
        printUsageError('Usage: vidpipe configure get <key>')
        return
      }

      const target = resolveKeyTarget(rawKey)
      if (!target) {
        printUnknownKeyError(rawKey)
        return
      }

      const value = getGlobalConfigValue(target.section, target.key)
      console.log(`${target.section}.${target.key} = ${formatValue(value, target)}`)
      return
    }

    case 'list':
      listConfig()
      return

    case 'reset': {
      const confirmed = await confirmReset()
      if (!confirmed) {
        console.log('Reset cancelled.')
        return
      }

      resetGlobalConfig()
      console.log('Global configuration reset.')
      return
    }

    case 'path':
      console.log(getConfigPath())
      return

    default:
      printUsageError(`Unknown configure subcommand: ${subcommand}`)
  }
}
