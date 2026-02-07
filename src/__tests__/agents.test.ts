import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @github/copilot-sdk before importing BaseAgent
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(),
  CopilotSession: vi.fn(),
}));

// Mock logger to silence output
vi.mock('../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { BaseAgent } from '../agents/BaseAgent.js';
import type { Tool } from '@github/copilot-sdk';

// ── Concrete test agent ─────────────────────────────────────────────────────

class TestAgent extends BaseAgent {
  public toolCallLog: { toolName: string; args: Record<string, unknown> }[] = [];

  constructor(name = 'TestAgent', prompt = 'You are a test agent.') {
    super(name, prompt);
  }

  protected getTools(): Tool<unknown>[] {
    return [
      {
        name: 'greet',
        description: 'Greet a user by name',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' },
          },
          required: ['name'],
        },
        handler: async (args: unknown) => this.handleToolCall('greet', args as Record<string, unknown>),
      },
    ];
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    this.toolCallLog.push({ toolName, args });
    if (toolName === 'greet') {
      return { message: `Hello, ${args.name}!` };
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  // Expose protected method for testing
  public exposedGetTools(): Tool<unknown>[] {
    return this.getTools();
  }
}

// ── ShortsAgent-style plan parsing agent ────────────────────────────────────

interface PlannedSegment {
  start: number;
  end: number;
  description: string;
}

interface PlannedShort {
  title: string;
  description: string;
  tags: string[];
  segments: PlannedSegment[];
}

class MockShortsAgent extends BaseAgent {
  private plannedShorts: PlannedShort[] = [];

  constructor() {
    super('MockShortsAgent', 'Plan shorts from transcripts.');
  }

  protected getTools(): Tool<unknown>[] {
    return [
      {
        name: 'plan_shorts',
        description: 'Submit planned shorts as structured JSON.',
        parameters: {
          type: 'object',
          properties: {
            shorts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  segments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        start: { type: 'number' },
                        end: { type: 'number' },
                        description: { type: 'string' },
                      },
                      required: ['start', 'end', 'description'],
                    },
                  },
                },
                required: ['title', 'description', 'tags', 'segments'],
              },
            },
          },
          required: ['shorts'],
        },
        handler: async (args: unknown) => this.handleToolCall('plan_shorts', args as Record<string, unknown>),
      },
    ];
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (toolName === 'plan_shorts') {
      this.plannedShorts = args.shorts as PlannedShort[];
      return { success: true, count: this.plannedShorts.length };
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  public getPlannedShorts(): PlannedShort[] {
    return this.plannedShorts;
  }

  public exposedGetTools(): Tool<unknown>[] {
    return this.getTools();
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BaseAgent construction', () => {
  it('stores agent name and system prompt', () => {
    const agent = new TestAgent('MyAgent', 'Custom system prompt.');
    // Access protected fields via casting
    expect((agent as any).agentName).toBe('MyAgent');
    expect((agent as any).systemPrompt).toBe('Custom system prompt.');
  });

  it('initialises with null client and session', () => {
    const agent = new TestAgent();
    expect((agent as any).client).toBeNull();
    expect((agent as any).session).toBeNull();
  });

  it('getTools() returns a tools array', () => {
    const agent = new TestAgent();
    const tools = agent.exposedGetTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });
});

describe('Tool registration', () => {
  let tools: Tool<unknown>[];

  beforeEach(() => {
    const agent = new TestAgent();
    tools = agent.exposedGetTools();
  });

  it('each tool has name, description, parameters, and handler', () => {
    for (const tool of tools) {
      expect(tool.name).toEqual(expect.any(String));
      expect(tool.description).toEqual(expect.any(String));
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('handler is callable and returns a result', async () => {
    const greetTool = tools.find((t) => t.name === 'greet')!;
    const mockInvocation = { sessionId: 'test', toolCallId: 'tc1', toolName: 'greet', arguments: {} } as any;
    const result = await greetTool.handler!({ name: 'Alice' }, mockInvocation);
    expect(result).toEqual({ message: 'Hello, Alice!' });
  });
});

describe('ShortsAgent plan parsing', () => {
  let agent: MockShortsAgent;

  beforeEach(() => {
    agent = new MockShortsAgent();
  });

  it('parses planned shorts via tool handler', async () => {
    const mockPlan = {
      shorts: [
        {
          title: 'Best Debugging Tip Ever',
          description: 'A quick tip on rubber-duck debugging.',
          tags: ['debugging', 'tips', 'coding'],
          segments: [
            { start: 10.5, end: 35.2, description: 'Explains rubber-duck debugging' },
          ],
        },
        {
          title: 'Why TypeScript Wins',
          description: 'Comparing TS vs JS for large projects.',
          tags: ['typescript', 'javascript', 'comparison'],
          segments: [
            { start: 120.0, end: 140.0, description: 'Type safety intro' },
            { start: 200.0, end: 220.0, description: 'Refactoring benefits' },
          ],
        },
      ],
    };

    const tools = agent.exposedGetTools();
    const planTool = tools.find((t) => t.name === 'plan_shorts')!;
    const result = await planTool.handler!(mockPlan, { sessionId: 'test', toolCallId: 'tc2', toolName: 'plan_shorts', arguments: {} } as any);

    expect(result).toEqual({ success: true, count: 2 });

    const planned = agent.getPlannedShorts();
    expect(planned).toHaveLength(2);
    expect(planned[0].title).toBe('Best Debugging Tip Ever');
    expect(planned[0].tags).toEqual(['debugging', 'tips', 'coding']);
    expect(planned[0].segments).toHaveLength(1);
    expect(planned[0].segments[0].start).toBe(10.5);
    expect(planned[0].segments[0].end).toBe(35.2);

    // Composite short
    expect(planned[1].segments).toHaveLength(2);
  });

  it('plan_shorts schema requires shorts array', () => {
    const tools = agent.exposedGetTools();
    const planTool = tools.find((t) => t.name === 'plan_shorts')!;
    const schema = planTool.parameters as any;

    expect(schema.required).toContain('shorts');
    expect(schema.properties.shorts.type).toBe('array');
    expect(schema.properties.shorts.items.required).toEqual(
      expect.arrayContaining(['title', 'description', 'tags', 'segments']),
    );
  });

  it('segment schema requires start, end, description', () => {
    const tools = agent.exposedGetTools();
    const planTool = tools.find((t) => t.name === 'plan_shorts')!;
    const segmentSchema = (planTool.parameters as any).properties.shorts.items.properties.segments.items;

    expect(segmentSchema.required).toEqual(expect.arrayContaining(['start', 'end', 'description']));
    expect(segmentSchema.properties.start.type).toBe('number');
    expect(segmentSchema.properties.end.type).toBe('number');
  });
});

describe('Agent error handling', () => {
  it('handleToolCall throws on unknown tool', async () => {
    const agent = new TestAgent();
    await expect(
      (agent as any).handleToolCall('nonexistent_tool', {}),
    ).rejects.toThrow('Unknown tool: nonexistent_tool');
  });

  it('MockShortsAgent throws on unknown tool', async () => {
    const agent = new MockShortsAgent();
    await expect(
      (agent as any).handleToolCall('bad_tool', {}),
    ).rejects.toThrow('Unknown tool: bad_tool');
  });

  it('destroy is safe to call on uninitialised agent', async () => {
    const agent = new TestAgent();
    await expect(agent.destroy()).resolves.toBeUndefined();
  });
});
