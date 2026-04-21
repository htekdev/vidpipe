import { vi, describe, test, expect, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockReaddir = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  readdir: mockReaddir,
}))

import { loadSpec } from '../../../L1-infra/spec/specLoader.js'
import {
  PRESET_FULL,
  PRESET_CLEAN,
  PRESET_MINIMAL,
} from '../../../L0-pure/pipelineSpec/index.js'

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── Built-in preset resolution ──────────────────────────────────────────────

describe('built-in preset resolution', () => {
  test('loadSpec("full") returns PRESET_FULL', async () => {
    const spec = await loadSpec('full', '/repo')
    expect(spec).toEqual(PRESET_FULL)
  })

  test('loadSpec("clean") returns PRESET_CLEAN', async () => {
    const spec = await loadSpec('clean', '/repo')
    expect(spec).toEqual(PRESET_CLEAN)
  })

  test('loadSpec("minimal") returns PRESET_MINIMAL', async () => {
    const spec = await loadSpec('minimal', '/repo')
    expect(spec).toEqual(PRESET_MINIMAL)
  })

  test('preset resolution does not touch the file system', async () => {
    await loadSpec('full', '/repo')
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockReaddir).not.toHaveBeenCalled()
  })
})

// ─── File path detection ─────────────────────────────────────────────────────

describe('file path detection', () => {
  const validYaml = `
name: custom
processing:
  silenceRemoval: true
`

  test('forward-slash path is treated as file path', async () => {
    mockReadFile.mockResolvedValue(validYaml)
    await loadSpec('/some/dir/spec.yaml', '/repo')
    expect(mockReadFile).toHaveBeenCalledWith('/some/dir/spec.yaml', 'utf-8')
  })

  test('backslash path is treated as file path', async () => {
    mockReadFile.mockResolvedValue(validYaml)
    await loadSpec('C:\\specs\\my.yaml', '/repo')
    expect(mockReadFile).toHaveBeenCalledWith('C:\\specs\\my.yaml', 'utf-8')
  })

  test('.yaml extension is treated as file path', async () => {
    mockReadFile.mockResolvedValue(validYaml)
    await loadSpec('my-spec.yaml', '/repo')
    expect(mockReadFile).toHaveBeenCalledWith('my-spec.yaml', 'utf-8')
  })

  test('.yml extension is treated as file path', async () => {
    mockReadFile.mockResolvedValue(validYaml)
    await loadSpec('my-spec.yml', '/repo')
    expect(mockReadFile).toHaveBeenCalledWith('my-spec.yml', 'utf-8')
  })

  test('.json extension is treated as file path', async () => {
    mockReadFile.mockResolvedValue('{"name":"custom"}')
    await loadSpec('my-spec.json', '/repo')
    expect(mockReadFile).toHaveBeenCalledWith('my-spec.json', 'utf-8')
  })
})

// ─── YAML file loading ──────────────────────────────────────────────────────

describe('YAML file loading', () => {
  test('parses YAML content and returns merged spec', async () => {
    const yamlContent = `
name: my-custom
description: A custom spec
processing:
  silenceRemoval: false
clips:
  shorts:
    enabled: false
`
    mockReadFile.mockResolvedValue(yamlContent)

    const spec = await loadSpec('/specs/custom.yaml', '/repo')

    expect(spec.name).toBe('my-custom')
    expect(spec.description).toBe('A custom spec')
    expect(spec.processing.silenceRemoval).toBe(false)
    expect(spec.clips.shorts.enabled).toBe(false)
    // defaults from PRESET_FULL for unspecified fields
    expect(spec.processing.captions).toBe(PRESET_FULL.processing.captions)
    expect(spec.clips.medium.enabled).toBe(PRESET_FULL.clips.medium.enabled)
  })
})

// ─── JSON file loading ──────────────────────────────────────────────────────

describe('JSON file loading', () => {
  test('parses JSON content and returns merged spec', async () => {
    const jsonContent = JSON.stringify({
      name: 'json-spec',
      content: { blog: false },
    })
    mockReadFile.mockResolvedValue(jsonContent)

    const spec = await loadSpec('/specs/custom.json', '/repo')

    expect(spec.name).toBe('json-spec')
    expect(spec.content.blog).toBe(false)
    // defaults filled in
    expect(spec.content.chapters).toBe(PRESET_FULL.content.chapters)
    expect(spec.content.summary).toBe(PRESET_FULL.content.summary)
  })
})

// ─── Convention path resolution ─────────────────────────────────────────────

describe('convention path resolution', () => {
  test('checks {repoRoot}/pipeline-specs/{name}.yaml', async () => {
    const yamlContent = `
name: my-spec
distribution:
  enabled: false
`
    // First readFile call: fileExists check (convention path)
    // Second readFile call: actual read of the file
    mockReadFile.mockResolvedValue(yamlContent)

    const spec = await loadSpec('my-spec', '/repo')

    // fileExists calls readFile without 'utf-8', then actual read uses 'utf-8'
    const expectedPath = expect.stringContaining('pipeline-specs')
    expect(mockReadFile).toHaveBeenCalledWith(expectedPath)
    expect(mockReadFile).toHaveBeenCalledWith(expectedPath, 'utf-8')
    expect(spec.name).toBe('my-spec')
    expect(spec.distribution.enabled).toBe(false)
  })

  test('convention path joins repoRoot with pipeline-specs and name', async () => {
    const yamlContent = 'name: test-conv'
    mockReadFile.mockResolvedValue(yamlContent)

    await loadSpec('test-conv', '/my/repo')

    // The fileExists check reads the convention path
    const calls = mockReadFile.mock.calls
    const conventionCall = calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('test-conv.yaml')
    )
    expect(conventionCall).toBeDefined()
    expect(conventionCall![0]).toMatch(/pipeline-specs[/\\]test-conv\.yaml$/)
  })
})

// ─── Validation errors ──────────────────────────────────────────────────────

describe('validation errors', () => {
  test('invalid strategy value throws with error details', async () => {
    const yamlContent = `
clips:
  shorts:
    strategy: invalid-strategy
`
    mockReadFile.mockResolvedValue(yamlContent)

    await expect(loadSpec('/specs/bad.yaml', '/repo')).rejects.toThrow(
      /Invalid pipeline spec/
    )
    await expect(loadSpec('/specs/bad.yaml', '/repo')).rejects.toThrow(
      /clips\.shorts\.strategy/
    )
  })

  test('invalid minViralScore throws with error details', async () => {
    const yamlContent = `
clips:
  medium:
    minViralScore: 999
`
    mockReadFile.mockResolvedValue(yamlContent)

    await expect(loadSpec('/specs/bad.yaml', '/repo')).rejects.toThrow(
      /clips\.medium\.minViralScore/
    )
  })

  test('non-boolean processing field throws', async () => {
    const yamlContent = `
processing:
  silenceRemoval: "yes"
`
    mockReadFile.mockResolvedValue(yamlContent)

    await expect(loadSpec('/specs/bad.yaml', '/repo')).rejects.toThrow(
      /processing\.silenceRemoval.*must be a boolean/
    )
  })

  test('unknown platform throws with error details', async () => {
    const yamlContent = `
distribution:
  platforms:
    targets:
      - facebook
`
    mockReadFile.mockResolvedValue(yamlContent)

    await expect(loadSpec('/specs/bad.yaml', '/repo')).rejects.toThrow(
      /unknown platform 'facebook'/
    )
  })

  test('error message includes source path', async () => {
    const yamlContent = `
clips:
  shorts:
    strategy: nope
`
    mockReadFile.mockResolvedValue(yamlContent)

    await expect(loadSpec('/my/spec.yaml', '/repo')).rejects.toThrow(
      '/my/spec.yaml'
    )
  })
})

// ─── File not found ─────────────────────────────────────────────────────────

describe('file not found', () => {
  test('explicit file path throws on read failure', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT: no such file or directory'))

    await expect(loadSpec('/missing/spec.yaml', '/repo')).rejects.toThrow(
      /Failed to read spec file/
    )
    await expect(loadSpec('/missing/spec.yaml', '/repo')).rejects.toThrow(
      'ENOENT'
    )
  })

  test('unknown name throws with available presets', async () => {
    // fileExists rejects (convention path not found)
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    // readdir returns empty (no custom specs)
    mockReaddir.mockRejectedValue(new Error('ENOENT'))

    await expect(loadSpec('nonexistent', '/repo')).rejects.toThrow(
      /Unknown spec 'nonexistent'/
    )
    await expect(loadSpec('nonexistent', '/repo')).rejects.toThrow(
      /full, clean, minimal/
    )
  })

  test('unknown name lists available custom spec files', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockReaddir.mockResolvedValue(['dev.yaml', 'staging.yml', 'prod.json', 'readme.txt'])

    await expect(loadSpec('nonexistent', '/repo')).rejects.toThrow(
      /Custom specs.*dev, staging, prod/
    )
  })

  test('unknown name shows "no custom specs" when directory is empty', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockReaddir.mockResolvedValue([])

    await expect(loadSpec('nonexistent', '/repo')).rejects.toThrow(
      /No custom specs found/
    )
  })
})

// ─── Partial spec merge with defaults ────────────────────────────────────────

describe('partial spec merge with defaults', () => {
  test('YAML with only name gets all defaults from PRESET_FULL', async () => {
    mockReadFile.mockResolvedValue('name: sparse')

    const spec = await loadSpec('/specs/sparse.yaml', '/repo')

    expect(spec.name).toBe('sparse')
    expect(spec.description).toBe(PRESET_FULL.description)
    expect(spec.processing).toEqual(PRESET_FULL.processing)
    expect(spec.clips).toEqual(PRESET_FULL.clips)
    expect(spec.content).toEqual(PRESET_FULL.content)
    expect(spec.distribution).toEqual(PRESET_FULL.distribution)
  })

  test('partial processing fields merge with full defaults', async () => {
    const yamlContent = `
processing:
  captions: false
`
    mockReadFile.mockResolvedValue(yamlContent)

    const spec = await loadSpec('/specs/partial.yaml', '/repo')

    expect(spec.processing.captions).toBe(false)
    expect(spec.processing.silenceRemoval).toBe(PRESET_FULL.processing.silenceRemoval)
    expect(spec.processing.visualEnhancement).toBe(PRESET_FULL.processing.visualEnhancement)
    expect(spec.processing.introOutro).toBe(PRESET_FULL.processing.introOutro)
  })

  test('partial clips config merges with full defaults', async () => {
    const yamlContent = `
clips:
  shorts:
    maxClips: 2
`
    mockReadFile.mockResolvedValue(yamlContent)

    const spec = await loadSpec('/specs/partial.yaml', '/repo')

    expect(spec.clips.shorts.maxClips).toBe(2)
    expect(spec.clips.shorts.enabled).toBe(PRESET_FULL.clips.shorts.enabled)
    expect(spec.clips.shorts.strategy).toBe(PRESET_FULL.clips.shorts.strategy)
    expect(spec.clips.medium).toEqual(PRESET_FULL.clips.medium)
  })

  test('partial distribution config merges with full defaults', async () => {
    const yamlContent = `
distribution:
  platforms:
    toneStrategy: unified
`
    mockReadFile.mockResolvedValue(yamlContent)

    const spec = await loadSpec('/specs/partial.yaml', '/repo')

    expect(spec.distribution.platforms.toneStrategy).toBe('unified')
    expect(spec.distribution.enabled).toBe(PRESET_FULL.distribution.enabled)
    expect(spec.distribution.platforms.targets).toEqual(PRESET_FULL.distribution.platforms.targets)
    expect(spec.distribution.platforms.variants).toBe(PRESET_FULL.distribution.platforms.variants)
  })
})
