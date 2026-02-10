import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tool } from '@github/copilot-sdk';

// ── Shared state via vi.hoisted (available to mock factories) ───────────────

const mockState = vi.hoisted(() => {
  const state = {
    capturedTools: [] as any[],
    mockSession: {
      sendAndWait: async () => ({ data: { content: '' } }),
      on: () => {},
      destroy: async () => {},
    },
  };
  return state;
});

// ── Mocks — must be declared before imports ─────────────────────────────────

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: function CopilotClientMock() {
    return {
      createSession: async (opts: any) => {
        mockState.capturedTools.length = 0;
        mockState.capturedTools.push(...(opts.tools || []));
        return mockState.mockSession;
      },
      stop: async () => {},
    };
  },
  CopilotSession: function CopilotSessionMock() {},
}));

vi.mock('../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../config/brand.js', () => ({
  getBrandConfig: () => ({
    name: 'TestBrand',
    handle: '@test',
    tagline: 'test tagline',
    voice: { tone: 'friendly', personality: 'helpful', style: 'concise' },
    advocacy: { interests: ['testing'], avoids: ['nothing'] },
    contentGuidelines: { blogFocus: 'testing focus' },
  }),
}));

vi.mock('../config/environment.js', () => ({
  getConfig: () => ({
    OUTPUT_DIR: '/tmp/test-output',
    LLM_PROVIDER: 'copilot',
    LLM_MODEL: '',
    EXA_API_KEY: '',
    EXA_MCP_URL: 'https://mcp.exa.ai/mcp',
  }),
}));

vi.mock('../tools/ffmpeg/clipExtraction.js', () => ({
  extractClip: vi.fn().mockResolvedValue(undefined),
  extractCompositeClip: vi.fn().mockResolvedValue(undefined),
  extractCompositeClipWithTransitions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tools/ffmpeg/captionBurning.js', () => ({
  burnCaptions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tools/ffmpeg/aspectRatio.js', () => ({
  generatePlatformVariants: vi.fn().mockResolvedValue([]),
}));

vi.mock('../tools/ffmpeg/silenceDetection.js', () => ({
  detectSilence: vi.fn().mockResolvedValue([]),
}));

vi.mock('../tools/ffmpeg/singlePassEdit.js', () => ({
  singlePassEdit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tools/ffmpeg/frameCapture.js', () => ({
  captureFrame: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tools/captions/captionGenerator.js', () => ({
  generateStyledASSForSegment: vi.fn().mockReturnValue(''),
  generateStyledASSForComposite: vi.fn().mockReturnValue(''),
}));

vi.mock('fluent-ffmpeg', () => {
  const mock: any = function () {};
  mock.setFfmpegPath = () => {};
  mock.setFfprobePath = () => {};
  mock.ffprobe = (_p: string, cb: Function) => cb(null, { format: { duration: 300 } });
  return { default: mock };
});

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

vi.mock('slugify', () => ({
  default: (s: string) => s.toLowerCase().replace(/\s+/g, '-'),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn().mockReturnValue(false),
    },
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

// ── Import REAL agents (BaseAgent for construction tests) ───────────────────

import { BaseAgent } from '../agents/BaseAgent.js';

// ── Test helpers ────────────────────────────────────────────────────────────

const mockInvocation = {
  sessionId: 's1',
  toolCallId: 'tc1',
  toolName: 'test',
  arguments: {},
} as any;

function findCapturedTool(name: string): Tool<unknown> {
  const tool = mockState.capturedTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not captured — was the agent's run() called?`);
  return tool;
}

// ── Mock fixtures ───────────────────────────────────────────────────────────

const mockVideo = {
  filename: 'test.mp4',
  repoPath: '/tmp/test.mp4',
  slug: 'test-video',
  videoDir: '/tmp',
  duration: 300,
  createdAt: new Date(),
} as any;

const mockTranscriptWithWords = {
  duration: 300,
  text: 'Hello world',
  segments: [
    {
      start: 0,
      end: 10,
      text: 'Hello world',
      words: [
        { start: 0, end: 0.5, word: 'Hello' },
        { start: 0.6, end: 1.0, word: 'world' },
      ],
    },
  ],
} as any;

const mockTranscript = {
  duration: 300,
  text: 'Hello world',
  segments: [{ start: 0, end: 10, text: 'Hello world' }],
} as any;

const mockSummary = {
  title: 'Test',
  overview: 'An overview',
  keyTopics: ['topic1'],
  snapshots: [],
  markdownPath: '/tmp/README.md',
} as any;

// ── BaseAgent tests ─────────────────────────────────────────────────────────

describe('BaseAgent construction', () => {
  class MinimalAgent extends BaseAgent {
    constructor() {
      super('Minimal', 'prompt');
    }
    protected async handleToolCall(_t: string, _a: Record<string, unknown>) {
      return {};
    }
  }

  it('stores agent name and system prompt', () => {
    const agent = new MinimalAgent();
    expect((agent as any).agentName).toBe('Minimal');
    expect((agent as any).systemPrompt).toBe('prompt');
  });

  it('initialises with provider and null session', () => {
    const agent = new MinimalAgent();
    expect((agent as any).provider).toBeDefined();
    expect((agent as any).session).toBeNull();
  });

  it('destroy is safe to call on uninitialised agent', async () => {
    const agent = new MinimalAgent();
    await expect(agent.destroy()).resolves.toBeUndefined();
  });
});

// ── ShortsAgent (REAL) ──────────────────────────────────────────────────────

describe('Real ShortsAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('plan_shorts tool: schema, handler stores shorts and returns count', async () => {
    const { generateShorts } = await import('../agents/ShortsAgent.js');

    // generateShorts calls agent.run() → createSession captures tools
    const result = await generateShorts(mockVideo, mockTranscriptWithWords);

    // Mock session returns no tool calls, so no shorts planned
    expect(result).toEqual([]);

    // Verify captured tool
    const planTool = findCapturedTool('plan_shorts');
    expect(planTool.description).toContain('planned shorts');

    // Verify schema
    const schema = planTool.parameters as any;
    expect(schema.required).toContain('shorts');
    expect(schema.properties.shorts.type).toBe('array');
    expect(schema.properties.shorts.items.required).toEqual(
      expect.arrayContaining(['title', 'description', 'tags', 'segments']),
    );

    const segmentSchema = schema.properties.shorts.items.properties.segments.items;
    expect(segmentSchema.required).toEqual(
      expect.arrayContaining(['start', 'end', 'description']),
    );
    expect(segmentSchema.properties.start.type).toBe('number');

    // Call the REAL handler
    const handlerResult = await planTool.handler!(
      {
        shorts: [
          {
            title: 'Test Short',
            description: 'A test',
            tags: ['test'],
            segments: [{ start: 5, end: 20, description: 'segment 1' }],
          },
          {
            title: 'Another Short',
            description: 'Another test',
            tags: ['demo'],
            segments: [
              { start: 30, end: 45, description: 'part 1' },
              { start: 60, end: 75, description: 'part 2' },
            ],
          },
        ],
      },
      mockInvocation,
    );

    expect(handlerResult).toEqual({ success: true, count: 2 });
  });
});

// ── SilenceRemovalAgent (REAL) ──────────────────────────────────────────────

describe('Real SilenceRemovalAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('decide_removals tool: schema and handler', async () => {
    const { removeDeadSilence } = await import('../agents/SilenceRemovalAgent.js');
    const { detectSilence } = await import('../tools/ffmpeg/silenceDetection.js');

    // Return silence regions ≥ 2s so the agent gets instantiated
    (detectSilence as any).mockResolvedValue([
      { start: 10, end: 15, duration: 5 },
      { start: 30, end: 37, duration: 7 },
    ]);

    const result = await removeDeadSilence(mockVideo, mockTranscript);

    // Mock session doesn't trigger tool calls → no removals → not edited
    expect(result.wasEdited).toBe(false);

    // Verify captured tool
    const removeTool = findCapturedTool('decide_removals');
    expect(removeTool.description).toContain('silence regions');

    const schema = removeTool.parameters as any;
    expect(schema.required).toContain('removals');
    expect(schema.properties.removals.items.required).toEqual(
      expect.arrayContaining(['start', 'end', 'reason']),
    );

    // Call the REAL handler
    const handlerResult = await removeTool.handler!(
      {
        removals: [
          { start: 10, end: 15, reason: 'Dead air' },
          { start: 30, end: 37, reason: 'Long pause' },
        ],
      },
      mockInvocation,
    );

    expect(handlerResult).toEqual({ success: true, count: 2 });
  });
});

// ── ChapterAgent (REAL) ─────────────────────────────────────────────────────

describe('Real ChapterAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('generate_chapters tool: schema and handler writes files', async () => {
    const { generateChapters } = await import('../agents/ChapterAgent.js');

    const longVideo = { ...mockVideo, duration: 600 };
    const longTranscript = {
      ...mockTranscript,
      duration: 600,
      segments: [
        { start: 0, end: 60, text: 'Introduction' },
        { start: 60, end: 300, text: 'Main content' },
        { start: 300, end: 600, text: 'Conclusion' },
      ],
    };

    // Will throw because mock session doesn't call generate_chapters
    try {
      await generateChapters(longVideo, longTranscript);
    } catch {
      // Expected: "ChapterAgent did not call generate_chapters"
    }

    const chapterTool = findCapturedTool('generate_chapters');
    expect(chapterTool.description).toContain('chapters');

    const schema = chapterTool.parameters as any;
    expect(schema.required).toContain('chapters');
    expect(schema.properties.chapters.items.required).toEqual(
      expect.arrayContaining(['timestamp', 'title', 'description']),
    );

    // Call the REAL handler
    const handlerResult = await chapterTool.handler!(
      {
        chapters: [
          { timestamp: 0, title: 'Introduction', description: 'The beginning' },
          { timestamp: 120, title: 'Main Topic', description: 'Core content' },
          { timestamp: 450, title: 'Wrap Up', description: 'Conclusion' },
        ],
      },
      mockInvocation,
    );

    expect(handlerResult).toContain('Chapters written');
    expect(handlerResult).toContain('3 chapters');
  });
});

// ── MediumVideoAgent (REAL) ─────────────────────────────────────────────────

describe('Real MediumVideoAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('plan_medium_clips tool: schema and handler stores clips', async () => {
    const { generateMediumClips } = await import('../agents/MediumVideoAgent.js');

    const result = await generateMediumClips(mockVideo, mockTranscriptWithWords);
    expect(result).toEqual([]);

    const clipTool = findCapturedTool('plan_medium_clips');

    const schema = clipTool.parameters as any;
    expect(schema.required).toContain('clips');
    expect(schema.properties.clips.items.required).toEqual(
      expect.arrayContaining(['title', 'description', 'tags', 'segments', 'totalDuration', 'hook', 'topic']),
    );

    // Call the REAL handler
    const handlerResult = await clipTool.handler!(
      {
        clips: [
          {
            title: 'Deep Dive into Testing',
            description: 'A complete walkthrough',
            tags: ['testing', 'vitest'],
            segments: [{ start: 10, end: 90, description: 'Testing basics' }],
            totalDuration: 80,
            hook: 'Ever wondered how to test?',
            topic: 'Testing',
          },
        ],
      },
      mockInvocation,
    );

    expect(handlerResult).toEqual({ success: true, count: 1 });
  });
});

// ── SummaryAgent (REAL) ─────────────────────────────────────────────────────

describe('Real SummaryAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('exposes capture_frame and write_summary tools with correct schemas', async () => {
    const { generateSummary } = await import('../agents/SummaryAgent.js');

    try {
      await generateSummary(mockVideo, mockTranscript);
    } catch {
      // Expected: "SummaryAgent did not call write_summary"
    }

    const captureTool = findCapturedTool('capture_frame');
    const writeTool = findCapturedTool('write_summary');

    // Verify capture_frame schema
    const captureSchema = captureTool.parameters as any;
    expect(captureSchema.required).toEqual(
      expect.arrayContaining(['timestamp', 'description', 'index']),
    );

    // Verify write_summary schema
    const writeSchema = writeTool.parameters as any;
    expect(writeSchema.required).toEqual(
      expect.arrayContaining(['markdown', 'title', 'overview', 'keyTopics']),
    );

    // Call write_summary REAL handler
    const writeResult = await writeTool.handler!(
      {
        markdown: '# Test Summary\nContent here',
        title: 'Test Video',
        overview: 'An overview',
        keyTopics: ['topic1', 'topic2'],
      },
      mockInvocation,
    );

    expect(writeResult).toContain('Summary written');
  });
});

// ── BlogAgent (REAL) ────────────────────────────────────────────────────────

describe('Real BlogAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('exposes write_blog tool; handler works (search is via MCP)', async () => {
    const { generateBlogPost } = await import('../agents/BlogAgent.js');

    try {
      await generateBlogPost(mockVideo, mockTranscript, mockSummary);
    } catch {
      // Expected: "BlogAgent did not produce any blog content"
    }

    const writeTool = findCapturedTool('write_blog');

    expect(writeTool).toBeDefined();

    // Test write_blog REAL handler
    const writeResult = await writeTool.handler!(
      {
        frontmatter: { title: 'Test Post', description: 'A description', tags: ['test'] },
        body: '# Hello\nBlog content',
      },
      mockInvocation,
    );

    expect(writeResult).toContain('success');
  });

  it('write_blog handler validates required frontmatter fields', async () => {
    const { generateBlogPost } = await import('../agents/BlogAgent.js');

    try {
      await generateBlogPost(mockVideo, mockTranscript, mockSummary);
    } catch {
      // Expected: "BlogAgent did not produce any blog content"
    }

    const writeTool = findCapturedTool('write_blog');
    
    // Verify schema has required fields
    const schema = writeTool.parameters as any;
    expect(schema.properties.frontmatter.required).toEqual(
      expect.arrayContaining(['title', 'description', 'tags']),
    );
    expect(schema.required).toEqual(
      expect.arrayContaining(['frontmatter', 'body']),
    );
  });

  it('write_blog handler accepts and stores comprehensive blog content', async () => {
    const { generateBlogPost } = await import('../agents/BlogAgent.js');

    try {
      await generateBlogPost(mockVideo, mockTranscript, mockSummary);
    } catch {
      // Expected: "BlogAgent did not produce any blog content"
    }

    const writeTool = findCapturedTool('write_blog');

    // Test with comprehensive, structured content
    const comprehensiveContent = {
      frontmatter: {
        title: 'Building Better Software with GitHub Copilot',
        description: 'Learn how GitHub Copilot can accelerate your development workflow',
        tags: ['github', 'copilot', 'ai', 'productivity'],
        cover_image: 'https://example.com/cover.png',
      },
      body: `# Introduction

Hook: Ever spent hours debugging code that could have been caught earlier?

## The Problem

Developers face constant challenges...

## The Solution

GitHub Copilot helps by...

## Key Takeaways

- Point 1
- Point 2
- Point 3

## Conclusion

In this post, we explored...

---
*This post is based on my video walkthrough.*`,
    };

    const writeResult = await writeTool.handler!(comprehensiveContent, mockInvocation);

    expect(writeResult).toContain('success');
  });
});

// ── SocialMediaAgent (REAL) ─────────────────────────────────────────────────

describe('Real SocialMediaAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('exposes create_posts tool; handler works (search is via MCP)', async () => {
    const { generateSocialPosts } = await import('../agents/SocialMediaAgent.js');

    const result = await generateSocialPosts(mockVideo, mockTranscript, mockSummary);
    expect(result).toEqual([]);

    const postsTool = findCapturedTool('create_posts');

    expect(postsTool).toBeDefined();

    // Verify create_posts schema
    const postsSchema = postsTool.parameters as any;
    expect(postsSchema.required).toContain('posts');
    expect(postsSchema.properties.posts.items.required).toEqual(
      expect.arrayContaining(['platform', 'content', 'hashtags', 'links', 'characterCount']),
    );

    // Test create_posts REAL handler
    const postsResult = await postsTool.handler!(
      {
        posts: [
          {
            platform: 'tiktok',
            content: 'Check this out!',
            hashtags: ['coding'],
            links: [],
            characterCount: 15,
          },
          {
            platform: 'linkedin',
            content: 'Professional insight on testing.',
            hashtags: ['testing'],
            links: ['https://example.com'],
            characterCount: 31,
          },
        ],
      },
      mockInvocation,
    );

    const parsed = JSON.parse(postsResult as string);
    expect(parsed).toEqual({ success: true, count: 2 });
  });
});
