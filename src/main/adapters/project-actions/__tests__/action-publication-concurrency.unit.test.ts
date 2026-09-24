import { mkdir, open, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_ACTION_MANIFEST } from '../../../domain/project-action-catalog'
import { createActionCatalog } from '../action-catalog'
import { serializeActionManifest } from '../action-manifest-file'
import {
  action,
  catalog,
  failPublicationBeforeWrite,
  failPublicationCompletion,
  installActionCatalogFixture,
  persistence,
  projectPath,
  rows,
  scope,
  shared,
} from './action-catalog.test-harness'

const hooks = vi.hoisted(() => ({
  beforeRename: async (_source: string, _target: string): Promise<void> => {},
  beforeLink: async (_source: string, _target: string): Promise<void> => {},
  afterRename: async (_source: string, _target: string): Promise<void> => {},
  afterLink: async (_source: string, _target: string): Promise<void> => {},
}))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      await hooks.beforeRename(String(args[0]), String(args[1]))
      await actual.rename(...args)
      await hooks.afterRename(String(args[0]), String(args[1]))
    },
    link: async (...args: Parameters<typeof actual.link>) => {
      await hooks.beforeLink(String(args[0]), String(args[1]))
      await actual.link(...args)
      await hooks.afterLink(String(args[0]), String(args[1]))
    },
  }
})

installActionCatalogFixture()
beforeEach(() => {
  hooks.beforeRename = async () => {}
  hooks.afterRename = async () => {}
  hooks.beforeLink = async () => {}
  hooks.afterLink = async () => {}
})

const external = {
  ...EMPTY_ACTION_MANIFEST,
  actions: [{ ...action, id: 'external', name: 'External edit' }],
}

async function publish() {
  const initial = await catalog.read(scope())
  return catalog.edit(scope(), initial.revision, {
    type: 'save-action',
    definition: action,
    storage: 'project',
  })
}

function recoveryPath() {
  const pending = rows.get(projectPath)?.state.pending
  if (!pending?.publication) throw new Error('Missing pending publication')
  return join(projectPath, '.openwaggle/action-recovery', pending.publication.id)
}

describe('concurrent action publication', () => {
  it('leaves the current manifest in place when hard links are unavailable', async () => {
    await shared(EMPTY_ACTION_MANIFEST)
    const target = join(projectPath, '.openwaggle/actions.json')
    hooks.beforeLink = async (_source, destination) => {
      if (basename(destination) === 'next.json')
        throw Object.assign(new Error('Hard links unavailable'), { code: 'EPERM' })
    }
    await expect(publish()).rejects.toThrow('Hard links unavailable')
    expect(await readFile(target, 'utf8')).toBe(serializeActionManifest(EMPTY_ACTION_MANIFEST))
    expect(rows.get(projectPath)?.state.pending?.nextShared.actions).toEqual([action])
  })

  it.each(['atomic save', 'in-place write'] as const)(
    'preserves an external %s after the final revision check',
    async (method) => {
      await shared(EMPTY_ACTION_MANIFEST)
      const initial = await catalog.read(scope())
      const target = join(projectPath, '.openwaggle/actions.json')
      hooks.beforeRename = async (source, destination) => {
        if (source !== target && destination !== target) return
        hooks.beforeRename = async () => {}
        if (method === 'atomic save') {
          const temporary = `${target}.external`
          await writeFile(temporary, serializeActionManifest(external))
          await rename(temporary, target)
        } else await writeFile(target, serializeActionManifest(external))
      }
      const result = await catalog.edit(scope(), initial.revision, {
        type: 'save-action',
        definition: action,
        storage: 'project',
      })
      expect(await readFile(target, 'utf8')).toBe(serializeActionManifest(external))
      expect(result.pendingPublication?.projectDraft.actions).toEqual([action])
    },
  )

  it('preserves a file first created by another writer during publication', async () => {
    const target = join(projectPath, '.openwaggle/actions.json')
    hooks.beforeRename = async (source) => {
      if (source !== target) return
      hooks.beforeRename = async () => {}
      await writeFile(target, serializeActionManifest(external))
    }
    const result = await publish()
    expect(await readFile(target, 'utf8')).toBe(serializeActionManifest(external))
    expect(result.pendingPublication?.projectDraft.actions).toEqual([action])
  })

  it('does not replace an external save created after moving the original aside', async () => {
    await shared(EMPTY_ACTION_MANIFEST)
    const target = join(projectPath, '.openwaggle/actions.json')
    hooks.beforeLink = async (_source, destination) => {
      if (destination !== target) return
      hooks.beforeLink = async () => {}
      await writeFile(target, serializeActionManifest(external))
    }
    const result = await publish()
    expect(await readFile(target, 'utf8')).toBe(serializeActionManifest(external))
    expect(result.pendingPublication?.projectDraft.actions).toEqual([action])
    expect(await readFile(join(recoveryPath(), 'previous.json'), 'utf8')).toBe(
      serializeActionManifest(EMPTY_ACTION_MANIFEST),
    )
  })

  it('retains in-place writes through a descriptor opened before capture', async () => {
    await shared(EMPTY_ACTION_MANIFEST)
    const target = join(projectPath, '.openwaggle/actions.json')
    const editor = await open(target, 'r+')
    try {
      hooks.beforeLink = async (_source, destination) => {
        if (destination !== target) return
        hooks.beforeLink = async () => {}
        await editor.truncate(0)
        await editor.writeFile(serializeActionManifest(external))
      }
      const result = await publish()
      expect(result.pendingPublication?.projectDraft.actions).toEqual([action])
      expect(await readFile(join(recoveryPath(), 'previous.json'), 'utf8')).toBe(
        serializeActionManifest(external),
      )
      const recovered = await createActionCatalog(persistence).read(scope())
      expect(recovered.pendingPublication).toEqual(result.pendingPublication)
    } finally {
      await editor.close()
    }
  })

  it('keeps the original inode recoverable even when its writer finishes after publication', async () => {
    await shared(EMPTY_ACTION_MANIFEST)
    const editor = await open(join(projectPath, '.openwaggle/actions.json'), 'r+')
    try {
      expect((await publish()).pendingPublication).toBeUndefined()
      await editor.truncate(0)
      await editor.writeFile(serializeActionManifest(external))
      const recovery = join(projectPath, '.openwaggle/action-recovery')
      const directories = await readdir(recovery, { withFileTypes: true })
      const publication = directories.find((entry) => entry.isDirectory())
      if (!publication) throw new Error('No retained publication')
      expect(await readFile(join(recovery, publication.name, 'previous.json'), 'utf8')).toBe(
        serializeActionManifest(external),
      )
      expect(await readFile(join(recovery, '.gitignore'), 'utf8')).toBe('*\n')
    } finally {
      await editor.close()
    }
  })

  it.each(['capture', 'install'] as const)(
    'resumes a crash immediately after %s',
    async (stage) => {
      await shared(EMPTY_ACTION_MANIFEST)
      const fail = async () => {
        throw new Error('Simulated publication crash')
      }
      if (stage === 'capture') hooks.afterRename = fail
      else
        hooks.afterLink = async (_source, destination) => {
          if (basename(destination) === 'actions.json') await fail()
        }
      await expect(publish()).rejects.toThrow('Simulated publication crash')
      expect(await readFile(join(recoveryPath(), 'previous.json'), 'utf8')).toBe(
        serializeActionManifest(EMPTY_ACTION_MANIFEST),
      )
      hooks.afterRename = async () => {}
      hooks.afterLink = async () => {}
      const recovered = await createActionCatalog(persistence).read(scope())
      expect(recovered.pendingPublication).toBeUndefined()
      expect(recovered.actions).toEqual([{ source: 'project', definition: action }])
    },
  )

  it('retains drafts when an external atomic save has identical bytes but another inode', async () => {
    await shared(EMPTY_ACTION_MANIFEST)
    failPublicationCompletion()
    await expect(publish()).rejects.toThrow('Simulated crash')
    const target = join(projectPath, '.openwaggle/actions.json')
    const temporary = `${target}.external`
    const content = await readFile(target, 'utf8')
    await writeFile(temporary, content)
    await rename(temporary, target)
    const recovered = await createActionCatalog(persistence).read(scope())
    expect(recovered.pendingPublication?.projectDraft.actions).toEqual([action])
    expect(await readFile(target, 'utf8')).toBe(content)
  })

  it.each(['directory', 'symlink'] as const)(
    'does not resume in a replaced recovery %s',
    async (kind) => {
      failPublicationBeforeWrite()
      await expect(publish()).rejects.toThrow('Simulated crash')
      const previous = recoveryPath()
      const moved = `${previous}.moved`
      await rename(previous, moved)
      if (kind === 'directory') await mkdir(previous)
      else await symlink(moved, previous, 'dir')
      const recovered = await createActionCatalog(persistence).read(scope())
      expect(recovered.pendingPublication?.projectDraft.actions).toEqual([action])
      expect(await readdir(moved)).toEqual([])
      expect(await readdir(previous)).toEqual([])
    },
  )

  it('does not overwrite an edited recovery ignore file', async () => {
    const directory = join(projectPath, '.openwaggle/action-recovery')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, '.gitignore'), 'user edit\n')
    await expect(publish()).rejects.toThrow('.gitignore was edited')
    expect(await readFile(join(directory, '.gitignore'), 'utf8')).toBe('user edit\n')
  })

  it('refuses a symlinked recovery root without writing through it', async () => {
    await mkdir(join(projectPath, '.openwaggle'))
    const outside = join(projectPath, 'elsewhere')
    await mkdir(outside)
    await symlink(outside, join(projectPath, '.openwaggle/action-recovery'), 'dir')
    await expect(publish()).rejects.toThrow('regular Workspace directory')
    expect(await readdir(outside)).toEqual([])
  })

  it('keeps an old journal without publication identity as a draft', async () => {
    failPublicationBeforeWrite()
    await expect(publish()).rejects.toThrow('Simulated crash')
    const stored = rows.get(projectPath)
    if (!stored?.state.pending) throw new Error('Missing pending publication')
    const { publication: _publication, ...pending } = stored.state.pending
    rows.set(projectPath, { ...stored, state: { ...stored.state, pending } })
    const recovered = await createActionCatalog(persistence).read(scope())
    expect(recovered.pendingPublication?.projectDraft.actions).toEqual([action])
  })
})
