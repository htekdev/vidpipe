import type { ToolWithHandler, MCPServerConfig } from '../providers/types.js'
import * as fs from 'fs'
import * as path from 'path'
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

## Quality Requirements

Your blog post MUST be:
- **Coherent**: Ideas flow logically from one to the next with smooth transitions
- **Comprehensive**: Cover all major points from the video, not just surface-level mentions
- **Engaging**: Start with a compelling hook that makes the reader want to continue
- **Educational**: Explain concepts clearly with examples where appropriate
- **Well-structured**: Use clear headings, short paragraphs, and logical organization
- **Technically accurate**: When discussing code or technical concepts, be precise
- **Contextual**: Provide enough background so readers unfamiliar with the topic can follow along

## Required Structure

The blog post MUST include these sections in order:

1. **dev.to frontmatter** (title, published: false, description, tags, cover_image placeholder)
   - Title should be compelling and descriptive (not generic)
   - Description should summarize the value proposition (what will readers learn?)
   - Tags should be relevant and specific (4-5 tags)

2. **Introduction** (2-3 paragraphs)
   - Start with a relatable hook that captures attention
   - Explain what problem or topic you're addressing
   - Preview what the reader will learn

3. **Main Content** (3-5 sections with descriptive headings)
   - Use clear, descriptive section headings (not generic like "Section 1")
   - Each section should focus on one key concept or point
   - Use subheadings where appropriate to break up long sections
   - Include code snippets with proper language tags when discussing code
   - Use bullet points or numbered lists to organize complex information
   - Add relevant links from web search results naturally within the text

4. **Key Takeaways** (bullet list of 3-5 main points)
   - Summarize the most important lessons or insights
   - Make each point actionable or memorable

5. **Conclusion** (1-2 paragraphs)
   - Recap the main value delivered
   - Encourage reader action or further exploration
   - End with an engaging question or call-to-action

6. **Video Reference Footer**
   - Natural reference to the original video
   - Brief mention that this content is based on the video

## Content Development Process

1. **First, use "web_search_exa" to gather context:**
   - Search for the main technical topics mentioned in the video
   - Look for relevant articles, documentation, or tutorials
   - Aim for 2-4 high-quality searches on different aspects

2. **Then, write the complete blog post:**
   - Synthesize information from the transcript, summary, and search results
   - Weave external links organically into the narrative (don't dump them at the end)
   - Ensure smooth transitions between sections
   - Maintain the author's voice throughout
   - Double-check that all major points from the video are covered

3. **Finally, call "write_blog" exactly once with:**
   - Complete frontmatter object
   - Full markdown body including all sections

## Writing Guidelines

- **Paragraphs**: Keep them short (2-4 sentences max)
- **Sentences**: Vary length but prefer clear, direct statements
- **Technical terms**: Explain on first use, link to references
- **Code blocks**: Always include language tags (\`\`\`typescript, \`\`\`python, etc.)
- **Examples**: Use concrete examples to illustrate abstract concepts
- **Transitions**: Use connecting phrases between sections ("Now that we've...", "Building on this...", "Let's explore...")
- **Tone**: ${brand.voice.tone} throughout — authentic enthusiasm, not forced hype

Remember: Your goal is to create a blog post that someone would genuinely want to read and share, not just a mechanical transcript conversion.`
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
      '## Transcript (first 12000 chars)',
      transcript.text.slice(0, 12000),
    ].join('\n')

    await agent.run(userMessage)

    const blogContent = agent.getBlogContent()
    if (!blogContent) {
      throw new Error('BlogAgent did not produce any blog content')
    }

    const outDir = path.join(video.videoDir, 'social-posts')
    fs.mkdirSync(outDir, { recursive: true })

    const outputPath = path.join(outDir, 'devto.md')
    fs.writeFileSync(outputPath, renderBlogMarkdown(blogContent), 'utf-8')
    logger.info(`[BlogAgent] Wrote blog post to ${outputPath}`)

    return outputPath
  } finally {
    await agent.destroy()
  }
}
