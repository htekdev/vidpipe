/**
 * BlogAsset Class
 *
 * Represents a blog post generated from a video.
 * Extends TextAsset to provide lazy loading and caching of blog content.
 *
 * The blog post is stored as a Markdown file with YAML frontmatter
 * containing metadata like title, description, tags, etc.
 */
import { TextAsset } from './TextAsset.js'
import type { AssetOptions } from './Asset.js'
import { join } from '../L1-infra/paths/paths.js'
import type { MainVideoAsset } from './MainVideoAsset.js'

/**
 * YAML frontmatter for the blog post.
 */
export interface BlogFrontmatter {
  /** Blog post title */
  title: string
  /** SEO description / subtitle */
  description: string
  /** Tags for categorization */
  tags: string[]
  /** Whether the post is published */
  published: boolean
  /** Publication date (ISO format) */
  date: string
}

/**
 * Asset representing a blog post generated from a video.
 *
 * The blog post is stored as `blog-post.md` in the video's directory.
 * It includes YAML frontmatter with metadata and Markdown body content.
 *
 * Note: Generation requires VideoSummary object (with title, overview, keyTopics)
 * which is produced by the pipeline's summary stage. Use pipeline to generate.
 */
export class BlogAsset extends TextAsset {
  /** Reference to the video this blog is about */
  readonly parent: MainVideoAsset

  /** Path to the blog post file */
  readonly filePath: string

  constructor(parent: MainVideoAsset) {
    super()
    this.parent = parent
    this.filePath = join(parent.videoDir, 'blog-post.md')
  }

  /**
   * Parse frontmatter from the blog post.
   *
   * Extracts YAML frontmatter from between `---` delimiters.
   *
   * @returns Parsed frontmatter or null if file doesn't exist or has no frontmatter
   */
  async getFrontmatter(): Promise<BlogFrontmatter | null> {
    const content = await this.loadFromDisk()
    if (!content) {
      return null
    }

    return this.parseFrontmatter(content)
  }

  /**
   * Parse YAML frontmatter from markdown content.
   *
   * @param content - Markdown content with optional frontmatter
   * @returns Parsed frontmatter or null if not present
   */
  private parseFrontmatter(content: string): BlogFrontmatter | null {
    // Check for frontmatter delimiters
    if (!content.startsWith('---')) {
      return null
    }

    // Find closing delimiter
    const endIndex = content.indexOf('---', 3)
    if (endIndex === -1) {
      return null
    }

    const yamlContent = content.slice(3, endIndex).trim()
    if (!yamlContent) {
      return null
    }

    // Parse YAML manually (simple key: value format)
    const frontmatter: Partial<BlogFrontmatter> = {
      tags: [],
      published: false,
    }

    const lines = yamlContent.split('\n')
    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()

      switch (key) {
        case 'title':
          frontmatter.title = this.unquote(value)
          break
        case 'description':
          frontmatter.description = this.unquote(value)
          break
        case 'published':
          frontmatter.published = value === 'true'
          break
        case 'date':
          frontmatter.date = this.unquote(value)
          break
        case 'tags':
          // Handle both "tag1, tag2" and "tag1,tag2" formats
          frontmatter.tags = value
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
          break
      }
    }

    // Validate required fields
    if (!frontmatter.title || !frontmatter.description) {
      return null
    }

    return {
      title: frontmatter.title,
      description: frontmatter.description,
      tags: frontmatter.tags ?? [],
      published: frontmatter.published ?? false,
      date: frontmatter.date ?? new Date().toISOString().split('T')[0],
    }
  }

  /**
   * Remove surrounding quotes from a string.
   */
  private unquote(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1)
    }
    return value
  }

  /**
   * Get the blog content.
   *
   * Loads from disk if exists. Generation requires VideoSummary object
   * which is produced by the pipeline's summary stage - use pipeline to generate.
   *
   * @param opts - Options controlling generation behavior
   * @returns The blog post content
   * @throws Error if blog post doesn't exist (generation happens via pipeline)
   */
  async getResult(opts?: AssetOptions): Promise<string> {
    // Return cached result if available and not forcing regeneration
    if (!opts?.force && this._result !== undefined) {
      return this._result
    }

    // Try to load from disk
    const content = await this.loadFromDisk()
    if (content !== null) {
      this._result = content
      return content
    }

    // Blog generation requires VideoSummary object (title, overview, keyTopics)
    // which is produced by the pipeline's summary stage
    throw new Error(
      `Blog post not found at ${this.filePath}. ` +
        `Run the pipeline to generate (requires VideoSummary from summary stage).`,
    )
  }
}
