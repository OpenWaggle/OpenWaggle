import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareConfigs } from '../compare'

let root = ''
const written = new Set<string>()

const SOURCES = [
  'src/a.ts',
  'scripts/b.ts',
  'tools/c.ts',
  'packages/p/src/index.ts',
  'packages/p/dist/index.ts',
]

function write(file: string, text: string) {
  written.add(file)
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2)
}

const ROOT = json({ files: [], references: [{ path: './tsconfig.node.json' }] })
const NODE = {
  compilerOptions: { strict: true, noUnusedLocals: true, composite: true },
  include: ['src/**/*', 'scripts/**/*', 'packages/**/*'],
}

/** Compares `before` (path to text) with the configs written to disk now. */
async function compare(before: Record<string, string>) {
  const result = await compareConfigs({
    root,
    listing: [...written].join('\0'),
    extraConfigs: Object.keys(before),
    before: (file) => Promise.resolve(before[file]),
    after: (file) => {
      try {
        return Promise.resolve(readFileSync(path.join(root, file), 'utf8'))
      } catch {
        return Promise.resolve(undefined)
      }
    },
  })
  return result.weakening
}

const BEFORE = { 'tsconfig.json': ROOT, 'tsconfig.node.json': json(NODE) }

beforeEach(() => {
  written.clear()
  root = mkdtempSync(path.join(tmpdir(), 'tsconfig-strictness-'))
  for (const file of SOURCES) write(file, 'export const value = 1\n')
  write('tsconfig.json', ROOT)
  write('tsconfig.node.json', json(NODE))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('tsconfig strictness by effect', () => {
  it('passes a move of scripts/ into a new stricter project', async () => {
    write('tsconfig.node.json', json({ ...NODE, include: ['src/**/*', 'packages/**/*'] }))
    write(
      'tsconfig.scripts.json',
      json({
        extends: './tsconfig.node.json',
        compilerOptions: { noUncheckedIndexedAccess: true },
        include: ['scripts/**/*'],
      }),
    )
    write(
      'tsconfig.json',
      json({
        files: [],
        references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.scripts.json' }],
      }),
    )
    expect(await compare(BEFORE)).toEqual({ droppedFiles: [], droppedFlags: [] })
  })

  it('passes a new project reference', async () => {
    write('tools/tsconfig.json', json({ compilerOptions: { strict: true }, include: ['*.ts'] }))
    write(
      'tsconfig.json',
      json({ files: [], references: [{ path: './tsconfig.node.json' }, { path: './tools' }] }),
    )
    expect(await compare(BEFORE)).toEqual({ droppedFiles: [], droppedFlags: [] })
  })

  it('passes excluding build outputs', async () => {
    write('tsconfig.node.json', json({ ...NODE, exclude: ['packages/*/dist'] }))
    expect(await compare(BEFORE)).toEqual({ droppedFiles: [], droppedFlags: [] })
  })

  it('blocks a source file that no project checks any more', async () => {
    write('tsconfig.node.json', json({ ...NODE, include: ['src/**/*', 'packages/**/*'] }))
    expect(await compare(BEFORE)).toEqual({ droppedFiles: ['scripts/b.ts'], droppedFlags: [] })
  })

  it('blocks a strictness flag turned off', async () => {
    write(
      'tsconfig.node.json',
      json({ ...NODE, compilerOptions: { strict: true, composite: true } }),
    )
    const change = await compare(BEFORE)
    expect(change.droppedFiles).toEqual([])
    expect(change.droppedFlags).toEqual([
      {
        flag: 'noUnusedLocals',
        files: ['packages/p/src/index.ts', 'scripts/b.ts', 'src/a.ts'],
      },
    ])
  })

  it('blocks extending a weaker base, and skipLibCheck turned on', async () => {
    const strictBase = json({ compilerOptions: { strict: true, noUncheckedIndexedAccess: true } })
    const looseBase = json({ compilerOptions: { strict: true, skipLibCheck: true } })
    const extending = json({ extends: './tsconfig.base.json', include: ['src/**/*'] })
    write('tsconfig.base.json', looseBase)
    write('tsconfig.node.json', extending)
    const change = await compare({
      'tsconfig.json': ROOT,
      'tsconfig.node.json': extending,
      'tsconfig.base.json': strictBase,
    })
    expect(change.droppedFlags.map((dropped) => dropped.flag)).toEqual([
      'noUncheckedIndexedAccess',
      'skipLibCheck',
    ])
  })

  it('treats narrower types and lib as no weakening', async () => {
    write(
      'tsconfig.node.json',
      json({ ...NODE, compilerOptions: { ...NODE.compilerOptions, types: [], lib: ['ES2022'] } }),
    )
    expect(await compare(BEFORE)).toEqual({ droppedFiles: [], droppedFlags: [] })
  })
})
