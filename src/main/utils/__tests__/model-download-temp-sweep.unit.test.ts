import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isOrphanedModelDownload,
  ORPHANED_MODEL_DOWNLOAD_MIN_AGE_MS,
  sweepOrphanedModelDownloads,
} from '../model-download-temp-sweep'

const NOW = 1_800_000_000_000
const CURRENT_PID = 4242
const OLD = NOW - ORPHANED_MODEL_DOWNLOAD_MIN_AGE_MS - 1
const RECENT = NOW - ORPHANED_MODEL_DOWNLOAD_MIN_AGE_MS + 60_000

describe('isOrphanedModelDownload', () => {
  it('matches the Transformers.js download temporary once it is an hour old', () => {
    const name = 'decoder_model_merged.onnx.tmp.76206.l1lcuz'
    expect(isOrphanedModelDownload({ name, modifiedAtMs: OLD }, NOW, CURRENT_PID)).toBe(true)
    expect(isOrphanedModelDownload({ name, modifiedAtMs: RECENT }, NOW, CURRENT_PID)).toBe(false)
  })

  it('keeps a download this process may still be writing, whatever its age', () => {
    const name = `encoder_model.onnx.tmp.${CURRENT_PID}.abc123`
    expect(isOrphanedModelDownload({ name, modifiedAtMs: OLD }, NOW, CURRENT_PID)).toBe(false)
  })

  it.each([
    'decoder_model_merged.onnx',
    'config.json',
    'model.tmp',
    'model.onnx.tmp.',
    'model.onnx.tmp.abc.def',
    'model.onnx.tmp.123.UPPER',
    'model.onnx.tmp.123.abc.json',
  ])('leaves %s alone', (name) => {
    expect(isOrphanedModelDownload({ name, modifiedAtMs: OLD }, NOW, CURRENT_PID)).toBe(false)
  })
})

describe('sweepOrphanedModelDownloads', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-model-sweep-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function file(relative: string, bytes: number, modifiedAtMs: number) {
    const target = path.join(root, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, Buffer.alloc(bytes))
    const seconds = modifiedAtMs / 1000
    await fs.utimes(target, seconds, seconds)
    return target
  }

  it('removes stale temporaries in nested folders and reports the bytes reclaimed', async () => {
    const onnx = 'transformers/Xenova/whisper-base/onnx'
    const orphan = await file(`${onnx}/decoder_model_merged.onnx.tmp.76206.l1lcuz`, 2048, OLD)
    const inProgress = await file(`${onnx}/encoder_model.onnx.tmp.76207.zz9`, 512, RECENT)
    const ownProcess = await file(`${onnx}/tokenizer.json.tmp.${CURRENT_PID}.q1`, 64, OLD)
    const model = await file(`${onnx}/encoder_model.onnx`, 128, OLD)

    const result = await sweepOrphanedModelDownloads(root, NOW, CURRENT_PID)

    expect(result).toEqual({ removedFiles: 1, removedBytes: 2048 })
    await expect(fs.stat(orphan)).rejects.toThrow()
    for (const kept of [inProgress, ownProcess, model])
      await expect(fs.stat(kept)).resolves.toBeTruthy()
  })

  it('never follows a symbolic link out of the models folder', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-model-sweep-outside-'))
    try {
      const target = path.join(outside, 'weights.onnx.tmp.1.a')
      await fs.writeFile(target, 'x')
      const seconds = OLD / 1000
      await fs.utimes(target, seconds, seconds)
      await fs.symlink(outside, path.join(root, 'linked'))
      await fs.symlink(target, path.join(root, 'link.onnx.tmp.2.b'))

      expect(await sweepOrphanedModelDownloads(root, NOW, CURRENT_PID)).toEqual({
        removedFiles: 0,
        removedBytes: 0,
      })
      await expect(fs.stat(target)).resolves.toBeTruthy()
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('treats a missing models folder as nothing to sweep', async () => {
    expect(await sweepOrphanedModelDownloads(path.join(root, 'absent'), NOW)).toEqual({
      removedFiles: 0,
      removedBytes: 0,
    })
  })
})
