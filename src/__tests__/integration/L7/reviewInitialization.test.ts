import { readFile } from 'node:fs/promises'
import { Script, createContext } from 'node:vm'
import { describe, test, expect, vi } from 'vitest'

async function mountReview(fetchResult: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const document = await readFile(new URL('../../../L7-app/review/public/index.html', import.meta.url), 'utf8')
  const start = document.indexOf('function App()')
  const end = document.indexOf('render(html`<${App}', start)
  const state: unknown[] = []
  const effects: Array<() => void> = []
  let cursor = 0
  const context = createContext({
    useState(initial: unknown) {
      const index = cursor++
      if (state.length <= index) state.push(initial)
      return [state[index], (value: unknown) => { state[index] = value }]
    },
    useEffect(effect: () => void) { effects.push(effect) },
    useCallback: (callback: unknown) => callback,
    html: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((result, part, index) => result + part + String(values[index] ?? ''), ''),
    fetch: vi.fn().mockResolvedValue(fetchResult),
    showToast: vi.fn(),
    SkeletonCard: 'SkeletonCard',
    EmptyState: 'EmptyState',
    SummaryState: 'SummaryState',
    GroupedPostCard: 'GroupedPostCard',
    LoadingOverlay: 'LoadingOverlay',
    Header: 'Header',
    Footer: 'Footer',
  })
  const app = new Script(`${document.slice(start, end)}; App`).runInContext(context) as () => string
  app()
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  cursor = 0
  return app()
}

describe('Review initialization UI', () => {
  test('ReviewStorage.REQ-004: storage failure remains visible instead of reporting an empty queue', async () => {
    const markup = await mountReview({
      ok: false, status: 503,
      json: async () => ({ error: 'Unable to load review storage: AWS access denied' }),
    })
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('AWS access denied')
    expect(markup).not.toContain('<EmptyState')
    expect(markup).not.toContain('<SummaryState')
    expect(markup).not.toContain('<SkeletonCard')
  })

  test('ReviewStorage.REQ-004: a successful empty response shows the genuine empty state', async () => {
    const markup = await mountReview({ ok: true, status: 200, json: async () => ({ groups: [] }) })
    expect(markup).toContain('<EmptyState')
    expect(markup).not.toContain('role="alert"')
  })
})
