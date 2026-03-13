import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getScheduleCalendar, findNextSlot } from '../../../L3-services/scheduler/scheduler.js'
import { getPendingItems, getPublishedItems, getItem } from '../../../L3-services/postStore/postStore.js'
import { getVideoStatus, getFullState } from '../../../L3-services/processingState/processingState.js'
import { costTracker } from '../../../L3-services/costTracking/costTracker.js'
import { listDirectorySync } from '../../../L1-infra/fileSystem/fileSystem.js'
import { getConfig } from '../../../L1-infra/config/environment.js'
import { getJob, listJobs } from '../jobs.js'
import type { JobStatus } from '../jobs.js'

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

export function registerQueryTools(server: McpServer): void {
  server.tool(
    'get_schedule_calendar',
    'View the upcoming posting schedule across all platforms. Shows scheduled posts from Late API and local queue.',
    {},
    async () => {
      const calendar = await getScheduleCalendar()
      return textResult({
        totalPosts: calendar.length,
        posts: calendar.map(s => ({
          platform: s.platform,
          scheduledFor: s.scheduledFor,
          source: s.source,
        })),
      })
    },
  )

  server.tool(
    'get_pending_posts',
    'List all pending social media posts waiting for review/approval in the publish queue.',
    {},
    async () => {
      const items = await getPendingItems()
      return textResult({
        count: items.length,
        items: items.map(i => ({
          id: i.id,
          platform: i.metadata.platform,
          clipType: i.metadata.clipType,
          sourceVideo: i.metadata.sourceVideo,
          contentPreview: i.postContent.slice(0, 200),
        })),
      })
    },
  )

  server.tool(
    'get_published_posts',
    'List all published social media posts.',
    {},
    async () => {
      const items = await getPublishedItems()
      return textResult({
        count: items.length,
        items: items.map(i => ({
          id: i.id,
          platform: i.metadata.platform,
          clipType: i.metadata.clipType,
          sourceVideo: i.metadata.sourceVideo,
          scheduledFor: i.metadata.scheduledFor,
        })),
      })
    },
  )

  server.tool(
    'get_post',
    'Get full details of a specific post by its ID, including content and metadata.',
    { postId: z.string().describe('The unique ID of the post') },
    async ({ postId }) => {
      const item = await getItem(postId)
      if (!item) {
        return textResult({ error: `Post not found: ${postId}` })
      }
      return textResult({
        id: item.id,
        platform: item.metadata.platform,
        clipType: item.metadata.clipType,
        sourceVideo: item.metadata.sourceVideo,
        scheduledFor: item.metadata.scheduledFor,
        content: item.postContent,
        metadata: item.metadata,
      })
    },
  )

  server.tool(
    'get_video_status',
    'Check the processing status of a video by its slug (filename without extension).',
    { slug: z.string().describe('Video slug (filename without extension, e.g., "my-recording")') },
    async ({ slug }) => {
      const status = await getVideoStatus(slug)
      if (!status) {
        return textResult({ error: `No processing state found for video: ${slug}` })
      }
      return textResult(status)
    },
  )

  server.tool(
    'list_recordings',
    'List all processed recordings and their processing status.',
    {},
    async () => {
      const state = await getFullState()
      const config = getConfig()

      let watchFiles: string[] = []
      try {
        watchFiles = listDirectorySync(config.WATCH_FOLDER)
          .filter(f => /\.(mp4|mov|webm|avi|mkv)$/i.test(f))
      } catch { /* watch folder may not exist */ }

      return textResult({
        tracked: Object.entries(state.videos).map(([slug, s]) => ({
          slug,
          status: s.status,
          sourcePath: s.sourcePath,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          error: s.error,
        })),
        watchFolderFiles: watchFiles,
      })
    },
  )

  server.tool(
    'get_cost_report',
    'Get the LLM cost report — total spend, breakdown by provider, agent, and model.',
    {},
    async () => {
      const report = costTracker.getReport()
      return textResult({
        totalCostUSD: report.totalCostUSD,
        totalPRUs: report.totalPRUs,
        totalTokens: report.totalTokens,
        totalServiceCostUSD: report.totalServiceCostUSD,
        byProvider: report.byProvider,
        byAgent: report.byAgent,
        byModel: report.byModel,
        byService: report.byService,
      })
    },
  )

  server.tool(
    'get_job_status',
    'Check the status of a long-running pipeline job. Returns status, current stage, progress, and result when completed.',
    { jobId: z.string().describe('The job ID returned when starting a pipeline operation') },
    async ({ jobId }) => {
      const job = await getJob(jobId)
      if (!job) {
        return textResult({ error: `Job not found: ${jobId}` })
      }
      return textResult({
        id: job.id,
        type: job.type,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })
    },
  )

  server.tool(
    'list_jobs',
    'List all pipeline jobs, optionally filtered by status.',
    {
      status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional()
        .describe('Filter by job status'),
    },
    async ({ status }) => {
      const jobs = await listJobs(status ? { status: status as JobStatus } : undefined)
      return textResult({
        count: jobs.length,
        jobs: jobs.map(j => ({
          id: j.id,
          type: j.type,
          status: j.status,
          stage: j.stage,
          progress: j.progress,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt,
          error: j.error,
        })),
      })
    },
  )
}
