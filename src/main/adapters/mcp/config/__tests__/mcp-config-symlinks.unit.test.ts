import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeMcpMigrationFs } from '../../migration/migration-fs'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'
import { realLocation } from '../mcp-config-files'
import { addMcpServerEntry } from '../mcp-config-writer'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-symlink-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A dotfiles setup: ~/.pi/agent/mcp.json is a link into a dotfiles repository. */
function linkedFile() {
  const real = path.join(root, 'dotfiles', 'mcp.json')
  const link = path.join(root, 'home', '.pi', 'agent', 'mcp.json')
  mkdirSync(path.dirname(real), { recursive: true })
  mkdirSync(path.dirname(link), { recursive: true })
  writeFileSync(real, '{"mcpServers":{}}\n')
  symlinkSync(real, link)
  return { real, link }
}

describe.skipIf(process.platform === 'win32')('MCP files that are symbolic links', () => {
  it('are edited through the link: the link stays and the file it points to changes', () => {
    const { real, link } = linkedFile()

    addMcpServerEntry(link, 'fs', { command: 'fs-mcp' })

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(JSON.parse(readFileSync(real, 'utf8'))).toEqual({
      mcpServers: { fs: { command: 'fs-mcp' } },
    })
  })

  it('are rewritten by the migration through the link too', async () => {
    const { real, link } = linkedFile()

    await nodeMcpMigrationFs.writeTextAtomic(link, '{"mcpServers":{"a":{"command":"a"}}}\n')

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(real, 'utf8')).toBe('{"mcpServers":{"a":{"command":"a"}}}\n')
  })

  it('read a link to a missing file as unreadable, so its overrides are never orphans', async () => {
    const home = path.join(root, 'home')
    const global = path.join(home, '.openwaggle', 'mcp.json')
    const project = path.join(root, 'project')
    mkdirSync(path.dirname(global), { recursive: true })
    // The dotfiles checkout is not mounted right now.
    symlinkSync(path.join(root, 'dotfiles', 'gone.json'), global)
    mkdirSync(path.join(project, '.openwaggle'), { recursive: true })
    writeFileSync(
      path.join(project, '.openwaggle', 'mcp.json'),
      '{"mcpServers":{"docs":{"enabled":false}}}\n',
    )
    const service = createFilesystemMcpConfigurationService({
      homeDir: home,
      piAgentDir: path.join(home, '.pi', 'agent'),
    })

    const view = await Effect.runPromise(service.getView({ projectPath: project }))

    expect(view.errors).toEqual([`${global}: links to a missing file`])
    expect(view.orphanedOverrides).toBeUndefined()
    expect(view.files.find((file) => file.fileId === 'openwaggle-global')?.exists).toBe(true)
  })

  it('read a file under a linked folder that is missing as unreadable, not as missing', async () => {
    const home = path.join(root, 'home')
    const globalFolder = path.join(home, '.openwaggle')
    const project = path.join(root, 'project')
    mkdirSync(home, { recursive: true })
    // The folder is the link, and its target, a dotfiles checkout, is not mounted.
    symlinkSync(path.join(root, 'dotfiles', 'openwaggle'), globalFolder)
    mkdirSync(path.join(project, '.openwaggle'), { recursive: true })
    writeFileSync(
      path.join(project, '.openwaggle', 'mcp.json'),
      '{"mcpServers":{"docs":{"enabled":false}}}\n',
    )
    const service = createFilesystemMcpConfigurationService({
      homeDir: home,
      piAgentDir: path.join(home, '.pi', 'agent'),
    })

    const view = await Effect.runPromise(service.getView({ projectPath: project }))

    expect(view.errors).toContain(
      `${path.join(globalFolder, 'mcp.json')}: ${globalFolder} links to a missing folder`,
    )
    expect(view.orphanedOverrides).toBeUndefined()
  })

  it('still reads a file missing under a linked folder that exists as missing', async () => {
    const home = path.join(root, 'home')
    const project = path.join(root, 'project')
    mkdirSync(path.join(root, 'dotfiles', 'openwaggle'), { recursive: true })
    mkdirSync(home, { recursive: true })
    symlinkSync(path.join(root, 'dotfiles', 'openwaggle'), path.join(home, '.openwaggle'))
    mkdirSync(project, { recursive: true })
    const service = createFilesystemMcpConfigurationService({
      homeDir: home,
      piAgentDir: path.join(home, '.pi', 'agent'),
    })

    const view = await Effect.runPromise(service.getView({ projectPath: project }))

    expect(view.errors).toEqual([])
  })

  it('refuse an edit through a link whose target is missing, creating nothing', () => {
    const target = path.join(root, 'Volumes', 'Dotfiles', 'openwaggle', 'mcp.json')
    const link = path.join(root, 'home', '.openwaggle', 'mcp.json')
    mkdirSync(path.dirname(link), { recursive: true })
    symlinkSync(target, link)

    expect(() => addMcpServerEntry(link, 'new', { command: 'x' })).toThrow(
      `${link}: links to a missing file`,
    )
    expect(existsSync(path.join(root, 'Volumes'))).toBe(false)
  })

  it('refuse an edit under a linked folder whose target is missing', () => {
    const folder = path.join(root, 'home', '.openwaggle')
    mkdirSync(path.dirname(folder), { recursive: true })
    symlinkSync(path.join(root, 'Volumes', 'Dotfiles', 'openwaggle'), folder)

    expect(() => addMcpServerEntry(path.join(folder, 'mcp.json'), 'new', { command: 'x' })).toThrow(
      `${folder} links to a missing folder`,
    )
    expect(existsSync(path.join(root, 'Volumes'))).toBe(false)
  })

  it('agree on where two spellings lead, below folders that do not exist yet', () => {
    const real = path.join(root, 'real')
    mkdirSync(real)
    symlinkSync(real, path.join(root, 'linked'))
    const tail = path.join('.openwaggle', 'mcp.json')

    expect(realLocation(path.join(root, 'linked', tail))).toBe(realLocation(path.join(real, tail)))
    expect(realLocation(path.join(root, 'linked', tail))).toBe(
      path.join(realpathSync.native(real), tail),
    )
  })

  it('agree on where two spellings lead that differ only in case, where case does not matter', (context) => {
    const real = path.join(root, 'real', 'proj')
    mkdirSync(real, { recursive: true })
    // Only on a file system that ignores case (macOS and Windows by default).
    if (!existsSync(path.join(root, 'REAL', 'PROJ'))) context.skip()
    const tail = path.join('.openwaggle', 'mcp.json')

    expect(realLocation(path.join(root, 'Real', 'Proj', tail))).toBe(
      realLocation(path.join(real, tail)),
    )
  })
})
