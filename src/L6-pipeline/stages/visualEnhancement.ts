// Re-export from L5 — enhanceVideo was moved to respect layer boundaries
// (L5 can import L0–L4; this file previously imported L3+L4 directly)
export { enhanceVideo } from '../../L5-assets/visualEnhancement.js'
