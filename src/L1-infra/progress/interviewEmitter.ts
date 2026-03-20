import type { InterviewEvent } from '../../L0-pure/types/index.js'

export type InterviewListener = (event: InterviewEvent) => void

/**
 * Singleton that writes structured JSONL interview events to stderr
 * and dispatches to programmatic listeners.
 *
 * Enabled via `vidpipe ideate start --progress` for stderr JSONL output.
 * SDK consumers register listeners via `addListener()` for in-process callbacks.
 *
 * When disabled AND no listeners are registered, all `emit()` calls are no-ops.
 *
 * ### Why stderr?
 * stdout carries human-readable Winston logs. stderr is the machine-readable
 * channel, following Unix conventions. Integrating tools (like VidRecord)
 * read stderr line-by-line and parse each JSON object.
 */
class InterviewEmitter {
  private enabled = false
  private listeners: Set<InterviewListener> = new Set()

  /** Turn on interview event output to stderr. */
  enable(): void {
    this.enabled = true
  }

  /** Turn off interview event output. */
  disable(): void {
    this.enabled = false
  }

  /** Whether the emitter is currently active (stderr or listeners). */
  isEnabled(): boolean {
    return this.enabled || this.listeners.size > 0
  }

  /** Register a programmatic listener for interview events. */
  addListener(fn: InterviewListener): void {
    this.listeners.add(fn)
  }

  /** Remove a previously registered listener. */
  removeListener(fn: InterviewListener): void {
    this.listeners.delete(fn)
  }

  /**
   * Write an interview event as a single JSON line to stderr (if enabled)
   * and dispatch to all registered listeners.
   * No-op when neither stderr output nor listeners are active.
   */
  emit(event: InterviewEvent): void {
    if (!this.enabled && this.listeners.size === 0) return
    if (this.enabled) {
      process.stderr.write(JSON.stringify(event) + '\n')
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

/** Singleton interview emitter — enable via `interviewEmitter.enable()`. */
export const interviewEmitter = new InterviewEmitter()
