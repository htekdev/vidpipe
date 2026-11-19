import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

  test('LateProfileRouting.REQ-007: persisted non-first profile scopes real sync-queues lookup, mutations and mapping refresh offline', async () => {
    await configure('profile-target')
    expect(JSON.parse(await readFile(join(workspace, 'config', 'config.json'), 'utf8')).defaults.lateProfileId)
      .toBe('profile-target')
    await Promise.all(['.vidpipe-cache.json', '.vidpipe-queue-cache.json'].map(name =>
      rm(join(workspace, name), { force: true }),
    ))
    await writeFile(join(workspace, 'schedule.json'), JSON.stringify({
      timezone: 'UTC',
      platforms: {
        twitter: {
          slots: [], avoidDays: [],
          byClipType: {
            shorts: { slots: [{ days: ['mon'], time: '12:00', label: 'Short' }], avoidDays: [] },
            video: { slots: [{ days: ['tue'], time: '14:00', label: 'Video' }], avoidDays: [] },
          },
        },
      },
    }))
    const transcript = join(workspace, 'sync-http.jsonl')
    const preload = join(workspace, 'offline-sync.mjs')
    const childCoverage = join(workspace, 'sync-coverage')
    await writeFile(preload, `
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
const queues = [
  { _id: 'target-short', profileId: 'profile-target', name: 'x-shorts', timezone: 'UTC',
    slots: [{ dayOfWeek: 0, time: '09:00' }], active: true, isDefault: false },
  { _id: 'target-orphan', profileId: 'profile-target', name: 'obsolete', timezone: 'UTC',
    slots: [], active: true, isDefault: false },
]
// No native fetch fallback: all unexpected URLs, methods, profiles or bodies fail closed.
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input))
  const method = options.method ?? 'GET'
  // CLI dependencies load embedded WASM; decode only this data URI format without any I/O.
  if (url.protocol === 'data:') {
    assert.equal(method, 'GET')
    assert.match(url.href, /^data:application\\/octet-stream;base64,[A-Za-z0-9+/=]+$/)
    return new Response(Buffer.from(url.href.slice(url.href.indexOf(',') + 1), 'base64'), {
      headers: { 'Content-Type': 'application/wasm' },
    })
  }
  const body = options.body ? JSON.parse(String(options.body)) : undefined
  appendFileSync(${JSON.stringify(transcript)}, JSON.stringify({ url: url.href, method, body }) + '\\n')
  assert.equal(url.origin, 'https://getlate.dev')
  assert.equal(new Headers(options.headers).get('authorization'), 'Bearer offline-sync-key')
  if (url.pathname === '/api/v1/profiles' && method === 'GET' && !url.search) {
    return Response.json({ profiles: [
      { _id: 'profile-other', name: 'Unrelated default', isDefault: true },
      { _id: 'profile-target', name: 'Selected second profile' },
    ] })
  }
  assert.equal(url.pathname, '/api/v1/queue/slots')
  assert.equal(body?.profileId ?? url.searchParams.get('profileId'), 'profile-target')
  if (method === 'GET') {
    assert.equal(url.searchParams.get('all'), 'true')
    return Response.json({ queues, count: queues.length })
  }
  if (method === 'PUT') {
    assert.equal(body.queueId, 'target-short')
    assert.equal(body.name, 'x-shorts')
    Object.assign(queues.find(queue => queue._id === body.queueId), body)
    return Response.json({ success: true })
  }
  if (method === 'POST') {
    assert.equal(body.name, 'x-video')
    queues.push({ ...body, _id: 'target-video', isDefault: false })
    return Response.json({ success: true })
  }
  if (method === 'DELETE') {
    assert.equal(url.searchParams.get('queueId'), 'target-orphan')
    queues.splice(queues.findIndex(queue => queue._id === 'target-orphan'), 1)
    return Response.json({ success: true })
  }
  throw new Error('Unhandled offline sync request: ' + method + ' ' + url.href)
}
`)
    const { stdout } = await execute(process.execPath, [
      '--import', tsx, '--import', pathToFileURL(preload).href, cli,
      'sync-queues', '--delete-orphans',
    ], {
      cwd: workspace,
      env: {
        ...environment, LATE_API_KEY: 'offline-sync-key', LATE_PROFILE_ID: '',
        AWS_SHARED_CREDENTIALS_FILE: join(workspace, 'no-credentials'),
        AWS_CONFIG_FILE: join(workspace, 'no-aws-config'),
        NODE_V8_COVERAGE: childCoverage,
      },
      timeout: 30_000,
    })
    expect(stdout).toContain('Created 1 queues: x-video')
    expect(stdout).toContain('Updated 1 queues: x-shorts')
    expect(stdout).toContain('Deleted 1 queues: obsolete')
    const calls = (await readFile(transcript, 'utf8')).trim().split(/\r?\n/).map(line =>
      JSON.parse(line) as { url: string; method: string; body?: { profileId: string; queueId?: string; name: string } },
    )
    expect(calls.map(call => [new URL(call.url).pathname, call.method])).toEqual([
      ['/api/v1/profiles', 'GET'],
      ['/api/v1/queue/slots', 'GET'],
      ['/api/v1/queue/slots', 'PUT'],
      ['/api/v1/queue/slots', 'POST'],
      ['/api/v1/queue/slots', 'DELETE'],
      ['/api/v1/profiles', 'GET'],
      ['/api/v1/queue/slots', 'GET'],
    ])
    for (const call of calls.filter(call => new URL(call.url).pathname === '/api/v1/queue/slots')) {
      expect(call.body?.profileId ?? new URL(call.url).searchParams.get('profileId')).toBe('profile-target')
    }
    expect(calls[2].body).toMatchObject({ queueId: 'target-short', name: 'x-shorts', slots: [{ dayOfWeek: 1, time: '12:00' }] })
    expect(calls[3].body).toMatchObject({ name: 'x-video', slots: [{ dayOfWeek: 2, time: '14:00' }] })
    expect(new URL(calls[4].url).searchParams.get('queueId')).toBe('target-orphan')
    const cache = JSON.parse(await readFile(join(workspace, '.vidpipe-queue-cache.json'), 'utf8'))
    expect(cache).toMatchObject({
      configuredProfileId: 'profile-target',
      profileId: 'profile-target',
    })
    expect(cache.mappings).toEqual({ 'x-shorts': 'target-short', 'x-video': 'target-video' })
    expect(await probe()).toEqual({
      configuredProfileId: 'profile-target', accountId: null, queueId: 'target-short', owner: 'profile-target',
    })
    // Vitest does not merge execFile child coverage; verify real CLI service execution separately.
    const coverageFiles = (await readdir(childCoverage)).filter(name => name.endsWith('.json'))
    const scripts = (await Promise.all(coverageFiles.map(async name =>
      JSON.parse(await readFile(join(childCoverage, name), 'utf8')) as {
        result: Array<{ url: string; functions: Array<{ functionName: string; ranges: Array<{ count: number }> }> }>
      },
    ))).flatMap(report => report.result)
    for (const [module, functionName] of [
      ['queueSync/queueSync.ts', 'syncQueuesToLate'],
      ['queueMapping/queueMapping.ts', 'refreshQueueMappings'],
    ]) {
      expect(scripts.some(script => script.url === sourceUrl('L3-services', module)
        && script.functions.some(fn => fn.functionName === functionName && fn.ranges[0].count > 0))).toBe(true)
    }
  }, 60_000)
})
