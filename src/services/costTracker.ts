import type { TokenUsage, CostInfo, QuotaSnapshot } from '../providers/types.js';
import { calculateTokenCost, calculatePRUCost, COPILOT_PRU_OVERAGE_RATE } from '../config/pricing.js';
import logger from '../config/logger.js';

/** Record of a single LLM usage event */
export interface UsageRecord {
  timestamp: Date;
  provider: string;
  model: string;
  agent: string;
  stage: string;
  usage: TokenUsage;
  cost: CostInfo;
  durationMs?: number;
}

/** Record of a non-LLM service usage event */
export interface ServiceUsageRecord {
  timestamp: Date;
  service: string;
  stage: string;
  costUSD: number;
  metadata: Record<string, unknown>;
}

/** Aggregated cost report */
export interface CostReport {
  totalCostUSD: number;
  totalPRUs: number;
  totalTokens: { input: number; output: number; total: number };
  byProvider: Record<string, { costUSD: number; prus: number; calls: number }>;
  byAgent: Record<string, { costUSD: number; prus: number; calls: number }>;
  byModel: Record<string, { costUSD: number; prus: number; calls: number }>;
  byService: Record<string, { costUSD: number; calls: number }>;
  records: UsageRecord[];
  serviceRecords: ServiceUsageRecord[];
  totalServiceCostUSD: number;
  /** Copilot quota info (if available) */
  copilotQuota?: QuotaSnapshot;
}

/** Singleton cost tracker for a pipeline run */
class CostTracker {
  private records: UsageRecord[] = [];
  private serviceRecords: ServiceUsageRecord[] = [];
  private latestQuota?: QuotaSnapshot;
  private currentAgent = 'unknown';
  private currentStage = 'unknown';

  /** Set the current agent name (called by BaseAgent before LLM calls) */
  setAgent(agent: string): void {
    this.currentAgent = agent;
  }

  /** Set the current pipeline stage */
  setStage(stage: string): void {
    this.currentStage = stage;
  }

  /** Record a usage event from any provider */
  recordUsage(
    provider: string,
    model: string,
    usage: TokenUsage,
    cost?: CostInfo,
    durationMs?: number,
    quotaSnapshot?: QuotaSnapshot
  ): void {
    // Calculate cost if not provided
    const finalCost = cost ?? {
      amount: provider === 'copilot'
        ? calculatePRUCost(model)
        : calculateTokenCost(model, usage.inputTokens, usage.outputTokens),
      unit: provider === 'copilot' ? 'premium_requests' as const : 'usd' as const,
      model,
    };

    const record: UsageRecord = {
      timestamp: new Date(),
      provider,
      model,
      agent: this.currentAgent,
      stage: this.currentStage,
      usage,
      cost: finalCost,
      durationMs,
    };

    this.records.push(record);

    if (quotaSnapshot) {
      this.latestQuota = quotaSnapshot;
    }

    logger.debug(
      `[CostTracker] ${provider}/${model} | ${this.currentAgent} | ` +
      `in=${usage.inputTokens} out=${usage.outputTokens} | ` +
      `cost=${finalCost.amount.toFixed(4)} ${finalCost.unit}`
    );
  }

  /** Record a non-LLM service usage event */
  recordServiceUsage(service: string, costUSD: number, metadata?: Record<string, unknown>): void {
    const record: ServiceUsageRecord = {
      timestamp: new Date(),
      service,
      stage: this.currentStage,
      costUSD,
      metadata: metadata ?? {},
    };

    this.serviceRecords.push(record);

    logger.debug(
      `[CostTracker] service=${service} | stage=${this.currentStage} | cost=$${costUSD.toFixed(4)}`
    );
  }

  /** Get the full cost report */
  getReport(): CostReport {
    const report: CostReport = {
      totalCostUSD: 0,
      totalPRUs: 0,
      totalTokens: { input: 0, output: 0, total: 0 },
      byProvider: {},
      byAgent: {},
      byModel: {},
      byService: {},
      records: [...this.records],
      serviceRecords: [...this.serviceRecords],
      totalServiceCostUSD: 0,
      copilotQuota: this.latestQuota,
    };

    for (const record of this.records) {
      const { provider, model, agent, usage, cost } = record;

      // Accumulate tokens
      report.totalTokens.input += usage.inputTokens;
      report.totalTokens.output += usage.outputTokens;
      report.totalTokens.total += usage.totalTokens;

      // Accumulate costs
      const usdCost = cost.unit === 'usd' ? cost.amount : cost.amount * COPILOT_PRU_OVERAGE_RATE;
      const prus = cost.unit === 'premium_requests' ? cost.amount : 0;
      report.totalCostUSD += usdCost;
      report.totalPRUs += prus;

      // By provider
      if (!report.byProvider[provider]) report.byProvider[provider] = { costUSD: 0, prus: 0, calls: 0 };
      report.byProvider[provider].costUSD += usdCost;
      report.byProvider[provider].prus += prus;
      report.byProvider[provider].calls += 1;

      // By agent
      if (!report.byAgent[agent]) report.byAgent[agent] = { costUSD: 0, prus: 0, calls: 0 };
      report.byAgent[agent].costUSD += usdCost;
      report.byAgent[agent].prus += prus;
      report.byAgent[agent].calls += 1;

      // By model
      if (!report.byModel[model]) report.byModel[model] = { costUSD: 0, prus: 0, calls: 0 };
      report.byModel[model].costUSD += usdCost;
      report.byModel[model].prus += prus;
      report.byModel[model].calls += 1;
    }

    for (const record of this.serviceRecords) {
      const { service, costUSD } = record;
      report.totalServiceCostUSD += costUSD;

      if (!report.byService[service]) report.byService[service] = { costUSD: 0, calls: 0 };
      report.byService[service].costUSD += costUSD;
      report.byService[service].calls += 1;
    }

    report.totalCostUSD += report.totalServiceCostUSD;

    return report;
  }

  /** Format report as human-readable string for console output */
  formatReport(): string {
    const report = this.getReport();
    const lines: string[] = [
      '',
      '═══════════════════════════════════════════',
      '  💰 Pipeline Cost Report',
      '═══════════════════════════════════════════',
      '',
      `  Total Cost:    $${report.totalCostUSD.toFixed(4)} USD` +
        (report.totalServiceCostUSD > 0 ? ` (incl. $${report.totalServiceCostUSD.toFixed(4)} services)` : ''),
    ];

    if (report.totalPRUs > 0) {
      lines.push(`  Total PRUs:    ${report.totalPRUs} premium requests`);
    }

    lines.push(
      `  Total Tokens:  ${report.totalTokens.total.toLocaleString()} (${report.totalTokens.input.toLocaleString()} in / ${report.totalTokens.output.toLocaleString()} out)`,
      `  LLM Calls:     ${this.records.length}`,
    );

    if (report.copilotQuota) {
      lines.push(
        '',
        `  Copilot Quota: ${report.copilotQuota.remainingPercentage.toFixed(1)}% remaining`,
        `  Used/Total:    ${report.copilotQuota.usedRequests}/${report.copilotQuota.entitlementRequests} PRUs`,
      );
      if (report.copilotQuota.resetDate) {
        lines.push(`  Resets:        ${report.copilotQuota.resetDate}`);
      }
    }

    // By agent breakdown
    if (Object.keys(report.byAgent).length > 1) {
      lines.push('', '  By Agent:');
      for (const [agent, data] of Object.entries(report.byAgent)) {
        lines.push(`    ${agent}: $${data.costUSD.toFixed(4)} (${data.calls} calls)`);
      }
    }

    // By model breakdown
    if (Object.keys(report.byModel).length > 1) {
      lines.push('', '  By Model:');
      for (const [model, data] of Object.entries(report.byModel)) {
        lines.push(`    ${model}: $${data.costUSD.toFixed(4)} (${data.calls} calls)`);
      }
    }

    // By service breakdown
    if (Object.keys(report.byService).length > 0) {
      lines.push('', '  By Service:');
      for (const [service, data] of Object.entries(report.byService)) {
        lines.push(`    ${service}: $${data.costUSD.toFixed(4)} (${data.calls} calls)`);
      }
    }

    lines.push('', '═══════════════════════════════════════════', '');
    return lines.join('\n');
  }

  /** Reset all tracking (for new pipeline run) */
  reset(): void {
    this.records = [];
    this.serviceRecords = [];
    this.latestQuota = undefined;
    this.currentAgent = 'unknown';
    this.currentStage = 'unknown';
  }
}

/** Global singleton instance */
export const costTracker = new CostTracker();
