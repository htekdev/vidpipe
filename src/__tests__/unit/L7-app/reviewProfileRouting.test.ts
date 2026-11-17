import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { config, fetchRaw } = vi.hoisted(() => ({
  config: { LATE_API_KEY: 'offline-test-key', LATE_PROFILE_ID: 'unit-target' },
  fetchRaw: vi.fn(),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => config,
}))
vi.mock('../../../L1-infra/http/httpClient.js', () => ({ fetchRaw }))

import { createRouter } from '../../../L7-app/review/routes.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(createRouter())
  return app
}

describe('review profile routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchRaw.mockImplementation(async (url: string) => {
      if (url.endsWith('/profiles')) {
        return Response.json({ profiles: [
          { _id: 'unit-other', name: 'Other' },
          { _id: 'unit-target', name: 'Target' },
        ] })
      }
      if (url.endsWith('/accounts')) {
        return Response.json({ accounts: [
          { _id: 'foreign-account', platform: 'instagram', profileId: 'unit-other' },
          { _id: 'target-account', platform: 'instagram', profileId: { _id: 'unit-target', name: 'Target' } },
        ] })
      }
      throw new Error(`Unexpected outbound request: ${url}`)
    })
  })

  it('LateProfileRouting.REQ-006: profile and account routes use the selected profile, not API order or stale route caches', async () => {
    const app = buildApp()
    config.LATE_PROFILE_ID = 'unit-target'
    const profile = await request(app).get('/api/profile').expect(200)
    const accounts = await request(app).get('/api/accounts').expect(200)
    expect(profile.body.profile).toEqual({ _id: 'unit-target', name: 'Target' })
    expect(accounts.body.accounts.map((account: { _id: string }) => account._id)).toEqual(['target-account'])
    expect(fetchRaw).toHaveBeenCalledTimes(2)

    config.LATE_PROFILE_ID = 'unit-other'
    expect((await request(app).get('/api/profile').expect(200)).body.profile._id).toBe('unit-other')
    expect((await request(app).get('/api/accounts').expect(200)).body.accounts.map(
      (account: { _id: string }) => account._id,
    )).toEqual(['foreign-account'])
    expect(fetchRaw).toHaveBeenCalledTimes(4)
  })

  it('LateProfileRouting.REQ-006: inaccessible explicit profiles expose no other profile or accounts', async () => {
    config.LATE_PROFILE_ID = 'unit-missing'
    const app = buildApp()
    const profile = await request(app).get('/api/profile').expect(500)
    const accounts = await request(app).get('/api/accounts').expect(500)
    expect(profile.body.profile).toBeNull()
    expect(profile.body.error).toContain('LATE_PROFILE_ID')
    expect(accounts.body.accounts).toEqual([])
    expect(fetchRaw.mock.calls.every(([url]) => String(url).endsWith('/profiles'))).toBe(true)
  })
})
