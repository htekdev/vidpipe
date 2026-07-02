import { join } from '../L1-infra/paths/paths.js'
import { fileExists, readJsonFile, writeJsonFile } from '../L1-infra/fileSystem/fileSystem.js'
import type { VideoFile, VideoKnowledgeBase } from '../L0-pure/types/index.js'

export const VIDEO_KNOWLEDGE_BASE_FILE = 'knowledge-base.json'

/** Create an empty blackboard initialized from ingested video metadata. */
export function createVideoKnowledgeBase(video: VideoFile): VideoKnowledgeBase {
  return {
    video,
    duration: video.duration,
    resolution: {
      width: video.layout?.width ?? 0,
      height: video.layout?.height ?? 0,
    },
    layout: {
      webcam: video.layout?.webcam ?? null,
      screenRegion: video.layout?.screen ?? null,
      layoutChanges: [],
    },
    scenes: {
      boundaries: [],
      segments: [],
    },
    screenContent: {
      ocr: [],
      contentType: [],
    },
    mouse: {
      positions: [],
      clicks: [],
    },
    audio: {
      silenceRegions: [],
      noiseLevel: [],
    },
    face: {
      energy: [],
      eyeContact: [],
    },
  }
}

/** Persist the video knowledge base to the canonical per-video JSON file. */
export async function writeVideoKnowledgeBase(videoDir: string, knowledgeBase: VideoKnowledgeBase): Promise<string> {
  const outputPath = join(videoDir, VIDEO_KNOWLEDGE_BASE_FILE)
  await writeJsonFile(outputPath, knowledgeBase)
  return outputPath
}

/** Load a persisted video knowledge base if available. */
export async function readVideoKnowledgeBase(videoDir: string): Promise<VideoKnowledgeBase | undefined> {
  const filePath = join(videoDir, VIDEO_KNOWLEDGE_BASE_FILE)
  if (!(await fileExists(filePath))) return undefined

  const raw = await readJsonFile<VideoKnowledgeBase>(filePath)
  const createdAt = raw.video?.createdAt
  if (typeof createdAt === 'string') {
    return {
      ...raw,
      video: { ...raw.video, createdAt: new Date(createdAt) },
    }
  }

  return raw
}
