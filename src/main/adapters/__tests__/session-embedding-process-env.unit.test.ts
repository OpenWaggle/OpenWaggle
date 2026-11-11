import { afterEach, describe, expect, it, vi } from 'vitest'

/** `env` decodes the process environment once at import, so each case imports after stubbing. */
async function loadEmbeddingChildEnv() {
  vi.resetModules()
  return (await import('../session-embedding-process')).embeddingChildEnv
}

/**
 * R6 P3-7: the embedding child runs onnxruntime-node in the shell's script runtime (Bun runs the
 * script as is, so it never carries Electron's `ELECTRON_RUN_AS_NODE`) with a minimal environment. On
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
  // An Electron parent (an install updating to this build) may still carry it.
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
}

describe('Session embedding child environment', () => {
  it('carries the Windows system, temp and profile roots on win32', async () => {
    stubWindowsEnvironment()
    const embeddingChildEnv = await loadEmbeddingChildEnv()
    expect(embeddingChildEnv('win32')).toMatchObject({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
      TMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
      USERPROFILE: 'C:\\Users\\me',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    })
  })

  it('stays the minimal environment elsewhere, and never carries secrets', async () => {
    stubWindowsEnvironment()
    const embeddingChildEnv = await loadEmbeddingChildEnv()
    const posix = embeddingChildEnv('darwin')
    expect(posix).not.toHaveProperty('LOCALAPPDATA')
    expect(posix).not.toHaveProperty('SystemRoot')
    expect(posix).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(embeddingChildEnv('win32')).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(Object.values(embeddingChildEnv('win32'))).not.toContain('sk-secret')
    expect(Object.values(posix)).not.toContain('sk-secret')
  })
})
