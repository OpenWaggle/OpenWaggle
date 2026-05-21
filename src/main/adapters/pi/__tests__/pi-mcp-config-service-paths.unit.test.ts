import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCopyableBundledMcpAdapterPackageDir } from '../pi-mcp-config-service'

describe('resolveCopyableBundledMcpAdapterPackageDir', () => {
  it('resolves packaged asar adapter paths to the unpacked copyable directory', () => {
    const packagedPath = path.join(
      path.sep,
      'Applications',
      'OpenWaggle.app',
      'Contents',
      'Resources',
      'app.asar',
      'node_modules',
      'pi-mcp-adapter',
    )

    expect(resolveCopyableBundledMcpAdapterPackageDir(packagedPath)).toBe(
      path.join(
        path.sep,
        'Applications',
        'OpenWaggle.app',
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules',
        'pi-mcp-adapter',
      ),
    )
  })

  it('keeps development adapter package paths unchanged', () => {
    const packagePath = path.join(path.sep, 'repo', 'node_modules', 'pi-mcp-adapter')

    expect(resolveCopyableBundledMcpAdapterPackageDir(packagePath)).toBe(packagePath)
  })
})
