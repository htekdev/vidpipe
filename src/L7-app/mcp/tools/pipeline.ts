import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { processVideoSafe } from '../../../L6-pipeline/pipeline.js'
import { createJob, updateJob, heartbeat } from '../jobs.js'
import logger from '../../../L1-infra/logger/configLogger.js'

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

async function runPipelineInBackground(jobId: string, videoPath: string): Promise<void> {
  const heartbeatInterval = setInterval(() => {
    heartbeat(jobId).catch(() => {})
  }, 30_000)

  try {
    await updateJob(jobId, { status: 'running', stage: 'starting', progress: '0/15 stages' })

    const result = await processVideoSafe(videoPath)

    if (result) {
      const completedStages = result.stageResults
        .filter(s => s.success)
        .length
      const totalStages = result.stageResults.length

      await updateJob(jobId, {
        status: 'completed',
        stage: 'done',
        progress: `${completedStages}/${totalStages} stages completed`,
        result: {
          slug: result.video.slug,
          totalDuration: result.totalDuration,
          stageResults: result.stageResults.map(s => ({
            stage: s.stage,
            success: s.success,
            duration: s.duration,
            error: s.error,
          })),
        },
      })
    } else {
      await updateJob(jobId, {
        status: 'failed',
        error: 'processVideoSafe returned null — video may have already been processed or path is invalid',
      })
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`Pipeline job ${jobId} failed: ${errorMsg}`)
    await updateJob(jobId, {
      status: 'failed',
      error: errorMsg,
    })
  } finally {
    clearInterval(heartbeatInterval)
  }
}

export function registerPipelineTools(server: McpServer): void {
  server.tool(
    'process_video',
    'Start the full video processing pipeline (15 stages: ingestion → transcription → silence removal → captions → shorts → medium clips → chapters → summary → social posts → blog → git push). Returns a job ID — use get_job_status to monitor progress.',
    {
      videoPath: z.string().describe('Absolute path to the video file to process'),
    },
    async ({ videoPath }) => {
      const job = await createJob('process_video')
      await updateJob(job.id, { status: 'pending', stage: 'queued' })

      // Fire and forget — pipeline runs in background
      runPipelineInBackground(job.id, videoPath).catch(err => {
        logger.error(`Unhandled pipeline error for job ${job.id}: ${err}`)
      })

      return textResult({
        jobId: job.id,
        status: 'running',
        message: `Pipeline started for ${videoPath}. Use get_job_status with jobId "${job.id}" to monitor progress.`,
      })
    },
  )
}
