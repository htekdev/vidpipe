import type { ProgressEvent } from '../../L0-pure/types/index.js'

/**
 * Singleton that writes structured JSONL progress events to stderr.
 *
 * Enabled via `vidpipe process --progress`. When disabled (the default),
 * all `emit()` calls are no-ops — zero overhead for normal pipeline runs.
 *
 * ### Why stderr?
 * stdout carries human-readable Winston logs. stderr is the machine-readable
 * channel, following Unix conventions. Integrating tools (like VidRecord)
 * read stderr line-by-line and parse each JSON object.
 */
class ProgressEmitter {
  private enabled = false

  /** Turn on progress event output to stderr. */
  enable(): void {
    this.enabled = true
  }

  /** Turn off progress event output. */
  disable(): void {
    this.enabled = false
  }

  /** Whether the emitter is currently active. */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Write a progress event as a single JSON line to stderr.
   * No-op when the emitter is disabled.
   */
  emit(event: ProgressEvent): void {
    if (!this.enabled) return
    process.stderr.write(JSON.stringify(event) + '\n')
  }
}

/** Singleton progress emitter — enable via `progressEmitter.enable()`. */
export const progressEmitter = new ProgressEmitter()
