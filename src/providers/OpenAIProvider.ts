/**
 * OpenAI Provider — wraps the OpenAI SDK behind the LLMProvider interface.
 *
 * Implements chat completions with automatic tool-calling loop:
 *   user message → LLM → (tool_calls? → execute → feed back → LLM)* → final text
 */

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions.js';
import type {
  LLMProvider,
  LLMSession,
  LLMResponse,
  SessionConfig,
  ToolWithHandler,
  TokenUsage,
  ProviderEventType,
  ProviderEvent,
} from './types.js';
import { calculateTokenCost } from '../config/pricing.js';
import logger from '../config/logger.js';

// ── helpers ────────────────────────────────────────────────────────────

/** Convert our ToolWithHandler[] to the OpenAI SDK tool format. */
function toOpenAITools(tools: ToolWithHandler[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Build a handler lookup map keyed by tool name. */
function buildHandlerMap(
  tools: ToolWithHandler[],
): Map<string, ToolWithHandler['handler']> {
  return new Map(tools.map((t) => [t.name, t.handler]));
}

/** Sum two TokenUsage objects. */
function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

// ── session ────────────────────────────────────────────────────────────

class OpenAISession implements LLMSession {
  private client: OpenAI;
  private model: string;
  private messages: ChatCompletionMessageParam[];
  private tools: ChatCompletionTool[];
  private handlers: Map<string, ToolWithHandler['handler']>;
  private listeners = new Map<ProviderEventType, ((e: ProviderEvent) => void)[]>();

  constructor(client: OpenAI, config: SessionConfig, model: string) {
    this.client = client;
    this.model = model;
    this.messages = [{ role: 'system', content: config.systemPrompt }];
    this.tools = toOpenAITools(config.tools);
    this.handlers = buildHandlerMap(config.tools);
  }

  // ── public API ─────────────────────────────────────────────────────

  async sendAndWait(message: string): Promise<LLMResponse> {
    this.messages.push({ role: 'user', content: message });

    let cumulative: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const start = Date.now();

    // Agent loop: keep calling the LLM until no tool_calls remain
    while (true) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        ...(this.tools.length > 0 ? { tools: this.tools } : {}),
      });

      const choice = response.choices[0];
      const assistantMsg = choice.message;

      // Accumulate token usage
      if (response.usage) {
        const iterUsage: TokenUsage = {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        };
        cumulative = addUsage(cumulative, iterUsage);
        this.emit('usage', iterUsage);
      }

      // Add assistant message to history
      this.messages.push(assistantMsg as ChatCompletionMessageParam);

      const toolCalls = assistantMsg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // No more tool calls — return final response
        const cost = calculateTokenCost(this.model, cumulative.inputTokens, cumulative.outputTokens);
        return {
          content: assistantMsg.content ?? '',
          toolCalls: [],
          usage: cumulative,
          cost: { amount: cost, unit: 'usd', model: this.model },
          durationMs: Date.now() - start,
        };
      }

      // Execute each tool call and feed results back
      for (const tc of toolCalls) {
        if (tc.type !== 'function') continue;

        const fnName = tc.function.name;
        const handler = this.handlers.get(fnName);

        let result: unknown;
        if (!handler) {
          logger.warn(`OpenAI requested unknown tool: ${fnName}`);
          result = { error: `Unknown tool: ${fnName}` };
        } else {
          this.emit('tool_start', { name: fnName, arguments: tc.function.arguments });
          try {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            result = await handler(args);
          } catch (err) {
            logger.error(`Tool ${fnName} failed: ${err}`);
            result = { error: String(err) };
          }
          this.emit('tool_end', { name: fnName, result });
        }

        this.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
      // Loop back to call the LLM again with tool results
    }
  }

  on(event: ProviderEventType, handler: (e: ProviderEvent) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  async close(): Promise<void> {
    this.messages = [];
    this.listeners.clear();
  }

  // ── internals ──────────────────────────────────────────────────────

  private emit(type: ProviderEventType, data: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) {
      try {
        handler({ type, data });
      } catch {
        // Don't let listener errors break the agent loop
      }
    }
  }
}

// ── provider ───────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  getDefaultModel(): string {
    return 'gpt-4o';
  }

  async createSession(config: SessionConfig): Promise<LLMSession> {
    const client = new OpenAI(); // reads OPENAI_API_KEY from env
    const model = config.model ?? this.getDefaultModel();
    logger.info(`OpenAI session created (model=${model}, tools=${config.tools.length})`);
    return new OpenAISession(client, config, model);
  }
}
