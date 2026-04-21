/**
 * Pipeline spec loader.
 *
 * Resolves a spec name or file path into a fully-resolved {@link PipelineSpec}:
 *
 * 1. File path (contains `/`, `\`, or ends in `.yaml`/`.yml`/`.json`) → read & parse
 * 2. Built-in preset name (`full`, `clean`, `minimal`) → return preset directly
 * 3. Convention path `{repoRoot}/pipeline-specs/{name}.yaml` → load if exists
 * 4. Throw with helpful message listing available options
 *
 * This is L1-infra — imports from L0-pure and Node.js builtins only.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, extname } from 'node:path'

import { parse as parseYaml } from 'yaml'

import type { PipelineSpec, PartialPipelineSpec } from '../../L0-pure/pipelineSpec/index.js'
import { isPresetName, getPreset, validateSpec, mergeWithDefaults } from '../../L0-pure/pipelineSpec/index.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isFilePath(nameOrPath: string): boolean {
  return nameOrPath.includes('/') ||
         nameOrPath.includes('\\') ||
         nameOrPath.endsWith('.yaml') ||
         nameOrPath.endsWith('.yml') ||
         nameOrPath.endsWith('.json')
}

function parseFileContent(raw: string, filePath: string): unknown {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.json') {
    return JSON.parse(raw) as unknown
  }
  return parseYaml(raw) as unknown
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

async function listSpecFiles(specsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(specsDir)
    return entries.filter(e => e.endsWith('.yaml') || e.endsWith('.yml') || e.endsWith('.json'))
  } catch {
    return []
  }
}

function validateAndMerge(raw: unknown, source: string): PipelineSpec {
  const errors = validateSpec(raw)
  if (errors.length > 0) {
    const details = errors.map(e => `  - ${e.path ? e.path + ': ' : ''}${e.message}`).join('\n')
    throw new Error(`Invalid pipeline spec from ${source}:\n${details}`)
  }
  return mergeWithDefaults(raw as PartialPipelineSpec)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load and resolve a pipeline spec by name or file path.
 *
 * @param nameOrPath - A preset name (`full`, `clean`, `minimal`), a file path,
 *                     or a short name that maps to `pipeline-specs/{name}.yaml`
 * @param repoRoot   - Absolute path to the repository root (for convention lookups)
 * @returns Fully-resolved PipelineSpec with all defaults filled in
 */
export async function loadSpec(nameOrPath: string, repoRoot: string): Promise<PipelineSpec> {
  // 1. Explicit file path
  if (isFilePath(nameOrPath)) {
    let raw: string
    try {
      raw = await readFile(nameOrPath, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read spec file '${nameOrPath}': ${(err as Error).message}`)
    }
    const parsed = parseFileContent(raw, nameOrPath)
    return validateAndMerge(parsed, nameOrPath)
  }

  // 2. Built-in preset
  if (isPresetName(nameOrPath)) {
    return getPreset(nameOrPath)!
  }

  // 3. Convention: pipeline-specs/{name}.yaml
  const specsDir = join(repoRoot, 'pipeline-specs')
  const conventionPath = join(specsDir, `${nameOrPath}.yaml`)
  if (await fileExists(conventionPath)) {
    const raw = await readFile(conventionPath, 'utf-8')
    const parsed = parseFileContent(raw, conventionPath)
    return validateAndMerge(parsed, conventionPath)
  }

  // 4. Not found — build helpful error
  const availableFiles = await listSpecFiles(specsDir)
  const presetList = ['full', 'clean', 'minimal']
  const parts = [`Unknown spec '${nameOrPath}'.`]
  parts.push(`  Built-in presets: ${presetList.join(', ')}`)
  if (availableFiles.length > 0) {
    const names = availableFiles.map(f => f.replace(/\.(yaml|yml|json)$/, ''))
    parts.push(`  Custom specs in pipeline-specs/: ${names.join(', ')}`)
  } else {
    parts.push(`  No custom specs found in pipeline-specs/`)
  }
  throw new Error(parts.join('\n'))
}
