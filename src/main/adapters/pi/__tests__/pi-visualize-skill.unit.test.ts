import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { ensurePiVisualizeSkill, getPiVisualizeSkillDiagnostic } from '../pi-visualize-skill'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-visualize-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

describe('Pi Visualize skill', () => {
  it('securely creates a missing Pi agent directory before installing', async () => {
    const parent = await temporaryRoot()
    const agentDir = path.join(parent, 'new-agent-directory')

    const skillPath = await ensurePiVisualizeSkill(agentDir)

    const skill = await fs.readFile(skillPath, 'utf8')
    expect(skill).toContain('name: visualize')
    expect(skill).toContain('## Inline HTML output contract')
    expect(skill).toContain('[data-tooltip-placement]')
    expect(skill).toContain('window.openai.sendFollowUpMessage')
    expect(skill).toContain('window.openai.setVisualizationState')
    expect(skill).toContain('16 KiB')
    expect(skill.split('\n').length).toBeGreaterThan(450)
    expect((await fs.lstat(agentDir)).isDirectory()).toBe(true)
  })

  it('refuses a symlink used as the Pi agent directory', async () => {
    const parent = await temporaryRoot()
    const outsideRoot = await temporaryRoot()
    const agentDir = path.join(parent, 'agent-link')
    await fs.symlink(outsideRoot, agentDir)

    await expect(ensurePiVisualizeSkill(agentDir)).rejects.toThrow('Invalid Pi agent directory')
  })

  it('refuses to install through a symlinked host-managed skill root', async () => {
    const agentDir = await temporaryRoot()
    const outsideRoot = await temporaryRoot()
    await fs.symlink(outsideRoot, path.join(agentDir, 'openwaggle-built-in-skills'))

    await expect(ensurePiVisualizeSkill(agentDir)).rejects.toThrow(
      'Invalid built-in skill directory',
    )
    await expect(fs.stat(path.join(outsideRoot, 'visualize', 'SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('reports an explicit command diagnostic when the bundled skill cannot be prepared', async () => {
    const parent = await temporaryRoot()
    const agentDir = path.join(parent, 'agent-file')
    await fs.writeFile(agentDir, 'not a directory', 'utf8')

    await expect(getPiVisualizeSkillDiagnostic(agentDir)).resolves.toMatchObject({
      id: 'visualize',
      enabled: false,
      loadStatus: 'error',
      hasScripts: true,
    })
  })

  it('installs a standalone renderer that preserves sandboxing and escaped titles', async () => {
    const agentDir = await temporaryRoot()
    const skillPath = await ensurePiVisualizeSkill(agentDir)
    const skillDirectory = path.dirname(skillPath)
    const fragmentPath = path.join(agentDir, 'latency-map.html')
    const outputPath = path.join(agentDir, 'latency-map-export.html')
    await fs.writeFile(fragmentPath, '<button id="probe">Probe</button>', 'utf8')

    await execFileAsync('python3', [
      path.join(skillDirectory, 'scripts', 'render.py'),
      fragmentPath,
      outputPath,
      '--title',
      'Latency <Map>',
    ])
    const output = await fs.readFile(outputPath, 'utf8')

    expect(output).toContain('sandbox="allow-scripts"')
    expect(output).toContain('Latency &lt;Map&gt;')
    expect(output).toContain('&lt;button id=&quot;probe&quot;&gt;Probe&lt;/button&gt;')
    expect(output).toContain("default-src 'none'")
    expect(output).toContain("worker-src 'none'")
    expect(output).not.toContain('worker-src blob:')
    expect(output).not.toContain('allow-same-origin')
  })
})
