// Wrapper for L5 enhanceVideo — respects layer boundaries
// (L6 can only import L0, L1, L5)
import { enhanceVideo as _enhanceVideo } from '../../L5-assets/visualEnhancement.js'

export function enhanceVideo(
  ...args: Parameters<typeof _enhanceVideo>
): ReturnType<typeof _enhanceVideo> {
  return _enhanceVideo(...args)
}
