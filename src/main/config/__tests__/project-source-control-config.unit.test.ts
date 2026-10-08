import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadProjectConfig } from '../project-config'
import {
  readProjectSourceControlConfig,
  updateProjectSourceControlConfig,
} from '../project-source-control-config'

let projectPath: string

async function writeSettings(value: unknown) {
  await mkdir(join(projectPath, '.openwaggle'), { recursive: true })
  await writeFile(join(projectPath, '.openwaggle', 'settings.json'), JSON.stringify(value))
}

async function readSettingsFile(): Promise<unknown> {
  return JSON.parse(await readFile(join(projectPath, '.openwaggle', 'settings.json'), 'utf-8'))
}

describe('project source-control declarations', () => {
  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'openwaggle-project-source-control-'))
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  it('reads nothing from a project without settings', async () => {
    await expect(readProjectSourceControlConfig(projectPath)).resolves.toEqual({ hosts: {} })
  })

  it('reads declared hosts as canonical lowercase keys and the shared destination', async () => {
    await writeSettings({
      sourceControl: {
        hosts: { 'Git.Acme.IO': 'gitlab', 'code.acme.io': 'github' },
        changeRequestOpenDestination: 'website',
      },
    })

    await expect(readProjectSourceControlConfig(projectPath)).resolves.toEqual({
      hosts: { 'git.acme.io': 'gitlab', 'code.acme.io': 'github' },
      changeRequestOpenDestination: 'website',
    })
  })

  it('ignores invalid entries without disabling the rest of the project settings', async () => {
    await writeSettings({
      preferences: { authorizationMode: 'ask-for-approval' },
      sourceControl: {
        hosts: { 'git.acme.io': 'bitbucket', 'ok.acme.io': 'gitlab', 'bad host': 'github' },
        changeRequestOpenDestination: 'somewhere',
      },
    })

    await expect(readProjectSourceControlConfig(projectPath)).resolves.toEqual({
      hosts: { 'ok.acme.io': 'gitlab' },
    })
    await expect(loadProjectConfig(projectPath)).resolves.toMatchObject({
      preferences: { authorizationMode: 'ask-for-approval' },
    })
  })

  it('writes declarations and the destination, keeping unrelated settings', async () => {
    await writeSettings({ preferences: { authorizationMode: 'yolo' } })

    await updateProjectSourceControlConfig(projectPath, {
      hosts: { 'Git.Acme.IO': 'gitlab' },
      changeRequestOpenDestination: 'inspector',
    })

    await expect(readSettingsFile()).resolves.toEqual({
      preferences: { authorizationMode: 'yolo' },
      sourceControl: {
        hosts: { 'git.acme.io': 'gitlab' },
        changeRequestOpenDestination: 'inspector',
      },
    })
  })

  it('removes a host or the destination with null and drops an empty section', async () => {
    await writeSettings({
      sourceControl: {
        hosts: { 'git.acme.io': 'gitlab' },
        changeRequestOpenDestination: 'website',
      },
    })

    await updateProjectSourceControlConfig(projectPath, {
      hosts: { 'git.acme.io': null },
      changeRequestOpenDestination: null,
    })

    await expect(readSettingsFile()).resolves.toEqual({})
  })
})
