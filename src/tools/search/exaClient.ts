// Exa AI web search client
// Searches the web for relevant links based on topics

import Exa from 'exa-js'
import { getConfig } from '../../config/environment'
import logger from '../../config/logger'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export async function searchWeb(query: string, numResults: number = 5): Promise<SearchResult[]> {
  const config = getConfig()
  if (!config.EXA_API_KEY) {
    logger.warn('EXA_API_KEY not set — skipping web search')
    return []
  }
  
  const exa = new Exa(config.EXA_API_KEY)
  
  try {
    const results = await exa.searchAndContents(query, {
      numResults,
      text: { maxCharacters: 200 }
    })
    
    return results.results.map(r => ({
      title: r.title || '',
      url: r.url,
      snippet: (r as any).text || ''
    }))
  } catch (err) {
    logger.error(`Exa search failed: ${err instanceof Error ? err.message : err}`)
    return []
  }
}

export async function searchTopics(topics: string[]): Promise<Map<string, SearchResult[]>> {
  const resultsMap = new Map<string, SearchResult[]>()
  for (const topic of topics) {
    const results = await searchWeb(topic, 3)
    resultsMap.set(topic, results)
  }
  return resultsMap
}
