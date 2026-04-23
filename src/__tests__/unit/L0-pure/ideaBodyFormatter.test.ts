import { describe, expect, test } from 'vitest'
import { Platform, type IdeaPublishRecord } from '../../../L0-pure/types/index.js'
import {
  extractLabelsFromIdea,
  formatIdeaBody,
  formatPublishRecordComment,
  formatVideoLinkComment,
  parseIdeaBody,
  parseIdeaComment,
  parseLabelsToIdea,
} from '../../../L0-pure/ideaFormatting/ideaBodyFormatter.js'

describe('ideaBodyFormatter', () => {
  describe('REQ-001: formatIdeaBody serializes structured idea markdown and omits blank trend context', () => {
    test('ideaBodyFormatter.REQ-001 - issue bodies include normalized sections in the expected order', () => {
      const body = formatIdeaBody({
        hook: '  GitHub just became a multi-agent battleground — here\'s how to play it  ',
        audience: ' Teams and enterprise developers ',
        keyTakeaway: ' Running multiple agents surfaces different tradeoffs ',
        talkingPoints: [' Agent HQ now supports Copilot, Claude, and Codex ', ' ', ' Demo: Comparing approaches '],
        publishBy: ' 2026-03-27 ',
        trendContext: '   ',
      })

      expect(body).toBe([
        '## Hook',
        'GitHub just became a multi-agent battleground — here\'s how to play it',
        '',
        '## Audience',
        'Teams and enterprise developers',
        '',
        '## Key Takeaway',
        'Running multiple agents surfaces different tradeoffs',
        '',
        '## Talking Points',
        '- Agent HQ now supports Copilot, Claude, and Codex',
        '- Demo: Comparing approaches',
        '',
        '## Publish By',
        '2026-03-27',
      ].join('\n'))
      expect(body).not.toContain('## Trend Context')
    })
  })

  describe('REQ-002: parseIdeaBody restores sections, bullet lists, and missing-section defaults', () => {
    test('ideaBodyFormatter.REQ-002 ideaBodyFormatter.REQ-003 - parsing extracts trimmed values and talking-point bullets', () => {
      const parsed = parseIdeaBody([
        '## Hook',
        '  GitHub just became a multi-agent battleground — here\'s how to play it  ',
        '',
        '## Audience',
        ' Teams and enterprise developers ',
        '',
        '## Key Takeaway',
        ' Running multiple agents surfaces different tradeoffs ',
        '',
        '## Talking Points',
        '- Agent HQ now supports Copilot, Claude, and Codex',
        'not a bullet',
        '- Demo: Comparing approaches',
        '',
        '## Publish By',
        ' 2026-03-27 ',
        '',
        '## Trend Context',
        ' GitHub announced Claude and Codex integration on Feb 4, 2026 ',
      ].join('\n'))

      expect(parsed).toEqual({
        hook: 'GitHub just became a multi-agent battleground — here\'s how to play it',
        audience: 'Teams and enterprise developers',
        keyTakeaway: 'Running multiple agents surfaces different tradeoffs',
        talkingPoints: [
          'Agent HQ now supports Copilot, Claude, and Codex',
          'Demo: Comparing approaches',
        ],
        publishBy: '2026-03-27',
        trendContext: 'GitHub announced Claude and Codex integration on Feb 4, 2026',
      })
    })

    test('ideaBodyFormatter.REQ-002 - missing sections fall back to empty strings and arrays', () => {
      expect(parseIdeaBody('## Hook\n\nIdea only')).toEqual({
        hook: 'Idea only',
        audience: '',
        keyTakeaway: '',
        talkingPoints: [],
        publishBy: '',
      })
    })
  })

  describe('REQ-004 and REQ-005: extractLabelsFromIdea derives labels and priority tiers', () => {
    test('ideaBodyFormatter.REQ-004 ideaBodyFormatter.REQ-005 - labels include priority tiers only when publishBy and now are provided', () => {
      const baseIdea = {
        status: 'ready' as const,
        platforms: [Platform.YouTube, Platform.TikTok],
        tags: ['topic:agents', 'series:copilot', 'topic:agents'],
      }

      expect(extractLabelsFromIdea(baseIdea)).toEqual([
        'status:ready',
        'platform:youtube',
        'platform:tiktok',
        'topic:agents',
        'series:copilot',
      ])

      expect(extractLabelsFromIdea(baseIdea, '2026-03-07', '2026-03-01')).toContain('priority:hot-trend')
      expect(extractLabelsFromIdea(baseIdea, '2026-03-14', '2026-03-01')).toContain('priority:timely')
      expect(extractLabelsFromIdea(baseIdea, '2026-04-01', '2026-03-01')).toContain('priority:evergreen')
      expect(extractLabelsFromIdea(baseIdea, 'not-a-date', '2026-03-01')).not.toContain('priority:timely')
    })
  })

  describe('REQ-006: parseLabelsToIdea restores stored labels while discarding derived priority labels', () => {
    test('ideaBodyFormatter.REQ-006 - status and platforms are extracted while other labels stay tags', () => {
      expect(parseLabelsToIdea([
        'status:recorded',
        'platform:youtube',
        'platform:tiktok',
        'priority:hot-trend',
        'topic:agents',
        'workflow',
        'platform:unknown',
      ])).toEqual({
        status: 'recorded',
        platforms: [Platform.YouTube, Platform.TikTok],
        tags: ['topic:agents', 'workflow'],
      })
    })
  })

  describe('REQ-007: formatPublishRecordComment emits a readable heading and parseable publish-record payload', () => {
    test('ideaBodyFormatter.REQ-007 - publish record comments round-trip through parseIdeaComment', () => {
      const record: IdeaPublishRecord = {
        clipType: 'medium',
        platform: Platform.LinkedIn,
        queueItemId: 'bandicam-2026-03-13-medium-1-linkedin',
        latePostId: '65a1b2c3d4e5f6g7h8i9j0',
        lateUrl: 'https://app.late.co/posts/65a1b2c3d4e5f6g7h8i9j0',
        publishedAt: '2026-03-14T03:26:40Z',
      }

      const comment = formatPublishRecordComment(record)

      expect(comment).toContain('## ✅ Published — LinkedIn (Medium Clip)')
      expect(comment).toContain('```json')
      expect(parseIdeaComment(comment)).toEqual({ type: 'publish-record', record })
    })
  })

  describe('REQ-008: formatVideoLinkComment emits a parseable linked-recording payload', () => {
    test('ideaBodyFormatter.REQ-008 - video link comments round-trip through parseIdeaComment', () => {
      const comment = formatVideoLinkComment('bandicam-2026-03-13-13-52-34-460', '2026-03-14T03:26:40Z')

      expect(comment).toContain('## 📹 Linked Recording')
      expect(parseIdeaComment(comment)).toEqual({
        type: 'video-link',
        videoSlug: 'bandicam-2026-03-13-13-52-34-460',
        linkedAt: '2026-03-14T03:26:40Z',
      })
    })
  })

  describe('REQ-009: parseIdeaComment ignores malformed or unsupported structured comments', () => {
    test('ideaBodyFormatter.REQ-009 - invalid JSON and unsupported payloads return null', () => {
      expect(parseIdeaComment('No JSON here')).toBeNull()
      expect(parseIdeaComment('```json\n{ invalid json }\n```')).toBeNull()
      expect(parseIdeaComment('```json\n{"type":"unknown"}\n```')).toBeNull()
      expect(parseIdeaComment('```json\n{"type":"publish-record","platform":"youtube"}\n```')).toBeNull()
    })
  })
})
