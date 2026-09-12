import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import {
  WorkspaceFileService,
  type WorkspaceFileServiceShape,
} from '../../ports/workspace-file-service'
import { FilesystemWorkspaceFileLive } from '../filesystem-workspace-file-service'

export interface WorkspaceFileFixture {
  readonly temporaryRoot: string
  readonly projectPath: string
}

export async function createWorkspaceFileFixture(): Promise<WorkspaceFileFixture> {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-workspace-files-'))
  const projectPath = path.join(temporaryRoot, 'project')
  await fs.mkdir(path.join(projectPath, 'src'), { recursive: true })
  await fs.mkdir(path.join(projectPath, '.agents'), { recursive: true })
  await fs.mkdir(path.join(projectPath, 'node_modules', 'ignored'), { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(projectPath, 'src', 'alpha.ts'), 'export const alpha = 1\n'),
    fs.writeFile(path.join(projectPath, 'src', 'beta.ts'), 'const needle = true\n'),
    fs.writeFile(path.join(projectPath, '.agents', 'guide.md'), '# Guide\n'),
    fs.writeFile(path.join(projectPath, 'node_modules', 'ignored', 'package.js'), 'ignored\n'),
  ])
  return { temporaryRoot, projectPath }
}

export async function removeWorkspaceFileFixture(temporaryRoot: string): Promise<void> {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
}

export function runWithWorkspaceFiles<A>(
  useService: (service: WorkspaceFileServiceShape) => Effect.Effect<A, unknown>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* WorkspaceFileService
      return yield* useService(service)
    }).pipe(Effect.provide(FilesystemWorkspaceFileLive)),
  )
}
