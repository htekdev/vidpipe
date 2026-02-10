import * as fs from 'fs/promises'
import * as path from 'path'

/**
 * Prompt Analysis Tool
 * 
 * Analyzes all system prompts used across the vidpipe content pipeline.
 * Extracts prompts from agent source files and generates comprehensive documentation.
 */

export interface PromptInfo {
  agentName: string
  pipelineStage: string
  systemPrompt: string
  tools: ToolInfo[]
  characteristics: PromptCharacteristics
  mcpServers?: string[]
}

export interface ToolInfo {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface PromptCharacteristics {
  wordCount: number
  hasRules: boolean
  hasExamples: boolean
  hasWorkflow: boolean
  tone: string
  primaryGoal: string
  constraints: string[]
  outputFormat: string[]
}

export interface AnalysisReport {
  totalAgents: number
  prompts: PromptInfo[]
  summary: {
    avgWordCount: number
    commonPatterns: string[]
    promptTypes: Record<string, number>
    totalTools: number
  }
}

/**
 * Extract system prompt from agent source file
 */
async function extractPromptFromFile(filePath: string): Promise<PromptInfo | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    
    // Extract system prompt using regex
    const promptMatch = content.match(/const\s+SYSTEM_PROMPT\s+=\s+`([^`]*)`/s) ||
                       content.match(/function\s+buildSystemPrompt\([^)]*\)[^{]*{[\s\S]*?return\s+`([^`]*)`/s) ||
                       content.match(/function\s+build\w+SystemPrompt\([^)]*\)[^{]*{[\s\S]*?return\s+`([^`]*)`/s)
    
    if (!promptMatch) return null
    
    const systemPrompt = promptMatch[1].trim()
    const agentName = path.basename(filePath, '.ts')
    
    // Extract tool names
    const toolMatches = content.matchAll(/name:\s+['"](\w+)['"]/g)
    const tools: ToolInfo[] = []
    for (const match of toolMatches) {
      const toolName = match[1]
      const toolDescMatch = content.match(new RegExp(`name:\\s+['"]${toolName}['"][^}]+description:\\s+['"]([^'"]+)['"]`, 's'))
      const toolParamsMatch = content.match(new RegExp(`const\\s+\\w*SCHEMA\\s*=\\s*{([^}]+(?:{[^}]+}[^}]*)*)}`, 's'))
      
      tools.push({
        name: toolName,
        description: toolDescMatch?.[1] || '',
        parameters: toolParamsMatch ? {} : {}
      })
    }
    
    // Check for MCP servers
    const hasMcpServers = content.includes('getMcpServers()')
    const mcpServers: string[] = []
    if (hasMcpServers) {
      const exaMatch = content.match(/exa:\s*{/)
      if (exaMatch) mcpServers.push('Exa Web Search')
    }
    
    // Analyze characteristics
    const characteristics = analyzePrompt(systemPrompt)
    
    // Map agent to pipeline stage
    const stageMapping: Record<string, string> = {
      'SilenceRemovalAgent': 'Stage 3: Silence Removal',
      'ShortsAgent': 'Stage 6: Shorts Generation',
      'MediumVideoAgent': 'Stage 7: Medium Clips Generation',
      'ChapterAgent': 'Stage 8: Chapters Generation',
      'SummaryAgent': 'Stage 9: Summary Generation',
      'SocialMediaAgent': 'Stage 10-12: Social Media Posts',
      'BlogAgent': 'Stage 13: Blog Post Generation'
    }
    
    return {
      agentName,
      pipelineStage: stageMapping[agentName] || 'Unknown',
      systemPrompt,
      tools,
      characteristics,
      mcpServers: mcpServers.length > 0 ? mcpServers : undefined
    }
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err)
    return null
  }
}

/**
 * Analyze prompt characteristics
 */
function analyzePrompt(prompt: string): PromptCharacteristics {
  const wordCount = prompt.split(/\s+/).length
  const hasRules = /rules:|guidelines:|constraints:/i.test(prompt)
  const hasExamples = /example:|for instance:|e\.g\.|such as:/i.test(prompt)
  const hasWorkflow = /workflow:|steps:|process:|first|then|finally/i.test(prompt)
  
  // Detect tone
  let tone = 'neutral'
  if (/conservative|careful|cautious/i.test(prompt)) tone = 'conservative'
  else if (/viral|engaging|compelling|catchy/i.test(prompt)) tone = 'creative'
  else if (/professional|technical|precise/i.test(prompt)) tone = 'professional'
  
  // Extract primary goal from first sentence
  const firstSentence = prompt.split(/[.!?]/)[0]
  const primaryGoal = firstSentence.trim()
  
  // Extract constraints (must/must not statements)
  const constraints: string[] = []
  const mustMatches = prompt.matchAll(/(?:must|should|need to|required to)\s+([^.!?]+)/gi)
  for (const match of mustMatches) {
    constraints.push(match[1].trim())
  }
  
  // Extract output format requirements
  const outputFormat: string[] = []
  if (/json/i.test(prompt)) outputFormat.push('JSON')
  if (/markdown/i.test(prompt)) outputFormat.push('Markdown')
  if (/call.*tool/i.test(prompt)) outputFormat.push('Tool Calls')
  if (/yaml/i.test(prompt)) outputFormat.push('YAML')
  
  return {
    wordCount,
    hasRules,
    hasExamples,
    hasWorkflow,
    tone,
    primaryGoal,
    constraints: constraints.slice(0, 5), // Top 5 constraints
    outputFormat
  }
}

/**
 * Generate analysis report
 */
export async function analyzeContentPipelines(agentsDir: string): Promise<AnalysisReport> {
  const agentFiles = [
    'SilenceRemovalAgent.ts',
    'ShortsAgent.ts',
    'MediumVideoAgent.ts',
    'ChapterAgent.ts',
    'SummaryAgent.ts',
    'SocialMediaAgent.ts',
    'BlogAgent.ts'
  ]
  
  const prompts: PromptInfo[] = []
  
  for (const file of agentFiles) {
    const filePath = path.join(agentsDir, file)
    const promptInfo = await extractPromptFromFile(filePath)
    if (promptInfo) {
      prompts.push(promptInfo)
    }
  }
  
  // Calculate summary statistics
  const avgWordCount = prompts.reduce((sum, p) => sum + p.characteristics.wordCount, 0) / prompts.length
  const totalTools = prompts.reduce((sum, p) => sum + p.tools.length, 0)
  
  // Identify common patterns
  const commonPatterns: string[] = []
  const hasRulesCount = prompts.filter(p => p.characteristics.hasRules).length
  const hasExamplesCount = prompts.filter(p => p.characteristics.hasExamples).length
  const hasWorkflowCount = prompts.filter(p => p.characteristics.hasWorkflow).length
  
  if (hasRulesCount >= prompts.length * 0.7) commonPatterns.push('Rule-based instructions')
  if (hasExamplesCount >= prompts.length * 0.5) commonPatterns.push('Example-driven')
  if (hasWorkflowCount >= prompts.length * 0.7) commonPatterns.push('Workflow-oriented')
  
  // Count prompt types by tone
  const promptTypes: Record<string, number> = {}
  for (const prompt of prompts) {
    const tone = prompt.characteristics.tone
    promptTypes[tone] = (promptTypes[tone] || 0) + 1
  }
  
  return {
    totalAgents: prompts.length,
    prompts,
    summary: {
      avgWordCount: Math.round(avgWordCount),
      commonPatterns,
      promptTypes,
      totalTools
    }
  }
}

/**
 * Generate Markdown report
 */
export function generateMarkdownReport(analysis: AnalysisReport): string {
  let md = '# Content Pipeline Prompt Analysis\n\n'
  md += `*Generated: ${new Date().toISOString()}*\n\n`
  md += '## Overview\n\n'
  md += `- **Total Agents**: ${analysis.totalAgents}\n`
  md += `- **Total Tools**: ${analysis.summary.totalTools}\n`
  md += `- **Average Prompt Length**: ${analysis.summary.avgWordCount} words\n\n`
  
  md += '## Common Patterns\n\n'
  for (const pattern of analysis.summary.commonPatterns) {
    md += `- ${pattern}\n`
  }
  md += '\n'
  
  md += '## Prompt Type Distribution\n\n'
  md += '| Tone | Count |\n'
  md += '|------|-------|\n'
  for (const [tone, count] of Object.entries(analysis.summary.promptTypes)) {
    md += `| ${tone.charAt(0).toUpperCase() + tone.slice(1)} | ${count} |\n`
  }
  md += '\n'
  
  md += '---\n\n'
  md += '## Agent-by-Agent Analysis\n\n'
  
  for (const prompt of analysis.prompts) {
    md += `### ${prompt.agentName}\n\n`
    md += `**Pipeline Stage**: ${prompt.pipelineStage}\n\n`
    
    md += '#### Characteristics\n\n'
    md += `- **Word Count**: ${prompt.characteristics.wordCount}\n`
    md += `- **Tone**: ${prompt.characteristics.tone}\n`
    md += `- **Has Rules**: ${prompt.characteristics.hasRules ? '✓' : '✗'}\n`
    md += `- **Has Examples**: ${prompt.characteristics.hasExamples ? '✓' : '✗'}\n`
    md += `- **Has Workflow**: ${prompt.characteristics.hasWorkflow ? '✓' : '✗'}\n`
    md += `- **Output Format**: ${prompt.characteristics.outputFormat.join(', ') || 'Text'}\n\n`
    
    md += '#### Primary Goal\n\n'
    md += `> ${prompt.characteristics.primaryGoal}\n\n`
    
    if (prompt.characteristics.constraints.length > 0) {
      md += '#### Key Constraints\n\n'
      for (const constraint of prompt.characteristics.constraints) {
        md += `- ${constraint}\n`
      }
      md += '\n'
    }
    
    if (prompt.tools.length > 0) {
      md += '#### Tools\n\n'
      md += '| Tool Name | Description |\n'
      md += '|-----------|-------------|\n'
      for (const tool of prompt.tools) {
        md += `| \`${tool.name}\` | ${tool.description} |\n`
      }
      md += '\n'
    }
    
    if (prompt.mcpServers) {
      md += '#### MCP Servers\n\n'
      for (const server of prompt.mcpServers) {
        md += `- ${server}\n`
      }
      md += '\n'
    }
    
    md += '#### Full System Prompt\n\n'
    md += '```\n'
    md += prompt.systemPrompt
    md += '\n```\n\n'
    md += '---\n\n'
  }
  
  return md
}

/**
 * Generate JSON report
 */
export function generateJSONReport(analysis: AnalysisReport): string {
  return JSON.stringify(analysis, null, 2)
}
