import { readJsonFile, writeJsonFile, fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
import { join, homedir } from '../../L1-infra/paths/paths.js'
import logger from '../../L1-infra/logger/configLogger.js'

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Job {
  id: string
  type: string
  status: JobStatus
  stage?: string
  progress?: string
  result?: unknown
  error?: string
  createdAt: string
  updatedAt: string
  heartbeat: string
}

interface JobStoreData {
  jobs: Record<string, Job>
}

let jobCounter = 0

function generateJobId(): string {
  jobCounter++
  return `job-${Date.now().toString(36)}-${jobCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const STALE_THRESHOLD_MS = 2 * 60 * 1000 // 2 minutes without heartbeat = stale
let jobsFilePath: string | undefined

function getJobsPath(): string {
  if (jobsFilePath) return jobsFilePath
  const dir = join(homedir(), '.vidpipe')
  jobsFilePath = join(dir, 'mcp-jobs.json')
  return jobsFilePath
}

async function readStore(): Promise<JobStoreData> {
  const path = getJobsPath()
  if (!await fileExists(path)) {
    return { jobs: {} }
  }
  try {
    return await readJsonFile<JobStoreData>(path)
  } catch {
    return { jobs: {} }
  }
}

async function writeStore(data: JobStoreData): Promise<void> {
  await writeJsonFile(getJobsPath(), data)
}

export async function createJob(type: string): Promise<Job> {
  const store = await readStore()
  const now = new Date().toISOString()
  const job: Job = {
    id: generateJobId(),
    type,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    heartbeat: now,
  }
  store.jobs[job.id] = job
  await writeStore(store)
  logger.debug(`Job created: ${job.id} (${type})`)
  return job
}

export async function updateJob(
  id: string,
  updates: Partial<Pick<Job, 'status' | 'stage' | 'progress' | 'result' | 'error'>>,
): Promise<Job | null> {
  const store = await readStore()
  const job = store.jobs[id]
  if (!job) return null

  const now = new Date().toISOString()
  Object.assign(job, updates, { updatedAt: now, heartbeat: now })
  await writeStore(store)
  return job
}

export async function heartbeat(id: string): Promise<void> {
  const store = await readStore()
  const job = store.jobs[id]
  if (!job) return
  job.heartbeat = new Date().toISOString()
  await writeStore(store)
}

export async function getJob(id: string): Promise<Job | null> {
  const store = await readStore()
  const job = store.jobs[id] ?? null
  if (job && job.status === 'running') {
    const elapsed = Date.now() - new Date(job.heartbeat).getTime()
    if (elapsed > STALE_THRESHOLD_MS) {
      job.status = 'failed'
      job.error = `Job appears stale (no heartbeat for ${Math.round(elapsed / 1000)}s). Server may have restarted.`
      job.updatedAt = new Date().toISOString()
      await writeStore(store)
    }
  }
  return job
}

export async function listJobs(filter?: { status?: JobStatus; type?: string }): Promise<Job[]> {
  const store = await readStore()
  let jobs = Object.values(store.jobs)

  if (filter?.status) {
    jobs = jobs.filter(j => j.status === filter.status)
  }
  if (filter?.type) {
    jobs = jobs.filter(j => j.type === filter.type)
  }

  return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function cancelJob(id: string): Promise<Job | null> {
  return updateJob(id, { status: 'cancelled', error: 'Cancelled by user' })
}

export async function cleanupOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const store = await readStore()
  const cutoff = Date.now() - maxAgeMs
  let removed = 0

  for (const [id, job] of Object.entries(store.jobs)) {
    if (new Date(job.updatedAt).getTime() < cutoff && job.status !== 'running') {
      delete store.jobs[id]
      removed++
    }
  }

  if (removed > 0) {
    await writeStore(store)
  }
  return removed
}
