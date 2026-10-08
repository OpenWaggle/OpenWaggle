import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { keepMcpFileOutOfGit } from '../git-exclude'

let root: string
let repo: string
let file: string

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

function exclude() {
  return readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ow-mcp-git-exclude-')))
  repo = path.join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git('init', '-q')
  file = path.join(repo, '.openwaggle', 'mcp.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '{}\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("keeping a file the MCP migration created out of the user's git", () => {
  it("adds it to the repository's .git/info/exclude, once", async () => {
    await keepMcpFileOutOfGit(file)
    await keepMcpFileOutOfGit(file)

    expect(git('status', '--porcelain')).toBe('')
    expect(exclude().match(/^\/\.openwaggle\/mcp\.json$/gm)).toHaveLength(1)
    // Never in a tracked file.
    expect(git('status', '--porcelain', '--ignored')).not.toContain('.gitignore')
  })

  it('leaves a file the repository already ignores or tracks alone', async () => {
    writeFileSync(path.join(repo, '.gitignore'), '.openwaggle/\n')
    const before = exclude()
    await keepMcpFileOutOfGit(file)
    expect(exclude()).toBe(before)

    rmSync(path.join(repo, '.gitignore'))
    git('add', '-f', '.openwaggle/mcp.json')
    await keepMcpFileOutOfGit(file)
    expect(exclude()).toBe(before)
  })

  it('does nothing outside a git work tree', async () => {
    const outside = path.join(root, 'plain', '.openwaggle', 'mcp.json')
    mkdirSync(path.dirname(outside), { recursive: true })
    writeFileSync(outside, '{}\n')

    await expect(keepMcpFileOutOfGit(outside)).resolves.toBe(false)
  })
})
