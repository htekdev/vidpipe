# Content Pipeline Prompt Analysis — Index

Complete documentation of all prompts, agents, and flows in the vidpipe content pipeline.

## 📚 Documentation Suite

This analysis suite consists of three comprehensive documents:

### 1. [Prompt Analysis Tool README](./prompt-analysis-readme.md)

**Purpose**: How to use the prompt analysis tool

**Contents**:
- Tool usage instructions
- Sample output
- Architecture overview
- Extending the tool
- Programmatic access examples

**Run the tool**: `npm run analyze:prompts`

### 2. [Prompt Analysis Report](./prompt-analysis.md)

**Purpose**: Complete analysis of all agent prompts

**Contents**:
- Overview statistics (7 agents, 8 tools, ~200 word average)
- Agent-by-agent breakdown with full prompts
- Characteristics analysis (tone, rules, workflow, constraints)
- Tool documentation
- MCP server usage

**Key Insights**:
- 4 agents use creative tone (shorts, medium, social, blog)
- 2 agents use conservative tone (silence removal, summary)
- 1 agent uses neutral tone (chapters)
- All agents use tool-based execution pattern
- 2 agents use Exa web search MCP

### 3. [Pipeline Flow Diagram](./pipeline-flow.md)

**Purpose**: Visual documentation of the 14-stage pipeline

**Contents**:
- Stage-by-stage flow diagram
- Data flow between stages
- Agent interaction patterns
- Service dependencies
- Output directory structure
- Performance characteristics
- Configuration guide

**Key Flows**:
- Video → Ingestion → Transcription → Silence Removal → Captions → Burn
- Original Transcript → Shorts + Medium Clips + Chapters
- Adjusted Transcript → Captions (aligned to edited video)

## 🎯 Quick Navigation

### By Use Case

**Want to understand a specific agent?**
→ [Prompt Analysis Report](./prompt-analysis.md) — Jump to the agent section

**Want to see how stages connect?**
→ [Pipeline Flow Diagram](./pipeline-flow.md) — Visual flow diagrams

**Want to modify prompts?**
→ [Prompt Analysis Tool](./prompt-analysis-readme.md) — Re-run after changes

**Want to add a new agent?**
→ [Prompt Analysis Tool](./prompt-analysis-readme.md#extending-the-tool) — Extension guide

### By Agent

| Agent | Stage | Report Section | Flow Diagram |
|-------|-------|---------------|--------------|
| SilenceRemovalAgent | 3 | [View](./prompt-analysis.md#silenceremovalagent) | [View](./pipeline-flow.md#stage-3-silence-removal-ai-agent) |
| ShortsAgent | 6 | [View](./prompt-analysis.md#shortsagent) | [View](./pipeline-flow.md#stage-6-shorts-generation-ai-agent) |
| MediumVideoAgent | 7 | [View](./prompt-analysis.md#mediumvideoagent) | [View](./pipeline-flow.md#stage-7-medium-clips-generation-ai-agent) |
| ChapterAgent | 8 | [View](./prompt-analysis.md#chapteragent) | [View](./pipeline-flow.md#stage-8-chapters-generation-ai-agent) |
| SummaryAgent | 9 | [View](./prompt-analysis.md#summaryagent) | [View](./pipeline-flow.md#stage-9-summary-generation-ai-agent) |
| SocialMediaAgent | 10-12 | [View](./prompt-analysis.md#socialmediaagent) | [View](./pipeline-flow.md#stage-10-social-media-posts-ai-agent) |
| BlogAgent | 13 | [View](./prompt-analysis.md#blogagent) | [View](./pipeline-flow.md#stage-13-blog-post-generation-ai-agent) |

### By Topic

**Prompts & AI**:
- [Agent System Prompts](./prompt-analysis.md#agent-by-agent-analysis)
- [Tool Definitions](./prompt-analysis.md#tools)
- [MCP Server Usage](./prompt-analysis.md#mcp-servers)
- [Agent Interaction Flow](./pipeline-flow.md#agent-interaction-flow)

**Pipeline Architecture**:
- [14-Stage Flow](./pipeline-flow.md#pipeline-overview)
- [Data Flow](./pipeline-flow.md#data-flow)
- [Error Handling](./pipeline-flow.md#error-handling)
- [Output Structure](./pipeline-flow.md#output-directory-structure)

**Configuration**:
- [Environment Variables](./pipeline-flow.md#environment-variables)
- [Brand Configuration](./pipeline-flow.md#brand-configuration)
- [Model Selection](./pipeline-flow.md#llm-model-selection)
- [Stage Control Flags](./pipeline-flow.md#stage-control)

**Performance**:
- [Duration Estimates](./pipeline-flow.md#typical-pipeline-duration)
- [Token Usage](./pipeline-flow.md#token-usage)
- [Service Costs](./pipeline-flow.md#external-services)

## 📊 Summary Statistics

### Pipeline Coverage

- **Total Stages**: 14
- **AI-Powered Stages**: 7 (stages 3, 6-13)
- **Service Stages**: 7 (stages 1, 2, 4, 5, 14)

### Agent Statistics

- **Total Agents**: 7
- **Total Tools**: 8 (1 per agent, except SummaryAgent with 2)
- **Average Prompt Length**: 200 words
- **Agents with Web Search**: 2 (SocialMediaAgent, BlogAgent)

### Output Generation

Per 10-minute video, the pipeline generates:

- **1** edited video (silence removed)
- **1** captioned video (ASS subtitles burned)
- **3-8** short clips with 5 platform variants each = 15-40 videos
- **2-4** medium clips = 2-4 videos
- **1** README summary with 3-8 screenshots
- **5** social media posts (full video)
- **15-40** social media posts (per short clip × 5 platforms)
- **10-20** social media posts (per medium clip × 5 platforms)
- **1** dev.to blog post
- **4** chapter formats (JSON, YouTube, Markdown, FFmetadata)
- **3** caption formats (SRT, VTT, ASS)

**Total files**: ~100-150 per video

## 🔄 Regenerating Reports

After making changes to agent prompts or configurations:

```bash
# Run the analysis tool
npm run analyze:prompts

# Commit updated reports
git add docs/prompt-analysis.*
git commit -m "Update prompt analysis"
git push
```

Reports track:
- Prompt evolution over time
- Tool additions/changes
- Characteristic shifts

## 🛠️ Development Workflow

### Understanding Existing Agents

1. **Read the flow** → [Pipeline Flow Diagram](./pipeline-flow.md)
2. **Find the agent** → [Prompt Analysis Report](./prompt-analysis.md)
3. **Review the code** → `src/agents/{AgentName}.ts`

### Adding a New Agent

1. **Create agent** → `src/agents/NewAgent.ts`
2. **Add to pipeline** → `src/pipeline.ts`
3. **Update analyzer** → `src/tools/analysis/promptAnalyzer.ts`
4. **Re-run analysis** → `npm run analyze:prompts`
5. **Commit reports** → `git add docs/prompt-analysis.*`

### Modifying Prompts

1. **Edit prompt** → `src/agents/{AgentName}.ts`
2. **Test locally** → Process a sample video
3. **Re-run analysis** → `npm run analyze:prompts`
4. **Compare changes** → `git diff docs/prompt-analysis.md`
5. **Commit if satisfied** → `git add docs/prompt-analysis.*`

## 📖 Further Reading

### Source Code

- [Agent Base Class](../src/agents/BaseAgent.ts) — Agent pattern implementation
- [Pipeline Orchestration](../src/pipeline.ts) — Stage execution and flow
- [Model Configuration](../src/config/modelConfig.ts) — Model selection logic
- [Brand Configuration](../brand.json) — Brand voice and vocabulary

### External Resources

- [GitHub Copilot SDK](https://github.com/copilot-sdk/copilot-sdk) — LLM provider abstraction
- [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text) — Transcription API
- [Exa AI](https://docs.exa.ai/) — Web search API
- [FFmpeg](https://ffmpeg.org/documentation.html) — Video processing

### Related Documentation

- [Main README](../README.md) — Project overview and setup
- [Custom Instructions](../custom_instructions.md) — Development guidelines
- [Contributing Guide](../CONTRIBUTING.md) — How to contribute

## 🙏 Acknowledgments

This analysis suite was created to provide comprehensive documentation for:

- **Developers** — Understanding the pipeline architecture
- **Prompt Engineers** — Analyzing and improving agent prompts
- **Researchers** — Studying LLM-based video processing workflows
- **Contributors** — Onboarding and making informed changes

## 📅 Maintenance

**Last Generated**: Check `docs/prompt-analysis.md` header for timestamp

**Update Frequency**: After any changes to:
- Agent system prompts
- Tool definitions
- MCP server configurations
- Pipeline stages
- Brand configuration

**Automation**: Consider adding `npm run analyze:prompts` to pre-commit hooks or CI/CD pipeline.
