import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { documentationVersionFromPackageVersion } from '../../../../scripts/package-documentation-model'
import {
  packageDocumentation,
  packageDocumentationPage,
  packageDocumentationPageRoute,
} from '../package-docs'

/** The major.minor line of the package's manifest version, which a release moves to a new line. */
function packageLine(slug: string) {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL(`../../../../packages/${slug}/package.json`, import.meta.url), 'utf8'),
  )
  const version =
    typeof manifest === 'object' && manifest !== null && 'version' in manifest
      ? manifest.version
      : undefined
  if (typeof version !== 'string') throw new Error(`packages/${slug}/package.json has no version.`)
  return documentationVersionFromPackageVersion(version)
}

describe('package documentation routes', () => {
  it('keeps latest aliases on the current major.minor line', () => {
    for (const definition of packageDocumentation) {
      const line = packageLine(definition.slug)
      expect(definition.currentVersion).toBe(line)
      expect(packageDocumentationPage(`packages/${definition.slug}`)).toMatchObject({
        page: 'guide',
        version: line,
      })
      expect(packageDocumentationPageRoute(definition.slug, line, 'api-reference')).toBe(
        `/docs/packages/${definition.slug}/${line}/api-reference/`,
      )
    }
  })

  it('exposes the component catalogue only for the React package', () => {
    expect(packageDocumentationPage('packages/extension-react/0.1/components')).toMatchObject({
      page: 'components',
      version: '0.1',
    })
    expect(packageDocumentationPage('packages/extension-sdk/0.1/components')).toBeUndefined()
  })

  it('uses exact major.minor documentation versions for every package', () => {
    for (const definition of packageDocumentation) {
      expect(definition.currentVersion).toMatch(/^\d+\.\d+$/u)
      expect(definition.versions).toContain(definition.currentVersion)
    }
  })

  it('catalogues every Alert tone with a rendered example', async () => {
    const catalogue = await readFile(
      new URL('../../content/docs/packages/extension-react/0.1/components.md', import.meta.url),
      'utf8',
    )

    for (const tone of ['neutral', 'accent', 'success', 'warning', 'danger', 'info']) {
      expect(catalogue).toContain(`<div class="ow-extension-alert" data-ow-tone="${tone}"`)
    }
  })
})
