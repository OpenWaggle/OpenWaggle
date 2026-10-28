import { afterEach, describe, expect, it, vi } from 'vitest'
import { embeddingChildEnv } from '../session-embedding-process'

/**
 * R6 P3-7: the embedding child runs onnxruntime-node as Node with a minimal environment. On
 * Windows, DLL loading and the model cache need the system and profile roots, which HOME and
 * TMPDIR do not provide there; no secret passes through on any platform.
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

function stubWindowsEnvironment() {
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  vi.stubEnv('TEMP', 'C:\\Users\\me\\AppData\\Local\\Temp')
  vi.stubEnv('TMP', 'C:\\Users\\me\\AppData\\Local\\Temp')
  vi.stubEnv('USERPROFILE', 'C:\\Users\\me')
  vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local')
  vi.stubEnv('OPENAI_API_KEY', 'sk-secret')
}

describe('Session embedding child environment', () => {
  it('carries the Windows system, temp and profile roots on win32', () => {
    stubWindowsEnvironment()
    expect(embeddingChildEnv('win32')).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
      TMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
      USERPROFILE: 'C:\\Users\\me',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    })
  })

  it('stays the minimal environment elsewhere, and never carries secrets', () => {
    stubWindowsEnvironment()
    const posix = embeddingChildEnv('darwin')
    expect(posix).not.toHaveProperty('LOCALAPPDATA')
    expect(posix).not.toHaveProperty('SystemRoot')
    expect(posix.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(Object.values(embeddingChildEnv('win32'))).not.toContain('sk-secret')
    expect(Object.values(posix)).not.toContain('sk-secret')
  })
})
