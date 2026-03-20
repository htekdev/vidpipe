import React, { useState, useCallback, useEffect } from 'react'
import { render, Box, Text, useInput, useApp, useStdout } from 'ink'
import TextInput from 'ink-text-input'

/** Role of a chat message */
export type MessageRole = 'user' | 'agent' | 'system' | 'error'

/** A message in the chat history */
export interface ChatMessage {
  role: MessageRole
  content: string
  timestamp: Date
}

/** Configuration for AltScreenChat */
export interface AltScreenChatOptions {
  /** Title shown in the header bar */
  title: string
  /** Optional subtitle/context line */
  subtitle?: string
  /** Input prompt text (default: '> ') */
  inputPrompt?: string
  /** Maximum messages to keep in scrollback (default: 500) */
  maxScrollback?: number
}

// ── Focused Question Card ──────────────────────────────────────────────
// Instead of a scrolling chat, show ONE focused card per question:
//
//  ┌─────────────────────────────────────────┐
//  │  📝 Interview: My Idea Topic            │  header
//  │  Type /end to finish, Ctrl+C to quit    │
//  ├─────────────────────────────────────────┤
//  │                                         │
//  │  Question 3 of ∞           🎯 audience  │  question #, target field
//  │                                         │
//  │  Who exactly is the target viewer?      │  THE QUESTION (big, cyan)
//  │                                         │
//  │  💭 Checking if audience is too broad   │  rationale (dim)
//  │                                         │
//  │  💡 hook: "Z Code vs Cursor" angle      │  latest insight (if any)
//  │                                         │
//  ├─────────────────────────────────────────┤
//  │  🤔 Thinking...                         │  status (when agent working)
//  ├─────────────────────────────────────────┤
//  │  > _                                    │  input
//  └─────────────────────────────────────────┘

interface QuestionCard {
  question: string
  rationale: string
  targetField: string
  questionNumber: number
}

interface HeaderProps {
  title: string
  subtitle: string
}

function Header({ title, subtitle }: HeaderProps): React.ReactElement {
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80

  return (
    <Box flexDirection="column" width={cols}>
      <Box>
        <Text backgroundColor="blue" color="white" bold>
          {`  📝 ${title}`.padEnd(cols)}
        </Text>
      </Box>
      <Box>
        <Text backgroundColor="blue" color="white" dimColor>
          {`  ${subtitle}`.padEnd(cols)}
        </Text>
      </Box>
      <Text dimColor>{'─'.repeat(cols)}</Text>
    </Box>
  )
}

const FIELD_EMOJI: Record<string, string> = {
  topic: '📌 topic',
  hook: '🪝 hook',
  audience: '🎯 audience',
  keyTakeaway: '💎 takeaway',
  talkingPoints: '📋 talking points',
  platforms: '📱 platforms',
  tags: '🏷️ tags',
  publishBy: '📅 deadline',
  trendContext: '🔥 trend',
}

interface QuestionCardViewProps {
  card: QuestionCard | null
  latestInsight: string | null
  statusText: string
}

function QuestionCardView({ card, latestInsight, statusText }: QuestionCardViewProps): React.ReactElement {
  if (!card) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text dimColor>{statusText || 'Preparing first question...'}</Text>
      </Box>
    )
  }

  const fieldLabel = FIELD_EMOJI[card.targetField] ?? `📎 ${card.targetField}`

  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2}>
      <Text> </Text>

      {/* Question number + target field */}
      <Box justifyContent="space-between">
        <Text dimColor>Question {card.questionNumber}</Text>
        <Text dimColor>{fieldLabel}</Text>
      </Box>

      <Text> </Text>

      {/* THE QUESTION — prominent */}
      <Text color="cyan" bold wrap="wrap">
        {card.question}
      </Text>

      <Text> </Text>

      {/* Rationale — why this question */}
      <Box>
        <Text dimColor>💭 </Text>
        <Text dimColor wrap="wrap">{card.rationale}</Text>
      </Box>

      {/* Latest insight if any */}
      {latestInsight && (
        <>
          <Text> </Text>
          <Box>
            <Text color="yellow">💡 </Text>
            <Text color="yellow" wrap="wrap">{latestInsight}</Text>
          </Box>
        </>
      )}

      <Text> </Text>

      {/* Status when agent is thinking */}
      {statusText && (
        <Box>
          <Text dimColor>{statusText}</Text>
        </Box>
      )}
    </Box>
  )
}

interface InputLineProps {
  prompt: string
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  active: boolean
}

function InputLine({ prompt, value, onChange, onSubmit, active }: InputLineProps): React.ReactElement {
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80

  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(cols)}</Text>
      <Box>
        <Text dimColor>{prompt}</Text>
        {active ? (
          <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
        ) : (
          <Text dimColor> waiting...</Text>
        )}
      </Box>
    </Box>
  )
}

// ── Main App Component ─────────────────────────────────────────────────

interface ChatAppProps {
  controller: AltScreenChat
}

function ChatApp({ controller }: ChatAppProps): React.ReactElement {
  const { exit } = useApp()
  const [card, setCard] = useState<QuestionCard | null>(null)
  const [latestInsight, setLatestInsight] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [inputActive, setInputActive] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    controller._wire({
      setCard,
      setLatestInsight,
      setStatusText,
      setInputActive,
      exit,
      forceRender: () => setTick(t => t + 1),
    })
    return () => controller._unwire()
  }, [controller, exit])

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit()
      process.exit(0)
    }
  })

  const handleSubmit = useCallback((value: string) => {
    setInputValue('')
    setInputActive(false)
    const resolve = controller._pendingResolve
    controller._pendingResolve = null
    if (resolve) resolve(value.trim())
  }, [controller])

  return (
    <Box flexDirection="column" height="100%">
      <Header
        title={controller.title}
        subtitle={controller.subtitle}
      />
      <QuestionCardView
        card={card}
        latestInsight={latestInsight}
        statusText={statusText}
      />
      <InputLine
        prompt={controller.inputPrompt}
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        active={inputActive}
      />
    </Box>
  )
}

// ── Controller Class (public API) ──────────────────────────────────────

interface ReactBridge {
  setCard: React.Dispatch<React.SetStateAction<QuestionCard | null>>
  setLatestInsight: React.Dispatch<React.SetStateAction<string | null>>
  setStatusText: React.Dispatch<React.SetStateAction<string>>
  setInputActive: React.Dispatch<React.SetStateAction<boolean>>
  exit: () => void
  forceRender: () => void
}

/**
 * Alt-screen terminal chat UI powered by Ink (React for CLI).
 *
 * For interview mode, shows a focused question card instead of a scrolling chat.
 * Each screen displays: question number, target field, the question, rationale,
 * and the latest insight — one thing at a time.
 */
export class AltScreenChat {
  readonly title: string
  readonly subtitle: string
  readonly inputPrompt: string
  private readonly maxScrollback: number

  private messages: ChatMessage[] = []
  private bridge: ReactBridge | null = null
  private inkInstance: ReturnType<typeof render> | null = null

  /** @internal */
  _pendingResolve: ((value: string) => void) | null = null

  constructor(options: AltScreenChatOptions) {
    this.title = options.title
    this.subtitle = options.subtitle ?? 'Type /end to finish, Ctrl+C to quit'
    this.inputPrompt = options.inputPrompt ?? '> '
    this.maxScrollback = options.maxScrollback ?? 500
  }

  /** @internal */
  _wire(bridge: ReactBridge): void {
    this.bridge = bridge
  }

  /** @internal */
  _unwire(): void {
    this.bridge = null
  }

  /** Enter fullscreen and render the Ink UI. */
  enter(): void {
    this.inkInstance = render(
      <ChatApp controller={this} />,
      { exitOnCtrlC: false },
    )
  }

  /** Leave fullscreen and clean up Ink. */
  leave(): void {
    if (this.inkInstance) {
      this.inkInstance.unmount()
      this.inkInstance = null
    }
  }

  /** Clean up everything. */
  destroy(): void {
    this.leave()
    this.messages = []
    this.bridge = null
    this._pendingResolve = null
  }

  /**
   * Show a focused question card. Replaces the entire display content
   * with this one question — no scrolling chat history.
   */
  showQuestion(question: string, rationale: string, targetField: string, questionNumber: number): void {
    this.bridge?.setCard({ question, rationale, targetField, questionNumber })
  }

  /**
   * Show a discovered insight on the current card.
   */
  showInsight(text: string): void {
    this.bridge?.setLatestInsight(text)
  }

  /**
   * Add a message to the internal log (for transcript purposes).
   * Does NOT affect the card display — use showQuestion for that.
   */
  addMessage(role: MessageRole, content: string): void {
    const msg: ChatMessage = { role, content, timestamp: new Date() }
    this.messages.push(msg)
    if (this.messages.length > this.maxScrollback) {
      this.messages = this.messages.slice(-this.maxScrollback)
    }
  }

  /** Set the status bar text. */
  setStatus(text: string): void {
    this.bridge?.setStatusText(text)
  }

  /** Clear the status bar. */
  clearStatus(): void {
    this.bridge?.setStatusText('')
  }

  /** Prompt for user input. Returns their trimmed text. */
  promptInput(_prompt?: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this._pendingResolve = resolve
      this.bridge?.setInputActive(true)
      this.bridge?.forceRender()
    })
  }
}
