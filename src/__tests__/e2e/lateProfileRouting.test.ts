import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../../../', import.meta.url))
const cli = join(root, 'src', 'L7-app', 'cli.ts')
const tsx = pathToFileURL(join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href
let workspace: string
let environment: NodeJS.ProcessEnv

interface ProbeResult {
  configuredProfileId: string
  accountId: string | null
  queueId: string | null
  owner: string
  switched?: { accountId: string | null; queueId: string | null; owner: string }
}

function sourceUrl(...segments: string[]): string {
  return pathToFileURL(join(root, 'src', ...segments)).href
}

async function configure(profileId: string): Promise<void> {
  await execute(process.execPath, ['--import', tsx, cli, 'configure', 'set', 'late-profile-id', profileId], {
    cwd: workspace, env: environment, timeout: 30_000,
  })
}

async function seedCaches(profileId: string, scoped: boolean): Promise<void> {
  const identity = scoped ? { profileId, configuredProfileId: profileId } : {}
  const fetchedAt = new Date().toISOString()
  await Promise.all([
    writeFile(join(workspace, '.vidpipe-cache.json'), JSON.stringify({
      ...identity, accounts: { twitter: `${profileId}-account` }, fetchedAt,
    })),
    writeFile(join(workspace, '.vidpipe-queue-cache.json'), JSON.stringify({
      ...identity, profileId, mappings: { 'x-shorts': `${profileId}-queue` }, fetchedAt,
    })),
  ])
}

async function probe(switchTo?: string, override?: string): Promise<ProbeResult> {
  const { stdout } = await execute(process.execPath, ['--import', tsx, join(workspace, 'probe.ts'), ...(switchTo ? [switchTo] : [])], {
    cwd: workspace,
    env: { ...environment, ...(override ? { LATE_PROFILE_ID: override } : {}) },
    timeout: 30_000,
  })
  const line = stdout.split(/\r?\n/).find(entry => entry.startsWith('PROFILE_PROBE='))
  if (!line) throw new Error(`Probe did not return a result: ${stdout}`)
  return JSON.parse(line.slice('PROFILE_PROBE='.length)) as ProbeResult
}

describe('offline CLI profile routing', () => {
  beforeAll(async () => {
    workspace = await mkdtemp(join(root, '.late-profile-e2e-'))
    environment = { ...process.env }
    for (const key of Object.keys(environment)) {
      if (/API_KEY|TOKEN|SECRET|PASSWORD|^AWS_|^AZURE_|^GH_|^GITHUB_/.test(key)) environment[key] = ''
    }
    Object.assign(environment, {
      VIDPIPE_CONFIG_DIR: join(workspace, 'config'),
      APPDATA: workspace,
      LOCALAPPDATA: workspace,
      LATE_PROFILE_ID: '',
      AWS_EC2_METADATA_DISABLED: 'true',
    })
    await writeFile(join(workspace, 'probe.ts'), `
import { initConfig } from ${JSON.stringify(sourceUrl('L1-infra', 'config', 'environment.ts'))}
import { getAccountId } from ${JSON.stringify(sourceUrl('L3-services', 'socialPosting', 'accountMapping.ts'))}
import { getQueueId, getProfileId } from ${JSON.stringify(sourceUrl('L3-services', 'queueMapping', 'queueMapping.ts'))}
import { Platform } from ${JSON.stringify(sourceUrl('L0-pure', 'types', 'index.ts'))}
async function readMappings() {
  return { accountId: await getAccountId(Platform.X), queueId: await getQueueId('twitter', 'shorts'), owner: await getProfileId() }
}
const config = initConfig()
const result = { configuredProfileId: config.LATE_PROFILE_ID, ...await readMappings() }
if (process.argv[2]) {
  initConfig({ lateProfileId: process.argv[2] })
  Object.assign(result, { switched: await readMappings() })
}
console.log('PROFILE_PROBE=' + JSON.stringify(result))
`)
  })

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('LateProfileRouting.REQ-002: CLI-pinned profile rejects legacy account and queue caches without credentials or network fallback', async () => {
    await configure('profile-target')
    expect(JSON.parse(await readFile(join(workspace, 'config', 'config.json'), 'utf8')).defaults.lateProfileId).toBe('profile-target')
    await seedCaches('profile-other', false)
    expect(await probe()).toEqual({
      configuredProfileId: 'profile-target', accountId: null, queueId: null, owner: '',
    })
    await seedCaches('profile-target', true)
    expect(await probe()).toEqual({
      configuredProfileId: 'profile-target', accountId: 'profile-target-account',
      queueId: 'profile-target-queue', owner: 'profile-target',
    })
  }, 60_000)

  test('LateProfileRouting.REQ-004: persisted CLI switches and environment overrides invalidate file and memory queue/account owners', async () => {
    await seedCaches('profile-target', true)
    await configure('profile-other')
    expect(await probe()).toEqual({
      configuredProfileId: 'profile-other', accountId: null, queueId: null, owner: '',
    })
    await seedCaches('profile-other', true)
    const result = await probe('profile-target')
    expect(result).toEqual({
      configuredProfileId: 'profile-other', accountId: 'profile-other-account',
      queueId: 'profile-other-queue', owner: 'profile-other',
      switched: { accountId: null, queueId: null, owner: '' },
    })
    expect(await probe(undefined, 'profile-target')).toEqual({
      configuredProfileId: 'profile-target', accountId: null, queueId: null, owner: '',
    })
  }, 60_000)
})
