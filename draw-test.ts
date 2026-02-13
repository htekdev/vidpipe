import { drawRegions } from './src/tools/agentTools.js'
const result = await drawRegions(
  'C:\\Users\\floreshector\\AppData\\Local\\Temp\\annotated-34b5adf7-158f-4310-a64e-02869aa4b2ba.jpg',
  [
    { x: 0, y: 0, width: 850, height: 980, label: 'Screen-CORRECT' },
    { x: 860, y: 620, width: 450, height: 280, label: 'Webcam-CORRECT', color: 'cyan' }
  ]
)
console.log('Saved:', result.imagePath)
