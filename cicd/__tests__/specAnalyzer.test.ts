import { describe, test, expect } from 'vitest';
import {
  parseSpecReqs,
  parseTestSpecRefs,
  extractSpecName,
  analyzeSpecTestTraceability,
  formatTraceabilityReport,
} from '../lib/specAnalyzer.js';

describe('parseSpecReqs', () => {
  test('extracts REQ-XXX from markdown table rows', () => {
    const content = `
| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | CLI displays version | Must |
| REQ-002 | CLI displays help | Must |
| REQ-010 | Init checks FFmpeg | Should |
`;
    const reqs = parseSpecReqs(content);
    expect(reqs).toEqual(['REQ-001', 'REQ-002', 'REQ-010']);
  });

  test('returns empty array for content without REQs', () => {
    const content = '# Some Header\n\nNo requirements here.';
    expect(parseSpecReqs(content)).toEqual([]);
  });

  test('deduplicates repeated REQs', () => {
    const content = `
| REQ-001 | First mention |
| REQ-001 | Duplicate mention |
| REQ-002 | Another req |
`;
    const reqs = parseSpecReqs(content);
    expect(reqs).toEqual(['REQ-001', 'REQ-002']);
  });

  test('handles various whitespace in table cells', () => {
    const content = `
|REQ-001| tight |
| REQ-002  | spaced |
|  REQ-003   | extra spaced |
`;
    const reqs = parseSpecReqs(content);
    expect(reqs).toEqual(['REQ-001', 'REQ-002', 'REQ-003']);
  });
});

describe('parseTestSpecRefs', () => {
  test('extracts SpecName.REQ-XXX from test content', () => {
    const content = `
describe('CLI Specification', () => {
  test('CLI.REQ-001: displays version', () => {});
  test('CLI.REQ-002: displays help', () => {});
  test.todo('CLI.REQ-010: init checks FFmpeg');
});
`;
    const refs = parseTestSpecRefs(content);
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ specName: 'CLI', reqId: 'REQ-001', fullId: 'CLI.REQ-001' });
    expect(refs[1]).toEqual({ specName: 'CLI', reqId: 'REQ-002', fullId: 'CLI.REQ-002' });
    expect(refs[2]).toEqual({ specName: 'CLI', reqId: 'REQ-010', fullId: 'CLI.REQ-010' });
  });

  test('handles double quotes', () => {
    const content = `test("VideoAsset.REQ-001: loads metadata", () => {});`;
    const refs = parseTestSpecRefs(content);
    expect(refs[0].fullId).toBe('VideoAsset.REQ-001');
  });

  test('handles backticks', () => {
    const content = 'test(`VisualEnhancement.REQ-030: saves enhanced video`, () => {});';
    const refs = parseTestSpecRefs(content);
    expect(refs[0].fullId).toBe('VisualEnhancement.REQ-030');
  });

  test('deduplicates repeated references', () => {
    const content = `
test('CLI.REQ-001: first test');
test('CLI.REQ-001: second test for same req');
`;
    const refs = parseTestSpecRefs(content);
    expect(refs).toHaveLength(1);
  });

  test('returns empty array for content without refs', () => {
    const content = `test('some regular test', () => {});`;
    expect(parseTestSpecRefs(content)).toEqual([]);
  });
});

describe('extractSpecName', () => {
  test('extracts spec name from file path', () => {
    expect(extractSpecName('specs/L7-app/CLI.md')).toBe('CLI');
    expect(extractSpecName('specs/L4-agents/VisualEnhancement.md')).toBe('VisualEnhancement');
    expect(extractSpecName('specs/L5-assets/VideoAsset.md')).toBe('VideoAsset');
  });

  test('handles Windows-style paths', () => {
    expect(extractSpecName('specs\\L7-app\\CLI.md')).toBe('CLI');
  });

  test('returns empty string for non-spec paths', () => {
    expect(extractSpecName('src/L7-app/cli.ts')).toBe('');
    expect(extractSpecName('README.md')).toBe('');
  });
});

describe('analyzeSpecTestTraceability', () => {
  // Note: This requires git diff access, so we test the logic with mocked data
  // The integration tests will cover full flow

  test('returns satisfied when no spec files', () => {
    const result = analyzeSpecTestTraceability([], []);
    expect(result.satisfied).toBe(true);
    expect(result.specChanges).toEqual([]);
    expect(result.missingTestRefs).toEqual([]);
  });
});

describe('formatTraceabilityReport', () => {
  test('formats success message when satisfied', () => {
    const result = {
      specChanges: [],
      missingTestRefs: [],
      satisfied: true,
    };
    const report = formatTraceabilityReport(result);
    expect(report).toContain('✅');
    expect(report).toContain('All spec changes have corresponding test references');
  });

  test('formats missing refs grouped by spec', () => {
    const result = {
      specChanges: [{ file: 'specs/L7-app/CLI.md', specName: 'CLI', changedReqs: ['REQ-001', 'REQ-002'] }],
      missingTestRefs: ['CLI.REQ-001', 'CLI.REQ-002'],
      satisfied: false,
    };
    const report = formatTraceabilityReport(result);
    expect(report).toContain('CLI:');
    expect(report).toContain('❌ CLI.REQ-001');
    expect(report).toContain('❌ CLI.REQ-002');
    expect(report).toContain('src/__tests__/');
  });
});
