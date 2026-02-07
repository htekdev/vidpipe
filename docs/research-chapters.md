# Research: Auto-Generating Video Chapters

> Research findings on automatically generating chapter markers for video content,
> covering formats, NLP approaches, and integration with our pipeline.

---

## 1. YouTube Chapter Format Specification

### Requirements

- Chapters are defined as **timestamps in the video description**, one per line
- Format: `TIMESTAMP TITLE` (e.g., `0:00 Introduction`)
- **First chapter must start at `0:00`**
- **Minimum of 3 chapters** required
- Minimum chapter length: **10 seconds**
- Timestamp formats accepted: `M:SS`, `MM:SS`, `H:MM:SS`
- Chapters appear as segments on the video progress bar (scrubber)

### Example Description Format

```
0:00 Introduction
0:45 Setting Up the Project
2:30 Writing the First Component
5:12 Handling State Management
8:45 Testing & Debugging
11:00 Deployment & Wrap-up
```

### YouTube Auto-Chapters

YouTube can **automatically generate chapters** using machine learning when:
- The creator has not manually added timestamps
- The video has sufficient speech/audio diversity
- Auto-chapters can be **overridden** by adding manual timestamps to the description
- Creators can opt out of auto-chapters in YouTube Studio settings

### SEO Benefits

- Chapters surface as **key moments** in Google search results (video snippets)
- Each chapter can appear as a separate search result with a direct deep-link
- Structured navigation improves watch time and viewer retention metrics

---

## 2. Chapter Detection from Transcript (NLP Approaches)

### 2.1 Topic Segmentation Overview

Topic segmentation is the task of dividing a stream of text into coherent segments where
each segment covers a distinct topic. Key approaches from recent research:

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **TextTiling** | Classic algorithm using vocabulary similarity between blocks | Fast, no model needed | Low accuracy on conversational content |
| **Semantic Similarity** | Embed sentences, detect drops in cosine similarity between adjacent windows | Good boundary detection | Needs tuning of threshold & window |
| **LLM Zero-Shot** | Prompt an LLM with the transcript, ask it to identify topic boundaries | Highest quality titles, understands context | Cost, token limits for long videos |
| **LLM + LoRA Fine-Tuning** | Fine-tune an LLM on segmentation data | Best accuracy (per Interspeech 2025) | Requires training data |
| **Transformer BIO Tagging** | Train a classifier to tag each sentence as B(eginning)/I(nside)/O(utside) | Precise boundaries | Needs labeled data |

### 2.2 LLM-Based Approach (Recommended for Our Pipeline)

Based on research from Towards Data Science and the Mux AI library, the most practical
approach for our use case combines:

1. **Transcript Pre-processing**: Clean raw transcript, group into paragraphs
2. **Paragraph Identification**: Use a fast LLM (e.g., GPT-4o-mini) to clean text and add paragraph breaks
3. **Chapter Boundary Detection**: Use an LLM to group paragraphs into chapters with titles
4. **TF-IDF Validation** (optional): Cross-check LLM boundaries against vocabulary-shift signals

### 2.3 Transition Phrase Detection

Common indicators of topic transitions in speech:

```
- "now let's talk about..."
- "moving on to..."
- "next up..."
- "switching gears..."
- "the next thing I want to show you..."
- "another important topic..."
- "let's dive into..."
- "so that's [topic], now..."
- Long pauses (>2 seconds) between segments
```

These can be used as **heuristic signals** to supplement LLM-based segmentation.

### 2.4 Optimal Chapter Length

- **Target: 2–5 minutes per chapter** for typical tutorial/presentation content
- Minimum: ~30 seconds (shorter feels fragmented)
- Maximum: ~10 minutes (longer defeats the purpose of navigation)
- For a 20-minute video: aim for 5–8 chapters
- For a 60-minute video: aim for 10–15 chapters
- Rule of thumb: `Math.max(3, Math.min(15, Math.round(duration_minutes / 3)))`

---

## 3. Chapter Metadata Formats

### 3.1 YouTube Description Timestamps

Plain text in the video description field:

```
0:00 Introduction
2:30 Project Setup
5:15 Core Implementation
8:45 Testing
11:20 Conclusion
```

### 3.2 FFmpeg FFMETADATA Format

Used to embed chapters into MP4/MKV container metadata:

```ini
;FFMETADATA1
title=Video Title
artist=Author Name

[CHAPTER]
TIMEBASE=1/1000
START=0
END=150000
title=Introduction

[CHAPTER]
TIMEBASE=1/1000
START=150000
END=315000
title=Project Setup

[CHAPTER]
TIMEBASE=1/1000
START=315000
END=525000
title=Core Implementation
```

**Key details:**
- Header: `;FFMETADATA1` (required)
- `TIMEBASE=1/1000` means START/END are in milliseconds
- `TIMEBASE=1/1` means START/END are in seconds
- Special characters (`=`, `;`, `#`, `\`, newline) must be escaped with `\`
- Apply with: `ffmpeg -i INPUT.mp4 -i metadata.txt -map_metadata 1 -codec copy OUTPUT.mp4`
- Extract existing: `ffmpeg -i INPUT.mp4 -f ffmetadata metadata.txt`
- Remove all chapters: `ffmpeg -i INPUT.mp4 -c copy -map_chapters -1 OUTPUT.mp4`

### 3.3 WebVTT Chapters

W3C standard format, used with HTML5 `<track kind="chapters">`:

```vtt
WEBVTT

chapter-1
00:00:00.000 --> 00:02:30.000
Introduction

chapter-2
00:02:30.000 --> 00:05:15.000
Project Setup

chapter-3
00:05:15.000 --> 00:08:45.000
Core Implementation

chapter-4
00:08:45.000 --> 00:11:20.000
Testing

chapter-5
00:11:20.000 --> 00:14:00.000
Conclusion
```

**Key details:**
- MIME type: `text/vtt`, extension: `.vtt`
- Cue identifiers (e.g., `chapter-1`) are optional but recommended
- Timestamps: `HH:MM:SS.mmm --> HH:MM:SS.mmm`
- Used in HTML: `<track kind="chapters" src="chapters.vtt" srclang="en">`
- Chapters tracks are separate from subtitle/caption tracks

### 3.4 MP4 Chapter Metadata (QuickTime/ISO BMFF)

- MP4 natively supports chapter tracks via **QuickTime text track** (`chpl` atom)
- Can be set via FFmpeg's FFMETADATA (see 3.2) or via `mp4box`:
  ```
  mp4box -chap chapters.txt output.mp4
  ```
- Most video players (VLC, MPC-HC, mpv) read chapter metadata and allow navigation

### 3.5 JSON Chapter Format (Programmatic Use)

Our internal format for the pipeline — designed for maximum flexibility:

```json
{
  "chapters": [
    {
      "startTime": 0,
      "endTime": 150,
      "title": "Introduction",
      "summary": "Overview of what will be covered in this video.",
      "keywords": ["intro", "overview", "agenda"]
    },
    {
      "startTime": 150,
      "endTime": 315,
      "title": "Project Setup",
      "summary": "Setting up the development environment and dependencies.",
      "keywords": ["setup", "install", "npm", "configuration"]
    }
  ],
  "videoId": "recording-slug",
  "totalDuration": 840,
  "generatedAt": "2025-01-15T10:30:00Z"
}
```

---

## 4. Implementation Approach: ChapterAgent

### 4.1 Agent Architecture

Following our existing `BaseAgent` → `SummaryAgent` pattern:

```
BaseAgent (abstract)
├── SummaryAgent      ← existing
├── ShortsAgent       ← existing
├── BlogAgent         ← existing
├── SocialMediaAgent  ← existing
└── ChapterAgent      ← NEW
```

### 4.2 ChapterAgent Design

```typescript
// src/agents/ChapterAgent.ts

interface ChapterResult {
  startTime: number;
  endTime: number;
  title: string;
  summary: string;
  keywords: string[];
}

interface WriteChaptersArgs {
  chapters: ChapterResult[];
}

class ChapterAgent extends BaseAgent {
  constructor(videoFile: VideoFile, outputDir: string) {
    super('ChapterAgent', buildChapterSystemPrompt())
    // ...
  }

  protected getTools(): Tool<unknown>[] {
    return [
      {
        name: 'write_chapters',
        description: 'Write the identified chapters to disk in all formats.',
        parameters: {
          type: 'object',
          properties: {
            chapters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  startTime: { type: 'number' },
                  endTime: { type: 'number' },
                  title: { type: 'string' },
                  summary: { type: 'string' },
                  keywords: { type: 'array', items: { type: 'string' } },
                },
                required: ['startTime', 'endTime', 'title', 'summary'],
              },
            },
          },
          required: ['chapters'],
        },
      },
    ]
  }
}
```

### 4.3 System Prompt Design

```text
You are a Video Chapter Agent. Your job is to analyze a video transcript and identify
logical chapter boundaries that help viewers navigate the content.

**Rules:**
1. Read the transcript carefully, paying attention to topic shifts.
2. Identify 3-15 chapter boundaries depending on video length.
3. The first chapter MUST start at timestamp 0.
4. Each chapter should be 1-5 minutes long (target ~3 minutes for tutorials).
5. Chapter titles must be concise (3-8 words), descriptive, and useful for navigation.
6. Each chapter needs a 1-2 sentence summary of what's covered.
7. Include 2-5 keywords per chapter for search/indexing.

**How to identify chapter boundaries:**
- Look for explicit topic transitions ("now let's talk about...", "moving on to...")
- Detect shifts in subject matter (new feature, new concept, new demo)
- Note structural shifts (intro → content → demo → Q&A → conclusion)
- Use natural pauses or section breaks in the speaker's delivery
- Consider when the speaker starts a new screen share, demo, or slide

**Output format:**
Call the "write_chapters" tool with an array of chapter objects.
Each chapter: { startTime (seconds), endTime (seconds), title, summary, keywords[] }

**Title style:**
- Use title case: "Setting Up the Database"
- Be specific: "Configuring PostgreSQL" not "Database Stuff"
- Include the action when relevant: "Building the API Routes"
- Keep under 50 characters
```

### 4.4 Output File Generation

The `write_chapters` tool handler should generate **all formats** from the JSON source:

```typescript
async function handleWriteChapters(chapters: ChapterResult[], outputDir: string) {
  // 1. JSON (canonical source)
  await writeJSON(chapters, path.join(outputDir, 'chapters.json'))

  // 2. YouTube description timestamps
  await writeYouTubeTimestamps(chapters, path.join(outputDir, 'chapters-youtube.txt'))

  // 3. FFmpeg metadata
  await writeFFMetadata(chapters, path.join(outputDir, 'chapters.ffmetadata'))

  // 4. WebVTT chapters
  await writeWebVTT(chapters, path.join(outputDir, 'chapters.vtt'))
}
```

### 4.5 Format Conversion Helpers

```typescript
// YouTube timestamps
function toYouTubeTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function writeYouTubeTimestamps(chapters: ChapterResult[]): string {
  return chapters
    .map(ch => `${toYouTubeTimestamp(ch.startTime)} ${ch.title}`)
    .join('\n')
}

// FFmpeg metadata
function writeFFMetadata(chapters: ChapterResult[]): string {
  let meta = ';FFMETADATA1\n\n'
  for (const ch of chapters) {
    meta += `[CHAPTER]\nTIMEBASE=1/1000\n`
    meta += `START=${Math.round(ch.startTime * 1000)}\n`
    meta += `END=${Math.round(ch.endTime * 1000)}\n`
    meta += `title=${ch.title.replace(/[=;#\\]/g, '\\$&')}\n\n`
  }
  return meta
}

// WebVTT
function writeWebVTT(chapters: ChapterResult[]): string {
  let vtt = 'WEBVTT\n\n'
  chapters.forEach((ch, i) => {
    vtt += `chapter-${i + 1}\n`
    vtt += `${formatVTTTime(ch.startTime)} --> ${formatVTTTime(ch.endTime)}\n`
    vtt += `${ch.title}\n\n`
  })
  return vtt
}
```

### 4.6 Embedding Chapters into Video Files

To bake chapters into the MP4 container (optional post-processing):

```bash
# Generate metadata file, then apply to video
ffmpeg -i input.mp4 -i chapters.ffmetadata -map_metadata 1 -codec copy output.mp4
```

This is **non-destructive** (`-codec copy`) and fast since it doesn't re-encode.

---

## 5. Integration with Existing Pipeline

### 5.1 Pipeline Placement

Chapters should run **after transcription** and can run **in parallel with captions**:

```
Ingestion → Transcription → ┬─ Silence Removal → Captions → Caption Burn
                             ├─ Chapters (NEW)
                             ├─ Shorts
                             └─ Summary (can use chapters)
```

Recommended insertion: as a new `PipelineStage.Chapters` between Transcription and Summary.

### 5.2 Pipeline Code Changes

In `src/types/index.ts` — add to `PipelineStage` enum:

```typescript
export enum PipelineStage {
  Ingestion = 'ingestion',
  Transcription = 'transcription',
  SilenceRemoval = 'silence-removal',
  Chapters = 'chapters',        // NEW
  Captions = 'captions',
  CaptionBurn = 'caption-burn',
  Summary = 'summary',
  // ...
}
```

Add chapter types:

```typescript
export interface Chapter {
  startTime: number;
  endTime: number;
  title: string;
  summary: string;
  keywords: string[];
}

export interface ChapterResult {
  chapters: Chapter[];
  youtubeTimestamps: string;
  jsonPath: string;
  vttPath: string;
  ffmetadataPath: string;
}
```

Add to `PipelineResult`:

```typescript
export interface PipelineResult {
  // ... existing fields
  chapters?: ChapterResult;  // NEW
}
```

### 5.3 Pipeline Stage in `pipeline.ts`

```typescript
// After transcription, before/alongside summary:
let chapters: ChapterResult | undefined
if (transcript) {
  chapters = await runStage<ChapterResult>(
    Stage.Chapters,
    () => generateChapters(video, transcript),
    stageResults,
  )
}
```

### 5.4 Enhancing the README with Chapters

The SummaryAgent's system prompt can be updated to include a **Chapters** section:

```markdown
## 📑 Chapters

| # | Time | Chapter | Summary |
|---|------|---------|---------|
| 1 | `0:00` | Introduction | Overview of the video content |
| 2 | `2:30` | Project Setup | Setting up dev environment |
| 3 | `5:15` | Implementation | Building the core feature |

> 📋 [YouTube Timestamps](chapters-youtube.txt) • [WebVTT](chapters.vtt) • [JSON](chapters.json)
```

Pass chapter data into `generateSummary()` so the README can include the table.

### 5.5 Chapter-Based Navigation in Documentation

Chapters enable deep-linking within the generated documentation:

- YouTube: `https://youtube.com/watch?v=VIDEO_ID&t=150` (timestamp in seconds)
- Local video: Players supporting chapter metadata allow keyboard navigation (PgUp/PgDn in VLC)
- Web: WebVTT chapters with `<track kind="chapters">` for custom web players

---

## 6. References

- [YouTube Chapters Help](https://support.google.com/youtube/answer/9884579)
- [FFmpeg Metadata Format](https://ffmpeg.org/ffmpeg-formats.html#Metadata-1)
- [WebVTT W3C Spec](https://www.w3.org/TR/webvtt1/)
- [Mux AI Chapters Library](https://www.mux.com/docs/examples/ai-generated-chapters)
- [Automate Video Chaptering with LLMs and TF-IDF](https://towardsdatascience.com/automate-video-chaptering-with-llms-and-tf-idf-f6569fd4d32b/)
- [Chapter-Llama: Efficient Chaptering in Hour-Long Videos (CVPR 2025)](https://arxiv.org/abs/2504.00072)
- [Topic Segmentation Using Generative LLMs](https://arxiv.org/html/2601.03276v1)
- [Multi-Level Transcript Segmentation (Interspeech 2025)](https://arxiv.org/html/2601.02128v1)
- [FastPix AI Chapters Guide](https://fastpix.io/blog/ai-generated-chapters-for-your-videos-a-developers-guide)
- [Moments Lab: Automatic Chapters with Open Source Models](https://research.momentslab.com/blog-posts/automatic-chapters)
