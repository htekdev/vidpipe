/**
 * Maps source layers to required test tiers and validates that
 * staged test changes cover all required tiers.
 */

import type { CodeChange, TestChange } from './diffAnalyzer.js';

export interface TierRequirement {
  tier: string;
  testDir: string;
  satisfied: boolean;
  matchingTests: string[];
}

export interface LayerRequirements {
  layer: number;
  files: string[];
  requiredTiers: TierRequirement[];
  allSatisfied: boolean;
}

/**
 * Layer → required test tiers mapping.
 * Each layer requires unit tests at its level + applicable integration + e2e.
 */
const LAYER_TEST_TIERS: Record<number, { tier: string; testDir: string }[]> = {
  0: [
    { tier: 'unit', testDir: 'src/__tests__/unit/L0-' },
    { tier: 'e2e', testDir: 'src/__tests__/e2e/' },
  ],
  1: [
    { tier: 'unit', testDir: 'src/__tests__/unit/L1-' },
    { tier: 'e2e', testDir: 'src/__tests__/e2e/' },
  ],
  2: [
    { tier: 'unit', testDir: 'src/__tests__/unit/L2-' },
    { tier: 'integration-L3', testDir: 'src/__tests__/integration/L3/' },
    { tier: 'e2e', testDir: 'src/__tests__/e2e/' },
  ],
  3: [
    { tier: 'unit', testDir: 'src/__tests__/unit/L3-' },
    { tier: 'integration-L3', testDir: 'src/__tests__/integration/L3/' },
    { tier: 'e2e', testDir: 'src/__tests__/e2e/' },
  ],
  4: [
    { tier: 'unit', testDir: 'src/__tests__/unit/L4-' },
    { tier: 'integration-L4-L6', testDir: 'src/__tests__/integration/L4-L6/' },
    { tier: 'e2e', testDir: 'src/__tests__/e2e/' },
  ],
  5: [
    { tier: 'unit', testDir: 'src/__tests__/unit/L5-' },
    { tier: 'integration-L4-L6', testDir: 'src/__tests__/integration/L4-L6/' },
    { tier: 'e2e', testDir: 'src/__tests__/e2e/' },
  ],
  6: [
    { tier: 'unit', testDir: 'src/__tests__/unit/L6-' },
    { tier: 'integration-L4-L6', testDir: 'src/__tests__/integration/L4-L6/' },
    { tier: 'e2e', testDir: 'src/__tests__/e2e/' },
  ],
  7: [
    { tier: 'unit', testDir: 'src/__tests__/unit/L7-' },
    { tier: 'integration-L7', testDir: 'src/__tests__/integration/L7/' },
    { tier: 'e2e', testDir: 'src/__tests__/e2e/' },
  ],
};

/**
 * Validate that staged test changes cover all required tiers for each changed layer.
 */
export function validateTestTiers(
  codeChanges: readonly CodeChange[],
  testChanges: readonly TestChange[]
): LayerRequirements[] {
  const layerFiles = new Map<number, string[]>();
  for (const change of codeChanges) {
    const files = layerFiles.get(change.layer) ?? [];
    files.push(change.file);
    layerFiles.set(change.layer, files);
  }

  const requirements: LayerRequirements[] = [];

  for (const [layer, files] of layerFiles) {
    const tiers = LAYER_TEST_TIERS[layer];
    if (!tiers) continue;

    const seenTiers = new Set<string>();
    const requiredTiers: TierRequirement[] = [];

    for (const { tier, testDir } of tiers) {
      if (seenTiers.has(tier)) continue;
      seenTiers.add(tier);

      const matchingTests = testChanges
        .filter(t => t.file.startsWith(testDir) || (tier === 'e2e' && t.tier === 'e2e'))
        .map(t => t.file);

      requiredTiers.push({
        tier,
        testDir,
        satisfied: matchingTests.length > 0,
        matchingTests,
      });
    }

    requirements.push({
      layer,
      files,
      requiredTiers,
      allSatisfied: requiredTiers.every(t => t.satisfied),
    });
  }

  return requirements;
}

/**
 * Format a report of missing test tiers for display.
 */
export function formatMissingTiers(requirements: readonly LayerRequirements[]): string {
  const lines: string[] = [];

  for (const req of requirements) {
    const missing = req.requiredTiers.filter(t => !t.satisfied);
    if (missing.length === 0) continue;

    lines.push(`  L${req.layer} changes require:`);
    for (const tier of req.requiredTiers) {
      const icon = tier.satisfied ? '✅' : '❌';
      lines.push(`    ${tier.tier} ${icon}${tier.satisfied ? '' : ` (need tests in ${tier.testDir})`}`);
    }
  }

  return lines.join('\n');
}
