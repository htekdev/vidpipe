import { BaseAgent } from './BaseAgent.js'
import { createLateApiClient } from '../L3-services/lateApi/lateApiService.js'
import { loadScheduleConfig } from '../L3-services/scheduler/scheduleConfig.js'
import logger from '../L1-infra/logger/configLogger.js'
import type { LatePost } from '../L3-services/lateApi/lateApiService.js'
import type { ToolWithHandler, UserInputHandler, LLMSession } from '../L3-services/llm/providerFactory.js'

/** Friendly labels for tool calls shown in chat mode */
const TOOL_LABELS: Record<string, string> = {
  list_posts: '📋 Listing posts',
  view_schedule_config: '⚙️  Loading schedule config',
  reschedule_post: '🔄 Rescheduling post',
  cancel_post: '🚫 Cancelling post',
  ask_user: '💬 Asking for your input',
}

const SYSTEM_PROMPT = `You are a schedule management assistant for Late.co social media posts.

You help the user view, analyze, and manage their posting schedule across platforms.

Available platforms: x (twitter), youtube, tiktok, instagram, linkedin
Clip types: short (15-60s vertical clips), medium-clip (60-180s clips), video (full-length)

When listing posts, always show content previews (first 60 chars) so the user can identify them.
Use ask_user when you need clarification on priorities or decisions — never guess at user intent.
Be concise and actionable. Prefer tables or bullet lists over prose.

Schedule management is handled by the Late API queue scheduler. Use list_posts to view scheduled
content, reschedule_post to move posts, and cancel_post to remove them.`

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
    ]
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'list_posts': return this.listPosts(args)
      case 'view_schedule_config': return this.viewScheduleConfig(args)
      case 'reschedule_post': return this.reschedulePost(args)
      case 'cancel_post': return this.cancelPost(args)
      default: return { error: `Unknown tool: ${toolName}` }
    }
  }

  private async listPosts(args: Record<string, unknown>): Promise<unknown> {
    try {
      const status = args.status as string | undefined
      const platform = args.platform as string | undefined
      const search = args.search as string | undefined
      const limit = (args.limit as number) ?? 100
      const client = createLateApiClient()

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

  private async reschedulePost(args: Record<string, unknown>): Promise<unknown> {
    try {
      const postId = args.postId as string
      const scheduledFor = args.scheduledFor as string
      const client = createLateApiClient()
      const updated = await client.schedulePost(postId, scheduledFor)
      return { success: true, postId, scheduledFor: updated.scheduledFor }
    } catch (err) {
      logger.error('reschedule_post failed', { error: err })
      return { error: `Failed to reschedule post: ${(err as Error).message}` }
    }
  }

  private async cancelPost(args: Record<string, unknown>): Promise<unknown> {
    try {
      const postId = args.postId as string
      const client = createLateApiClient()
      await client.updatePost(postId, { status: 'cancelled' })
      return { success: true, postId, status: 'cancelled' }
    } catch (err) {
      logger.error('cancel_post failed', { error: err })
      return { error: `Failed to cancel post: ${(err as Error).message}` }
    }
  }

}
