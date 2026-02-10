---
title: Brand Customization
---

# Brand Customization

The `brand.json` file shapes how the AI agents write content — summaries, social posts, blog posts, and short clip descriptions. Customize it to match your personal or company brand.

---

## Location

By default, the tool looks for `brand.json` in the current working directory. Override the path with:

```bash
# CLI flag
vidpipe --brand /path/to/my-brand.json

# Environment variable
BRAND_PATH=/path/to/my-brand.json

# .env file
BRAND_PATH=./brands/my-brand.json
```

---

## Format Reference

```jsonc
{
  // Your name or brand name — used in content attribution
  "name": "Your Name",

  // Social media handle — included in posts
  "handle": "@yourhandle",

  // Short tagline that appears in bios/intros
  "tagline": "Your tagline here",

  // Voice configuration — shapes how the AI writes
  "voice": {
    "tone": "enthusiastic, authentic, educational",
    "personality": "A brief description of your public persona and what you're known for.",
    "style": "How you communicate — conversational, formal, technical, etc."
  },

  // Topics and advocacy areas
  "advocacy": {
    "primary": ["Technology A", "Technology B"],
    "interests": ["Topic 1", "Topic 2", "Topic 3"],
    "avoids": ["Things the AI should never say or do"]
  },

  // Custom vocabulary for better Whisper transcription accuracy
  "customVocabulary": [
    "ProperNoun",
    "TechTermThatWhisperMightMisspell",
    "YourProductName"
  ],

  // Hashtag strategy
  "hashtags": {
    "always": ["#AlwaysInclude"],
    "preferred": ["#Often", "#Used", "#Tags"],
    "platforms": {
      "tiktok": ["#PlatformSpecific"],
      "linkedin": ["#ProfessionalTag"],
      "instagram": ["#VisualTag"]
    }
  },

  // Content guidelines for different output types
  "contentGuidelines": {
    "shortsFocus": "What makes a good short clip for your content",
    "blogFocus": "How blog posts should be structured and what to emphasize",
    "socialFocus": "Your social media strategy and posting style"
  }
}
```

---

## Field Details

### `name` and `handle`

Your display name and primary social media handle. The AI uses these when generating attribution text and social posts.

### `voice`

Controls the writing style of all AI-generated content:

| Field | Purpose | Example |
|-------|---------|---------|
| `tone` | Comma-separated tone descriptors | `"enthusiastic, authentic, educational"` |
| `personality` | Paragraph describing your public persona | `"A developer advocate who loves teaching..."` |
| `style` | How content should read | `"Conversational but knowledgeable. Uses code examples."` |

### `advocacy`

Guides topic selection and avoidance:

| Field | Purpose |
|-------|---------|
| `primary` | Core technologies/brands you champion |
| `interests` | Broader topics the AI can reference |
| `avoids` | Things the AI should never include (e.g., negative competitor comparisons) |

### `customVocabulary`

A list of proper nouns, brand names, and technical terms. These are sent to OpenAI Whisper as a prompt hint to improve transcription accuracy for domain-specific words.

**Why this matters:** Whisper sometimes misspells product names or jargon. Adding them here significantly improves accuracy.

```json
"customVocabulary": [
  "GitHub Copilot",
  "VS Code",
  "TypeScript",
  "Kubernetes",
  "PostgreSQL"
]
```

### `hashtags`

Organized hashtag strategy:

| Field | Purpose |
|-------|---------|
| `always` | Included on every post, every platform |
| `preferred` | Commonly used, AI picks the most relevant ones |
| `platforms` | Platform-specific hashtags (keys: `tiktok`, `youtube`, `instagram`, `linkedin`, `x`) |

### `contentGuidelines`

Direction for each content type:

| Field | Guides |
|-------|--------|
| `shortsFocus` | What moments to extract as short clips |
| `blogFocus` | Blog post structure, depth, and angle |
| `socialFocus` | Social media writing strategy |

---

## Example Templates

### Developer / Tech Creator

```json
{
  "name": "Alex Chen",
  "handle": "@alexcodes",
  "tagline": "Full-stack dev | Building in public",
  "voice": {
    "tone": "friendly, technical, concise",
    "personality": "A full-stack developer who shares real-world coding experiences. Honest about trade-offs.",
    "style": "Direct and practical. Includes code snippets when relevant. Avoids hype."
  },
  "advocacy": {
    "primary": ["React", "Node.js", "PostgreSQL"],
    "interests": ["Web Performance", "DevOps", "Open Source", "TypeScript"],
    "avoids": ["Framework wars", "Clickbait titles"]
  },
  "customVocabulary": [
    "Next.js",
    "Prisma",
    "Vercel",
    "PostgreSQL",
    "TypeScript",
    "Tailwind CSS"
  ],
  "hashtags": {
    "always": ["#WebDev", "#BuildInPublic"],
    "preferred": ["#React", "#NodeJS", "#TypeScript", "#OpenSource"],
    "platforms": {
      "tiktok": ["#CodeTok", "#DevTok"],
      "linkedin": ["#SoftwareEngineering", "#TechCareers"],
      "instagram": ["#CodeLife", "#DeveloperLife"]
    }
  },
  "contentGuidelines": {
    "shortsFocus": "Focus on aha moments, bug fixes, before/after demos, and performance wins",
    "blogFocus": "Tutorial-style with code examples. Always explain the 'why' behind decisions.",
    "socialFocus": "Share the journey and lessons learned. Be authentic about failures too."
  }
}
```

### Corporate / Product Team

```json
{
  "name": "Acme DevTools",
  "handle": "@acmedevtools",
  "tagline": "Developer tools that just work",
  "voice": {
    "tone": "professional, clear, helpful",
    "personality": "A product team focused on developer experience. Celebrates customer wins.",
    "style": "Polished but not stuffy. Uses product terminology consistently."
  },
  "advocacy": {
    "primary": ["Acme CLI", "Acme Cloud", "Acme SDK"],
    "interests": ["Developer Experience", "CI/CD", "Cloud Native"],
    "avoids": ["Competitor bashing", "Unsubstantiated performance claims", "Internal jargon"]
  },
  "customVocabulary": [
    "Acme CLI",
    "Acme Cloud",
    "AcmeSDK",
    "DevOps"
  ],
  "hashtags": {
    "always": ["#AcmeDevTools"],
    "preferred": ["#DevTools", "#DeveloperExperience", "#CloudNative"],
    "platforms": {
      "tiktok": ["#TechTok"],
      "linkedin": ["#Engineering", "#ProductLaunch"],
      "instagram": ["#DevLife"]
    }
  },
  "contentGuidelines": {
    "shortsFocus": "Product demos, feature highlights, customer success stories",
    "blogFocus": "Feature announcements, how-to guides, migration tutorials",
    "socialFocus": "Lead with value. Show the product in action. Include CTAs."
  }
}
```

### Educator / Course Creator

```json
{
  "name": "Prof. Sarah",
  "handle": "@profsarah",
  "tagline": "Making computer science accessible to everyone",
  "voice": {
    "tone": "warm, patient, encouraging",
    "personality": "A CS educator who breaks down complex topics. Celebrates learning milestones.",
    "style": "Uses analogies and metaphors. Never condescending. Builds from basics."
  },
  "advocacy": {
    "primary": ["Python", "Computer Science Fundamentals"],
    "interests": ["Education", "Algorithms", "Data Structures", "Career Advice"],
    "avoids": ["Gatekeeping", "Assuming prior knowledge", "Discouraging language"]
  },
  "customVocabulary": [
    "Python",
    "Big O",
    "recursion",
    "binary search",
    "data structures"
  ],
  "hashtags": {
    "always": ["#LearnToCode", "#ComputerScience"],
    "preferred": ["#Python", "#Coding", "#Education", "#STEM"],
    "platforms": {
      "tiktok": ["#LearnOnTikTok", "#CodingTikTok", "#EduTok"],
      "linkedin": ["#TechEducation", "#CareerGrowth"],
      "instagram": ["#StudyGram", "#CodeNewbie"]
    }
  },
  "contentGuidelines": {
    "shortsFocus": "Aha moments, visual explanations, quick tips, common mistakes",
    "blogFocus": "Step-by-step tutorials with diagrams. Include exercises.",
    "socialFocus": "Motivational and educational. Ask questions to engage followers."
  }
}
```

---

## Caption Font

The default caption font is **Montserrat Bold**, bundled with the package in `assets/fonts/`. No manual font installation is required — FFmpeg uses the bundled font file directly when burning captions into videos.

---

## Tips

- **Keep `customVocabulary` updated.** Add any terms that Whisper consistently misspells in your transcriptions.
- **Test your brand with a short video first.** Process a 1–2 minute clip and review the generated content to see if the tone matches your expectations.
- **Use `avoids` generously.** It's easier to tell the AI what *not* to do than to perfectly describe what you want.
- **Platform-specific hashtags matter.** TikTok and LinkedIn audiences respond to very different tags — customize per platform for maximum reach.
