import { describe, expect, it, vi } from 'vitest'
import type { RegistryServerRecord } from '../registry-client'
import { createRegistryEntry } from '../registry-entry'

const DIGEST = `sha256:${'b'.repeat(64)}`
const options = {
  cacheRoot: '/unused-cache',
  homeDir: '/home/me',
  resolveOciImage: vi.fn(async () => ({
    coordinate: `ghcr.io/example/weather@${DIGEST}`,
    digest: DIGEST,
  })),
}

/**
 * A Registry `named` argument is a command-line `--flag={value}` (server.json schema,
 * `NamedArgument`); a `positional` one is its value alone.
 */
const PACKAGE_ARGUMENTS = [
  { type: 'named', name: '--port', value: '8080' },
  { type: 'positional', value: 'serve' },
  { type: 'named', name: '--read-only' },
  { type: 'named', name: '-m', value: 'fast mode' },
]
const EXPECTED_ARGUMENTS = ['--port=8080', 'serve', '--read-only', '-m=fast mode']

function server(registryType: string, identifier: string, extra: object): RegistryServerRecord {
  const pkg = {
    registryType,
    identifier,
    transport: { type: 'stdio' },
    packageArguments: PACKAGE_ARGUMENTS,
    ...extra,
  }
  return {
    name: 'io.github.example/weather',
    version: '2.0.0',
    description: 'Weather forecasts.',
    raw: { name: 'io.github.example/weather', version: '2.0.0', packages: [pkg] },
  }
}

describe('Registry package arguments', () => {
  it.each([
    ['npm', '@example/weather', { version: '1.2.3' }, ['--yes', '@example/weather@1.2.3']],
    ['pypi', 'weather-mcp', { version: '1.2.3' }, ['weather-mcp==1.2.3']],
    [
      'oci',
      'ghcr.io/example/weather:v2',
      {},
      ['run', '--rm', '-i', `ghcr.io/example/weather@${DIGEST}`],
    ],
  ] as const)(
    'keep the flag name of a named argument for a %s package',
    async (type, identifier, extra, launch) => {
      const result = await createRegistryEntry(server(type, identifier, extra), options)

      expect(result.entry).toMatchObject({ args: [...launch, ...EXPECTED_ARGUMENTS] })
    },
  )

  it('checks a named runner argument with its flag name, so a flag cannot pass as a value', async () => {
    await expect(
      createRegistryEntry(
        server('npm', '@example/weather', {
          version: '1.2.3',
          runtimeArguments: [{ type: 'named', name: '--registry', value: '-y' }],
        }),
        options,
      ),
    ).rejects.toThrow('unsupported runtime argument "--registry=-y"')
  })

  function withArguments(packageArguments: readonly object[]) {
    return server('npm', '@example/weather', { version: '1.2.3', packageArguments })
  }

  it('uses an argument default and fills {variables} from their values or defaults', async () => {
    const result = await createRegistryEntry(
      withArguments([
        { type: 'named', name: '--port', default: '8080' },
        {
          type: 'positional',
          value: '--root={root}/data',
          variables: { root: { default: '/srv' } },
        },
      ]),
      options,
    )

    expect(result.entry).toMatchObject({
      args: ['--yes', '@example/weather@1.2.3', '--port=8080', '--root=/srv/data'],
    })
  })

  it('leaves out an optional argument it cannot fill, and refuses a required one', async () => {
    const optional = await createRegistryEntry(
      withArguments([{ type: 'positional', value: '{workspace}', variables: { workspace: {} } }]),
      options,
    )

    expect(optional.entry).toMatchObject({ args: ['--yes', '@example/weather@1.2.3'] })
    await expect(
      createRegistryEntry(
        withArguments([{ type: 'named', name: '--api-url', isRequired: true, valueHint: 'url' }]),
        options,
      ),
    ).rejects.toThrow('needs a value for --api-url')
  })
})
