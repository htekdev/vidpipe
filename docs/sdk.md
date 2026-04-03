# VidPipe SDK

VidPipe ships as a Node.js **ESM** package with a programmatic SDK on top of the same pipeline, scheduling, ideation, and helper APIs used by the CLI.

```ts
import { createVidPipe } from 'vidpipe'
```

The SDK factory returns a `VidPipeSDK` instance:

```ts
const vidpipe = createVidPipe(config?)
```

---

## 1. Quick Start

### Install

```bash
npm install vidpipe
```

VidPipe is published as an ESM package. Your app should use ESM imports:

```json
{
  "type": "module"
}
```

### Minimal example

```ts
import { createVidPipe } from 'vidpipe'

const vidpipe = createVidPipe({
  openaiApiKey: process.env.OPENAI_API_KEY,
})

const diagnostics = await vidpipe.doctor()
if (!diagnostics.allPassed) {
  console.warn(diagnostics.checks)
}

const result = await vidpipe.processVideo('./videos/demo.mp4')
console.log(result.video.videoDir)
console.log(result.shorts.length)
console.log(result.socialPosts.length)
```

### Minimal video processing example

```ts
import { createVidPipe } from 'vidpipe'

const vidpipe = createVidPipe({
  openaiApiKey: process.env.OPENAI_API_KEY,
  outputDir: './recordings',
  brandPath: './brand.json',
  verbose: true,
})

const result = await vidpipe.processVideo('./input/recording.mp4', {
  skipGit: true,
})

for (const stage of result.stageResults) {
  console.log(stage.stage, stage.success ? 'ok' : stage.error)
}
```

---

## 2. Configuration

VidPipe resolves configuration in this order (**highest priority wins**):

1. **SDK constructor options** / CLI args
2. **Environment variables**
3. **Global config file**
4. **Hardcoded defaults**

For SDK users, the important takeaway is simple: **values you pass to `createVidPipe()` win**.

### `VidPipeConfig`

```ts
interface VidPipeConfig {
  openaiApiKey?: string
  anthropicApiKey?: string
  exaApiKey?: string
  youtubeApiKey?: string
  perplexityApiKey?: string
  lateApiKey?: string
  lateProfileId?: string
  githubToken?: string
  geminiApiKey?: string
  llmProvider?: 'copilot' | 'openai' | 'claude'
  llmModel?: string
  outputDir?: string
  watchFolder?: string
  brandPath?: string
  repoRoot?: string
  verbose?: boolean
  ideasRepo?: string
  geminiModel?: string
}
```

### Global config file locations

- **Unix/macOS:** `~/.config/vidpipe/config.json`
- **Windows:** `%APPDATA%\\vidpipe\\config.json`

VidPipe also supports a `VIDPIPE_CONFIG_DIR` override if you want to relocate the global config directory.

### Recommended configuration patterns

#### A. Constructor-only config

Use this when you want a self-contained SDK client in an app or script.

```ts
import { createVidPipe } from 'vidpipe'

const vidpipe = createVidPipe({
  openaiApiKey: process.env.OPENAI_API_KEY,
  exaApiKey: process.env.EXA_API_KEY,
  youtubeApiKey: process.env.YOUTUBE_API_KEY,
  llmProvider: 'copilot',
  outputDir: './recordings',
  brandPath: './brand.json',
})
```

#### B. Environment-driven config

```bash
OPENAI_API_KEY=sk-...
EXA_API_KEY=exa_...
YOUTUBE_API_KEY=AIza...
OUTPUT_DIR=./recordings
BRAND_PATH=./brand.json
LLM_PROVIDER=copilot
```

Then create the SDK with no arguments:

```ts
import { createVidPipe } from 'vidpipe'

const vidpipe = createVidPipe()
```

#### C. Shared machine/user config with `vidpipe configure`

The CLI can write the same global config file the SDK reads.

```bash
# Interactive wizard
vidpipe configure

# Set individual values
vidpipe configure set openai-key sk-...
vidpipe configure set llm-provider copilot
vidpipe configure set output-dir ./recordings

# Inspect values
vidpipe configure list
vidpipe configure get openai-key
vidpipe configure path

# Reset the global config file
vidpipe configure reset
```

This is useful when you want CLI usage and SDK usage to share the same credentials and defaults.

### Programmatic config access

The SDK exposes a `config` namespace for reading and mutating config at runtime.

```ts
import { createVidPipe } from 'vidpipe'

const vidpipe = createVidPipe()

console.log(vidpipe.config.path())
console.log(vidpipe.config.get('openai-key'))
console.log(vidpipe.config.getAll())
console.log(vidpipe.config.getGlobal())

vidpipe.config.set('output-dir', './recordings')
vidpipe.config.set('verbose', true)
await vidpipe.config.save()
```

Useful persisted keys include both shorthand and dot-notation forms, for example:

- `openai-key` or `credentials.openaiApiKey`
- `anthropic-key` or `credentials.anthropicApiKey`
- `exa-key` or `credentials.exaApiKey`
- `youtube-key` or `credentials.youtubeApiKey`
- `perplexity-key` or `credentials.perplexityApiKey`
- `late-key` or `credentials.lateApiKey`
- `github-token` or `credentials.githubToken`
- `gemini-key` or `credentials.geminiApiKey`
- `llm-provider`
- `llm-model`
- `output-dir`
- `watch-folder`
- `brand-path`
- `ideas-repo`
- `late-profile-id`
- `gemini-model`

Runtime-only overrides like `verbose`, `skipGit`, `skipSocial`, `repoRoot`, `ffmpegPath`, and `ffprobePath` affect the current process.

---

## 3. API Reference

## Factory

### `createVidPipe(config?: VidPipeConfig): VidPipeSDK`

Creates a configured SDK client.

```ts
import { createVidPipe } from 'vidpipe'

const vidpipe = createVidPipe({
  openaiApiKey: process.env.OPENAI_API_KEY,
  llmProvider: 'openai',
  llmModel: 'gpt-4o',
})
```

---

## Core methods

### `processVideo(videoPath, options?)`

Runs the full VidPipe pipeline for a single video.

```ts
const result = await vidpipe.processVideo('./videos/session.mp4', {
  ideas: [12, 15],
  skipGit: true,
  skipShorts: false,
  skipMediumClips: false,
  skipSocial: false,
  skipCaptions: false,
})

console.log(result.video)
console.log(result.transcript?.text)
console.log(result.captionedVideoPath)
console.log(result.shorts)
console.log(result.mediumClips)
console.log(result.stageResults)
```

`ProcessOptions` supports:

- `ideas?: number[]`
- `skipGit?: boolean`
- `skipSilenceRemoval?: boolean`
- `skipShorts?: boolean`
- `skipMediumClips?: boolean`
- `skipSocial?: boolean`
- `skipCaptions?: boolean`
- `skipVisualEnhancement?: boolean`
- `skipSocialPublish?: boolean`

### `ideate(options?)`

Generates new research-backed content ideas.

```ts
const ideas = await vidpipe.ideate({
  topics: ['GitHub Copilot', 'TypeScript', 'FFmpeg'],
  count: 5,
  brandPath: './brand.json',
})

console.log(ideas.map((idea) => ({
  issueNumber: idea.issueNumber,
  topic: idea.topic,
  status: idea.status,
})))
```

Generate a single AI-enriched idea (equivalent to `vidpipe ideate --add --topic "..."`):

```ts
const [idea] = await vidpipe.ideate({
  topics: ['AI-powered video editing'],
  count: 1,
  singleTopic: true,
})
```

---

## `ideas` namespace

### `ideas.list(filters?)`

```ts
const readyIdeas = await vidpipe.ideas.list({ status: 'ready' })
```

### `ideas.get(issueNumber)`

```ts
const idea = await vidpipe.ideas.get(42)
if (!idea) {
  console.log('Idea not found')
}
```

### `ideas.create(input)`

```ts
import { Platform } from 'vidpipe'

const created = await vidpipe.ideas.create({
  topic: '3 FFmpeg mistakes slowing down your edits',
  hook: 'Most creators are wasting minutes on every export.',
  audience: 'Developers making technical videos',
  keyTakeaway: 'Use faster defaults and automate repetitive export steps.',
  talkingPoints: [
    'Why default exports are often too slow',
    'How to trim without extra re-encodes',
    'How to standardize platform variants',
  ],
  platforms: [Platform.YouTube, Platform.X],
  tags: ['ffmpeg', 'video-editing', 'automation'],
  publishBy: '2026-03-31',
  trendContext: 'Creators are actively comparing faster editing workflows.',
})
```

### `ideas.update(issueNumber, updates)`

```ts
const updated = await vidpipe.ideas.update(42, {
  topic: '3 FFmpeg shortcuts that speed up your edit pipeline',
  publishBy: '2026-04-05',
})
```

Use the `ideas` namespace when you want CRUD-style access to the idea store. Use `ideate()` when you want AI to generate new ideas.

---

## `schedule` namespace

### `schedule.findNextSlot(platform, clipType?, options?)`

Returns the next publish slot. If a mapped Late queue exists for the platform/clipType, previews that queue first. Falls back to local scheduler calculation. Returns `null` if no slot is available.

```ts
const nextTikTokSlot = await vidpipe.schedule.findNextSlot('tiktok', 'short', {
  ideaIds: [12, 15],
  publishBy: '2026-03-31',
})
```

### `schedule.getCalendar(startDate?, endDate?)`

```ts
const calendar = await vidpipe.schedule.getCalendar(
  new Date('2026-03-01'),
  new Date('2026-03-31'),
)

for (const slot of calendar) {
  console.log(slot.platform, slot.scheduledFor, slot.postId)
}
```

### `schedule.realign(options?)`

```ts
const preview = await vidpipe.schedule.realign({
  platform: 'youtube',
  dryRun: true,
})

console.log(preview)

const applied = await vidpipe.schedule.realign({
  platform: 'youtube',
})

console.log(applied)
```

With `dryRun: true`, VidPipe calculates how many posts would move without executing the plan.

Note: Uses per-post realign plan. For queue-based reshuffle, use `vidpipe sync-queues --reshuffle` or `vidpipe realign --queue` via CLI.

### `schedule.loadConfig()`

```ts
const scheduleConfig = await vidpipe.schedule.loadConfig()
console.log(Object.keys(scheduleConfig.platforms))
```

---

## `video` namespace

### `video.extractClip(videoPath, start, end, output)`

```ts
const clipPath = await vidpipe.video.extractClip(
  './videos/demo.mp4',
  12.5,
  47.2,
  './output/demo-clip.mp4',
)
```

### `video.burnCaptions(videoPath, captionsFile, output)`

```ts
const captionedPath = await vidpipe.video.burnCaptions(
  './videos/demo.mp4',
  './captions/demo.ass',
  './output/demo-captioned.mp4',
)
```

### `video.detectSilence(videoPath, options?)`

```ts
const silentRegions = await vidpipe.video.detectSilence('./videos/demo.mp4', {
  threshold: '-30dB',
  minDuration: 0.5,
})

console.log(silentRegions)
```

### `video.generateVariants(videoPath, platforms, outputDir)`

Use the exported `Platform` enum for the clearest call sites.

```ts
import { Platform } from 'vidpipe'

const variants = await vidpipe.video.generateVariants(
  './videos/demo.mp4',
  [Platform.TikTok, Platform.YouTube, Platform.Instagram],
  './output/variants',
)
```

### `video.captureFrame(videoPath, timestamp, output)`

```ts
const framePath = await vidpipe.video.captureFrame(
  './videos/demo.mp4',
  23.4,
  './output/frame-23.4.png',
)
```

---

## `social` namespace

### `social.generatePosts(context, platforms)`

Generates simple platform-specific post drafts from a title, description, and tag list.

```ts
import { Platform } from 'vidpipe'

const posts = await vidpipe.social.generatePosts(
  {
    title: 'Automate your clip workflow',
    description: 'A practical walkthrough of extracting clips, captions, and platform variants with VidPipe.',
    tags: ['vidpipe', 'ffmpeg', 'creators'],
  },
  [Platform.X, Platform.LinkedIn, Platform.YouTube],
)

for (const post of posts) {
  console.log(post.platform, post.characterCount, post.outputPath)
}
```

These SDK-generated posts are also written to `<outputDir>/sdk-social`.

---

## `doctor()`

Runs a practical environment check for the most important prerequisites.

Checks include Node.js, FFmpeg, FFprobe, OpenAI configuration, optional Exa/Git/Late API availability, watch folder, LLM provider, model, and schedule config.

```ts
const diagnostics = await vidpipe.doctor()

for (const check of diagnostics.checks) {
  console.log(`[${check.status}] ${check.name}: ${check.message}`)
}

if (!diagnostics.allPassed) {
  throw new Error('VidPipe is not ready yet')
}
```

---

## `config` namespace

### `config.get(key)`

```ts
const outputDir = vidpipe.config.get('output-dir')
const openAiKey = vidpipe.config.get('credentials.openaiApiKey')
```

### `config.getAll()`

Returns the fully resolved runtime config after constructor options, environment variables, global config file values, and defaults have been applied.

```ts
const runtimeConfig = vidpipe.config.getAll()
console.log(runtimeConfig.OUTPUT_DIR)
console.log(runtimeConfig.OPENAI_API_KEY)
```

### `config.getGlobal()`

Returns the raw persisted global config file values only.

```ts
const globalConfig = vidpipe.config.getGlobal()
console.log(globalConfig.credentials)
console.log(globalConfig.defaults)
```

### `config.set(key, value)`

```ts
vidpipe.config.set('llm-provider', 'copilot')
vidpipe.config.set('output-dir', './recordings')
vidpipe.config.set('verbose', true)
```

### `config.save()`

```ts
await vidpipe.config.save()
```

### `config.path()`

```ts
console.log(vidpipe.config.path())
```

---

## 4. Type Exports

VidPipe exports both SDK-specific types and many domain types from the package root.

### SDK-specific exports

```ts
import type {
  VidPipeSDK,
  VidPipeConfig,
  ProcessOptions,
  IdeateOptions,
  SlotOptions,
  RealignOptions,
  DiagnosticCheck,
  DiagnosticResult,
  GeneratedClip,
} from 'vidpipe'
```

### Common domain types and enums

```ts
import {
  Platform,
  PipelineStage,
  PLATFORM_CHAR_LIMITS,
} from 'vidpipe'

import type {
  PipelineResult,
  SocialPost,
  Idea,
  CreateIdeaInput,
  IdeaFilters,
  ScheduleSlot,
  Transcript,
  VideoFile,
  VideoSummary,
  ShortClip,
  MediumClip,
  StageResult,
  CaptionStyle,
} from 'vidpipe'
```

### Full root export surface

The package root currently re-exports these type categories:

- **SDK types:** `VidPipeSDK`, `VidPipeConfig`, `ProcessOptions`, `IdeateOptions`, `SlotOptions`, `RealignOptions`, `DiagnosticCheck`, `DiagnosticResult`, `GeneratedClip`
- **Transcription:** `Word`, `Segment`, `Transcript`
- **Video:** `VideoFile`, `VideoLayout`, `WebcamRegion`, `ScreenRegion`
- **Aspect ratio / platform video variants:** `AspectRatio`, `VideoPlatform`
- **Short clips:** `ShortSegment`, `ShortClipVariant`, `ShortClip`, `HookType`, `EmotionalTrigger`, `ShortNarrativeStructure`
- **Medium clips:** `MediumSegment`, `MediumClip`, `MediumNarrativeStructure`, `MediumClipType`
- **Social:** `SocialPost`
- **Chapters / summary:** `Chapter`, `VideoSnapshot`, `VideoSummary`
- **Visual enhancement:** `OverlayRegion`, `OverlayPlacement`, `EnhancementOpportunity`, `GeneratedOverlay`, `VisualEnhancementResult`
- **Pipeline:** `StageResult`, `PipelineResult`, `SilenceRemovalResult`, `AgentResult`
- **Ideas / ideation:** `IdeaStatus`, `IdeaPublishRecord`, `Idea`, `CreateIdeaInput`, `IdeaFilters`, `IdeaCommentData`
- **Scheduling:** `ScheduleSlot`

The package root also exports:

- `Platform`
- `PipelineStage`
- `PLATFORM_CHAR_LIMITS`
- `SUPPORTED_VIDEO_EXTENSIONS`
- `toLatePlatform()`
- `fromLatePlatform()`
- `normalizePlatformString()`

---

## 5. CLI vs SDK

| Use case | CLI | SDK |
|---|---|---|
| One-off local processing | Excellent | Good |
| Integrating with your own app/server | Limited | Excellent |
| Reusing config from `vidpipe configure` | Excellent | Excellent |
| Batch automation and orchestration | Okay | Excellent |
| Custom error handling and retries | Limited | Excellent |
| Building your own UI or workflow | Limited | Excellent |
| Shell-first workflows | Excellent | Okay |
| Typed TypeScript integration | Limited | Excellent |

### When to use the CLI

Use the CLI when you want:

- a quick local workflow
- interactive configuration
- review/schedule commands from the terminal
- a simple automation step in CI or a shell script

### When to use the SDK

Use the SDK when you want:

- VidPipe inside your own Node.js app
- custom scheduling or ideation flows
- direct access to pipeline results and stage-level data
- your own logging, retries, or job orchestration
- typed integration in TypeScript

### Side-by-side example

**CLI**

```bash
vidpipe ./videos/demo.mp4 --no-git --verbose
```

**SDK**

```ts
import { createVidPipe } from 'vidpipe'

const vidpipe = createVidPipe({ verbose: true })
await vidpipe.processVideo('./videos/demo.mp4', { skipGit: true })
```
