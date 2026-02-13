# Gemini Video Understanding — Editor Direction Integration

> Research notes for adding AI-powered editorial direction (cut points, transitions, pacing) to VidPipe using Google's Gemini API.

---

## Why Gemini?

| Criteria | Gemini 2.5 Pro | Gemini 2.5 Flash |
|----------|---------------|-----------------|
| **Native video input** | ✅ Up to ~45 min | ✅ Up to ~45 min |
| **Timestamped references** | ✅ | ✅ |
| **Audio + visual analysis** | ✅ | ✅ |
| **Context window** | 1M tokens | 1M tokens |
| **Reasoning quality** | Best | Good (faster) |

Gemini is the only production-ready API that accepts raw video files and returns timestamped editorial direction — no frame extraction required.

---

## Pricing (per 1M tokens)

| Model | Input | Output | Cached Input |
|-------|-------|--------|-------------|
| **Gemini 2.5 Pro** | $1.25 | $10.00 | $0.125 |
| **Gemini 2.5 Flash** | $0.15 | $0.60 | $0.0375 |

### Video Token Cost

- Video is processed at **~263 tokens/second** of footage
- 1 min ≈ ~15,800 tokens
- 10 min ≈ ~158,000 tokens
- 45 min ≈ ~710,000 tokens

### Estimated Cost Per Video (input only)

| Video Length | Flash | Pro |
|-------------|-------|-----|
| 1 min | ~$0.003 | ~$0.02 |
| 10 min | ~$0.03 | ~$0.20 |
| 45 min | ~$0.12 | ~$0.90 |

Free tier available at [aistudio.google.com](https://aistudio.google.com) for testing.

---

## SDK Setup

### Install

```bash
npm install @google/genai
```

### Environment

```env
# Add to .env
GEMINI_API_KEY=your-api-key-here
```

Get an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

Requires **Node.js 20+** (already a VidPipe requirement).

---

## Node.js Code — Video Editorial Direction

```typescript
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Upload a video and get timestamped editorial direction from Gemini.
 */
export async function getEditorialDirection(videoPath: string) {
  // 1. Upload the video file
  const file = await ai.files.upload({
    file: videoPath,
    config: { mimeType: "video/mp4" },
  });

  // 2. Request editorial analysis
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash", // or "gemini-2.5-pro" for higher quality
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      EDITORIAL_PROMPT,
    ]),
  });

  return response.text;
}

const EDITORIAL_PROMPT = `You are a professional video editor. Analyze this video and provide detailed editorial direction:

1. **Cut Points** — List every timestamp where a cut or transition should occur.
2. **Transition Type** — For each cut point, recommend a transition:
   - Hard cut, crossfade, dissolve, J-cut, L-cut, whip pan, match cut, jump cut, fade to black
3. **Pacing Analysis** — Flag sections that are too slow, too fast, or have dead air.
4. **B-Roll Suggestions** — Identify moments where b-roll, graphics, or text overlays would improve engagement.
5. **Hook & Retention** — Rate the first 3 seconds and suggest improvements for viewer retention.
6. **Music/Sound Cues** — Suggest where background music should swell, drop, or change mood.
7. **Overall Structure** — Recommend an intro/body/outro structure with timestamps.

Format your response as a structured JSON object with the following schema:

{
  "cutPoints": [
    {
      "timestamp": "MM:SS",
      "transitionType": "hard cut | crossfade | ...",
      "reason": "why this cut improves the edit"
    }
  ],
  "pacingNotes": [
    {
      "startTime": "MM:SS",
      "endTime": "MM:SS",
      "issue": "too slow | too fast | dead air",
      "suggestion": "what to do"
    }
  ],
  "bRollSuggestions": [
    {
      "timestamp": "MM:SS",
      "suggestion": "what to show"
    }
  ],
  "hookAnalysis": {
    "rating": 1-10,
    "suggestion": "how to improve the opening"
  },
  "musicCues": [
    {
      "timestamp": "MM:SS",
      "action": "swell | drop | change mood",
      "mood": "energetic | calm | dramatic | ..."
    }
  ],
  "structure": {
    "intro": { "start": "MM:SS", "end": "MM:SS" },
    "body": [{ "start": "MM:SS", "end": "MM:SS", "topic": "..." }],
    "outro": { "start": "MM:SS", "end": "MM:SS" }
  }
}`;
```

---

## Integration with VidPipe Pipeline

This could slot into the existing pipeline as a new early-stage agent:

```
Ingest → Transcribe → ✨ Editorial Direction (Gemini) → Silence Removal → ...
```

### Potential `EditorialDirectionAgent`

```typescript
// src/agents/editorial-direction-agent.ts
import { BaseAgent } from "./base-agent.js";

export class EditorialDirectionAgent extends BaseAgent {
  name = "editorial-direction";

  async run(videoPath: string, outputDir: string) {
    const direction = await getEditorialDirection(videoPath);
    const outputPath = path.join(outputDir, "editorial-direction.json");
    await fs.writeFile(outputPath, direction, "utf-8");
    return JSON.parse(direction);
  }
}
```

The JSON output can feed into downstream agents:
- **ShortsAgent** — use cut points to find natural clip boundaries
- **MediumVideoAgent** — use structure/pacing data for better segment selection
- **ChapterAgent** — use structure analysis as chapter hints

---

## Supported Video Formats

| MIME Type | Extension |
|-----------|-----------|
| `video/mp4` | `.mp4` |
| `video/webm` | `.webm` |
| `video/quicktime` | `.mov` |
| `video/mpeg` | `.mpeg` |
| `video/x-flv` | `.flv` |
| `video/wmv` | `.wmv` |
| `video/3gpp` | `.3gp` |

---

## Alternatives Considered

| Model | Verdict |
|-------|---------|
| **GPT-4o** (OpenAI) | No native video upload — requires frame extraction. More complex integration. |
| **Claude Opus 4** (Anthropic) | Processes sampled frames, not raw video. Good reasoning but extra preprocessing needed. |
| **Qwen2.5-VL** (Alibaba) | Open-source, good quality, but requires self-hosting for video input. |
| **Apollo** (Research) | Purpose-built for video understanding but not available as a production API. |
| **Cutback Selects** | Standalone app, not an API — can't integrate into VidPipe pipeline. |

---

## References

- [Gemini Video Understanding Docs](https://ai.google.dev/gemini-api/docs/video-understanding)
- [@google/genai npm package](https://www.npmjs.com/package/@google/genai)
- [SDK GitHub repo](https://github.com/googleapis/js-genai)
- [API Key](https://aistudio.google.com/apikey)
- [Vertex AI Video Understanding](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/video-understanding)
