import { describe, expect, it } from 'vitest'
import { declaredRegistryValues } from '../registry-values'

describe('Registry environment variables and headers', () => {
  it('fills {variables} from their values or defaults, and leaves other braces as written', () => {
    expect(
      declaredRegistryValues(
        [
          {
            name: 'API_URL',
            value: 'https://{region}.api.example/{version}',
            variables: { region: { default: 'eu' }, version: { value: 'v2' } },
          },
          { name: 'TEMPLATE', value: '{not-a-variable}' },
        ],
        'env',
      ),
    ).toEqual({ API_URL: 'https://eu.api.example/v2', TEMPLATE: '{not-a-variable}' })
  })

  it('makes a value with a secret variable one vault secret for the whole value', () => {
    expect(
      declaredRegistryValues(
        [
          {
            name: 'Authorization',
            value: 'Bearer {token}',
            variables: { token: { isSecret: true, isRequired: true } },
          },
        ],
        'header',
      ),
    ).toEqual({ Authorization: { secret: 'AUTHORIZATION' } })
  })

  it('leaves out an optional value it has no value for; only a required one asks the vault', () => {
    expect(
      declaredRegistryValues(
        [
          { name: 'LOG_LEVEL' },
          { name: 'WORKSPACE', value: '{dir}', variables: { dir: {} } },
          { name: 'TENANT', isRequired: true },
          { name: 'API_KEY', isSecret: true },
        ],
        'env',
      ),
    ).toEqual({ TENANT: { secret: 'TENANT' }, API_KEY: { secret: 'API_KEY' } })
  })
})
