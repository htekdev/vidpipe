# OpenAI Provider Prompt Tuning Guide

> Bringing GPT-4o quality up to the Copilot baseline for vidpipe

## Overview

### Context

Regression testing of OpenAI Direct (GPT-4o) against the GitHub Copilot baseline revealed a **67.6% cost reduction** ($0.66 vs $2.04 per run) but introduced **critical quality regressions** across 5 of 10 evaluation categories. Four categories scored Critical severity; two scored Major.

### Goal

This document prescribes **specific, copy-pasteable prompt changes** for each affected agent to bring OpenAI output quality to Copilot baseline parity — without reverting to Copilot pricing. The target is to maintain **~50–55% cost savings** while eliminating all Critical and Major regressions.

### Methodology

For each agent that regressed:
1. Extract the **exact failure patterns** from side-by-side regression testing
2. Identify what the **current prompt fails to enforce**
3. Prescribe **exact text additions** to the system prompt
4. Define **measurable validation criteria** for pass/fail

---

## Regression Scorecard

| # | Category | Verdict | Key Finding | Severity |
|---|----------|---------|-------------|----------|
| 1 | **Cost** | ✅ IMPROVED | 67.6% cheaper ($0.66 vs $2.04) | None |
| 2 | **Transcript** | ✅ PASS | 91.3% Jaccard similarity | Minor |
| 3 | **Captions** | ✅ PASS | Differences from upstream silence removal only | Minor |
| 4 | **Chapters** | ❌ FAIL | 5 vs 8 chapters; generic titles; FFMetadata START > END | Major |
| 5 | **Shorts** | ❌ FAIL | 6.24s clip (below 15s min); 12 missing captioned MP4s; weak metadata | Critical |
| 6 | **Medium Clips** | ❌ FAIL | All 3 clips below 60s minimum (13–38s); 80% less coverage | Critical |
| 7 | **Social Posts** | ❌ FAIL | 77–88% shorter; hallucinated links; no CTAs; no voice differentiation | Critical |
| 8 | **README** | ❌ FAIL | 48% fewer words; third-person tone; 1 quote vs 4 | Major |
| 9 | **Thumbnails** | ✅ PASS | Same count, format, naming | None |
| 10 | **Structural** | ❌ FAIL | 25 fewer files; all captioned videos missing | Critical |

**Summary: 4 PASS, 1 IMPROVED, 5 FAIL (4 Critical, 2 Major)**

### Cost Breakdown by Agent

| Agent | Copilot | OpenAI | Savings |
|-------|--------:|-------:|--------:|
| SocialMediaAgent | $1.32 | $0.25 | $1.07 (81%) |
| ChapterAgent | $0.12 | $0.03 | $0.09 (77%) |
| BlogAgent | $0.12 | $0.04 | $0.08 (71%) |
| SilenceRemovalAgent | $0.12 | $0.05 | $0.07 (62%) |
| SummaryAgent | $0.12 | $0.07 | $0.05 (42%) |
| ShortsAgent | $0.12 | $0.12 | ~$0.00 |
| MediumVideoAgent | $0.12 | $0.12 | ~$0.00 |
| **Total** | **$2.04** | **$0.66** | **$1.38** |

---

## Per-Agent Tuning Plan

### ChapterAgent

**Priority:** P2 · Major severity

#### Current Prompt (Key Constraints)

```
Rules:
- First chapter MUST start at 0:00
- Minimum 3 chapters, maximum 10
- Each chapter should be 2-5 minutes long
- Chapter titles should be concise (3-7 words)
- Look for topic transitions, "moving on", "next", "now let's", etc.
- Include a brief 1-sentence description per chapter
```

#### What Went Wrong

1. **Too few chapters:** 5 chapters for an 18-minute video vs Copilot's 8. Three distinct topics were collapsed into broad buckets (e.g., Copilot chapters 3–6 — "Running Tests → Discovering Output → Amazed → Reviewing Content" — became one "Automated Content Creation" spanning 6 minutes).
2. **Generic titles:** "Introduction and Initial Setup", "Reflecting on the Experience" vs Copilot's "Parallel Agent Dispatch Feature", "Amazed by 20-Minute Creation".
3. **Out-of-bounds timestamp:** Last chapter at 18:20 (1100s) exceeds video duration of 18:00 (1080s).
4. **FFMetadata corruption:** `START=1,100,000 > END=1,080,800` — negative-duration last chapter, invalid for FFmpeg.
5. **Shallow descriptions:** "The speaker begins by discussing the video setup and checks if it picks up" vs "Excitement as the pipeline successfully creates transcripts, blog posts, and video shorts automatically."

#### Proposed Prompt Changes

Add the following block **after** the existing `Rules:` section, before `**Output format:**`:

```diff
+ **Chapter density requirements:**
+ - For videos ≥ 5 minutes: minimum 4 chapters
+ - For videos ≥ 10 minutes: minimum 6 chapters
+ - For videos ≥ 15 minutes: minimum 7 chapters
+ - For videos ≥ 25 minutes: minimum 9 chapters
+ - If you identify fewer chapters than the minimum, split the longest chapter into sub-topics
+
+ **Title quality rules:**
+ - Chapter titles MUST name the specific feature, tool, concept, or event discussed — NEVER use generic labels
+ - BAD titles: "Introduction", "Testing the Pipeline", "Reflecting on the Experience", "Automated Content Creation"
+ - GOOD titles: "Parallel Agent Dispatch Feature", "Amazed by 20-Minute Creation", "Reviewing Generated Content", "Explaining GitHub Copilot Fleet Mode"
+ - When the speaker discusses a specific technology, name it in the title
+ - When the speaker has a strong reaction, capture the emotion: "Amazed by...", "Discovering...", "Frustrated with..."
+
+ **Timestamp validation — CRITICAL:**
+ - All chapter timestamps MUST be less than or equal to the video duration provided in the user message
+ - The last chapter's content extends to the end of the video — do NOT set its timestamp beyond the video duration
+ - Double-check: if the video is N seconds long, no chapter timestamp may exceed N
+
+ **Description requirements:**
+ - Each chapter description MUST be 2+ sentences
+ - Describe what SPECIFICALLY happens (tools used, problems encountered, reactions)
+ - BAD: "The speaker begins by discussing the video setup."
+ - GOOD: "Excitement as the pipeline successfully creates transcripts, blog posts, and video shorts automatically. The speaker scrolls through the generated output in disbelief."
```

#### Validation Criteria

| Metric | Threshold | How to Verify |
|--------|-----------|---------------|
| Chapter count (18-min video) | ≥ 7 | Count entries in `chapters.json` |
| Generic title ratio | 0/N (no generic titles) | Manual review: reject "Introduction", "Conclusion", "Reflecting on..." |
| Out-of-bounds timestamps | 0 | `max(timestamps) <= video_duration_seconds` |
| FFMetadata validity | All START < END | Parse `chapters.ffmetadata`, assert `START < END` for every chapter |
| Description sentence count | ≥ 2 per chapter | Split on `.` and count |

---

### ShortsAgent

**Priority:** P1 · Critical severity (due to missing captioned variants)

#### Current Prompt (Key Constraints)

```
Rules:
1. Each short must be 15–60 seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence boundaries for clean cuts.
4. Aim for 3–8 shorts per video, depending on length and richness.
5. Every short needs a catchy, descriptive title (5–10 words).
6. Tags should be lowercase, no hashes, 3–6 per short.
```

#### What Went Wrong

1. **Duration violation:** One clip was **6.24 seconds** — below the 15s platform minimum. Average clip duration was 24.2s vs Copilot's 43.8s.
2. **Generic titles:** "Excited Reaction to Video Creation", "The 20-Minute Creation Miracle", "An Unbelievable Tech Achievement" — none use first-person voice or name specific features.
3. **Thin tags:** Average 3.0 generic tags ("technology", "automation", "astonishment") vs Copilot's 5.3 platform-optimized tags ("github copilot", "fleet mode", "prompt engineering").
4. **Shallow descriptions:** Single sentences vs Copilot's multi-sentence contextual descriptions.
5. **Total coverage:** 145s vs 263s — 45% less video content captured.

#### Proposed Prompt Changes

Add after existing rule 7 (the buffer rule):

```diff
+ 8. **Duration enforcement — CRITICAL:** Every short MUST be at least 15 seconds. Clips under 15 seconds are REJECTED by TikTok, YouTube Shorts, and Instagram Reels. If a moment is compelling but under 15 seconds, EXTEND the segment to include surrounding context (the lead-in or the reaction after) to reach at least 20 seconds.
+ 9. **Target duration:** Aim for 30–60 second clips that capture a COMPLETE thought or emotional arc, not a single reaction moment. A reaction needs setup → peak → aftermath to be compelling.
+ 10. **Title style:** Use first-person voice and name specific features or quote the speaker.
+     - BAD: "Excited Reaction to Video Creation", "An Unbelievable Tech Achievement", "The Power of Parallel Dispatch"
+     - GOOD: "It Created the Shorts — Mind Blown Moment", "Built This Entire App in 20 Minutes", "Two Prompts Built My Entire Video Pipeline"
+     - Pattern: "[What happened] — [Emotional reaction]" or "[First-person claim about the result]"
+ 11. **Tag requirements:** Include at least 5 tags per clip. Tags MUST be specific and searchable platform terms — never generic category words.
+     - BAD tags: "technology", "innovation", "software", "astonishment", "automation"
+     - GOOD tags: "github copilot", "fleet mode", "prompt engineering", "ai development", "productivity", "video pipeline", "content automation"
+ 12. **Description depth:** Descriptions must be 2+ sentences explaining the specific content AND why it's compelling for viewers.
+     - BAD: "Passionate reaction to automatic video and social media content creation by GitHub Copilot."
+     - GOOD: "The exact moment of discovery when the creator realizes the automated pipeline successfully generated video shorts. Pure authentic excitement and disbelief."
```

#### Validation Criteria

| Metric | Threshold | How to Verify |
|--------|-----------|---------------|
| Minimum clip duration | ≥ 15s (every clip) | Parse `plan_shorts` tool call, assert all `end - start ≥ 15` |
| Average clip duration | ≥ 35s | Mean of all clip durations |
| Title specificity | 100% specific | Manual review: no generic titles allowed |
| First-person voice in titles | ≥ 50% | Count titles with "I", "My", or first-person framing |
| Tags per clip | ≥ 5 | Count tags array length per clip |
| Generic tag ratio | ≤ 20% | Flag tags that are single generic words |
| Description sentence count | ≥ 2 per clip | Split on `.` and count |

---

### MediumVideoAgent

**Priority:** P0 · Critical severity

#### Current Prompt (Key Constraints)

```
Rules:
1. Each clip must be 60–180 seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence and paragraph boundaries for clean entry/exit points.
4. Each clip must be self-contained...
5. Aim for 2–4 medium clips per video, depending on length and richness.
...
```

#### What Went Wrong

1. **ALL 3 clips violate the 60–180s spec:** Actual durations were 13s, 33s, and 38s. Every single clip was under the minimum.
2. **No multi-segment composition:** Copilot used a 2-segment composite clip (731.20s–843.90s + 856.70s–892.52s = 161s); OpenAI used only single contiguous segments.
3. **Total coverage collapse:** 84s vs 417s — an 80% reduction in content captured.
4. **Missing key moments:** "AI-generated documentation review" and "Pipeline success moment" were not covered at all.
5. **Only 3 clips:** Copilot produced 4.

#### Proposed Prompt Changes

Replace the existing rule 1 with a strengthened version and add new rules after rule 10:

```diff
- 1. Each clip must be 60–180 seconds total duration.
+ 1. Each clip MUST be between 60 and 180 seconds total duration. This is a HARD constraint — a clip under 60 seconds is INVALID. If a compelling topic segment is shorter than 60 seconds, you MUST either:
+    (a) Extend the segment boundaries to include the lead-in context and follow-up discussion, OR
+    (b) Combine it with other related segments into a multi-segment composite clip using the segments array.
+    NEVER submit a clip with totalDuration < 60.
```

Add after existing rule 10:

```diff
+ 11. **Multi-segment composition is encouraged.** When a single contiguous section is too short to reach 60 seconds, combine 2–3 non-contiguous segments from the same topic thread. The pipeline automatically adds crossfade transitions between segments. Example: combine "problem statement at 2:00–2:25" + "solution demo at 4:30–5:15" + "results at 6:00–6:20" into one 90-second narrative arc.
+ 12. **Duration self-check — CRITICAL:** Before submitting your plan, verify EVERY clip:
+     - Calculate: sum of (end - start) for all segments in the clip
+     - If any clip's totalDuration is under 60 seconds → EXTEND or MERGE before submitting
+     - If any clip's totalDuration exceeds 180 seconds → SPLIT into two clips
+ 13. **Coverage target:** Medium clips should collectively cover at least 5 minutes (300 seconds) of the most important video content. If your total coverage is under 300 seconds, look for additional moments to extract.
+ 14. **Prioritize these moment types (in order):**
+     1. Strong emotional reactions and revelations
+     2. Complete technical demonstrations (problem → solution → result)
+     3. Key decision points or turning moments
+     4. Educational explanations with clear takeaways
```

#### Validation Criteria

| Metric | Threshold | How to Verify |
|--------|-----------|---------------|
| Per-clip duration | 60s ≤ d ≤ 180s (every clip) | Parse `plan_medium_clips` tool call, validate `totalDuration` |
| Clip count | ≥ 3 for videos > 10min | Count clips array length |
| Total coverage | ≥ 300s | Sum all `totalDuration` values |
| Multi-segment usage | ≥ 1 composite clip | Count clips with `segments.length > 1` |
| Captioned MP4 production | N/N clips | Verify `*-captioned.mp4` exists for each clip |

> **Code-level validation required:** See [Pipeline Validation Changes](#pipeline-validation-changes) for a `totalDuration` guard that rejects invalid clips before extraction.

---

### SocialMediaAgent

**Priority:** P0 · Critical severity

#### Current Prompt (Key Constraints)

```
Platform guidelines:
1. **TikTok** – Casual, hook-driven, trending hashtags, 150 chars max, emoji-heavy.
2. **YouTube** – Descriptive, SEO-optimized title + description, relevant tags.
3. **Instagram** – Visual storytelling, emoji-rich, 30 hashtags max, engaging caption.
4. **LinkedIn** – Professional, thought-leadership, industry insights, 1-3 hashtags.
5. **X (Twitter)** – Concise, punchy, 280 chars max, 2-5 hashtags, thread-ready.

IMPORTANT – Content format:
The "content" field you provide must be the FINAL, ready-to-post text...
```

#### What Went Wrong

1. **Posts 77–88% shorter:** LinkedIn 275 chars (vs 1,518), YouTube 239 chars (vs 1,289), Instagram 292 chars (vs 1,479).
2. **Hallucinated links:** YouTube linked to Grammarly reflective essay guide; X linked to lawinsider.com dictionary; LinkedIn linked to BrowserStack automation guide — all completely irrelevant to the video content.
3. **Zero CTAs:** No call-to-action on any platform (Copilot had CTAs on 4/6).
4. **No platform voice differentiation:** Same generic tone across all 5 platforms.
5. **Hashtag formatting bug:** YAML values include `#` prefix (`"#Automation"`) instead of bare words.

#### Proposed Prompt Changes

Replace the existing `Platform guidelines:` block with an expanded version:

```diff
- Platform guidelines:
- 1. **TikTok** – Casual, hook-driven, trending hashtags, 150 chars max, emoji-heavy.
- 2. **YouTube** – Descriptive, SEO-optimized title + description, relevant tags.
- 3. **Instagram** – Visual storytelling, emoji-rich, 30 hashtags max, engaging caption.
- 4. **LinkedIn** – Professional, thought-leadership, industry insights, 1-3 hashtags.
- 5. **X (Twitter)** – Concise, punchy, 280 chars max, 2-5 hashtags, thread-ready.
+ Platform guidelines (with MINIMUM character counts and voice):
+
+ 1. **TikTok** (100–150 chars)
+    - Voice: ALL CAPS for emphasis, high emoji density (5+ emojis), rapid-fire energy
+    - Include trending hashtags like #DevTok #CodeTok #AI
+    - Hook-driven: first line must grab attention
+    - Example tone: "Built a WHOLE video pipeline in 20 mins with AI agents 🤯🔥 Transcripts, blogs, shorts - ALL automated! The future is NOW 🚀✨"
+
+ 2. **YouTube** (500+ chars)
+    - Voice: Structured SEO description with clear sections
+    - MUST include: title line, intro paragraph (2-3 sentences), bullet-pointed feature list or "In this video:" section, relevant links, 7+ hashtags
+    - Write for search: front-load keywords in the first 2 lines
+    - This is a FULL description, not a tweet — aim for 500-1500 characters
+
+ 3. **Instagram** (500+ chars)
+    - Voice: Multi-paragraph storytelling caption with personal voice
+    - Use emoji bullets (🔥, 🚀, ✨, 💡) to break up paragraphs
+    - Include a direct speaker quote from the video
+    - End with engagement CTA: "Drop a 🚀 if this blows your mind!" or "What would YOU automate? 👇"
+    - 20-30 targeted hashtags (specific to content, not generic)
+
+ 4. **LinkedIn** (800+ chars)
+    - Voice: Thought-leadership narrative with business implications
+    - Structure: provocative hook → context → insight → implications → CTA question
+    - Use → bullet points for scanability
+    - Include 1-3 relevant hashtags
+    - End with a discussion-prompting question: "What's your experience with...?"
+    - Example hook: "Let that sink in." or "This changes everything about..."
+
+ 5. **X/Twitter** (200–280 chars)
+    - Voice: Information-dense, punchy, shareable
+    - Maximize the 280-char limit — use it fully
+    - Use ✓ checkmarks or → arrows for visual structure
+    - 2-5 hashtags, specific to content
+    - Pattern: headline stat + proof points + punchline
```

Add after the existing `IMPORTANT – Content format:` block:

```diff
+ IMPORTANT – Call-to-action requirement:
+ Every platform post MUST include a platform-appropriate call-to-action (CTA).
+ - TikTok: "Follow for more!" or "Part 2 coming 👀"
+ - YouTube: "Subscribe for more AI dev content" or "Watch the full breakdown ↗️"
+ - Instagram: "Drop a 🚀 if..." or "Save this for later 🔖" or "What would YOU automate? 👇"
+ - LinkedIn: End with a discussion question: "What's your experience with [topic]?"
+ - X/Twitter: "Thread 🧵👇" or "RT if you agree" or provocative question
+
+ IMPORTANT – Link quality:
+ Only include links that are DIRECTLY relevant to the specific tools, technologies, or topics discussed in the video. If the web search returns irrelevant results (e.g., Grammarly guides, lawinsider.com, BrowserStack tutorials when the video is about AI coding), include NO links rather than irrelevant ones. A post with zero links is better than a post with hallucinated links.
+
+ IMPORTANT – Hashtag formatting:
+ Hashtag values MUST be bare words WITHOUT the # prefix. The # is added at render time.
+ - CORRECT: ["GitHubCopilot", "AI", "Automation"]
+ - WRONG: ["#GitHubCopilot", "#AI", "#Automation"]
```

#### Validation Criteria

| Platform | Min Characters | CTA Required | Max Hashtags |
|----------|---------------:|:------------:|:------------:|
| TikTok | 100 | Yes | — |
| YouTube | 500 | Yes | 15 |
| Instagram | 500 | Yes | 30 |
| LinkedIn | 800 | Yes | 3 |
| X/Twitter | 200 | Yes | 5 |

| Metric | Threshold | How to Verify |
|--------|-----------|---------------|
| Character count per platform | ≥ minimums above | Parse `create_posts` tool call, check `content.length` |
| CTA present | 5/5 platforms | Search content for question marks, "subscribe", "follow", "drop", "comment" |
| Link relevance | 100% relevant or 0 links | Manual review: every link must relate to video topic |
| Hashtag `#` prefix | 0 occurrences | Assert no hashtag string starts with `#` |
| Platform voice differentiation | 5/5 distinct | Manual review: each post should read differently |

---

### SummaryAgent

**Priority:** P2 · Major severity

#### Current Prompt (Key Constraints)

```
Your job is to analyse a video transcript and produce a beautiful, narrative-style Markdown README.

**Writing style rules**
- Write in a narrative, blog-post style — NOT a timestamp-driven timeline.
- Timestamps appear as subtle inline badges...
- The summary paragraphs should flow naturally and be enjoyable to read.
- Use the brand perspective: {brand.voice.personality}
```

#### What Went Wrong

1. **Third-person detached tone:** "The speaker marvels at the automation capabilities", "The video presents an impressive demonstration" — instead of first-person authentic voice.
2. **48% shorter:** 789 words vs 1,504 words. Missing quotes, explanations, and narrative depth.
3. **Only 1 direct quote** vs Copilot's 4 blockquotes from the speaker.
4. **Quick Reference weakness:** 7 vague entries ("Automation amazement", "Reflective conclusion") vs 10 specific entries ("Shorts Auto-Creation Discovery", "Two-Prompt Development").
5. **Estimated timestamps:** Appear rounded rather than grounded in actual transcript segment times.
6. **Out-of-bounds timestamp:** Chapter at 18:20 exceeds video duration 18:00.

#### Proposed Prompt Changes

Add after the existing `**Writing style rules**` section:

```diff
+ **Voice — CRITICAL:**
+ - Write the README as if YOU are the creator of the video, in FIRST PERSON
+ - Use "I built", "I discovered", "I'm still in shock" — NEVER "the speaker", "the video presents", "the creator demonstrates"
+ - This is YOUR story, YOUR excitement, YOUR technical journey
+ - BAD: "The speaker marvels at the automation capabilities"
+ - GOOD: "I'm still in shock — the pipeline generated everything automatically"
+
+ **Minimum content requirements:**
+ - The README must be at least 1,200 words. If your draft is shorter, add more detail to Key Moments, include additional quotes, or expand technical explanations.
+ - Include at least 3 direct quotes from the speaker, formatted as blockquotes (> "quote text"). Choose quotes that capture emotional moments and key insights.
+   - BAD: Only 1 generic quote
+   - GOOD: 4 blockquotes including reactions ("You're kidding me..."), realizations ("I've been trying to create this..."), and reflections ("If you see this video...")
+ - The Quick Reference table must have at least 9 entries with SPECIFIC, descriptive labels
+   - BAD labels: "Automation amazement", "Reflective conclusion", "Future enhancements"
+   - GOOD labels: "Shorts Auto-Creation Discovery", "Two-Prompt Development", "Self-Processing Demo"
+
+ **Timestamp accuracy — CRITICAL:**
+ - Every timestamp in the README MUST come directly from a transcript segment's start time — do NOT estimate or round
+ - No timestamp may exceed the video duration. If the video is 18:00, the latest valid timestamp is 17:59
+ - Cross-reference each `[M:SS]` badge against the transcript data provided
+
+ **Narrative arc:**
+ - Structure Key Moments as a story: anticipation → discovery → emotional reaction → technical explanation → reflection
+ - Each Key Moment must include: a timestamp badge, a narrative paragraph (3+ sentences), and an inline screenshot reference
+ - End the README with a reflective paragraph that captures what was learned or what comes next
```

#### Validation Criteria

| Metric | Threshold | How to Verify |
|--------|-----------|---------------|
| Word count | ≥ 1,200 | `wc -w README.md` |
| POV voice | First-person throughout | Search for "the speaker", "the creator", "the video" — should be 0 matches |
| Direct quotes | ≥ 3 blockquotes | Count lines starting with `>` that contain quoted speech |
| Quick Reference entries | ≥ 9 | Count rows in the Quick Reference table |
| Out-of-bounds timestamps | 0 | Parse all `[M:SS]` badges, convert to seconds, verify ≤ duration |
| Key Moments with screenshots | ≥ 5 | Count `![` image references in Key Moments section |

---

### BlogAgent

**Priority:** P2 (inherits from SocialMediaAgent regression patterns)

#### Current Prompt (Key Constraints)

```
Your task is to generate a full dev.to-style technical blog post (800-1500 words) based on a video transcript and summary.

The blog post MUST include:
1. dev.to frontmatter (title, published: false, description, tags, cover_image placeholder)
2. An engaging introduction with a hook
3. Clear sections covering the main content
4. Code snippets where the video content discusses code
5. Key Takeaways section
6. A conclusion
7. A footer referencing the original video
```

#### What Went Wrong

1. **66% shorter:** ~550 words vs ~1,600 words — well below the 800-word minimum specified in the prompt.
2. **No code examples:** Despite the video discussing TypeScript pipeline code, OpenAI included zero code snippets. Copilot included TypeScript examples.
3. **Impersonal tone:** Reads like a product brochure, not a personal dev narrative. No first-person voice.
4. **Placeholder links:** Uses `[video tutorial](#)` instead of real links.
5. **No community CTA:** Missing engagement hooks like "Drop a comment below — I'd love to hear about your experiments! 👇"

#### Proposed Prompt Changes

Add after existing item 7 in the "MUST include" list:

```diff
+ 8. A community engagement CTA — invite readers to comment, share experiences, or ask questions (e.g., "Drop a comment below — I'd love to hear about your experiments! 👇")
+
+ **Word count enforcement:**
+ - The blog MUST be at least 1,200 words (body only, excluding frontmatter). The 800-word minimum is a floor, not a target.
+ - If your draft is under 1,000 words, you need to add more depth: expand explanations, add code examples, include more personal narrative.
+
+ **Voice requirements:**
+ - Write in FIRST PERSON as the video creator: "I built", "I discovered", "here's what I learned"
+ - Use the personal developer narrative style of dev.to — conversational, opinionated, sharing real experience
+ - BAD: "The pipeline demonstrates impressive automation capabilities" (product brochure)
+ - GOOD: "I literally watched it generate blog posts, video shorts, and social media content — all from a single recording. My jaw hit the floor." (personal narrative)
+
+ **Code snippet requirement:**
+ - If the video discusses ANY code, tools, or technical implementation, include at least 2 fenced code blocks with language tags
+ - Show real examples: configuration snippets, command-line invocations, TypeScript/JavaScript code from the project
+ - If no code is explicitly shown, include example usage or setup commands
+
+ **Link quality:**
+ - Only include links from the web search results that are DIRECTLY relevant
+ - NEVER use placeholder links like `[text](#)` or `[text](link)` — either use a real URL or omit the link entirely
+ - A blog post with 0 links is better than one with fake or irrelevant links
+
+ **Section markers:**
+ - Use emoji section markers for visual appeal: ## 🚀 The Problem, ## 💡 The Solution, ## 🔑 Key Takeaways
+ - Include at least 4 major sections between introduction and conclusion
```

#### Validation Criteria

| Metric | Threshold | How to Verify |
|--------|-----------|---------------|
| Word count (body) | ≥ 1,200 words | Count words in body (exclude frontmatter) |
| Code blocks | ≥ 2 | Count fenced code blocks (` ``` `) |
| First-person voice | Yes | Search for "the speaker", "the video", "the pipeline demonstrates" — should be 0 |
| Placeholder links | 0 | Search for `](#)` or `](link)` — should be 0 |
| Community CTA | Present | Search for question mark + engagement language in conclusion |
| dev.to frontmatter | Complete | Verify `title`, `description`, `tags`, `published: false` present |

---

## Pipeline Validation Changes

These are **code-level guards** that should be added regardless of prompt tuning, as defense-in-depth against LLM non-compliance.

### 1. Medium Clip Duration Validation

**File:** `src/agents/MediumVideoAgent.ts` (in `plan_medium_clips` tool handler)

```typescript
// After receiving clips from LLM, before extraction:
for (const clip of clips) {
  const totalDuration = clip.segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  if (totalDuration < 60) {
    logger.warn(`Clip "${clip.title}" is ${totalDuration}s — below 60s minimum. Skipping.`);
    continue; // or: throw to trigger re-prompt
  }
  if (totalDuration > 180) {
    logger.warn(`Clip "${clip.title}" is ${totalDuration}s — above 180s maximum. Skipping.`);
    continue;
  }
}
```

### 2. FFMetadata START < END Validation

**File:** `src/agents/ChapterAgent.ts` (in chapter writing logic)

```typescript
// When writing chapters.ffmetadata:
for (let i = 0; i < chapters.length; i++) {
  const start = chapters[i].timestamp;
  const end = i < chapters.length - 1 ? chapters[i + 1].timestamp : videoDurationSeconds;
  if (start >= end) {
    logger.warn(`Chapter ${i} has START (${start}) >= END (${end}). Clamping to video duration.`);
    // Clamp or skip the chapter
  }
}
```

### 3. Social Post Minimum Character Counts

**File:** `src/agents/SocialMediaAgent.ts` (in `create_posts` tool handler)

```typescript
const MIN_CHARS: Record<string, number> = {
  tiktok: 100,
  youtube: 500,
  instagram: 500,
  linkedin: 800,
  x: 200,
};

for (const post of posts) {
  const min = MIN_CHARS[post.platform.toLowerCase()] ?? 0;
  if (post.content.length < min) {
    logger.warn(`${post.platform} post is ${post.content.length} chars — below ${min} minimum.`);
  }
}
```

### 4. Link Relevance Checking

**File:** `src/agents/SocialMediaAgent.ts` (in `search_links` tool handler)

```typescript
// After web search returns results, filter out obviously irrelevant domains:
const IRRELEVANT_DOMAINS = ['grammarly.com', 'lawinsider.com', 'browserstack.com', 'atlassian.com'];

function isRelevantLink(url: string, videoTopics: string[]): boolean {
  const domain = new URL(url).hostname;
  if (IRRELEVANT_DOMAINS.some(d => domain.includes(d))) return false;
  // Additional: check if page title/snippet contains any video topic keyword
  return true;
}
```

### 5. Hashtag `#` Prefix Stripping

**File:** `src/agents/SocialMediaAgent.ts` (in post-processing)

```typescript
// Before writing YAML frontmatter:
post.hashtags = post.hashtags.map(tag => tag.replace(/^#/, ''));
```

### 6. characterCount Fallback

**File:** `src/agents/SocialMediaAgent.ts` (in post metadata writer)

```typescript
// Ensure characterCount is never undefined:
const characterCount = post.content?.length ?? 0;
```

---

## Testing Protocol

### Step 1: Apply Prompt Changes

Update system prompts in the following files:
- `src/agents/ChapterAgent.ts`
- `src/agents/ShortsAgent.ts`
- `src/agents/MediumVideoAgent.ts`
- `src/agents/SocialMediaAgent.ts`
- `src/agents/SummaryAgent.ts`
- `src/agents/BlogAgent.ts`

### Step 2: Apply Pipeline Validation Changes

Add code-level guards as described in [Pipeline Validation Changes](#pipeline-validation-changes).

### Step 3: Re-Run the Comparison

```bash
# Use the same test video from the original regression test:
# bandicam-2026-02-06-12-48-43-967.mp4 (18:00 duration)

# Run with OpenAI provider:
LLM_PROVIDER=openai node dist/index.js --input watch/bandicam-2026-02-06-12-48-43-967.mp4

# Run with Copilot provider (baseline refresh):
LLM_PROVIDER=copilot node dist/index.js --input watch/bandicam-2026-02-06-12-48-43-967.mp4
```

### Step 4: Evaluate Results

Run the same comparison analysis across all 10 categories. The following constitutes a **PASS**:

| Category | Pass Criteria |
|----------|---------------|
| **Chapters** | ≥ 7 chapters, all timestamps ≤ video duration, no generic titles, valid FFMetadata |
| **Shorts** | All clips ≥ 15s, avg ≥ 35s, specific titles, ≥ 5 tags/clip, all captioned variants produced |
| **Medium Clips** | All clips 60–180s, total coverage ≥ 300s, ≥ 1 composite clip, all captioned variants produced |
| **Social Posts** | All platforms meet character minimums, CTAs on all 5, no hallucinated links, distinct voices |
| **README** | ≥ 1,200 words, first-person voice, ≥ 3 quotes, ≥ 9 Quick Reference entries, valid timestamps |
| **Blog** | ≥ 1,200 words, ≥ 2 code blocks, first-person voice, no placeholder links |
| **Structural** | File count within 5% of Copilot baseline (≥ 141 files) |
| **Cost** | ≤ $1.10 per run (allowing for richer prompts) |

### Step 5: Iterate

If any category fails, examine the specific output, adjust the relevant prompt, and re-run only the affected stage (if possible) or the full pipeline.

---

## Estimated Impact

### Cost Projection

| Component | Current OpenAI | After Prompt Changes | Change |
|-----------|---------------:|--------------------:|-------:|
| Input tokens (richer prompts) | ~12,000 | ~15,000–18,000 | +25–50% |
| Output tokens (enforced minimums) | ~15,800 | ~18,000–22,000 | +14–39% |
| Estimated per-run cost | $0.66 | **$0.85–$1.05** | +$0.19–$0.39 |
| Savings vs Copilot ($2.04) | 67.6% | **49–58%** | Still significant |
| Monthly savings (100 videos) | $138 | **$99–$119** | Still $100+/mo |

The cost increase is driven by:
- Longer system prompts (more input tokens per call)
- Enforced content minimums (more output tokens generated)
- Potential retry logic for duration violations (additional calls)

### Quality Improvement Projection

| Agent | Current Grade | Expected After Tuning | Confidence |
|-------|:------------:|:--------------------:|:----------:|
| ChapterAgent | ❌ FAIL | ✅ PASS | High — numeric constraints are well-respected by GPT-4o |
| ShortsAgent | ❌ FAIL | ✅ PASS | High — duration and example-driven constraints |
| MediumVideoAgent | ❌ FAIL | ⚠️ CONDITIONAL | Medium — may need code-level rejection + re-prompt loop |
| SocialMediaAgent | ❌ FAIL | ✅ PASS | High — per-platform examples and minimums are effective |
| SummaryAgent | ❌ FAIL | ✅ PASS | High — voice and word count constraints |
| BlogAgent | ❌ FAIL | ✅ PASS | High — word count and code snippet requirements |
| Caption burning | ❌ FAIL | ❓ UNKNOWN | Requires pipeline debugging, not prompt changes |

### Risk: Caption Burning

The caption-burn failure (17 missing MP4s) is **not a prompt issue** — ASS subtitle files are generated correctly, but the FFmpeg burn step produces no output. This requires separate pipeline investigation:
- Check if the OpenAI-edited video (24s shorter due to more aggressive silence removal) has a different codec/container that breaks the FFmpeg filter chain
- Test the burn step manually with the OpenAI-edited video file
- This is the single highest-impact fix and is independent of all prompt changes

---

## Appendix: Cross-Cutting Patterns

These patterns appeared across multiple agents and should inform all future prompt writing for the OpenAI provider:

1. **GPT-4o respects explicit numeric constraints** — When told "minimum 7 chapters" or "at least 500 characters", it complies. The current prompts use soft language ("aim for", "should be") that GPT-4o treats as suggestions, not requirements. Use "MUST", "CRITICAL", "NEVER", and hard numbers.

2. **GPT-4o needs good/bad examples** — Unlike Copilot (which infers quality expectations from context), GPT-4o performs significantly better when given explicit BAD vs GOOD examples in the prompt. Every constraint should include at least one example pair.

3. **GPT-4o defaults to third-person** — For content-generation agents (Summary, Blog, Social), explicitly mandate first-person voice with examples. Without this, GPT-4o writes in a detached, observational tone.

4. **GPT-4o generates shorter content by default** — Every output length regression was addressed by adding explicit minimums. The model can produce long, detailed content — it just needs to be told to.

5. **GPT-4o is more prone to link hallucination** — Web search results need explicit relevance filtering. Add "include NO links rather than irrelevant ones" to every agent that uses web search.

6. **GPT-4o treats tool schemas loosely** — Fields like `characterCount` received `undefined`. Add fallback guards in tool handlers for all numeric fields.

---

## Caption Burn Failure — Root Cause Investigation

> **This is NOT a model/prompt issue.** The caption burn failure affects ALL captioned MP4s (root, shorts, medium clips) and is a pipeline/FFmpeg issue, not a quality regression.

### What Fails

The OpenAI run has all ASS subtitle files generated correctly, but zero `*-captioned.mp4` files at any level:
- ❌ Root: `bandicam-...-captioned.mp4` missing
- ❌ Shorts: all 6 `*-captioned.mp4` + 6 `*-portrait-captioned.mp4` missing
- ❌ Medium clips: all `*-captioned.mp4` missing

### What Was Ruled Out

| Hypothesis | Status | Evidence |
|-----------|--------|----------|
| Missing font files | ❌ Ruled out | `FONTS_DIR` resolves from `__dirname` → `assets/fonts/` regardless of OUTPUT_DIR. Montserrat-Regular.ttf and Montserrat-Bold.ttf are present. |
| Path resolution (C:\Videos\ vs repo) | ❌ Ruled out | All output paths derive from `OUTPUT_DIR`, not `REPO_ROOT`. Font paths are `__dirname`-relative to the JS module. |
| Missing ASS files | ❌ Ruled out | All ASS files exist with correct content in the OpenAI run. |
| Brand.json font refs | ❌ Ruled out | `brand.json` contains zero font references. |
| Build/dist asset bundling | ❌ Ruled out | `tsup.config.ts` bundles only JS. Fonts are accessed at runtime via `FONTS_DIR`. |

### Root Cause: `singlePassEditAndCaption` filter_complex failure

The caption burn at root level uses `singlePassEditAndCaption()` (line 212 in pipeline.ts), which builds a complex FFmpeg `filter_complex` combining:
1. Silence removal: trim+setpts+concat for each keep-segment
2. Caption overlay: `[cv]ass=captions.ass:fontsdir=.[outv]`

The OpenAI SilenceRemovalAgent made **more aggressive cuts** (15 segments removed vs Copilot's 6), resulting in a different `keepSegments` array. The `filter_complex` string differs between runs because it has different numbers of trim/concat inputs.

**Most likely failure modes:**
1. **Very short keep-segments** — OpenAI's aggressive silence removal may produce segments under 0.1s, which can cause FFmpeg trim filter to produce empty output
2. **Segment boundary edge cases** — With 15 removals, there are more segment boundaries where floating-point rounding in `start.toFixed(3)` / `end.toFixed(3)` could create overlaps or gaps
3. **Audio map mismatch** — `singlePassEditAndCaption` maps `[ca]` for audio (line 134), which is the concat output. If concat fails silently, the audio stream is missing.

### Why It Also Fails in Shorts/Medium Clips

Shorts and medium clips use `burnCaptions()` (the simpler path, not `singlePassEditAndCaption`). These fail because:
- `burnCaptions()` takes the **extracted clip MP4** as input
- If the clip was extracted from the original video using FFmpeg `extractClip()`, and the clip itself is very short (OpenAI produced 13–38s medium clips vs 71–161s baseline), the ASS captions may reference timestamps **beyond the clip duration**
- The ASS is generated using `generateStyledASSForSegment(transcript, start, end)` which produces timestamps relative to `start=0`, but if the clip extraction didn't align perfectly, the ASS timeline overruns

### Recommended Fixes

```
1. Add keepSegment minimum duration validation in singlePassEdit.ts:
   - Filter out segments shorter than 0.05s before building filter_complex
   - Log a warning when segments are removed

2. Add error logging for caption burn in the shorts/medium-clips agents:
   - Lines 225-230 in ShortsAgent.ts and 223-228 in MediumVideoAgent.ts
     catch errors but only log a warn — add the full stderr output

3. Check ASS duration vs clip duration before burn:
   - If last ASS event timestamp > clip duration, truncate or warn

4. Re-run with VERBOSE FFmpeg logging to capture the exact stderr
   from the failed burns:
   - Set LOG_LEVEL=debug before running the pipeline
   - The stderr from execFile contains the FFmpeg error message
```

### How to Reproduce

```bash
# Re-run just the caption burn stage on the OpenAI output
# to capture the exact FFmpeg error:
LLM_PROVIDER=openai OUTPUT_DIR=C:\Videos npx tsx src/index.ts process \
  "C:\Videos\bandicam-2026-02-06-12-48-43-967\bandicam-2026-02-06-12-48-43-967.mp4" \
  --skip-transcription --skip-silence-removal --skip-shorts --skip-chapters \
  --skip-summary --skip-social --skip-blog --skip-git
```

This will re-generate captions from the existing `transcript-edited.json` and attempt to burn them, logging the FFmpeg error.

---

*Last updated: 2026-02-08 · Based on regression test of `bandicam-2026-02-06-12-48-43-967` (18:00) · Copilot baseline vs OpenAI GPT-4o direct*
