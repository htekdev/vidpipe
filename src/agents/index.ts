/**
 * Agent exports for vidpipe.
 *
 * All AI agents extend BaseAgent and use the LLM provider abstraction
 * for tool-calling workflows.
 */

export { BaseAgent } from './BaseAgent.js'
export { generateBlogPost } from './BlogAgent.js'
export { generateChapters } from './ChapterAgent.js'
export { generateMediumClips } from './MediumVideoAgent.js'
export { ProducerAgent } from './ProducerAgent.js'
export { generateShorts } from './ShortsAgent.js'
export { removeDeadSilence } from './SilenceRemovalAgent.js'
export { generateShortPosts, generateSocialPosts } from './SocialMediaAgent.js'
export { generateSummary } from './SummaryAgent.js'
