import { BaseAgent } from './BaseAgent.js'
import { LateApiClient } from '../L3-services/lateApi/lateApiService.js'
import { findNextSlot, getScheduleCalendar } from '../L3-services/scheduler/scheduler.js'
import { loadScheduleConfig } from '../L3-services/scheduler/scheduleConfig.js'
import { buildRealignPlan, executeRealignPlan } from '../L3-services/scheduler/realign.js'
import logger from '../L1-infra/logger/configLogger.js'
import type { LatePost } from '../L3-services/lateApi/lateApiService.js'
import type { RealignPlan } from '../L3-services/scheduler/realign.js'
import type { ToolWithHandler, UserInputHandler, LLMSession } from '../L3-services/llm/providerFactory.js'

/** Friendly labels for tool calls shown in chat mode */
const TOOL_LABELS: Record<string, string> = {
  list_posts: '📋 Listing posts',
  view_schedule_config: '⚙️  Loading schedule config',
  view_calendar: '📅 Loading calendar',
  reschedule_post: '🔄 Rescheduling post',
  cancel_post: '🚫 Cancelling post',
  swap_posts: '🔀 Swapping posts',
  find_next_slot: '🔍 Finding next slot',
  realign_schedule: '📐 Running realignment',
  ask_user: '💬 Asking for your input',
}

const SYSTEM_PROMPT = `You are a schedule management assistant for Late.co social media posts.

You help the user view, analyze, and reprioritize their posting schedule across platforms.

Available platforms: x (twitter), youtube, tiktok, instagram, linkedin
Clip types: short (15-60s vertical clips), medium-clip (60-180s clips), video (full-length)

When listing posts, always show content previews (first 60 chars) so the user can identify them.
Use ask_user when you need clarification on priorities or decisions — never guess at user intent.
Be concise and actionable. Prefer tables or bullet lists over prose.`

export class ScheduleAgent extends BaseAgent {
  private userInputHandler?: UserInputHandler
  private chatOutput?: (message: string) => void

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
        name: 'swap_posts',
        description: 'Swap the scheduled times of two posts.',
        parameters: {
          type: 'object',
          properties: {
            postId1: { type: 'string', description: 'First post ID' },
            postId2: { type: 'string', description: 'Second post ID' },
          },
          required: ['postId1', 'postId2'],
        },
        handler: async (args) => this.handleToolCall('swap_posts', args as Record<string, unknown>),
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
    ]
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'list_posts': return this.listPosts(args)
      case 'view_schedule_config': return this.viewScheduleConfig(args)
      case 'view_calendar': return this.viewCalendar(args)
      case 'reschedule_post': return this.reschedulePost(args)
      case 'cancel_post': return this.cancelPost(args)
      case 'swap_posts': return this.swapPosts(args)
      case 'find_next_slot': return this.findNextSlot(args)
      case 'realign_schedule': return this.realignSchedule(args)
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

  private async swapPosts(args: Record<string, unknown>): Promise<unknown> {
    try {
      const postId1 = args.postId1 as string
      const postId2 = args.postId2 as string
      const client = new LateApiClient()
      const allPosts = await client.listPosts({ status: 'scheduled' })
      const post1 = allPosts.find(p => p._id === postId1)
      const post2 = allPosts.find(p => p._id === postId2)
      if (!post1) return { error: `Post not found: ${postId1}` }
      if (!post2) return { error: `Post not found: ${postId2}` }
      const time1 = post1.scheduledFor
      const time2 = post2.scheduledFor
      await Promise.all([
        client.updatePost(postId1, { scheduledFor: time2 }),
        client.updatePost(postId2, { scheduledFor: time1 }),
      ])
      return {
        success: true,
        post1: { id: postId1, oldTime: time1, newTime: time2 },
        post2: { id: postId2, oldTime: time2, newTime: time1 },
      }
    } catch (err) {
      logger.error('swap_posts failed', { error: err })
      return { error: `Failed to swap posts: ${(err as Error).message}` }
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
}
