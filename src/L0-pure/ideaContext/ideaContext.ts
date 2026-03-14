import type { Idea } from '../types/index.js'

export function buildIdeaContext(ideas: readonly Idea[]): string {
  if (ideas.length === 0) return ''

  return `\n\n## Creator's Intent for This Video\n\n` +
    ideas.map(idea => [
      `### Idea: ${idea.topic}`,
      `- **Hook angle:** ${idea.hook}`,
      `- **Target audience:** ${idea.audience}`,
      `- **Key takeaway:** ${idea.keyTakeaway}`,
      `- **Talking points:** ${idea.talkingPoints.join(', ')}`,
    ].join('\n')).join('\n\n') +
    `\n\n**PRIORITY:** Clips that deliver the creator's intended message AND score high on virality should be ranked above clips that are only generically viral. Ensure at least one clip directly delivers the key takeaway.\n`
}

export function buildIdeaContextForPosts(ideas: readonly Idea[]): string {
  if (ideas.length === 0) return ''

  return `\n\n## Creator's Content Intent\n\n` +
    ideas.map(idea => [
      `### Idea: ${idea.topic}`,
      `- **Hook:** ${idea.hook}`,
      `- **Target audience:** ${idea.audience}`,
      `- **Key takeaway:** ${idea.keyTakeaway}`,
      `- **Target platforms:** ${idea.platforms.join(', ')}`,
    ].join('\n')).join('\n\n') +
    `\n\n**Posts should align to the creator's intended message and hook angle.** Use the key takeaway as the primary CTA where possible.\n`
}

export function buildIdeaContextForSummary(ideas: readonly Idea[]): string {
  if (ideas.length === 0) return ''

  return `\n\n## Creator's Intent\n\n` +
    `This video was created to cover the following ideas. The summary should reflect these themes:\n\n` +
    ideas.map(idea => `- **${idea.topic}:** ${idea.keyTakeaway}`).join('\n') + '\n'
}

export function buildIdeaContextForBlog(ideas: readonly Idea[]): string {
  if (ideas.length === 0) return ''

  return `\n\n## Editorial Direction from Creator\n\n` +
    ideas.map(idea => [
      `### ${idea.topic}`,
      `- **Angle:** ${idea.hook}`,
      `- **Audience:** ${idea.audience}`,
      `- **Key takeaway:** ${idea.keyTakeaway}`,
      `- **Points to cover:** ${idea.talkingPoints.join('; ')}`,
    ].join('\n')).join('\n\n') +
    `\n\n**Write the blog post to deliver these key takeaways.** The editorial angle should match the creator's intended hook.\n`
}
