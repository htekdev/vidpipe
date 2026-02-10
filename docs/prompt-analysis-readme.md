# Prompt Analysis Tool

Comprehensive analysis tool for all content pipeline prompts in vidpipe.

## Overview

This tool analyzes all system prompts used across the 14-stage video processing pipeline, extracting key characteristics, patterns, and documentation for each AI agent.

## Usage

Run the analysis:

```bash
npm run analyze:prompts
```

This will generate two reports in the `docs/` directory:

- **`prompt-analysis.md`** — Human-readable Markdown report with full analysis
- **`prompt-analysis.json`** — Machine-readable JSON data for programmatic access

## What's Analyzed

### Per-Agent Analysis

For each of the 7 AI agents in the pipeline, the tool extracts:

- **System Prompt** — The complete prompt text sent to the LLM
- **Pipeline Stage** — Which stage(s) this agent runs in
- **Word Count** — Prompt length in words
- **Tone** — Conservative, creative, professional, or neutral
- **Primary Goal** — The agent's main objective
- **Key Constraints** — Important rules and requirements
- **Tools** — Functions the agent can call (with descriptions)
- **MCP Servers** — External services the agent uses (e.g., Exa for web search)
- **Output Format** — Expected output types (JSON, Markdown, YAML, etc.)
- **Characteristics** — Whether the prompt has rules, examples, workflow instructions

### Agents Covered

1. **SilenceRemovalAgent** (Stage 3) — Context-aware silence removal decisions
2. **ShortsAgent** (Stage 6) — Short clip planning (15-60 seconds)
3. **MediumVideoAgent** (Stage 7) — Medium clip planning (60-180 seconds)
4. **ChapterAgent** (Stage 8) — Chapter boundary detection
5. **SummaryAgent** (Stage 9) — README generation with frame captures
6. **SocialMediaAgent** (Stage 10-12) — Multi-platform social post generation
7. **BlogAgent** (Stage 13) — Dev.to blog post generation

### Summary Statistics

The tool also provides:

- **Total agent count**
- **Total tool count** across all agents
- **Average prompt length**
- **Common patterns** (rule-based, example-driven, workflow-oriented)
- **Prompt type distribution** by tone

## Sample Output

```
🔍 Analyzing content pipeline prompts...

✅ Analysis complete!

📊 Summary:
   - Total Agents: 7
   - Total Tools: 8
   - Average Prompt Length: 200 words

🎯 Agent breakdown:
   - SilenceRemovalAgent: 176 words, 1 tools
   - ShortsAgent: 228 words, 1 tools
   - MediumVideoAgent: 381 words, 1 tools
   - ChapterAgent: 123 words, 1 tools
   - SummaryAgent: 89 words, 2 tools
   - SocialMediaAgent: 217 words, 1 tools
   - BlogAgent: 189 words, 1 tools

✨ Common patterns:
   - Workflow-oriented
   - Tool-driven execution
```

## Architecture

### Files

```
src/tools/analysis/
├── promptAnalyzer.ts  # Core analysis logic
└── runAnalysis.ts     # CLI runner script
```

### How It Works

1. **Extract** — Parses agent source files to find `SYSTEM_PROMPT` constants and `buildSystemPrompt()` functions
2. **Analyze** — Examines prompt characteristics (word count, tone, patterns, constraints)
3. **Generate** — Creates both Markdown and JSON reports

### Key Functions

- `analyzeContentPipelines(agentsDir)` — Main analysis function
- `extractPromptFromFile(filePath)` — Extract prompt from a single agent file
- `analyzePrompt(prompt)` — Analyze prompt characteristics
- `generateMarkdownReport(analysis)` — Generate human-readable report
- `generateJSONReport(analysis)` — Generate machine-readable report

## Use Cases

### For Development

- **Prompt Engineering** — Review and compare prompts across agents
- **Consistency Checks** — Ensure similar agents use similar patterns
- **Documentation** — Keep prompt documentation up-to-date

### For Optimization

- **Token Usage** — Identify prompts that could be shortened
- **Pattern Recognition** — Find common structures to extract into templates
- **Tool Coverage** — See which agents use which tools

### For Research

- **Prompt Templates** — Export prompts for reuse in other projects
- **Benchmark Data** — Compare prompt effectiveness across agents
- **LLM Testing** — Test prompts with different models

## Extending the Tool

### Adding New Agents

When you add a new agent to the pipeline:

1. Create the agent file in `src/agents/`
2. Define a `SYSTEM_PROMPT` constant or `buildSystemPrompt()` function
3. Add the filename to the `agentFiles` array in `promptAnalyzer.ts`
4. Add the stage mapping to `stageMapping` in `extractPromptFromFile()`
5. Re-run the analysis: `npm run analyze:prompts`

### Custom Analysis

You can extend the analysis by:

- Adding new characteristics to `PromptCharacteristics` interface
- Implementing custom pattern detection in `analyzePrompt()`
- Creating additional report formats (CSV, HTML, etc.)

## Example: Accessing Data Programmatically

```typescript
import { analyzeContentPipelines } from './src/tools/analysis/promptAnalyzer.js'

const analysis = await analyzeContentPipelines('./src/agents')

// Find the longest prompt
const longest = analysis.prompts.reduce((max, p) => 
  p.characteristics.wordCount > max.characteristics.wordCount ? p : max
)

console.log(`Longest prompt: ${longest.agentName} (${longest.characteristics.wordCount} words)`)

// Find all agents that use web search
const searchAgents = analysis.prompts.filter(p => 
  p.mcpServers?.includes('Exa Web Search')
)

console.log('Agents with web search:', searchAgents.map(a => a.agentName))
```

## Related Documentation

- [Pipeline Documentation](../README.md#pipeline-stages) — Full pipeline overview
- [Agent Pattern](../custom_instructions.md#agent-pattern) — How agents are structured
- [Brand Configuration](../brand.json) — Brand voice used in prompts
- [Model Configuration](../src/config/modelConfig.ts) — Model selection per agent

## Maintenance

Run the analysis tool after any changes to:

- Agent system prompts
- Tool definitions
- MCP server configurations
- Brand configuration (for dynamic prompts)

The reports should be committed to the repository to track prompt evolution over time.
