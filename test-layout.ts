import { LayoutAgent } from './src/agents/LayoutAgent.js'

const agent = new LayoutAgent()

const result = await agent.createPortraitVariant(
  'recordings/bandicam-2026-02-10-18-37-56-001/bandicam-2026-02-10-18-37-56-001.mp4',
  'recordings/bandicam-2026-02-10-18-37-56-001/variants/portrait.mp4'
)

console.log('Result:', result)

