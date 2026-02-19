import { BaseAgent } from './BaseAgent.js'
import { LateApiClient } from '../L3-services/lateApi/lateApiService.js'
import { findNextSlot, getScheduleCalendar } from '../L3-services/scheduler/scheduler.js'
import { loadScheduleConfig } from '../L3-services/scheduler/scheduleConfig.js'
import { buildRealignPlan, executeRealignPlan, buildPrioritizedRealignPlan } from '../L3-services/scheduler/realign.js'
import logger from '../L1-infra/logger/configLogger.js'
import type { LatePost } from '../L3-services/lateApi/lateApiService.js'
import type { RealignPlan, PriorityRule } from '../L3-services/scheduler/realign.js'
import type { ToolWithHandler, UserInputHandler, LLMSession } from '../L3-services/llm/providerFactory.js'

/** Friendly labels for tool calls shown in chat mode */
const TOOL_LABELS: Record<string, string> = {
  list_posts: '📋 Listing posts',
  view_schedule_config: '⚙️  Loading schedule config',
  view_calendar: '📅 Loading calendar',
  reschedule_post: '🔄 Rescheduling post',
  cancel_post: '🚫 Cancelling post',
  find_next_slot: '🔍 Finding next slot',
  realign_schedule: '📐 Running realignment',
  start_prioritize_realign: '🎯 Starting prioritized realignment',
  check_realign_status: '📊 Checking realignment progress',
  ask_user: '💬 Asking for your input',
}

interface RealignJob {
  id: string
  status: 'planning' | 'executing' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  progress: { completed: number; total: number; phase: 'planning' | 'cancelling' | 'updating' }
  plan?: {
    totalFetched: number
    toReschedule: number
    toCancel: number
    skipped: number
    unmatched: number
  }
  result?: { updated: number; cancelled: number; failed: number; errors: Array<{ postId: string; error: string }> }
  error?: string
}

const SYSTEM_PROMPT = `You are a schedule management assistant for Late.co social media posts.

You help the user view, analyze, and reprioritize their posting schedule across platforms.

Available platforms: x (twitter), youtube, tiktok, instagram, linkedin
Clip types: short (15-60s vertical clips), medium-clip (60-180s clips), video (full-length)

When listing posts, always show content previews (first 60 chars) so the user can identify them.
Use ask_user when you need clarification on priorities or decisions — never guess at user intent.
Be concise and actionable. Prefer tables or bullet lists over prose.

For themed scheduling, use start_prioritize_realign to kick off the job, then poll with
check_realign_status until it completes. The priorities array is ordered — rule[0] is checked
first for each slot. Each rule has keywords to match post content, a saturation (0.0–1.0) controlling
how aggressively to fill slots with matches, and optional from/to dates for the active range.
Example: "DevOps this week, hooks next week" → two rules with different date ranges.
Workflow: start_prioritize_realign (dryRun=true) → check_realign_status → review plan → if approved,
start_prioritize_realign (dryRun=false) → check_realign_status (poll every few seconds until completed).`

export class ScheduleAgent extends BaseAgent {
  private userInputHandler?: UserInputHandler
  private chatOutput?: (message: string) => void
  private realignJobs = new Map<string, RealignJob>()

  constructor(userInputHandler?: UserInputHandler, model?: string) {
    super('ScheduleAgent', SYSTEM_PROMPT, undefined, model)
    this.userInputHandler = userInputHandler
  }

  /** Set a callback for chat-friendly status messages (tool starts, progress). */
  setChatOutput(fn: (message: string) => void): void {
    this.chatOutput = fn
  }

  protected getUserInputHandler(): UserInputHandler | undefined {
    return this.userInputHandler
  }

  protected getTimeoutMs(): number {
    return 1_800_000 // 30 minutes for interactive chat
  }

  protected setupEventHandlers(session: LLMSession): void {
    if (!this.chatOutput) {
      super.setupEventHandlers(session)
      return
    }

    const write = this.chatOutput

    session.on('delta', (event) => {
      const data = event.data as Record<string, unknown> | undefined
      const chunk = (data?.deltaContent as string) ?? ''
      if (chunk) process.stdout.write(`\x1b[36m${chunk}\x1b[0m`)
    })

    session.on('tool_start', (event) => {
      const data = event.data as Record<string, unknown> | undefined
      const toolName = (data?.toolName as string) ?? 'unknown'
      const label = TOOL_LABELS[toolName] ?? `🔧 ${toolName}`
      write(`\x1b[90m${label}...\x1b[0m`)
    })

    session.on('error', (event) => {
      const data = event.data as Record<string, unknown> | undefined
      const msg = (data?.message as string) ?? JSON.stringify(data)
      write(`\x1b[31m❌ Error: ${msg}\x1b[0m`)
    })
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'list_posts',
        description: 'List posts from the Late.co queue. Fetches ALL posts with pagination, then filters locally. Use search to find posts about specific topics.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by status: scheduled, draft, cancelled, failed, published. Omit for all statuses.' },
            platform: { type: 'string', description: 'Filter by platform: x, twitter, youtube, tiktok, instagram, linkedin' },
            search: { type: 'string', description: 'Search text to filter posts by content (case-insensitive substring match)' },
            limit: { type: 'number', description: 'Max posts to return (default: 50). Use higher values to find all matches.' },
          },
          required: [],
        },
        handler: async (args) => this.handleToolCall('list_posts', args as Record<string, unknown>),
      },
      {
        name: 'view_schedule_config',
        description: 'Show the schedule.json slot configuration (posting windows per platform).',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: 'Filter to a specific platform' },
          },
          required: [],
        },
        handler: async (args) => this.handleToolCall('view_schedule_config', args as Record<string, unknown>),
      },
      {
        name: 'view_calendar',
        description: 'Show upcoming scheduled posts as a calendar view.',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'number', description: 'Number of days to look ahead (default: 7)' },
          },
          required: [],
        },
        handler: async (args) => this.handleToolCall('view_calendar', args as Record<string, unknown>),
      },
      {
        name: 'reschedule_post',
        description: 'Move a post to a new scheduled time.',
        parameters: {
          type: 'object',
          properties: {
            postId: { type: 'string', description: 'The Late post ID' },
            scheduledFor: { type: 'string', description: 'New scheduled datetime (ISO 8601)' },
          },
          required: ['postId', 'scheduledFor'],
        },
        handler: async (args) => this.handleToolCall('reschedule_post', args as Record<string, unknown>),
      },
      {
        name: 'cancel_post',
        description: 'Cancel a scheduled post.',
        parameters: {
          type: 'object',
          properties: {
            postId: { type: 'string', description: 'The Late post ID to cancel' },
          },
          required: ['postId'],
        },
        handler: async (args) => this.handleToolCall('cancel_post', args as Record<string, unknown>),
      },
      {
        name: 'find_next_slot',
        description: 'Find the next available posting slot for a platform.',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: 'Platform: x, twitter, youtube, tiktok, instagram, linkedin' },
            clipType: { type: 'string', description: 'Clip type: short, medium-clip, video' },
          },
          required: ['platform'],
        },
        handler: async (args) => this.handleToolCall('find_next_slot', args as Record<string, unknown>),
      },
      {
        name: 'realign_schedule',
        description: 'Run full schedule realignment — preview the plan or execute it.',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: 'Limit realignment to a specific platform' },
            execute: { type: 'boolean', description: 'If true, execute the plan. If false (default), only preview.' },
          },
          required: [],
        },
        handler: async (args) => this.handleToolCall('realign_schedule', args as Record<string, unknown>),
      },
      {
        name: 'start_prioritize_realign',
        description: 'Start a prioritized realignment in the background. Returns a job ID immediately. Use check_realign_status to poll progress. The priorities array is ordered: rule[0] is checked first for each slot.',
        parameters: {
          type: 'object',
          properties: {
            priorities: {
              type: 'array',
              description: 'Ordered array of priority rules. Array order = priority rank — rule[0] is checked first for each slot, then rule[1], etc.',
              items: {
                type: 'object',
                properties: {
                  keywords: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Search terms to match post content (case-insensitive). Posts matching ANY keyword are included.',
                  },
                  saturation: {
                    type: 'number',
                    description: 'Probability 0.0-1.0 of filling each slot with a match. 1.0 = always, 0.5 = ~50% of slots.',
                  },
                  from: { type: 'string', description: 'Start date (YYYY-MM-DD) for when this rule is active. Omit for immediately.' },
                  to: { type: 'string', description: 'End date (YYYY-MM-DD) for when this rule expires. Omit for no end.' },
                },
                required: ['keywords', 'saturation'],
              },
            },
            platform: { type: 'string', description: 'Limit to one platform: x, youtube, tiktok, instagram, linkedin' },
            dryRun: { type: 'boolean', description: 'If true (default), only build the plan without executing. Set to false to build AND execute.' },
          },
          required: ['priorities'],
        },
        handler: async (args) => this.handleToolCall('start_prioritize_realign', args as Record<string, unknown>),
      },
      {
        name: 'check_realign_status',
        description: 'Check the progress of a running prioritized realignment job. Poll this periodically after calling start_prioritize_realign.',
        parameters: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: 'The job ID returned by start_prioritize_realign' },
          },
          required: ['jobId'],
        },
        handler: async (args) => this.handleToolCall('check_realign_status', args as Record<string, unknown>),
      },
    ]
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'list_posts': return this.listPosts(args)
      case 'view_schedule_config': return this.viewScheduleConfig(args)
      case 'view_calendar': return this.viewCalendar(args)
      case 'reschedule_post': return this.reschedulePost(args)
      case 'cancel_post': return this.cancelPost(args)
      case 'find_next_slot': return this.findNextSlot(args)
      case 'realign_schedule': return this.realignSchedule(args)
      case 'start_prioritize_realign': return this.startPrioritizeRealign(args)
      case 'check_realign_status': return this.checkRealignStatus(args)
      default: return { error: `Unknown tool: ${toolName}` }
    }
  }

  private async listPosts(args: Record<string, unknown>): Promise<unknown> {
    try {
      const status = args.status as string | undefined
      const platform = args.platform as string | undefined
      const search = args.search as string | undefined
      const limit = (args.limit as number) ?? 100
      const client = new LateApiClient()

      // Fetch all posts — if no status specified, fetch all active statuses
      let posts: LatePost[]
      if (status) {
        posts = await client.listPosts({ status, platform })
      } else {
        const statuses = ['scheduled', 'draft', 'cancelled', 'failed']
        const results = await Promise.all(
          statuses.map(s => client.listPosts({ status: s, platform })),
        )
        posts = results.flat()
      }

      // Client-side search filter
      if (search) {
        const needle = search.toLowerCase()
        posts = posts.filter(p => (p.content ?? '').toLowerCase().includes(needle))
      }

      // Sort by scheduledFor (earliest first), unscheduled at end
      posts.sort((a, b) => {
        const at = a.scheduledFor ? new Date(a.scheduledFor).getTime() : Infinity
        const bt = b.scheduledFor ? new Date(b.scheduledFor).getTime() : Infinity
        return at - bt
      })

      // Limit results to save tokens
      const limited = posts.slice(0, limit)

      return {
        total: posts.length,
        returned: limited.length,
        posts: limited.map((p: LatePost) => ({
          id: p._id,
          content_preview: (p.content ?? '').slice(0, 120),
          platform: p.platforms.map(pl => pl.platform).join(', '),
          status: p.status,
          scheduledFor: p.scheduledFor ?? null,
        })),
      }
    } catch (err) {
      logger.error('list_posts failed', { error: err })
      return { error: `Failed to list posts: ${(err as Error).message}` }
    }
  }

  private async viewScheduleConfig(args: Record<string, unknown>): Promise<unknown> {
    try {
      const platform = args.platform as string | undefined
      const config = await loadScheduleConfig()
      if (platform) {
        const normalized = platform === 'twitter' ? 'x' : platform
        const platformConfig = config.platforms[normalized]
        if (!platformConfig) return { error: `No schedule config for platform: ${normalized}` }
        return { timezone: config.timezone, platform: normalized, schedule: platformConfig }
      }
      return config
    } catch (err) {
      logger.error('view_schedule_config failed', { error: err })
      return { error: `Failed to load schedule config: ${(err as Error).message}` }
    }
  }

  private async viewCalendar(args: Record<string, unknown>): Promise<unknown> {
    try {
      const days = (args.days as number) ?? 7
      const startDate = new Date()
      const endDate = new Date()
      endDate.setDate(endDate.getDate() + days)
      const calendar = await getScheduleCalendar(startDate, endDate)
      return { days, slots: calendar }
    } catch (err) {
      logger.error('view_calendar failed', { error: err })
      return { error: `Failed to get calendar: ${(err as Error).message}` }
    }
  }

  private async reschedulePost(args: Record<string, unknown>): Promise<unknown> {
    try {
      const postId = args.postId as string
      const scheduledFor = args.scheduledFor as string
      const client = new LateApiClient()
      const updated = await client.updatePost(postId, { scheduledFor, status: 'scheduled' })
      return { success: true, postId, scheduledFor: updated.scheduledFor }
    } catch (err) {
      logger.error('reschedule_post failed', { error: err })
      return { error: `Failed to reschedule post: ${(err as Error).message}` }
    }
  }

  private async cancelPost(args: Record<string, unknown>): Promise<unknown> {
    try {
      const postId = args.postId as string
      const client = new LateApiClient()
      await client.updatePost(postId, { status: 'cancelled' })
      return { success: true, postId, status: 'cancelled' }
    } catch (err) {
      logger.error('cancel_post failed', { error: err })
      return { error: `Failed to cancel post: ${(err as Error).message}` }
    }
  }

  private async findNextSlot(args: Record<string, unknown>): Promise<unknown> {
    try {
      const platform = args.platform as string
      const clipType = args.clipType as string | undefined
      const normalized = platform === 'twitter' ? 'x' : platform
      const slot = await findNextSlot(normalized, clipType)
      if (!slot) return { error: `No available slot found for ${normalized}` }
      return { platform: normalized, clipType: clipType ?? 'any', nextSlot: slot }
    } catch (err) {
      logger.error('find_next_slot failed', { error: err })
      return { error: `Failed to find next slot: ${(err as Error).message}` }
    }
  }

  private async realignSchedule(args: Record<string, unknown>): Promise<unknown> {
    try {
      const platform = args.platform as string | undefined
      const execute = (args.execute as boolean) ?? false
      const plan: RealignPlan = await buildRealignPlan({ platform })
      if (!execute) {
        return {
          preview: true,
          totalFetched: plan.totalFetched,
          toReschedule: plan.posts.length,
          toCancel: plan.toCancel.length,
          skipped: plan.skipped,
          unmatched: plan.unmatched,
          moves: plan.posts.map(p => ({
            postId: p.post._id,
            platform: p.platform,
            clipType: p.clipType,
            from: p.oldScheduledFor,
            to: p.newScheduledFor,
          })),
        }
      }
      const result = await executeRealignPlan(plan)
      return { executed: true, ...result }
    } catch (err) {
      logger.error('realign_schedule failed', { error: err })
      return { error: `Failed to realign schedule: ${(err as Error).message}` }
    }
  }

  private async startPrioritizeRealign(args: Record<string, unknown>): Promise<unknown> {
    try {
      const priorities = (args.priorities as PriorityRule[]) ?? []
      const platform = args.platform as string | undefined
      const dryRun = (args.dryRun as boolean) ?? true

      const jobId = `realign-${Date.now()}`
      const job: RealignJob = {
        id: jobId,
        status: 'planning',
        startedAt: new Date().toISOString(),
        progress: { completed: 0, total: 0, phase: 'planning' },
      }
      this.realignJobs.set(jobId, job)

      // Fire-and-forget — runs in background
      this.runRealignJob(job, priorities, platform, dryRun).catch((err) => {
        job.status = 'failed'
        job.error = err instanceof Error ? err.message : String(err)
        job.completedAt = new Date().toISOString()
        logger.error('Realign job failed', { jobId, error: err })
      })

      return {
        started: true,
        jobId,
        dryRun,
        message: `Prioritized realignment started. Use check_realign_status with jobId "${jobId}" to monitor progress.`,
      }
    } catch (err) {
      logger.error('start_prioritize_realign failed', { error: err })
      return { error: `Failed to start prioritize realign: ${(err as Error).message}` }
    }
  }

  private async runRealignJob(
    job: RealignJob,
    priorities: PriorityRule[],
    platform: string | undefined,
    dryRun: boolean,
  ): Promise<void> {
    // Phase 1: Build plan
    const plan: RealignPlan = await buildPrioritizedRealignPlan({ priorities, platform })
    job.plan = {
      totalFetched: plan.totalFetched,
      toReschedule: plan.posts.length,
      toCancel: plan.toCancel.length,
      skipped: plan.skipped,
      unmatched: plan.unmatched,
    }

    if (dryRun) {
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      job.result = { updated: 0, cancelled: 0, failed: 0, errors: [] }
      return
    }

    // Phase 2: Execute
    job.status = 'executing'
    job.progress = { completed: 0, total: plan.toCancel.length + plan.posts.length, phase: 'cancelling' }

    const result = await executeRealignPlan(plan, (completed, total, phase) => {
      job.progress = { completed, total, phase }
    })

    job.status = 'completed'
    job.completedAt = new Date().toISOString()
    job.result = result
  }

  private async checkRealignStatus(args: Record<string, unknown>): Promise<unknown> {
    const jobId = args.jobId as string
    const job = this.realignJobs.get(jobId)
    if (!job) return { error: `No realign job found with ID: ${jobId}` }

    const response: Record<string, unknown> = {
      jobId: job.id,
      status: job.status,
      startedAt: job.startedAt,
      progress: job.progress,
    }

    if (job.plan) response.plan = job.plan
    if (job.completedAt) response.completedAt = job.completedAt
    if (job.result) response.result = job.result
    if (job.error) response.error = job.error

    return response
  }
}
