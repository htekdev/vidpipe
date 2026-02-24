/**
 * Unit tests for the TextAsset class.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TextAsset } from '../../../L5-assets/TextAsset.js'
import { AssetOptions } from '../../../L5-assets/Asset.js'
import * as fileSystem from '../../../L1-infra/fileSystem/fileSystem.js'

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  removeFile: vi.fn(),
}))

/**
 * Concrete implementation of TextAsset for testing.
 */
class TestTextAsset extends TextAsset {
  readonly filePath: string
  private _generateContent: string

  constructor(filePath: string, generateContent: string = 'generated content') {
    super()
    this.filePath = filePath
    this._generateContent = generateContent
  }

  async getResult(opts?: AssetOptions): Promise<string> {
    if (!opts?.force) {
      const existing = await this.loadFromDisk()
      if (existing !== null) {
        return existing
      }
    }
    // Simulate generation
    await this.saveToDisk(this._generateContent)
    return this._generateContent
  }
}

describe('TextAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('exists()', () => {
    it('returns true when file exists on disk', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const asset = new TestTextAsset('/path/to/file.txt')
      const result = await asset.exists()

      expect(result).toBe(true)
      expect(fileSystem.fileExists).toHaveBeenCalledWith('/path/to/file.txt')
    })

    it('returns false when file does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      const asset = new TestTextAsset('/path/to/file.txt')
      const result = await asset.exists()

      expect(result).toBe(false)
    })
  })

  describe('filePath', () => {
    it('returns the configured file path', () => {
      const asset = new TestTextAsset('/custom/path/content.md')
      expect(asset.filePath).toBe('/custom/path/content.md')
    })
  })

  describe('getContent()', () => {
    it('returns content from getResult', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readTextFile).mockResolvedValue('disk content')

      const asset = new TestTextAsset('/path/to/file.txt')
      const content = await asset.getContent()

      expect(content).toBe('disk content')
    })
  })

  describe('loadFromDisk()', () => {
    it('returns file content when file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readTextFile).mockResolvedValue('file content')

      const asset = new TestTextAsset('/path/to/file.txt')
      const result = await asset.getResult()

      expect(result).toBe('file content')
      expect(fileSystem.readTextFile).toHaveBeenCalledWith('/path/to/file.txt')
    })

    it('generates content when file does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      const asset = new TestTextAsset('/path/to/file.txt', 'new content')
      const result = await asset.getResult()

      expect(result).toBe('new content')
      expect(fileSystem.writeTextFile).toHaveBeenCalledWith('/path/to/file.txt', 'new content')
    })
  })

  describe('saveToDisk()', () => {
    it('writes content to disk when generating', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      const asset = new TestTextAsset('/output/file.md', 'generated text')
      await asset.getResult()

      expect(fileSystem.writeTextFile).toHaveBeenCalledWith('/output/file.md', 'generated text')
    })
  })

  describe('force option', () => {
    it('regenerates when force is true even if file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readTextFile).mockResolvedValue('old content')

      const asset = new TestTextAsset('/path/to/file.txt', 'forced content')
      const result = await asset.getResult({ force: true })

      expect(result).toBe('forced content')
      expect(fileSystem.writeTextFile).toHaveBeenCalledWith('/path/to/file.txt', 'forced content')
    })
  })
})
