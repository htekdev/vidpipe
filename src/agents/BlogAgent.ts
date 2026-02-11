import type { ToolWithHandler, MCPServerConfig } from '../providers/types.js'
import { ensureDirectorySync, writeTextFileSync } from '../core/fileSystem.js'
import { join } from '../core/paths.js'
import { BaseAgent } from './BaseAgent'
import logger from '../config/logger'
import { getBrandConfig } from '../config/brand'
import { getConfig } from '../config/environment.js'
import type { Transcript, VideoFile, VideoSummary } from '../types'

// ── Tool argument shapes ────────────────────────────────────────────────────

interface WriteBlogArgs {
  frontmatter: {
    title: string
    description: string
    tags: string[]
    cover_image?: string
  }
  body: string
}

// ── Build system prompt from brand config ───────────────────────────────────

function buildSystemPrompt(): string {
  const brand = getBrandConfig()

  return `You are a technical blog writer for dev.to, writing from the perspective of ${brand.name} (${brand.handle}).

Voice & style:
- Tone: ${brand.voice.tone}
- Personality: ${brand.voice.personality}
- Style: ${brand.voice.style}

Content guidelines: ${brand.contentGuidelines.blogFocus}

Your task is to generate a full dev.to-style technical blog post (800-1500 words) based on a video transcript and summary.

The blog post MUST include:
1. dev.to frontmatter (title, published: false, description, tags, cover_image placeholder)
2. An engaging introduction with a hook
3. Clear sections covering the main content (e.g. The Problem, The Solution, How It Works)
4. Code snippets where the video content discusses code — use fenced code blocks with language tags
5. Key Takeaways section
6. A conclusion
7. A footer referencing the original video

Workflow:
1. First use the "web_search_exa" tool to search for relevant articles and resources to link to. Search for key topics from the video.
2. Then call "write_blog" with the complete blog post including frontmatter and body.
   - Weave the search result links organically into the post text (don't dump them at the end).
   - Reference the video and any shorts naturally.

Always call "write_blog" exactly once with the complete post.`
}

// ── Agent ────────────────────────────────────────────────────────────────────

class BlogAgent extends BaseAgent {
  private blogContent: WriteBlogArgs | null = null

  constructor(model?: string) {
    super('BlogAgent', buildSystemPrompt(), undefined, model)
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
        name: 'write_blog',
        description:
          'Submit the complete dev.to blog post with frontmatter and markdown body.',
        parameters: {
          type: 'object',
          properties: {
            frontmatter: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                cover_image: { type: 'string' },
              },
              required: ['title', 'description', 'tags'],
            },
            body: {
              type: 'string',
              description: 'The full markdown body of the blog post (excluding frontmatter)',
            },
          },
          required: ['frontmatter', 'body'],
        },
        handler: async (args: unknown) => {
          const blogArgs = args as WriteBlogArgs
          this.blogContent = blogArgs
          logger.info(`[BlogAgent] write_blog received post: "${blogArgs.frontmatter.title}"`)
          return JSON.stringify({ success: true })
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    _args: Record<string, unknown>,
  ): Promise<unknown> {
    logger.warn(`[BlogAgent] Unexpected handleToolCall for "${toolName}"`)
    return { error: `Unknown tool: ${toolName}` }
  }

  getBlogContent(): WriteBlogArgs | null {
    return this.blogContent
  }
}

// ── Render the final markdown ───────────────────────────────────────────────

function renderBlogMarkdown(blog: WriteBlogArgs): string {
  const fm = blog.frontmatter
  const tags = fm.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')).join(', ')

  const lines: string[] = [
    '---',
    `title: "${fm.title}"`,
    'published: false',
    `description: "${fm.description}"`,
    `tags: ${tags}`,
    `cover_image: ${fm.cover_image || ''}`,
    '---',
    '',
    blog.body,
  ]

  return lines.join('\n')
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function generateBlogPost(
  video: VideoFile,
  transcript: Transcript,
  summary: VideoSummary,
  model?: string,
): Promise<string> {
  const agent = new BlogAgent(model)

  try {
    const userMessage = [
      '## Video Metadata',
      `- **Title:** ${summary.title}`,
      `- **Slug:** ${video.slug}`,
      `- **Duration:** ${video.duration}s`,
      `- **Recorded:** ${video.createdAt.toISOString().split('T')[0]}`,
      '',
      '## Summary',
      summary.overview,
      '',
      '## Key Topics',
      summary.keyTopics.map((t) => `- ${t}`).join('\n'),
      '',
      '## Transcript (first 6000 chars)',
      transcript.text.slice(0, 6000),
    ].join('\n')

    await agent.run(userMessage)

    const blogContent = agent.getBlogContent()
    if (!blogContent) {
      throw new Error('BlogAgent did not produce any blog content')
    }

    const outDir = join(video.videoDir, 'social-posts')
    ensureDirectorySync(outDir)

    const outputPath = join(outDir, 'devto.md')
    writeTextFileSync(outputPath, renderBlogMarkdown(blogContent))
    logger.info(`[BlogAgent] Wrote blog post to ${outputPath}`)

    return outputPath
  } finally {
    await agent.destroy()
  }
}
