# Video Analysis ML: UltraFace ONNX & Beyond

> Research document exploring ML models and techniques applicable to video analysis pipelines.
> Written for the vidpipe project after replacing a skin-tone heuristic with UltraFace-320 ONNX for webcam face detection.

---

## Table of Contents

1. [UltraFace Model Deep Dive](#1-ultraface-model-deep-dive)
2. [Alternative Face Detection Models](#2-alternative-face-detection-models)
3. [Video Analysis ML Use Cases](#3-video-analysis-ml-use-cases)
4. [Integration Patterns](#4-integration-patterns)
5. [Potential vidpipe Enhancements](#5-potential-vidpipe-enhancements)

---

## 1. UltraFace Model Deep Dive

### Overview

UltraFace (formally "Ultra-Light-Fast-Generic-Face-Detector-1MB") is an ultra-lightweight face detection model designed for edge computing devices. It was created by [Linzaer](https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB) and pre-trained on the [WIDER FACE](http://shuoyang1213.me/WIDERFACE/) dataset.

We use the **RFB-320** variant — the version with modified Receptive Field Block (RFB) modules at 320×240 input resolution.

### Architecture

UltraFace is built on a lightweight CNN backbone with two architectural variants:

| Variant | Technique | Key Idea |
|---------|-----------|----------|
| **Slim** | Depthwise separable convolutions | Minimizes parameters via MobileNet-style factorized convolutions |
| **RFB** | Receptive Field Block modules | Multi-branch dilated convolutions that capture multi-scale features without increasing model size significantly |

The **RFB variant** (which we use) replaces standard convolution blocks with RFB modules inspired by the human visual cortex's receptive fields. Each RFB module uses parallel branches with different dilation rates to capture features at multiple scales, improving detection of faces at varying sizes while keeping the model small.

The detection head uses an SSD-style (Single Shot MultiBox Detector) approach with anchor boxes at multiple scales. The model outputs two tensors:

- **`boxes`** — `[1, 4420, 4]`: bounding box coordinates for each anchor
- **`scores`** — `[1, 4420, 2]`: per-anchor probabilities for two classes (background, face)

### Model Specifications

| Metric | Value |
|--------|-------|
| **Input size** | 320×240 (W×H) |
| **Model file size** | ~1.2 MB (ONNX) |
| **Parameters** | 0.3M (300,400) |
| **GFLOPs** | 0.2106 |
| **Anchor boxes** | 4,420 |
| **Output classes** | 2 (background / face) |
| **Source framework** | PyTorch |
| **License** | MIT (original repo) |
| **ONNX available** | ✅ Yes — pre-exported in the repo |

### Accuracy (WIDER FACE Val)

| Variant | Input | Easy AP | Medium AP | Hard AP |
|---------|-------|---------|-----------|---------|
| RFB-320 | 320×240 | 78.7% | 69.8% | 43.8% |
| RFB-640 | 640×480 | 85.5% | 82.2% | 57.9% |
| Slim-320 | 320×240 | 77.0% | 67.1% | 39.7% |
| Slim-640 | 640×480 | 83.7% | 80.3% | 55.3% |

> **Note**: The OpenVINO model zoo reports 84.78% mAP for RFB-320 using their evaluation methodology, which aggregates across difficulty levels differently.

### Performance Characteristics

| Platform | RFB-320 | RFB-640 |
|----------|---------|---------|
| **CPU** (Xeon Silver 4116) | ~25ms/frame | ~67ms/frame |
| **GPU** (Quadro RTX 8000) | ~8.5ms/frame | ~19ms/frame |

For our use case (5 sample frames from a video), CPU inference adds roughly **125ms total** — negligible compared to the video extraction step.

### ONNX Runtime Integration

We use [`onnxruntime-node`](https://www.npmjs.com/package/onnxruntime-node) (v1.23+) for inference in Node.js:

```typescript
import * as ort from 'onnxruntime-node'

// Session creation (cached singleton)
const session = await ort.InferenceSession.create(MODEL_PATH, {
  executionProviders: ['cpu'],
  graphOptimizationLevel: 'all',  // enables constant folding, node fusion, etc.
})

// Preprocessing: resize to 320×240, normalize with mean=[127,127,127] std=128
const inputTensor = new ort.Tensor('float32', floatData, [1, 3, 240, 320])
const results = await session.run({ input: inputTensor })

const scores = results['scores'].data as Float32Array  // [1, 4420, 2]
const boxes = results['boxes'].data as Float32Array     // [1, 4420, 4]
```

Key integration details:
- **Execution provider**: CPU-only (no GPU dependencies needed for deployment)
- **Graph optimization**: `'all'` enables operator fusion, constant folding, and redundant node elimination
- **Session caching**: Single `InferenceSession` instance reused across all frames
- **Platform support**: Windows x64/arm64, Linux x64/arm64, macOS x64/arm64

### How We Use It in vidpipe

Our webcam detection pipeline (`src/tools/ffmpeg/faceDetection.ts`) works in three phases:

```
┌─────────────────────────────────────────────────────────┐
│ Phase 1: Frame Sampling                                 │
│ Extract 5 frames evenly distributed across the video    │
│ Scaled to model input size (320×240) via FFmpeg         │
├─────────────────────────────────────────────────────────┤
│ Phase 2: Face Detection & Corner Classification         │
│ Run UltraFace on each frame                             │
│ Classify each face → corner (top-left/right/bottom-*)   │
│ Score corners by detection consistency across frames     │
├─────────────────────────────────────────────────────────┤
│ Phase 3: Edge Refinement                                │
│ Compute per-column/row mean intensities across frames   │
│ Average to cancel out changing content                  │
│ Find peak intensity step = overlay border               │
│ Sanity check: webcam = 5-55% of frame dimensions        │
└─────────────────────────────────────────────────────────┘
```

This replaces the previous skin-tone heuristic, which was brittle across different lighting conditions, skin tones, and webcam backgrounds.

---

## 2. Alternative Face Detection Models

### Comparison Table

| Model | Size | Input | Speed (CPU) | WIDER FACE (Easy/Med/Hard) | License | ONNX Available |
|-------|------|-------|-------------|---------------------------|---------|----------------|
| **UltraFace RFB-320** | 1.2 MB | 320×240 | ~25ms | 78.7 / 69.8 / 43.8 | MIT | ✅ Pre-exported |
| **BlazeFace** | 0.1 MB | 128×128 | ~5ms | ~79 / ~65 / ~35 | Apache 2.0 | ✅ Available |
| **RetinaFace (MobileNet)** | 1.7 MB | 640×640 | ~80ms | 90.7 / 88.2 / 73.8 | MIT | ✅ Convertible |
| **RetinaFace (ResNet50)** | 105 MB | 640×640 | ~300ms | 96.5 / 95.6 / 90.4 | MIT | ✅ Convertible |
| **MTCNN** | ~2 MB | Variable | ~100ms | ~85 / ~82 / ~60 | MIT | ⚠️ Multi-stage |
| **YOLO-Face (YOLOv8n)** | 6 MB | 640×640 | ~50ms | ~93 / ~91 / ~78 | GPL-3.0 | ✅ Via Ultralytics |
| **YuNet** | 0.3 MB | 320×320 | ~15ms | ~86 / ~83 / ~69 | MIT | ✅ OpenCV built-in |

> CPU speed estimates are approximate and vary with hardware; measured on mid-range x86 CPUs.

### Model Details

#### BlazeFace (Google/MediaPipe)

- **Architecture**: MobileNet-style backbone + SSD detection head, optimized for mobile GPUs
- **Strengths**: Extremely fast (<5ms), tiny model (100KB), includes 6 facial landmark points
- **Weaknesses**: Optimized for close-range selfie-style faces; struggles with small/distant faces
- **Best for**: Mobile/real-time applications, front-facing camera scenarios
- **Links**: [MediaPipe Face Detection](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector), [ONNX model on HuggingFace](https://huggingface.co/garavv/blazeface-onnx)

#### RetinaFace

- **Architecture**: Feature Pyramid Network (FPN) + multi-task learning (face detection, landmark localization, 3D face reconstruction)
- **Strengths**: State-of-the-art accuracy especially on hard/small faces; includes 5 facial landmarks
- **Weaknesses**: Heavy ResNet variant is too large for edge; MobileNet variant trades accuracy for speed
- **Best for**: Applications requiring highest accuracy (security, identity verification)
- **Links**: [GitHub (biubug6)](https://github.com/biubug6/Pytorch_Retinaface), [Paper (arXiv:1905.00641)](https://arxiv.org/abs/1905.00641)

#### MTCNN (Multi-task Cascaded Convolutional Networks)

- **Architecture**: Three-stage cascade — P-Net (proposal), R-Net (refinement), O-Net (output)
- **Strengths**: Good balance of accuracy and speed; well-established, widely supported
- **Weaknesses**: Cascade architecture makes ONNX export complex (three separate models); slower than single-shot detectors
- **Best for**: General-purpose face detection where moderate speed is acceptable
- **Links**: [GitHub (ipazc)](https://github.com/ipazc/mtcnn), [Paper](https://arxiv.org/abs/1604.02878)

#### YOLO-Face

- **Architecture**: YOLO (You Only Look Once) adapted for face detection; YOLOv8 variants available from nano to extra-large
- **Strengths**: Excellent accuracy, single-pass detection, well-maintained Ultralytics ecosystem
- **Weaknesses**: GPL-3.0 license (restrictive for commercial use); larger models than UltraFace
- **Best for**: High-accuracy face detection when model size isn't constrained
- **Links**: [GitHub (akanametov/yolo-face)](https://github.com/akanametov/yolo-face), [Ultralytics Docs](https://docs.ultralytics.com/)

#### YuNet

- **Architecture**: Lightweight CNN with depthwise separable convolutions; included in OpenCV's DNN module
- **Strengths**: Extremely small (337KB), fast, built into OpenCV (no extra dependencies), good accuracy for its size
- **Weaknesses**: Less community adoption than YOLO or RetinaFace
- **Best for**: C++/Python projects already using OpenCV
- **Links**: [OpenCV Zoo (YuNet)](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)

### Why UltraFace for vidpipe?

Our requirements map well to UltraFace:

| Requirement | UltraFace Fit |
|-------------|---------------|
| **Detect corner webcam overlays** | ✅ Only needs to find 1 face reliably — Easy/Medium AP is sufficient |
| **Minimal dependencies** | ✅ Single 1.2MB ONNX file + onnxruntime-node |
| **CPU-only inference** | ✅ Designed for edge/CPU deployment |
| **Cross-platform** | ✅ ONNX Runtime supports all our targets |
| **MIT/Apache license** | ✅ MIT licensed |
| **Speed** | ✅ ~25ms/frame, 5 frames = ~125ms total |

We don't need the Hard AP accuracy (small/occluded faces) because webcam overlays are typically large, well-lit, and unoccluded.

---

## 3. Video Analysis ML Use Cases

### 3.1 Scene/Shot Detection

**What**: Detect transitions between shots (cuts, fades, dissolves) to segment a video into semantically meaningful scenes.

**Relevance to vidpipe**: Could improve chapter splitting (stage 8) by providing precise shot boundaries instead of relying solely on transcript topic analysis.

| Tool/Model | Type | License | Notes |
|------------|------|---------|-------|
| [**PySceneDetect**](https://www.scenedetect.com/) | Library | BSD-3 | Python CLI/API. Content-aware + threshold + adaptive detectors. Mature, widely used. v0.6.7 (Aug 2025). |
| [**TransNetV2**](https://github.com/soCzech/TransNetV2) | Neural net | MIT | DDCNN architecture. ~77.9% F1 on ClipShots. Available as [PyPI package](https://pypi.org/project/transnetv2-pytorch/). |
| [**AutoShot**](https://github.com/wentaozhu/AutoShot) | Neural net | — | Neural architecture search-based. Outperforms TransNetV2 by ~4.2% F1 on the SHOT dataset. |
| **FFmpeg** `select` filter | Built-in | LGPL | `scenecut_threshold` filter — simple but effective for hard cuts |

**For screen recordings**: Traditional detectors work well for detecting slide transitions, IDE tab switches, and application changes. TransNetV2 is particularly effective as it handles both hard cuts and gradual transitions.

### 3.2 Object Detection

**What**: Detect and localize specific objects in video frames (code editors, terminals, browser windows, slide decks).

| Model | Size | Speed | License | Notes |
|-------|------|-------|---------|-------|
| [**YOLOv8/v11**](https://docs.ultralytics.com/) | 3-68 MB (n→x) | 1-15ms GPU | AGPL-3.0 | State-of-the-art; ONNX export built-in |
| [**MobileNet-SSD**](https://github.com/chuanqi305/MobileNet-SSD) | 5 MB | ~30ms CPU | Apache 2.0 | Lightweight, good for CPU |
| [**EfficientDet**](https://github.com/google/automl/tree/master/efficientdet) | 4-52 MB | Varies | Apache 2.0 | Scalable accuracy/speed tradeoff |

**Relevance to vidpipe**: Could detect when a presenter is showing code vs. slides vs. browser content, enabling smarter chapter segmentation or content-type tagging.

### 3.3 OCR / Text Detection

**What**: Extract text from video frames — critical for screen recordings containing code, terminal output, or UI elements.

| Tool | Language | License | Strengths |
|------|----------|---------|-----------|
| [**Tesseract**](https://github.com/tesseract-ocr/tesseract) | C++ (Node bindings) | Apache 2.0 | Mature, 100+ languages, widely deployed |
| [**PaddleOCR**](https://github.com/PaddlePaddle/PaddleOCR) | Python | Apache 2.0 | State-of-the-art accuracy, multilingual, lightweight PP-OCR model |
| [**EasyOCR**](https://github.com/JaidedAI/EasyOCR) | Python | Apache 2.0 | 80+ languages, easy setup, GPU-accelerated |
| [**Surya**](https://github.com/VikParuchuri/surya) | Python | GPL-3.0 | Excellent for documents/code, 90+ languages |

**Relevance to vidpipe**: Could extract on-screen code snippets, terminal commands, or slide text for searchable transcripts, enriching the summary and blog generation stages. Particularly valuable for coding tutorial videos.

### 3.4 Action Recognition

**What**: Classify what's happening in video segments (e.g., "typing code", "presenting slides", "demonstrating software").

| Model | Architecture | License | Notes |
|-------|-------------|---------|-------|
| [**SlowFast**](https://github.com/facebookresearch/SlowFast) | Dual-pathway CNN | Apache 2.0 | Fast pathway (temporal) + slow pathway (spatial) |
| [**TimeSformer**](https://github.com/facebookresearch/TimeSformer) | Vision Transformer | Apache 2.0 | Divided space-time attention |
| [**X3D**](https://github.com/facebookresearch/SlowFast) | Efficient 3D CNN | Apache 2.0 | Mobile-friendly, expands across axes |
| [**VideoMAE**](https://github.com/MCG-NJU/VideoMAE) | Masked autoencoder | CC BY-NC 4.0 | Self-supervised pre-training |

**Relevance to vidpipe**: Could auto-tag segments ("coding", "presenting", "demo", "Q&A"), improving chapter descriptions and social media post generation.

### 3.5 Speaker Diarization

**What**: Determine "who spoke when" — segment audio by speaker identity.

| Tool | License | Notes |
|------|---------|-------|
| [**pyannote-audio**](https://github.com/pyannote/pyannote-audio) | MIT | 9k+ ★. Neural speaker diarization pipeline. State-of-the-art. HuggingFace integration. |
| [**pyannoteAI**](https://docs.pyannote.ai/) | Commercial | Cloud API with STT orchestration, voiceprint identification |
| [**Resemblyzer**](https://github.com/resemble-ai/Resemblyzer) | Apache 2.0 | Speaker embeddings from GE2E model; lighter than pyannote |
| [**NeMo**](https://github.com/NVIDIA/NeMo) | Apache 2.0 | NVIDIA's toolkit — includes speaker diarization, verification, and ASR |

**Relevance to vidpipe**: We already use Whisper for transcription. Adding speaker diarization could attribute transcript segments to speakers, useful for multi-speaker recordings (interviews, panels, pair programming).

### 3.6 Emotion / Expression Analysis

**What**: Analyze facial expressions to gauge presenter engagement, energy levels, or audience reactions.

| Tool | License | Notes |
|------|---------|-------|
| [**DeepFace**](https://github.com/serengil/deepface) | MIT | Wraps multiple backends (VGG-Face, FaceNet, ArcFace); includes emotion analysis |
| [**FER**](https://github.com/justinshenk/fer) | MIT | Lightweight facial expression recognition |
| [**HSEmotion**](https://github.com/HSE-asavchenko/face-emotion-recognition) | Apache 2.0 | ONNX-exported models, mobile-friendly |

**Relevance to vidpipe**: Could help identify the most engaging segments for short clips or thumbnails, or add engagement metrics to the summary.

### 3.7 Visual Quality Assessment

**What**: Detect blur, bad lighting, encoding artifacts, or other quality issues in video frames.

| Technique | Method | Notes |
|-----------|--------|-------|
| **Laplacian variance** | Gradient-based | Simple blur detection: low variance = blurry. Can implement with Sharp/FFmpeg. |
| **BRISQUE** | No-reference IQA | Trained model predicting perceived quality without a reference image |
| [**MUSIQ**](https://github.com/google-research/google-research/tree/master/musiq) | Multi-scale Transformer | Google's no-reference image quality model |
| **FFmpeg `signalstats`** | Built-in filter | Measures brightness, saturation, temporal outliers — no ML needed |

**Relevance to vidpipe**: Could skip or flag low-quality segments before generating shorts, or automatically select the best-quality frames for thumbnails.

### 3.8 Thumbnail Generation

**What**: Automatically select the best frame for a video thumbnail using ML-based aesthetics scoring.

| Approach | Notes |
|----------|-------|
| **NIMA (Neural Image Assessment)** | Google's image aesthetics model — predicts human aesthetic ratings |
| **Face + composition heuristics** | Prefer frames with visible faces, rule-of-thirds alignment, good lighting |
| **Engagement-based** | Select frames from the most-viewed or highest-engagement segments |
| **Scene diversity sampling** | Pick representative frames from each detected scene |

**Relevance to vidpipe**: Currently the summary stage captures key frames via FFmpeg timestamp extraction. ML-based frame selection could improve thumbnail quality significantly.

### 3.9 Content Moderation

**What**: Detect inappropriate or NSFW content before publishing to social media.

| Tool | License | Notes |
|------|---------|-------|
| [**NudeNet**](https://github.com/notAI-tech/NudeNet) | AGPL-3.0 | NSFW detection/classification, ONNX available |
| **OpenAI Moderation API** | Commercial | Text + image moderation endpoint |
| **Azure Content Safety** | Commercial | Multi-modal content moderation with severity levels |
| [**Safety Checker (Stable Diffusion)**](https://huggingface.co/CompVis/stable-diffusion-safety-checker) | CreativeML Open RAIL-M | CLIP-based NSFW detection |

**Relevance to vidpipe**: Automated safety check before the social media and git-push stages to prevent publishing inappropriate content.

---

## 4. Integration Patterns

### 4.1 ONNX Runtime as Universal Inference Engine

ONNX (Open Neural Network Exchange) provides a common format for ML models from any framework. ONNX Runtime is the inference engine.

```
PyTorch Model  ──→ torch.onnx.export() ──→ .onnx file ──→ ONNX Runtime
TensorFlow     ──→ tf2onnx                ──→ .onnx file ──→ ONNX Runtime
PaddlePaddle   ──→ paddle2onnx            ──→ .onnx file ──→ ONNX Runtime
```

**Why this matters for vidpipe**: We can evaluate models from any framework and deploy them uniformly via `onnxruntime-node`. No need for Python dependencies at runtime.

```typescript
// Generic ONNX model loading pattern
import * as ort from 'onnxruntime-node'

async function loadModel(modelPath: string): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],        // or ['cuda'] for GPU, ['dml'] for DirectML
    graphOptimizationLevel: 'all',       // max CPU optimizations
    enableCpuMemArena: true,             // memory pool for CPU allocations
    enableMemPattern: true,              // memory pattern optimization
  })
}
```

### 4.2 Model Optimization

#### Quantization

Convert FP32 weights to INT8, reducing model size by ~4x and improving CPU inference speed:

```
Original model (FP32)  →  Quantized model (INT8)
1.2 MB                 →  ~300 KB
25ms/frame             →  ~12ms/frame (approximate)
```

ONNX Runtime provides built-in quantization tools:

```python
# Python-side quantization (one-time step)
from onnxruntime.quantization import quantize_dynamic, QuantType

quantize_dynamic(
    "ultraface-320.onnx",
    "ultraface-320-int8.onnx",
    weight_type=QuantType.QUInt8
)
```

#### Pruning

Remove low-magnitude weights to create sparse models. Less applicable for already-tiny models like UltraFace, but useful for larger models (RetinaFace, YOLO).

#### Graph Optimization

ONNX Runtime's built-in graph optimizations (`graphOptimizationLevel: 'all'`):
- **Constant folding**: Pre-compute operations with constant inputs
- **Operator fusion**: Merge adjacent operations (e.g., Conv + BatchNorm + ReLU → single fused op)
- **Redundant node elimination**: Remove unnecessary reshape/transpose nodes

### 4.3 Batched vs. Streaming Inference

| Pattern | Use Case | Approach |
|---------|----------|----------|
| **Batch sampling** | Face detection, thumbnail selection | Extract N key frames, process as batch. What we do now (5 frames). |
| **Sliding window** | Scene detection, action recognition | Process overlapping windows of frames, stride by K frames |
| **Full decode** | OCR on every frame, content moderation | Decode every frame (or every Nth frame), process sequentially |
| **Streaming** | Real-time applications | Process frames as they're decoded, maintain state between frames |

For vidpipe's offline processing pipeline, **batch sampling** is ideal for most tasks. We only need **sliding window** for temporal tasks like scene/shot detection.

### 4.4 Memory Management for Long Videos

Long videos (1+ hours) require careful memory management:

```typescript
// Pattern: process frames in chunks, release memory between chunks
const CHUNK_SIZE = 10

for (let i = 0; i < totalFrames; i += CHUNK_SIZE) {
  const chunk = frames.slice(i, i + CHUNK_SIZE)
  const results = await processChunk(chunk)
  aggregateResults(results)
  // GC hint — release frame buffers
  chunk.forEach(f => f.buffer = null)
}
```

Key strategies:
- **Extract frames on-demand** via FFmpeg (don't decode entire video into memory)
- **Release frame buffers** after processing each chunk
- **Cache ONNX sessions** (load once, reuse) — sessions are thread-safe for read
- **Use typed arrays** (Float32Array) instead of JS arrays for tensor data
- **Limit concurrent models** — each ONNX session holds model weights in memory

---

## 5. Potential vidpipe Enhancements

### Priority Matrix

| Enhancement | Effort | Impact | Priority | Dependencies |
|-------------|--------|--------|----------|--------------|
| **Scene-aware chapter splitting** | Medium | High | ★★★★★ | PySceneDetect or TransNetV2 |
| **OCR for screen text extraction** | Medium | High | ★★★★☆ | Tesseract (Node bindings exist) |
| **ML-based thumbnail selection** | Easy | Medium | ★★★★☆ | Sharp (already in use) + Laplacian + face detection (already have) |
| **Speaker diarization** | Medium | High | ★★★☆☆ | pyannote (Python) or cloud API |
| **Content moderation pre-check** | Easy | Medium | ★★★☆☆ | NudeNet ONNX or API call |
| **Visual quality filtering** | Easy | Low-Med | ★★☆☆☆ | FFmpeg signalstats or Laplacian |
| **Action recognition tagging** | Hard | Medium | ★★☆☆☆ | SlowFast/X3D (Python, GPU preferred) |
| **Emotion-based clip selection** | Hard | Low | ★☆☆☆☆ | FER/DeepFace + face detection |

### Detailed Recommendations

#### 1. Scene-Aware Chapter Splitting ★★★★★

**Current state**: Chapters are generated by an LLM agent analyzing the transcript for topic boundaries.

**Enhancement**: Combine transcript-based chapters with visual shot boundaries. When the LLM identifies a topic change, verify it aligns with a visual transition. If not, snap to the nearest shot boundary.

```
Transcript chapters:  |--- Intro ---|--- Setup ---|--- Demo ---|--- Summary ---|
Shot boundaries:      | | |  |    |   |     ||   |   |        |
Combined:             |--- Intro --|--- Setup --|---- Demo ----|-- Summary ---|
                                   ^             ^
                               Snapped to nearest shot boundary
```

**Effort**: Medium — integrate PySceneDetect as a subprocess, merge results with existing chapter logic.

#### 2. OCR for Screen Text ★★★★☆

**Current state**: We transcribe audio but don't extract any visual text from screen recordings.

**Enhancement**: Run OCR on sampled frames to extract code snippets, terminal commands, slide titles. Feed into summary/blog generation.

**Effort**: Medium — Tesseract has Node.js bindings via [`tesseract.js`](https://github.com/naptha/tesseract.js) (runs entirely in JS/WASM, no native dependency). Alternatively, use `node-tesseract-ocr` which wraps the CLI.

#### 3. ML-Based Thumbnail Selection ★★★★☆

**Current state**: Key frames are selected at specific timestamps.

**Enhancement**: Score candidate frames using:
1. **Blur detection** (Laplacian variance via Sharp — zero new dependencies)
2. **Face detection** (already have UltraFace)
3. **Composition scoring** (rule-of-thirds, brightness distribution)

**Effort**: Easy — we already have Sharp and UltraFace. Just need a scoring function over candidate frames.

#### 4. Speaker Diarization ★★★☆☆

**Current state**: Whisper transcribes all audio as a single speaker.

**Enhancement**: Attribute transcript segments to individual speakers. Useful for multi-speaker recordings.

**Effort**: Medium — pyannote requires Python. Could run as a subprocess or use a cloud diarization API. Integration point: post-transcription, pre-captions.

#### 5. Content Moderation ★★★☆☆

**Current state**: No automated content checks before publishing.

**Enhancement**: Quick NSFW/inappropriate content scan before social media stage. NudeNet has ONNX models we could load with our existing onnxruntime-node setup.

**Effort**: Easy — add a check in the pipeline before social media/git-push stages.

---

## References

### Models & Repos

- UltraFace: https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB
- BlazeFace ONNX: https://huggingface.co/garavv/blazeface-onnx
- RetinaFace: https://github.com/biubug6/Pytorch_Retinaface
- MTCNN: https://github.com/ipazc/mtcnn
- YOLO-Face: https://github.com/akanametov/yolo-face
- YuNet: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- TransNetV2: https://github.com/soCzech/TransNetV2
- PySceneDetect: https://www.scenedetect.com/
- pyannote-audio: https://github.com/pyannote/pyannote-audio
- ONNX Runtime: https://onnxruntime.ai/
- onnxruntime-node: https://www.npmjs.com/package/onnxruntime-node

### Papers

- UltraFace/Ultra-Light-Fast-Generic-Face-Detector: Linzaer (2019)
- RetinaFace: Deng et al. — [arXiv:1905.00641](https://arxiv.org/abs/1905.00641)
- MTCNN: Zhang et al. — [arXiv:1604.02878](https://arxiv.org/abs/1604.02878)
- TransNetV2: Souček & Lokoč — [arXiv:2008.04838](https://arxiv.org/abs/2008.04838)
- SlowFast: Feichtenhofer et al. — [arXiv:1812.03982](https://arxiv.org/abs/1812.03982)
- TimeSformer: Bertasius et al. — [arXiv:2102.05095](https://arxiv.org/abs/2102.05095)
- VideoPrism: Zhao et al. — [arXiv:2402.13217](https://arxiv.org/abs/2402.13217)

### Documentation

- ONNX Runtime quantization: https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- ONNX Runtime Node.js: https://onnxruntime.ai/docs/get-started/with-javascript/node.html
- OpenVINO UltraFace spec: https://docs.openvino.ai/2023.3/omz_models_model_ultra_lightweight_face_detection_rfb_320.html
- WIDER FACE benchmark: http://shuoyang1213.me/WIDERFACE/
