import { readFile } from 'node:fs/promises'
import { createContext, Script } from 'node:vm'
import { expect, test, vi } from 'vitest'

test('ReviewStorage.REQ-005: displayed duplicate partitions accompany both frontend bulk actions', async () => {
  const document = await readFile(new URL('../../../L7-app/review/public/index.html', import.meta.url), 'utf8')
  const start = document.indexOf('function App()')
  const end = document.indexOf('render(html`<${App}', start)
  const items = [{ id: 'duplicate', videoSlug: 'older', platform: 'linkedin' }]
  const state: unknown[] = [[{ groupKey: 'clip', items }], null, {}, null, 0, ['duplicate'], false,
    '', { approved: 0, rejected: 0, skipped: 0 }, '']
  let cursor = 0
  const callbacks: Array<(...args: unknown[]) => Promise<void>> = []
  const fetch = vi.fn().mockResolvedValue({})
  const context = createContext({
    useState() { return [state[cursor++], () => {}] },
    useEffect() {},
    useCallback(callback: (...args: unknown[]) => Promise<void>) { callbacks.push(callback); return callback },
    html: () => '', fetch, showToast: vi.fn(), setTimeout: vi.fn(),
    GroupedPostCard: '', LoadingOverlay: '', Header: '', Footer: '',
  })
  new Script(`${document.slice(start, end)}; App()`).runInContext(context)
  const approve = callbacks.find(callback => callback.toString().includes('/api/posts/bulk-approve'))!
  const reject = callbacks.find(callback => callback.toString().includes('/api/posts/bulk-reject'))!
  await approve(true)
  await reject()
  expect(fetch.mock.calls.map(([url, options]) => ({ url, body: JSON.parse(options.body) }))).toEqual([
    { url: '/api/posts/bulk-approve', body: { itemIds: ['duplicate'], priority: true, videoSlugs: { duplicate: 'older' } } },
    { url: '/api/posts/bulk-reject', body: { itemIds: ['duplicate'], videoSlugs: { duplicate: 'older' } } },
  ])
})
