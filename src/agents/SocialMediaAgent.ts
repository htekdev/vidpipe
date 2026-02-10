import type { ToolWithHandler } from '../providers/types.js'
import * as fs from 'fs'
import * as path from 'path'
import { BaseAgent } from './BaseAgent'
import logger from '../config/logger'
import type { MCPServerConfig } from '../providers/types.js'
import { getConfig } from '../config/environment.js'
import {
  Platform,
  ShortClip,
  SocialPost,
  Transcript,
  VideoFile,
  VideoSummary,
} from '../types'

// ── JSON shape the LLM returns via the create_posts tool ────────────────────

interface PlatformPost {
  platform: string
  content: string
  hashtags: string[]
  links: string[]
  characterCount: number
}

interface CreatePostsArgs {
  posts: PlatformPost[]
}

// ── System prompt───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a viral social-media content strategist.
Given a video transcript and summary you MUST generate one post for each of the 6 platforms listed below.
Each post must match the platform's tone, format, and constraints exactly.

Platform guidelines:
1. **TikTok** – Casual, hook-driven, trending hashtags, 150 chars max, emoji-heavy.
2. **YouTube** – Descriptive, SEO-optimized title + description, relevant tags.
3. **Instagram** – Visual storytelling, emoji-rich, 30 hashtags max, engaging caption.
4. **LinkedIn** – Professional, thought-leadership, industry insights, 1-3 hashtags.
5. **X (Twitter)** – Concise, punchy, 280 chars max, 2-5 hashtags, thread-ready.
6. **Facebook** – Conversational, community-focused, storytelling, 400 chars recommended, 2-5 hashtags, emoji-friendly.

IMPORTANT – Content format:
The "content" field you provide must be the FINAL, ready-to-post text that can be directly copied and pasted onto the platform. Do NOT use markdown headers, bullet points, or any formatting inside the content. Include hashtags inline at the end of the post text where appropriate. The content is saved as-is for direct posting.

Workflow:
1. First use the "web_search_exa" tool to search for relevant URLs based on the key topics discussed in the video.
2. Then call the "create_posts" tool with a JSON object that has a "posts" array.
   Each element must have: platform, content, hashtags (array), links (array), characterCount.

Include relevant links in posts when search results provide them.
Always call "create_posts" exactly once with all 6 platform posts.`

// ── Agent ────────────────────────────────────────────────────────────────────

class SocialMediaAgent extends BaseAgent {
  private collectedPosts: PlatformPost[] = []

  constructor(model?: string) {
    super('SocialMediaAgent', SYSTEM_PROMPT, undefined, model)
  }

  protected getMcpServers(): Record<string, MCPServerConfig> | undefined {
    const config = getConfig()
    if (!config.EXA_API_KEY) return undefined
    return {
      exa: {
        type: 'http' as const,
        url: `${config.EXA_MCP_URL}?exaApiKey=${config.EXA_API_KEY}&tools=web_search_exa`,
        headers: {},
        tools: ['*'],
      },
    }
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'create_posts',
        description:
          'Submit the generated social media posts for all 6 platforms.',
        parameters: {
          type: 'object',
          properties: {
            posts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  platform: { type: 'string' },
                  content: { type: 'string' },
                  hashtags: { type: 'array', items: { type: 'string' } },
                  links: { type: 'array', items: { type: 'string' } },
                  characterCount: { type: 'number' },
                },
                required: ['platform', 'content', 'hashtags', 'links', 'characterCount'],
              },
              description: 'Array of posts, one per platform',
            },
          },
          required: ['posts'],
        },
        handler: async (args: unknown) => {
          const { posts } = args as CreatePostsArgs
          this.collectedPosts = posts
          logger.info(`[SocialMediaAgent] create_posts received ${posts.length} posts`)
          return JSON.stringify({ success: true, count: posts.length })
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    // Tool dispatch is handled inline via tool handlers above.
    // This satisfies the abstract contract from BaseAgent.
    logger.warn(`[SocialMediaAgent] Unexpected handleToolCall for "${toolName}"`)
    return { error: `Unknown tool: ${toolName}` }
  }

  getCollectedPosts(): PlatformPost[] {
    return this.collectedPosts
  }
}

// ── Helper: map raw platform string → Platform enum ─────────────────────────

function toPlatformEnum(raw: string): Platform {
  const normalised = raw.toLowerCase().trim()
  switch (normalised) {
    case 'tiktok':
      return Platform.TikTok
    case 'youtube':
      return Platform.YouTube
    case 'instagram':
      return Platform.Instagram
    case 'linkedin':
      return Platform.LinkedIn
    case 'x':
    case 'twitter':
      return Platform.X
    case 'facebook':
      return Platform.Facebook
    default:
      return normalised as Platform
  }
}

// ── Helper: render a post file with YAML frontmatter ───────────────────────

interface RenderPostOpts {
  videoSlug: string
  shortSlug?: string | null
}

function renderPostFile(post: PlatformPost, opts: RenderPostOpts): string {
  const now = new Date().toISOString()
  const platform = toPlatformEnum(post.platform)
  const lines: string[] = ['---']

  lines.push(`platform: ${platform}`)
  lines.push(`status: draft`)
  lines.push(`scheduledDate: null`)

  if (post.hashtags.length > 0) {
    lines.push('hashtags:')
    for (const tag of post.hashtags) {
      lines.push(`  - "${tag}"`)
    }
  } else {
    lines.push('hashtags: []')
  }

  if (post.links.length > 0) {
    lines.push('links:')
    for (const link of post.links) {
      lines.push(`  - url: "${link}"`)
      lines.push(`    title: null`)
    }
  } else {
    lines.push('links: []')
  }

  lines.push(`characterCount: ${post.characterCount}`)
  lines.push(`videoSlug: "${opts.videoSlug}"`)
  lines.push(`shortSlug: ${opts.shortSlug ? `"${opts.shortSlug}"` : 'null'}`)
  lines.push(`createdAt: "${now}"`)
  lines.push('---')
  lines.push('')
  lines.push(post.content)
  lines.push('')

  return lines.join('\n')
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function generateShortPosts(
  video: VideoFile,
  short: ShortClip,
  transcript: Transcript,
  model?: string,
): Promise<SocialPost[]> {
  const agent = new SocialMediaAgent(model)

  try {
    // Extract transcript segments that overlap with the short's time ranges
    const relevantText = transcript.segments
      .filter((seg) =>
        short.segments.some((ss) => seg.start < ss.end && seg.end > ss.start),
      )
      .map((seg) => seg.text)
      .join(' ')

    const userMessage = [
      '## Short Clip Metadata',
      `- **Title:** ${short.title}`,
      `- **Description:** ${short.description}`,
      `- **Duration:** ${short.totalDuration.toFixed(1)}s`,
      `- **Tags:** ${short.tags.join(', ')}`,
      '',
      '## Relevant Transcript',
      relevantText.slice(0, 3000),
    ].join('\n')

    await agent.run(userMessage)

    const collectedPosts = agent.getCollectedPosts()

    // Save posts to recordings/{slug}/shorts/{short-slug}/posts/
    const shortsDir = path.join(path.dirname(video.repoPath), 'shorts')
    const postsDir = path.join(shortsDir, short.slug, 'posts')
    fs.mkdirSync(postsDir, { recursive: true })

    const socialPosts: SocialPost[] = collectedPosts.map((p) => {
      const platform = toPlatformEnum(p.platform)
      const outputPath = path.join(postsDir, `${platform}.md`)

      fs.writeFileSync(
        outputPath,
        renderPostFile(p, { videoSlug: video.slug, shortSlug: short.slug }),
        'utf-8',
      )
      logger.info(`[SocialMediaAgent] Wrote short post ${outputPath}`)

      return {
        platform,
        content: p.content,
        hashtags: p.hashtags,
        links: p.links,
        characterCount: p.characterCount,
        outputPath,
      }
    })

    return socialPosts
  } finally {
    await agent.destroy()
  }
}

export async function generateSocialPosts(
  video: VideoFile,
  transcript: Transcript,
  summary: VideoSummary,
  outputDir?: string,
  model?: string,
): Promise<SocialPost[]> {
  const agent = new SocialMediaAgent(model)

  try {
    // Build the user prompt with transcript summary and metadata
    const userMessage = [
      '## Video Metadata',
      `- **Title:** ${summary.title}`,
      `- **Slug:** ${video.slug}`,
      `- **Duration:** ${video.duration}s`,
      '',
      '## Summary',
      summary.overview,
      '',
      '## Key Topics',
      summary.keyTopics.map((t) => `- ${t}`).join('\n'),
      '',
      '## Transcript (first 3000 chars)',
      transcript.text.slice(0, 3000),
    ].join('\n')

    await agent.run(userMessage)

    const collectedPosts = agent.getCollectedPosts()

    // Ensure the output directory exists
    const outDir = outputDir ?? path.join(video.videoDir, 'social-posts')
    fs.mkdirSync(outDir, { recursive: true })

    const socialPosts: SocialPost[] = collectedPosts.map((p) => {
      const platform = toPlatformEnum(p.platform)
      const outputPath = path.join(outDir, `${platform}.md`)

      fs.writeFileSync(
        outputPath,
        renderPostFile(p, { videoSlug: video.slug }),
        'utf-8',
      )
      logger.info(`[SocialMediaAgent] Wrote ${outputPath}`)

      return {
        platform,
        content: p.content,
        hashtags: p.hashtags,
        links: p.links,
        characterCount: p.characterCount,
        outputPath,
      }
    })

    return socialPosts
  } finally {
    await agent.destroy()
  }
}
