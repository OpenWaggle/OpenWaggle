import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export async function createAgentDefinitionManagementTestPaths() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-management-'))
  const projectPath = path.join(root, 'project')
  const userHome = path.join(root, 'home')
  await Promise.all([
    fs.mkdir(projectPath, { recursive: true }),
    fs.mkdir(userHome, { recursive: true }),
  ])
  return { root, projectPath, userHome }
}
