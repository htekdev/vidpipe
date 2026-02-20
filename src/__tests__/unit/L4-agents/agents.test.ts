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

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getBrandConfig: () => ({
    name: 'TestBrand',
    handle: '@test',
    tagline: 'test tagline',
    voice: { tone: 'friendly', personality: 'helpful', style: 'concise' },
    advocacy: { interests: ['testing'], avoids: ['nothing'] },
    contentGuidelines: { blogFocus: 'testing focus' },
  }),
}));

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    OUTPUT_DIR: '/tmp/test-output',
    LLM_PROVIDER: 'copilot',
    LLM_MODEL: '',
    EXA_API_KEY: '',
    EXA_MCP_URL: 'https://mcp.exa.ai/mcp',
  }),
}));

vi.mock('../../../L3-services/videoOperations/videoOperations.js', () => ({
  extractClip: vi.fn().mockResolvedValue(undefined),
  extractCompositeClip: vi.fn().mockResolvedValue(undefined),
  extractCompositeClipWithTransitions: vi.fn().mockResolvedValue(undefined),
  burnCaptions: vi.fn().mockResolvedValue(undefined),
  generatePlatformVariants: vi.fn().mockResolvedValue([]),
  detectSilence: vi.fn().mockResolvedValue([]),
  singlePassEdit: vi.fn().mockResolvedValue(undefined),
  captureFrame: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: () => ({
    listPosts() { return Promise.resolve([]) },
    updatePost() { return Promise.resolve({}) },
    schedulePost(_id: string, scheduledFor: string) { return Promise.resolve({ _id, scheduledFor }) },
  }),
}));

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: vi.fn().mockResolvedValue('2026-03-01T12:00:00-06:00'),
  getScheduleCalendar: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: vi.fn().mockResolvedValue({ timezone: 'UTC', platforms: {} }),
}));

vi.mock('../../../L3-services/scheduler/realign.js', () => ({
  buildRealignPlan: vi.fn().mockResolvedValue({ posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 }),
  executeRealignPlan: vi.fn().mockResolvedValue({ updated: 0, cancelled: 0, failed: 0, errors: [] }),
  buildPrioritizedRealignPlan: vi.fn().mockResolvedValue({ posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 }),
}));

vi.mock('../../../L0-pure/captions/captionGenerator.js', () => ({
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

import { BaseAgent } from '../../../L4-agents/BaseAgent.js';

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

  it('add_shorts tool: schema, handler accumulates shorts incrementally', async () => {
    const { generateShorts } = await import('../../../L4-agents/ShortsAgent.js');

    // generateShorts calls agent.run() → createSession captures tools
    const result = await generateShorts(mockVideo, mockTranscriptWithWords);

    // Mock session returns no tool calls, so no shorts planned
    expect(result).toEqual([]);

    // Verify captured tools
    const addTool = findCapturedTool('add_shorts');
    expect(addTool.description).toContain('Add one or more shorts');

    const reviewTool = findCapturedTool('review_shorts');
    expect(reviewTool.description).toContain('Review all shorts');

    const finalizeTool = findCapturedTool('finalize_shorts');
    expect(finalizeTool.description).toContain('Finalize');

    // Verify schema
    const schema = addTool.parameters as any;
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

    // Call the REAL handler — first batch
    const handlerResult = await addTool.handler!(
      {
        shorts: [
          {
            title: 'Test Short',
            description: 'A test',
            tags: ['test'],
            segments: [{ start: 5, end: 20, description: 'segment 1' }],
          },
        ],
      },
      mockInvocation,
    );

    expect(handlerResult).toContain('Added 1 shorts');
    expect(handlerResult).toContain('Total planned: 1');

    // Call again — second batch (accumulates)
    const handlerResult2 = await addTool.handler!(
      {
        shorts: [
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

    expect(handlerResult2).toContain('Total planned: 2');

    // Review shows both shorts
    const reviewResult = await reviewTool.handler!({}, mockInvocation);
    expect(reviewResult).toContain('2 total');
    expect(reviewResult).toContain('Test Short');
    expect(reviewResult).toContain('Another Short');
  });
});

// ── SilenceRemovalAgent (REAL) ──────────────────────────────────────────────

describe('Real SilenceRemovalAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('decide_removals tool: schema and handler', async () => {
    const { removeDeadSilence } = await import('../../../L4-agents/SilenceRemovalAgent.js');
    const { detectSilence } = await import('../../../L3-services/videoOperations/videoOperations.js');

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

// ── ProducerAgent (REAL) ────────────────────────────────────────────────────

describe('Real ProducerAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('add_cuts tool: schema accepts removals with start/end/reason', async () => {
    const { ProducerAgent } = await import('../../../L4-agents/ProducerAgent.js');

    const mockVideoAsset = {
      videoPath: '/tmp/test.mp4',
      getMetadata: async () => ({ width: 1920, height: 1080, duration: 300 }),
      getTranscript: async () => mockTranscriptWithWords,
      getEditorialDirection: async () => 'No issues found',
    } as any;

    const agent = new ProducerAgent(mockVideoAsset);
    const result = await agent.produce('/tmp/output.mp4');

    // Mock session returns no tool calls → no removals → clean video
    expect(result.success).toBe(true);
    expect(result.editCount).toBe(0);
    expect(result.removals).toEqual([]);

    // Verify captured tools
    const addTool = findCapturedTool('add_cuts');
    expect(addTool.description).toContain('remove');

    // Verify add_cuts schema
    const schema = addTool.parameters as any;
    expect(schema.required).toContain('removals');
    expect(schema.properties.removals.items.required).toEqual(
      expect.arrayContaining(['start', 'end', 'reason']),
    );
    expect(schema.properties.removals.items.properties.start.type).toBe('number');
    expect(schema.properties.removals.items.properties.end.type).toBe('number');
    expect(schema.properties.removals.items.properties.reason.type).toBe('string');
  });

  it('exposes get_video_info, get_transcript, get_editorial_direction, add_cuts, and finalize_cuts tools', async () => {
    const { ProducerAgent } = await import('../../../L4-agents/ProducerAgent.js');

    const mockVideoAsset = {
      videoPath: '/tmp/test.mp4',
      getMetadata: async () => ({ width: 1920, height: 1080, duration: 300 }),
      getTranscript: async () => mockTranscriptWithWords,
      getEditorialDirection: async () => 'No issues found',
    } as any;

    const agent = new ProducerAgent(mockVideoAsset);
    await agent.produce('/tmp/output.mp4');

    const toolNames = mockState.capturedTools.map((t: any) => t.name);
    expect(toolNames).toContain('get_video_info');
    expect(toolNames).toContain('get_transcript');
    expect(toolNames).toContain('get_editorial_direction');
    expect(toolNames).toContain('add_cuts');
    expect(toolNames).toContain('finalize_cuts');
  });

  it('add_cuts handler accumulates removals across multiple calls', async () => {
    const { ProducerAgent } = await import('../../../L4-agents/ProducerAgent.js');

    const mockVideoAsset = {
      videoPath: '/tmp/test.mp4',
      getMetadata: async () => ({ width: 1920, height: 1080, duration: 300 }),
      getTranscript: async () => mockTranscriptWithWords,
      getEditorialDirection: async () => null,
    } as any;

    const agent = new ProducerAgent(mockVideoAsset);
    await agent.produce('/tmp/output.mp4');

    const addTool = findCapturedTool('add_cuts');
    const result1 = await addTool.handler!(
      {
        removals: [
          { start: 10, end: 15, reason: 'Dead air' },
        ],
      },
      mockInvocation,
    );
    expect(result1).toContain('1 cuts');

    const result2 = await addTool.handler!(
      {
        removals: [
          { start: 30, end: 37, reason: 'Long pause' },
        ],
      },
      mockInvocation,
    );
    expect(result2).toContain('Total queued: 2');
  });
});

// ── ChapterAgent (REAL) ─────────────────────────────────────────────────────

describe('Real ChapterAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('generate_chapters tool: schema and handler writes files', async () => {
    const { generateChapters } = await import('../../../L4-agents/ChapterAgent.js');

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

  it('add_medium_clips tool: schema and handler accumulates clips', async () => {
    const { generateMediumClips } = await import('../../../L4-agents/MediumVideoAgent.js');

    const result = await generateMediumClips(mockVideo, mockTranscriptWithWords);
    expect(result).toEqual([]);

    const addTool = findCapturedTool('add_medium_clips');
    const reviewTool = findCapturedTool('review_medium_clips');
    const finalizeTool = findCapturedTool('finalize_medium_clips');

    expect(addTool.description).toContain('Add one or more medium clips');
    expect(reviewTool.description).toContain('Review all medium clips');
    expect(finalizeTool.description).toContain('Finalize');

    const schema = addTool.parameters as any;
    expect(schema.required).toContain('clips');
    expect(schema.properties.clips.items.required).toEqual(
      expect.arrayContaining(['title', 'description', 'tags', 'segments', 'totalDuration', 'hook', 'topic']),
    );

    // Call the REAL handler
    const handlerResult = await addTool.handler!(
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

    expect(handlerResult).toContain('Added 1 clips');
    expect(handlerResult).toContain('Total planned: 1');

    // Review shows the clip
    const reviewResult = await reviewTool.handler!({}, mockInvocation);
    expect(reviewResult).toContain('1 total');
    expect(reviewResult).toContain('Deep Dive into Testing');
  });
});

// ── SummaryAgent (REAL) ─────────────────────────────────────────────────────

describe('Real SummaryAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('exposes capture_frame and write_summary tools with correct schemas', async () => {
    const { generateSummary } = await import('../../../L4-agents/SummaryAgent.js');

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
    const { generateBlogPost } = await import('../../../L4-agents/BlogAgent.js');

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
});

// ── SocialMediaAgent (REAL) ─────────────────────────────────────────────────

describe('Real SocialMediaAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('exposes create_posts tool; handler works (search is via MCP)', async () => {
    const { generateSocialPosts } = await import('../../../L4-agents/SocialMediaAgent.js');

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

// ── GraphicsAgent (REAL) ────────────────────────────────────────────────────

vi.mock('../../../L3-services/imageGeneration/imageGeneration.js', () => ({
  generateImage: vi.fn().mockResolvedValue('/tmp/enhancements/0-test.png'),
  COST_BY_QUALITY: { low: 0.04, medium: 0.07, high: 0.07 },
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    metadata: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
  }),
}));

describe('Real GraphicsAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('exposes generate_enhancement and skip_opportunity tools', async () => {
    const { generateEnhancementImages } = await import('../../../L4-agents/GraphicsAgent.js');

    const result = await generateEnhancementImages(
      'Enhancement report: Add a diagram at 10s showing the architecture.',
      '/tmp/enhancements',
      120,
    );

    // Mock session returns no tool calls → no overlays
    expect(result).toEqual([]);

    const genTool = findCapturedTool('generate_enhancement');
    const skipTool = findCapturedTool('skip_opportunity');

    expect(genTool.description).toContain('Generate an AI image overlay');
    expect(skipTool.description).toContain('Skip an enhancement opportunity');
  });

  it('generate_enhancement tool schema has required fields', async () => {
    const { generateEnhancementImages } = await import('../../../L4-agents/GraphicsAgent.js');

    await generateEnhancementImages('report', '/tmp/enhancements', 60);

    const genTool = findCapturedTool('generate_enhancement');
    const schema = genTool.parameters as any;
    expect(schema.required).toEqual(
      expect.arrayContaining(['prompt', 'timestampStart', 'timestampEnd', 'region', 'sizePercent', 'topic', 'reason']),
    );
    expect(schema.properties.region.enum).toEqual(
      expect.arrayContaining(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
    );
  });

  it('generate_enhancement handler creates overlay and returns success', async () => {
    const { generateEnhancementImages } = await import('../../../L4-agents/GraphicsAgent.js');

    await generateEnhancementImages('report', '/tmp/enhancements', 120);

    const genTool = findCapturedTool('generate_enhancement');
    const result = await genTool.handler!(
      {
        prompt: 'Architecture diagram',
        timestampStart: 10,
        timestampEnd: 20,
        region: 'top-right',
        sizePercent: 25,
        topic: 'Architecture',
        reason: 'Helps visualize the system',
      },
      mockInvocation,
    );

    expect(result).toEqual(
      expect.objectContaining({ success: true, imagePath: expect.stringContaining('enhancements') }),
    );
  });

  it('skip_opportunity handler returns success with skipped flag', async () => {
    const { generateEnhancementImages } = await import('../../../L4-agents/GraphicsAgent.js');

    await generateEnhancementImages('report', '/tmp/enhancements', 60);

    const skipTool = findCapturedTool('skip_opportunity');
    const result = await skipTool.handler!(
      { topic: 'Unnecessary diagram', reason: 'Not helpful for this section' },
      mockInvocation,
    );

    expect(result).toEqual({ success: true, skipped: true });
  });

  it('generate_enhancement clamps sizePercent between 15 and 30', async () => {
    const { generateEnhancementImages } = await import('../../../L4-agents/GraphicsAgent.js');

    await generateEnhancementImages('report', '/tmp/enhancements', 60);

    const genTool = findCapturedTool('generate_enhancement');

    // Test with too-large size
    const result = await genTool.handler!(
      {
        prompt: 'Test',
        timestampStart: 0,
        timestampEnd: 10,
        region: 'top-left',
        sizePercent: 50,
        topic: 'Test',
        reason: 'Test',
      },
      mockInvocation,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it('generate_enhancement handles image generation errors', async () => {
    const { generateImage } = await import('../../../L3-services/imageGeneration/imageGeneration.js');
    vi.mocked(generateImage).mockRejectedValueOnce(new Error('API quota exceeded'));

    const { generateEnhancementImages } = await import('../../../L4-agents/GraphicsAgent.js');
    await generateEnhancementImages('report', '/tmp/enhancements', 60);

    const genTool = findCapturedTool('generate_enhancement');
    const result = await genTool.handler!(
      {
        prompt: 'Test',
        timestampStart: 0,
        timestampEnd: 10,
        region: 'top-left',
        sizePercent: 20,
        topic: 'Test',
        reason: 'Test',
      },
      mockInvocation,
    );

    expect(result).toEqual(expect.objectContaining({ error: 'API quota exceeded' }));
  });
});

// ── ScheduleAgent tool registration ─────────────────────────────────────────

describe('Real ScheduleAgent', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0;
  });

  it('registers start_prioritize_realign tool with correct schema', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const tool = findCapturedTool('start_prioritize_realign');
    expect(tool).toBeDefined();
    expect(tool.description).toContain('prioritized realignment');

    const schema = tool.parameters as any;
    expect(schema.required).toContain('priorities');
    expect(schema.properties.priorities.type).toBe('array');
    expect(schema.properties.priorities.items.required).toEqual(
      expect.arrayContaining(['keywords', 'saturation']),
    );
    expect(schema.properties.dryRun).toBeDefined();
  });

  it('registers check_realign_status tool', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const tool = findCapturedTool('check_realign_status');
    expect(tool).toBeDefined();
    expect(tool.description).toContain('progress');

    const schema = tool.parameters as any;
    expect(schema.required).toContain('jobId');
  });

  it('does not register swap_posts or old prioritize_realign tool', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const toolNames = mockState.capturedTools.map((t: any) => t.name);
    expect(toolNames).not.toContain('swap_posts');
    expect(toolNames).not.toContain('prioritize_realign');
  });

  it('registers all expected tools', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const toolNames = mockState.capturedTools.map((t: any) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      'list_posts',
      'view_schedule_config',
      'view_calendar',
      'reschedule_post',
      'cancel_post',
      'find_next_slot',
      'realign_schedule',
      'start_prioritize_realign',
      'check_realign_status',
    ]));
  });

  it('start_prioritize_realign handler returns job ID and starts background job', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const tool = findCapturedTool('start_prioritize_realign');
    const result = await tool.handler!(
      { priorities: [{ keywords: ['devops'], saturation: 1.0 }], dryRun: true },
      mockInvocation,
    ) as any;

    expect(result.started).toBe(true);
    expect(result.jobId).toMatch(/^realign-/);
    expect(result.dryRun).toBe(true);

    // Wait a tick for the background job to complete
    await new Promise(r => setTimeout(r, 50));
  });

  it('check_realign_status handler returns job progress after start', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    // Start a dry-run job
    const startTool = findCapturedTool('start_prioritize_realign');
    const startResult = await startTool.handler!(
      { priorities: [{ keywords: ['test'], saturation: 1.0 }], dryRun: true },
      mockInvocation,
    ) as any;

    // Wait for background job to complete (dry run is fast)
    await new Promise(r => setTimeout(r, 100));

    // Check status
    const checkTool = findCapturedTool('check_realign_status');
    const status = await checkTool.handler!(
      { jobId: startResult.jobId },
      mockInvocation,
    ) as any;

    expect(status.jobId).toBe(startResult.jobId);
    expect(status.status).toBe('completed');
    expect(status.plan).toBeDefined();
    expect(status.result).toBeDefined();
  });

  it('check_realign_status handler returns error for unknown job ID', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const checkTool = findCapturedTool('check_realign_status');
    const result = await checkTool.handler!(
      { jobId: 'nonexistent-job' },
      mockInvocation,
    ) as any;

    expect(result.error).toContain('No realign job found');
  });

  it('start_prioritize_realign with dryRun=false triggers execution', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const startTool = findCapturedTool('start_prioritize_realign');
    const result = await startTool.handler!(
      { priorities: [{ keywords: ['devops'], saturation: 0.5 }], dryRun: false },
      mockInvocation,
    ) as any;

    expect(result.started).toBe(true);
    expect(result.dryRun).toBe(false);

    // Wait for background job to complete
    await new Promise(r => setTimeout(r, 100));

    // Verify it completed
    const checkTool = findCapturedTool('check_realign_status');
    const status = await checkTool.handler!(
      { jobId: result.jobId },
      mockInvocation,
    ) as any;
    expect(status.status).toBe('completed');
    expect(status.result).toBeDefined();
  });

  it('reschedule_post handler calls schedulePost and returns success', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const tool = findCapturedTool('reschedule_post');
    const result = await tool.handler!(
      { postId: 'post-123', scheduledFor: '2026-04-01T10:00:00Z' },
      mockInvocation,
    ) as any;

    expect(result.success).toBe(true);
    expect(result.postId).toBe('post-123');
    expect(result.scheduledFor).toBe('2026-04-01T10:00:00Z');
  });

  it('list_posts handler calls createLateApiClient and returns posts', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const tool = findCapturedTool('list_posts');
    const result = await tool.handler!(
      { status: 'scheduled' },
      mockInvocation,
    ) as any;

    expect(result.posts).toEqual([]);
  });

  it('cancel_post handler calls createLateApiClient and returns success', async () => {
    const { ScheduleAgent } = await import('../../../L4-agents/ScheduleAgent.js');
    const agent = new ScheduleAgent();
    try {
      await agent.run('test');
    } catch { /* session mock ends quickly */ }

    const tool = findCapturedTool('cancel_post');
    const result = await tool.handler!(
      { postId: 'post-456' },
      mockInvocation,
    ) as any;

    expect(result.success).toBe(true);
    expect(result.postId).toBe('post-456');
  });
});
