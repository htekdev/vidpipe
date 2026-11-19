import type { LateProfile } from '../../L2-clients/late/lateApi.js'

/** Select a publishing profile without guessing between unrelated brands. */
export function selectLateProfile(
  profiles: LateProfile[],
  configuredProfileId: string,
): LateProfile | null {
  if (configuredProfileId) {
    const profile = profiles.find(candidate => candidate._id === configuredProfileId)
    if (!profile) throw new Error('Configured LATE_PROFILE_ID is not accessible')
    return profile
  }
  if (profiles.length <= 1) return profiles[0] ?? null
  const defaults = profiles.filter(profile => profile.isDefault)
  if (defaults.length === 1) return defaults[0]
  throw new Error('Multiple Late profiles found; configure LATE_PROFILE_ID before publishing')
}
