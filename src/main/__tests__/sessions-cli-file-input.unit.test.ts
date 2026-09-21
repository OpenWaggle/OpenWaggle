import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SESSION_INPUT_LIMITS } from '@shared/session-input-limits'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import {
  type CliInputFileSystem,
  readUtf8File,
  resolveSessionsCliMessageInput,
} from '../sessions-cli-message-input'

describe('Sessions CLI file input', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cli-file-input-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('rejects oversized and non-regular files before reading their contents', async () => {
    const oversizedPath = path.join(root, 'oversized.txt')
    await fs.writeFile(oversizedPath, '')
    await fs.truncate(oversizedPath, SESSION_INPUT_LIMITS.persistedTextBytes + 1)

    await expect(
      resolveSessionsCliMessageInput(
        'message',
        parseMcpCliArguments(['session-1', '--input-file', oversizedPath]),
      ),
    ).rejects.toThrow('exceeds 16 MiB')
    await expect(
      resolveSessionsCliMessageInput(
        'message',
        parseMcpCliArguments(['session-1', '--input-file', root]),
      ),
    ).rejects.toThrow('regular file')
  })

  it('reads until EOF when the filesystem returns short regular-file reads', async () => {
    const inputPath = path.join(root, 'prompt.txt')
    const input = 'read every byte despite short reads'
    await fs.writeFile(inputPath, input)
    const shortReadFileSystem: CliInputFileSystem = {
      lstat: (filePath) => fs.lstat(filePath),
      open: async (filePath, flags) => {
        const handle = await fs.open(filePath, flags)
        return {
          close: () => handle.close(),
          stat: () => handle.stat(),
          read: (buffer, offset, length, position) =>
            handle.read(buffer, offset, Math.min(length, 3), position),
        }
      },
    }

    await expect(readUtf8File(inputPath, shortReadFileSystem)).resolves.toBe(input)
  })

  it('rejects a regular file that changes while it is being read', async () => {
    const inputPath = path.join(root, 'prompt.txt')
    await fs.writeFile(inputPath, 'initial')
    let changed = false
    const growingFileSystem: CliInputFileSystem = {
      lstat: (filePath) => fs.lstat(filePath),
      open: async (filePath, flags) => {
        const handle = await fs.open(filePath, flags)
        return {
          close: () => handle.close(),
          stat: () => handle.stat(),
          read: async (buffer, offset, length, position) => {
            if (!changed) {
              changed = true
              await fs.appendFile(inputPath, ' growth')
            }
            return handle.read(buffer, offset, length, position)
          },
        }
      },
    }

    await expect(readUtf8File(inputPath, growingFileSystem)).rejects.toThrow(
      'changed while it was being read',
    )
  })
})
