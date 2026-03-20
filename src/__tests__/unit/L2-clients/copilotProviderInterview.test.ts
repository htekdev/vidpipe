import { describe, test, expect } from 'vitest'

describe('CopilotProvider — sendAndWaitForIdle', () => {
  test.skip(
    'ideateStart.REQ-052: zero timeoutMs triggers send+idle path instead of sendAndWait',
    () => {
      // The sendAndWaitForIdle method is private and tested via integration.
    },
  )
})
