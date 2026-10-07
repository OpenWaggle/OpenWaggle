import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPiSessionDiscoveryScanner } from '../pi-session-discovery'

let root = ''
let sessionsRoot = ''

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-discovery-')))
  sessionsRoot = path.join(root, 'agent', 'sessions')
  await fs.mkdir(sessionsRoot, { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** The directory name Pi gives a working directory's sessions. */
function piSessionDirName(cwd: string) {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

interface PiFileOptions {
  readonly id: string
  readonly cwd: string
  readonly timestamp?: string
  readonly entries?: readonly unknown[]
}

async function writePiSession(options: PiFileOptions) {
  const directory = path.join(sessionsRoot, piSessionDirName(options.cwd))
  await fs.mkdir(directory, { recursive: true })
  const timestamp = options.timestamp ?? '2026-01-02T03:04:05.000Z'
  const file = path.join(directory, `${timestamp.replace(/[:.]/g, '-')}_${options.id}.jsonl`)
  const lines = [
    { type: 'session', version: 3, id: options.id, timestamp, cwd: options.cwd },
    ...(options.entries ?? []),
  ]
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return file
}

function userEntry(id: string, parentId: string | null, text: string) {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-01-02T03:05:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1 },
  }
}

describe('Pi session discovery scanner', () => {
  it('finds Pi sessions whose working directory is the project or a folder inside it', async () => {
    const project = path.join(root, 'work', 'app')
    const inProject = await writePiSession({ id: 'in-project', cwd: project })
    const inSubfolder = await writePiSession({
      id: 'in-subfolder',
      cwd: path.join(project, 'packages', 'core'),
    })
    await writePiSession({ id: 'sibling', cwd: path.join(root, 'work', 'app-other') })
    await writePiSession({ id: 'elsewhere', cwd: path.join(root, 'elsewhere') })

    const scanner = createPiSessionDiscoveryScanner({ sessionsRoot })
    const found = await scanner.scan({ projectPaths: [project], isKnownFile: () => false })

    expect(found.map((session) => session.piSessionId).sort()).toEqual([
      'in-project',
      'in-subfolder',
    ])
    expect(found.find((session) => session.piSessionId === 'in-project')).toMatchObject({
      piSessionFile: inProject,
      projectPath: project,
      cwd: project,
      createdAt: Date.parse('2026-01-02T03:04:05.000Z'),
    })
    expect(found.find((session) => session.piSessionId === 'in-subfolder')).toMatchObject({
      piSessionFile: inSubfolder,
      projectPath: project,
    })
  })

  it('binds a session to the most specific project that contains it', async () => {
    const outer = path.join(root, 'work')
    const inner = path.join(outer, 'app')
    await writePiSession({ id: 'nested', cwd: path.join(inner, 'src') })

    const scanner = createPiSessionDiscoveryScanner({ sessionsRoot })
    const found = await scanner.scan({ projectPaths: [outer, inner], isKnownFile: () => false })

    expect(found).toEqual([expect.objectContaining({ piSessionId: 'nested', projectPath: inner })])
  })

  it('skips files OpenWaggle already knows without reading them', async () => {
    const project = path.join(root, 'app')
    const known = await writePiSession({ id: 'known', cwd: project })
    await writePiSession({ id: 'new', cwd: project, timestamp: '2026-01-03T00:00:00.000Z' })

    const scanner = createPiSessionDiscoveryScanner({ sessionsRoot })
    const found = await scanner.scan({
      projectPaths: [project],
      isKnownFile: (file) => file === known,
    })

    expect(found.map((session) => session.piSessionId)).toEqual(['new'])
  })

  it('reads the session name and first user message from the start of the file', async () => {
    const project = path.join(root, 'app')
    await writePiSession({
      id: 'named',
      cwd: project,
      entries: [
        userEntry('u1', null, 'Fix the flaky login test'),
        { type: 'session_info', id: 'n1', parentId: 'u1', timestamp: '', name: ' Login fix ' },
      ],
    })

    const scanner = createPiSessionDiscoveryScanner({ sessionsRoot })
    const [found] = await scanner.scan({ projectPaths: [project], isKnownFile: () => false })

    expect(found).toMatchObject({ name: 'Login fix', firstUserMessage: 'Fix the flaky login test' })
  })

  it('ignores files without a Pi session header and lists nothing without projects', async () => {
    const project = path.join(root, 'app')
    const directory = path.join(sessionsRoot, piSessionDirName(project))
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'empty.jsonl'), '')
    await fs.writeFile(path.join(directory, 'other.jsonl'), '{"type":"message"}\n')
    await writePiSession({ id: 'real', cwd: project })

    const scanner = createPiSessionDiscoveryScanner({ sessionsRoot })

    expect(
      (await scanner.scan({ projectPaths: [project], isKnownFile: () => false })).map(
        (session) => session.piSessionId,
      ),
    ).toEqual(['real'])
    expect(await scanner.scan({ projectPaths: [], isKnownFile: () => false })).toEqual([])
  })

  it('finds nothing when Pi has no sessions directory yet', async () => {
    const scanner = createPiSessionDiscoveryScanner({
      sessionsRoot: path.join(root, 'missing', 'sessions'),
    })

    expect(
      await scanner.scan({ projectPaths: [path.join(root, 'app')], isKnownFile: () => false }),
    ).toEqual([])
  })

  it('lists a session once its folder becomes a project', async () => {
    const outer = path.join(root, 'work')
    const project = path.join(outer, 'app')
    await writePiSession({ id: 'in-sibling', cwd: path.join(root, 'work', 'app-docs') })

    const scanner = createPiSessionDiscoveryScanner({ sessionsRoot })
    expect(await scanner.scan({ projectPaths: [project], isKnownFile: () => false })).toEqual([])

    expect(
      (await scanner.scan({ projectPaths: [project, outer], isKnownFile: () => false })).map(
        (session) => [session.piSessionId, session.projectPath],
      ),
    ).toEqual([['in-sibling', outer]])
  })

  it('finds the header past blank and malformed lines, as Pi does', async () => {
    const project = path.join(root, 'app')
    const directory = path.join(sessionsRoot, piSessionDirName(project))
    await fs.mkdir(directory, { recursive: true })
    const header = { type: 'session', version: 3, id: 'late-header', timestamp: '', cwd: project }
    await fs.writeFile(
      path.join(directory, 'late.jsonl'),
      `\n{ truncated\n${JSON.stringify(header)}\n`,
    )

    const scanner = createPiSessionDiscoveryScanner({ sessionsRoot })
    const found = await scanner.scan({ projectPaths: [project], isKnownFile: () => false })

    expect(found.map((session) => session.piSessionId)).toEqual(['late-header'])
  })

  it('reads a headerless file again only after it changes', async () => {
    const project = path.join(root, 'app')
    const directory = path.join(sessionsRoot, piSessionDirName(project))
    await fs.mkdir(directory, { recursive: true })
    const file = path.join(directory, 'pending.jsonl')
    const header = JSON.stringify({ type: 'session', id: 'abcd', timestamp: '', cwd: project })
    await fs.writeFile(file, ' '.repeat(header.length + 1))
    const unchanged = new Date('2026-01-01T00:00:00.000Z')
    await fs.utimes(file, unchanged, unchanged)
    const scanner = createPiSessionDiscoveryScanner({ sessionsRoot })
    expect(await scanner.scan({ projectPaths: [project], isKnownFile: () => false })).toEqual([])

    // Same size and modification time: the scanner trusts what it read before.
    await fs.writeFile(file, `${header}\n`)
    await fs.utimes(file, unchanged, unchanged)
    expect(await scanner.scan({ projectPaths: [project], isKnownFile: () => false })).toEqual([])

    const changed = new Date('2026-01-02T00:00:00.000Z')
    await fs.utimes(file, changed, changed)
    expect(
      (await scanner.scan({ projectPaths: [project], isKnownFile: () => false })).map(
        (session) => session.piSessionId,
      ),
    ).toEqual(['abcd'])
  })
})
