import fs from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import config from '../../electron-builder'

/** Resolves the patched dmg-builder that electron-builder actually loads. */
function dmgBuilderRequire() {
  const rootRequire = createRequire(import.meta.url)
  const electronBuilderRequire = createRequire(rootRequire.resolve('electron-builder/package.json'))
  return createRequire(electronBuilderRequire.resolve('app-builder-lib/package.json'))
}

describe('DMG signing and notarization', () => {
  it('asks electron-builder to sign the DMG, not only the app inside it', () => {
    expect(config.dmg).toEqual({ sign: true })
  })

  it('notarizes and staples a DMG it signed before the blockmap and update metadata read it', () => {
    const source = fs.readFileSync(dmgBuilderRequire().resolve('dmg-builder/out/dmg'), 'utf8')
    const signed = source.indexOf('if (await this.signDmg(artifactPath)) {')
    const notarized = source.indexOf('await this.packager.helper.notarizeIfProvided(artifactPath);', signed)
    const blockmap = source.indexOf('createBlockmap)(artifactPath', notarized)
    expect(signed).toBeGreaterThan(0)
    expect(notarized).toBeGreaterThan(signed)
    expect(blockmap).toBeGreaterThan(notarized)
  })

  it('reports an unsigned DMG, so an unsigned build is never sent for notarization', async () => {
    const dmg: unknown = dmgBuilderRequire()('dmg-builder/out/dmg')
    const target: unknown = Reflect.get(Object(dmg), 'DmgTarget')
    const signDmg: unknown = Reflect.get(Object(Reflect.get(Object(target), 'prototype')), 'signDmg')
    expect(typeof signDmg).toBe('function')
    const unsignedTarget = { packager: { platformSpecificBuildOptions: { identity: null } } }
    if (typeof signDmg !== 'function') return
    expect(await Reflect.apply(signDmg, unsignedTarget, ['/tmp/unsigned.dmg'])).toBe(false)
  })
})
