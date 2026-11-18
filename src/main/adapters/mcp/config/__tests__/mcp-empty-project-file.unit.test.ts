import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'
import { mcpConfigFileLocations } from '../mcp-config-files'
import { removeEmptyOpenWaggleProjectFile } from '../mcp-empty-project-file'

/**
 * A change that leaves OpenWaggle's project file with nothing in it removes the file, so turning a
 * switch off and on again leaves the checkout as it was. Pi's, shared, and global files stay.
 */

let root: string
let homeDir: string
let projectPath: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-empty-file-'))
  homeDir = path.join(root, 'home')
  projectPath = path.join(root, 'project')
  mkdirSync(projectPath, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2))
}

const piGlobal = () => path.join(homeDir, '.pi', 'agent', 'mcp.json')
const owGlobal = () => path.join(homeDir, '.openwaggle', 'mcp.json')
const owProject = () => path.join(projectPath, '.openwaggle', 'mcp.json')

function service() {
  return createFilesystemMcpConfigurationService({
    homeDir,
    piAgentDir: path.join(homeDir, '.pi', 'agent'),
  })
}

function setProjectSwitch(enabled: boolean) {
  return Effect.runPromise(
    service().setServerEnabled({ projectPath, name: 'fs', enabled, target: 'project' }),
  )
}

describe("OpenWaggle's emptied project MCP file", () => {
  it('is removed when a project switch goes back to what the global file gives', async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'fs-mcp' } } })

    await setProjectSwitch(false)
    expect(existsSync(owProject())).toBe(true)
    await setProjectSwitch(true)

    expect(existsSync(owProject())).toBe(false)
    expect(existsSync(path.dirname(owProject()))).toBe(false)
  })

  it('keeps the .openwaggle folder when something else is in it', async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'fs-mcp' } } })
    write(path.join(projectPath, '.openwaggle', 'other.json'), {})

    await setProjectSwitch(false)
    await setProjectSwitch(true)

    expect(existsSync(owProject())).toBe(false)
    expect(existsSync(path.join(projectPath, '.openwaggle', 'other.json'))).toBe(true)
  })

  it('stays when it has other keys', async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'fs-mcp' } } })
    write(owProject(), { note: 'kept', mcpServers: {} })

    await setProjectSwitch(false)
    await setProjectSwitch(true)

    expect(JSON.parse(readFileSync(owProject(), 'utf8'))).toEqual({ note: 'kept', mcpServers: {} })
  })

  it("leaves Pi's project file and the global file when they are emptied", async () => {
    const piProject = path.join(projectPath, '.pi', 'mcp.json')
    write(piProject, { mcpServers: { fs: { command: 'fs-mcp' } } })
    write(owGlobal(), { mcpServers: { web: { url: 'https://example.com/mcp' } } })

    await Effect.runPromise(service().removeServer({ projectPath, name: 'fs' }))
    await Effect.runPromise(service().removeServer({ projectPath, name: 'web' }))

    expect(JSON.parse(readFileSync(piProject, 'utf8'))).toEqual({ mcpServers: {} })
    expect(JSON.parse(readFileSync(owGlobal(), 'utf8'))).toEqual({ mcpServers: {} })
  })

  it.skipIf(process.platform === 'win32')(
    'is never removed through a symlinked .openwaggle folder',
    () => {
      // Dotfiles: the project's folder links to the global one, or to a dotfiles checkout.
      const dotfiles = path.join(root, 'dotfiles', '.openwaggle')
      write(owGlobal(), {})
      write(path.join(dotfiles, 'mcp.json'), {})
      symlinkSync(path.dirname(owGlobal()), path.join(projectPath, '.openwaggle'))
      const other = path.join(root, 'other')
      mkdirSync(other, { recursive: true })
      symlinkSync(dotfiles, path.join(other, '.openwaggle'))

      removeEmptyOpenWaggleProjectFile(owProject(), homeDir)
      removeEmptyOpenWaggleProjectFile(path.join(other, '.openwaggle', 'mcp.json'), homeDir)

      expect(existsSync(owGlobal())).toBe(true)
      expect(existsSync(path.join(dotfiles, 'mcp.json'))).toBe(true)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'is read once when the project folder links to the global one',
    () => {
      write(owGlobal(), {})
      symlinkSync(path.dirname(owGlobal()), path.join(projectPath, '.openwaggle'))

      const files = mcpConfigFileLocations({
        homeDir,
        piAgentDir: path.join(homeDir, '.pi', 'agent'),
        projectPath,
      })

      expect(files.map((file) => file.fileId)).not.toContain('project-openwaggle')
    },
  )
})
