import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { rejectItem } from '../../../L3-services/postStore/postStore.js'
import { findNextSlot } from '../../../L3-services/scheduler/scheduler.js'
import { buildRealignPlan, executeRealignPlan } from '../../../L3-services/scheduler/realign.js'
import { enqueueApproval } from '../../review/approvalQueue.js'
import { cancelJob } from '../jobs.js'

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

export function registerActionTools(server: McpServer): void {
  server.tool(
    'approve_posts',
    'Approve one or more pending social media posts for scheduling. Posts are queued sequentially to avoid slot collisions.',
    {
      postIds: z.array(z.string()).min(1).describe('Array of post IDs to approve'),
    },
    async ({ postIds }) => {
      try {
        const result = await enqueueApproval(postIds)
        return textResult({
          scheduled: result.scheduled,
          failed: result.failed,
          results: result.results,
          rateLimitedPlatforms: result.rateLimitedPlatforms,
        })
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) })
      }
    },
  )

  server.tool(
    'reject_posts',
    'Reject (delete) one or more pending social media posts from the review queue.',
    {
      postIds: z.array(z.string()).min(1).describe('Array of post IDs to reject'),
    },
    async ({ postIds }) => {
      const results: Array<{ id: string; success: boolean; error?: string }> = []
      for (const id of postIds) {
        try {
          await rejectItem(id)
          results.push({ id, success: true })
        } catch (err) {
          results.push({ id, success: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return textResult({
        rejected: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      })
    },
  )

  server.tool(
    'find_next_slot',
    'Find the next available posting slot for a platform. Returns the ISO datetime of the next open slot.',
    {
      platform: z.string().describe('Platform name: tiktok, youtube, instagram, linkedin, twitter'),
      clipType: z.string().optional().describe('Clip type: short, medium-clip, video (default: short)'),
    },
    async ({ platform, clipType }) => {
      const slot = await findNextSlot(platform, clipType)
      if (!slot) {
        return textResult({ error: `No available slots found for ${platform}${clipType ? ` (${clipType})` : ''}` })
      }
      return textResult({
        platform,
        clipType: clipType ?? 'short',
        nextSlot: slot,
        formatted: new Date(slot).toLocaleString('en-US', {
          timeZone: 'America/Chicago',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
      })
    },
  )

  server.tool(
    'realign_schedule',
    'Realign all Late scheduled/cancelled/failed posts to match schedule.json slots. Detects and fixes scheduling collisions.',
    {
      platform: z.string().optional().describe('Filter to a specific platform'),
      dryRun: z.boolean().optional().default(true).describe('Preview changes without executing (default: true)'),
    },
    async ({ platform, dryRun }) => {
      const plan = await buildRealignPlan({ platform })

      if (plan.posts.length === 0 && plan.toCancel.length === 0) {
        return textResult({
          message: 'Nothing to realign — all posts are on valid slots.',
          totalFetched: plan.totalFetched,
          skipped: plan.skipped,
        })
      }

      const summary = {
        totalFetched: plan.totalFetched,
        skipped: plan.skipped,
        unmatched: plan.unmatched,
        toRealign: plan.posts.length,
        toCancel: plan.toCancel.length,
        moves: plan.posts.map(p => ({
          platform: p.platform,
          clipType: p.clipType,
          contentPreview: p.post.content.slice(0, 80),
          from: p.oldScheduledFor,
          to: p.newScheduledFor,
        })),
        cancellations: plan.toCancel.map(c => ({
          platform: c.platform,
          clipType: c.clipType,
          reason: c.reason,
        })),
      }

      if (dryRun) {
        return textResult({ dryRun: true, ...summary })
      }

      const result = await executeRealignPlan(plan)
      return textResult({
        executed: true,
        updated: result.updated,
        cancelled: result.cancelled,
        failed: result.failed,
        errors: result.errors,
        ...summary,
      })
    },
  )

  server.tool(
    'cancel_job',
    'Cancel a running pipeline job.',
    { jobId: z.string().describe('The job ID to cancel') },
    async ({ jobId }) => {
      const job = await cancelJob(jobId)
      if (!job) {
        return textResult({ error: `Job not found: ${jobId}` })
      }
      return textResult({ id: job.id, status: job.status, message: 'Job cancelled' })
    },
  )
}
