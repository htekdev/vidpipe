# Screen Object Detection with YOLOv8 + ONNX Runtime in Node.js

This document covers how to consume the exported `yolov8s.onnx` model in the vidpipe Node.js/TypeScript codebase to perform rich object detection on screen captures.

## Model Location

```
assets/models/yolov8s.onnx
```

- **Architecture**: YOLOv8s (Small)
- **Input**: `(1, 3, 640, 640)` — 1 image, RGB, 640×640 pixels
- **Output**: `(1, 84, 8400)` — 8400 candidate detections × (4 bbox coords + 80 COCO class scores)
- **Size**: ~43 MB

## Dependencies

```bash
npm install onnxruntime-node sharp
```

| Package | Purpose |
|---|---|
| `onnxruntime-node` | Run ONNX model inference on CPU (or GPU with `onnxruntime-node-gpu`) |
| `sharp` | Resize/preprocess screen captures to 640×640 RGB tensor |

## Implementation Steps

### 1. Load the ONNX Session

Create a singleton session to avoid reloading the model on every frame.

```typescript
import * as ort from 'onnxruntime-node';
import path from 'path';

let session: ort.InferenceSession | null = null;

export async function getSession(): Promise<ort.InferenceSession> {
  if (!session) {
    const modelPath = path.resolve(__dirname, '../assets/models/yolov8s.onnx');
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'], // use 'cuda' for GPU
    });
  }
  return session;
}
```

### 2. Preprocess the Screen Capture

YOLOv8 expects a `float32` tensor of shape `[1, 3, 640, 640]` with pixel values normalized to `[0, 1]`.

```typescript
import sharp from 'sharp';

export interface PreprocessResult {
  tensor: Float32Array;
  originalWidth: number;
  originalHeight: number;
}

export async function preprocessImage(imageBuffer: Buffer): Promise<PreprocessResult> {
  const metadata = await sharp(imageBuffer).metadata();
  const originalWidth = metadata.width!;
  const originalHeight = metadata.height!;

  // Resize to 640x640, get raw RGB pixels
  const { data } = await sharp(imageBuffer)
    .resize(640, 640, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert HWC (height, width, channels) → CHW (channels, height, width)
  // and normalize pixel values from [0, 255] → [0, 1]
  const float32 = new Float32Array(3 * 640 * 640);
  for (let i = 0; i < 640 * 640; i++) {
    float32[i] = data[i * 3] / 255.0;                // R
    float32[640 * 640 + i] = data[i * 3 + 1] / 255.0; // G
    float32[2 * 640 * 640 + i] = data[i * 3 + 2] / 255.0; // B
  }

  return { tensor: float32, originalWidth, originalHeight };
}
```

### 3. Run Inference

```typescript
export interface Detection {
  classId: number;
  className: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export async function detect(imageBuffer: Buffer): Promise<Detection[]> {
  const session = await getSession();
  const { tensor, originalWidth, originalHeight } = await preprocessImage(imageBuffer);

  const input = new ort.Tensor('float32', tensor, [1, 3, 640, 640]);
  const results = await session.run({ images: input });

  const output = results['output0']; // shape: [1, 84, 8400]
  const data = output.data as Float32Array;

  return postprocess(data, originalWidth, originalHeight);
}
```

### 4. Post-Process Results

YOLOv8 output is `[1, 84, 8400]` where each of the 8400 columns is a detection candidate:
- Rows 0–3: `cx, cy, w, h` (center-x, center-y, width, height) in 640×640 space
- Rows 4–83: confidence scores for 80 COCO classes

```typescript
const CONFIDENCE_THRESHOLD = 0.5;
const IOU_THRESHOLD = 0.45;

function postprocess(
  data: Float32Array,
  originalWidth: number,
  originalHeight: number
): Detection[] {
  const numDetections = 8400;
  const numClasses = 80;
  const candidates: Detection[] = [];

  for (let i = 0; i < numDetections; i++) {
    // Find best class score for this detection
    let maxScore = 0;
    let classId = 0;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numDetections + i];
      if (score > maxScore) {
        maxScore = score;
        classId = c;
      }
    }

    if (maxScore < CONFIDENCE_THRESHOLD) continue;

    // Extract bbox (center format → corner format)
    const cx = data[0 * numDetections + i];
    const cy = data[1 * numDetections + i];
    const w = data[2 * numDetections + i];
    const h = data[3 * numDetections + i];

    // Scale from 640×640 back to original image dimensions
    const scaleX = originalWidth / 640;
    const scaleY = originalHeight / 640;

    candidates.push({
      classId,
      className: COCO_CLASSES[classId],
      confidence: maxScore,
      bbox: {
        x: (cx - w / 2) * scaleX,
        y: (cy - h / 2) * scaleY,
        width: w * scaleX,
        height: h * scaleY,
      },
    });
  }

  return nms(candidates, IOU_THRESHOLD);
}
```

### 5. Non-Maximum Suppression (NMS)

YOLOv8 ONNX export does not include NMS, so we apply it in post-processing to remove duplicate/overlapping boxes.

```typescript
function nms(detections: Detection[], iouThreshold: number): Detection[] {
  // Sort by confidence descending
  detections.sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];

  while (detections.length > 0) {
    const best = detections.shift()!;
    kept.push(best);
    detections = detections.filter(
      (d) => d.classId !== best.classId || iou(best.bbox, d.bbox) < iouThreshold
    );
  }

  return kept;
}

function iou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return intersection / union;
}
```

### 6. COCO Class Labels

The model detects 80 COCO object classes. Define them for human-readable output:

```typescript
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush',
];
```

## Full Usage Example

```typescript
import { readFileSync } from 'fs';
import { detect } from './screen-detector';

// Capture or load a screenshot
const screenshot = readFileSync('screen-capture.png');

const detections = await detect(screenshot);

for (const d of detections) {
  console.log(
    `${d.className} (${(d.confidence * 100).toFixed(1)}%) at [${d.bbox.x.toFixed(0)}, ${d.bbox.y.toFixed(0)}, ${d.bbox.width.toFixed(0)}×${d.bbox.height.toFixed(0)}]`
  );
}

// Example output:
// laptop (92.3%) at [120, 45, 480×320]
// keyboard (87.1%) at [100, 400, 520×120]
// mouse (78.5%) at [650, 450, 40×30]
// cup (71.2%) at [700, 200, 60×80]
```

## Performance Considerations

| Concern | Recommendation |
|---|---|
| **Startup** | Load session once at init, reuse across frames |
| **Resize quality** | Use `fit: 'contain'` with letterboxing for accurate aspect ratio (requires adjusting bbox scaling) |
| **Throughput** | CPU inference ~50–150ms/frame; use `onnxruntime-node-gpu` + CUDA for <10ms |
| **Memory** | Model uses ~100MB RAM at runtime |
| **Batch** | Process multiple frames by changing input shape to `[N, 3, 640, 640]` |

## Screen-Specific Tips

- **Screen captures are not natural images** — COCO-pretrained YOLO detects real-world objects (laptop, keyboard, monitor, person). For GUI elements (buttons, text fields), consider fine-tuning on a UI dataset or using a secondary model like Grounding DINO.
- **High resolution screens** — capture at native resolution, then let `sharp` resize. The bbox coordinates are scaled back to original dimensions.
- **Letterbox preprocessing** — for more accurate detections, use `fit: 'contain'` (adds padding) instead of `fit: 'fill'` (stretches), and adjust the coordinate scaling accordingly.

## Next Steps

- [ ] Create `src/screen-detector.ts` module with the above logic
- [ ] Add integration test with a sample screenshot
- [ ] Evaluate whether COCO classes are sufficient or if fine-tuning / a GUI-specific model is needed
- [ ] Consider adding Grounding DINO for open-vocabulary detection (find elements by text prompt)
