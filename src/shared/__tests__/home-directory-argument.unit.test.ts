import { describe, expect, it } from 'vitest'
import {
  homeDirectoryFromRendererArguments,
  homeDirectoryRendererArguments,
} from '../home-directory-argument'

describe('home directory renderer argument', () => {
  it('round-trips the home directory through the renderer arguments', () => {
    const argv = ['electron', '--type=renderer', ...homeDirectoryRendererArguments('/home/a b')]
    expect(homeDirectoryFromRendererArguments(argv)).toBe('/home/a b')
  })

  it('passes no argument for an empty home or the filesystem root', () => {
    expect(homeDirectoryRendererArguments('')).toEqual([])
    expect(homeDirectoryRendererArguments('/')).toEqual([])
  })

  it('reads null when main passed no home directory', () => {
    expect(homeDirectoryFromRendererArguments(['electron', '--type=renderer'])).toBeNull()
    expect(homeDirectoryFromRendererArguments(['--openwaggle-home-directory='])).toBeNull()
  })
})
