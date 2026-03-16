import type { ProgressEvent } from '../../L0-pure/types/index.js'

export type ProgressListener = (event: ProgressEvent) => void

/**
 * Singleton that writes structured JSONL progress events to stderr
 * and dispatches to programmatic listeners.
 *
 * Enabled via `vidpipe process --progress` for stderr JSONL output.
 * SDK consumers register listeners via `addListener()` for in-process callbacks.
 *
 * When disabled AND no listeners are registered, all `emit()` calls are no-ops.
 *
 * ### Why stderr?
 * stdout carries human-readable Winston logs. stderr is the machine-readable
 * channel, following Unix conventions. Integrating tools (like VidRecord)
 * read stderr line-by-line and parse each JSON object.
 */
class ProgressEmitter {
  private enabled = false
  private listeners: Set<ProgressListener> = new Set()

  /** Turn on progress event output to stderr. */
  enable(): void {
    this.enabled = true
  }

  /** Turn off progress event output. */
  disable(): void {
    this.enabled = false
  }

  /** Whether the emitter is currently active (stderr or listeners). */
  isEnabled(): boolean {
    return this.enabled || this.listeners.size > 0
  }

  /** Register a programmatic listener for progress events. */
  addListener(fn: ProgressListener): void {
    this.listeners.add(fn)
  }

  /** Remove a previously registered listener. */
  removeListener(fn: ProgressListener): void {
    this.listeners.delete(fn)
  }

  /**
   * Write a progress event as a single JSON line to stderr (if enabled)
   * and dispatch to all registered listeners.
   * No-op when neither stderr output nor listeners are active.
   */
  emit(event: ProgressEvent): void {
    if (!this.enabled && this.listeners.size === 0) return
    if (this.enabled) {
      process.stderr.write(JSON.stringify(event) + '\n')
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

/** Singleton progress emitter — enable via `progressEmitter.enable()`. */
export const progressEmitter = new ProgressEmitter()
