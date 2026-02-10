#!/usr/bin/env node
import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { analyzeContentPipelines, generateMarkdownReport, generateJSONReport } from './promptAnalyzer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Run prompt analysis and generate reports
 */
async function main() {
  console.log('🔍 Analyzing content pipeline prompts...\n')
  
  // Find agents directory
  const agentsDir = path.resolve(__dirname, '../../agents')
  
  try {
    // Run analysis
    const analysis = await analyzeContentPipelines(agentsDir)
    
    // Generate reports
    const markdownReport = generateMarkdownReport(analysis)
    const jsonReport = generateJSONReport(analysis)
    
    // Create docs directory if it doesn't exist
    const docsDir = path.resolve(process.cwd(), 'docs')
    await fs.mkdir(docsDir, { recursive: true })
    
    // Write reports
    const markdownPath = path.join(docsDir, 'prompt-analysis.md')
    const jsonPath = path.join(docsDir, 'prompt-analysis.json')
    
    await fs.writeFile(markdownPath, markdownReport, 'utf-8')
    await fs.writeFile(jsonPath, jsonReport, 'utf-8')
    
    // Print summary to console
    console.log('✅ Analysis complete!\n')
    console.log('📊 Summary:')
    console.log(`   - Total Agents: ${analysis.totalAgents}`)
    console.log(`   - Total Tools: ${analysis.summary.totalTools}`)
    console.log(`   - Average Prompt Length: ${analysis.summary.avgWordCount} words`)
    console.log(`\n📝 Reports generated:`)
    console.log(`   - Markdown: ${markdownPath}`)
    console.log(`   - JSON: ${jsonPath}`)
    console.log('\n🎯 Agent breakdown:')
    
    for (const prompt of analysis.prompts) {
      console.log(`   - ${prompt.agentName}: ${prompt.characteristics.wordCount} words, ${prompt.tools.length} tools`)
    }
    
    console.log('\n✨ Common patterns:')
    for (const pattern of analysis.summary.commonPatterns) {
      console.log(`   - ${pattern}`)
    }
    
  } catch (error) {
    console.error('❌ Error running analysis:', error)
    process.exit(1)
  }
}

main()
