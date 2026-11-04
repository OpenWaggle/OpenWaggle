/**
 * The SKILL.md frontmatter behaviour the skills docs describe, checked against Pi's skill loader.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeScratchDirectories, scratchDirectory } from './published-json-schemas.test-harness'

afterEach(removeScratchDirectories)

/** Development tooling loads Pi dynamically; static Pi imports belong to the app's Pi adapter. */
function loadPi() {
  return import('@earendil-works/pi-coding-agent')
}

describe('the SKILL.md frontmatter the skills docs describe', () => {
  function writeSkill(root: string, folder: string, frontmatter: string) {
    const directory = path.join(root, folder)
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'SKILL.md'), `---\n${frontmatter}\n---\n\nDo the task.\n`)
  }

  it('loads name, description and disable-model-invocation, and ignores the other fields', async () => {
    const { formatSkillsForPrompt, loadSkillsFromDir } = await loadPi()
    const root = scratchDirectory('ow-skill-frontmatter-')
    writeSkill(
      root,
      'release-notes',
      'name: release-notes\ndescription: Write release notes. Use when preparing a release.\ndisable-model-invocation: true\nlicense: MIT\ncompatibility: Needs git\nmetadata:\n  owner: docs\nallowed-tools: Bash(git log:*)',
    )
    writeSkill(root, 'folder-name', 'description: Uses its folder name.')
    writeSkill(root, 'no-description', 'name: no-description')

    const { skills } = loadSkillsFromDir({ dir: root, source: 'project' })
    const byName = new Map(skills.map((skill) => [skill.name, skill]))
    expect([...byName.keys()].sort()).toEqual(['folder-name', 'release-notes'])
    expect(byName.get('release-notes')?.disableModelInvocation).toBe(true)
    const prompt = formatSkillsForPrompt(skills)
    expect(prompt).toContain('folder-name')
    expect(prompt).not.toContain('release-notes')
  })
})

describe('the SKILL.md limits the skills docs describe', () => {
  it('warns about a name or description outside the limits but still loads the skill', async () => {
    const { loadSkillsFromDir } = await loadPi()
    const root = scratchDirectory('ow-skill-limits-')
    const directory = path.join(root, 'limits')
    mkdirSync(directory, { recursive: true })
    const name = `Too_Long_${'x'.repeat(64)}`
    writeFileSync(
      path.join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${'d'.repeat(1100)}\n---\n\nDo the task.\n`,
    )
    const { skills, diagnostics } = loadSkillsFromDir({ dir: root, source: 'project' })
    expect(skills.map((skill) => skill.name)).toEqual([name])
    const warnings = diagnostics.filter((diagnostic) => diagnostic.type === 'warning')
    expect(warnings.map((warning) => warning.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/name exceeds 64 characters/u),
        expect.stringMatching(/name contains invalid characters/u),
        expect.stringMatching(/description exceeds 1024 characters/u),
      ]),
    )
  })
})
