import { describe, expect, it } from 'vitest'
import {
  sidAt,
  sidString,
  userOnlyAcl,
  verifyUserOnlyDescriptor,
  type WindowsUserOnlyKind,
} from '../windows-security-descriptor'
import {
  secureWindowsUserOnlyWith,
  type WindowsSecurityKernel,
} from '../windows-user-only-security'

/** S-1-5-21-1000-2000-3000-1001: revision 1, five sub-authorities, NT authority 5. */
function sid(...subAuthorities: number[]) {
  const bytes = new Uint8Array(8 + 4 * subAuthorities.length)
  const view = new DataView(bytes.buffer)
  bytes[0] = 1
  bytes[1] = subAuthorities.length
  bytes[7] = 5
  for (const [index, value] of subAuthorities.entries()) view.setUint32(8 + 4 * index, value, true)
  return bytes
}

const USER = sid(21, 1000, 2000, 3000, 1001)
const OTHER = sid(21, 1000, 2000, 3000, 1002)
const EVERYONE = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0])

interface Ace {
  readonly type?: number
  readonly flags?: number
  readonly mask: number
  readonly sid: Uint8Array
}

function aceBytes(ace: Ace) {
  const bytes = new Uint8Array(8 + ace.sid.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, ace.type ?? 0)
  view.setUint8(1, ace.flags ?? 0)
  view.setUint16(2, bytes.byteLength, true)
  view.setUint32(4, ace.mask, true)
  bytes.set(ace.sid, 8)
  return bytes
}

function aclBytes(aces: readonly Ace[]) {
  const entries = aces.map(aceBytes)
  const acl = new Uint8Array(8 + entries.reduce((sum, bytes) => sum + bytes.byteLength, 0))
  const view = new DataView(acl.buffer)
  view.setUint8(0, 2)
  view.setUint16(2, acl.byteLength, true)
  view.setUint16(4, aces.length, true)
  let offset = 8
  for (const entry of entries) {
    acl.set(entry, offset)
    offset += entry.byteLength
  }
  return acl
}

/** A self-relative descriptor, as GetSecurityInfo returns one. */
function descriptor(input: {
  readonly owner?: Uint8Array | null
  readonly protectedDacl?: boolean
  readonly aces?: readonly Ace[] | null
  readonly selfRelative?: boolean
}) {
  const owner = input.owner === undefined ? USER : input.owner
  const acl = input.aces === null ? null : aclBytes(input.aces ?? [])
  const ownerBytes = owner ?? new Uint8Array()
  const bytes = new Uint8Array(20 + ownerBytes.byteLength + (acl?.byteLength ?? 0))
  const view = new DataView(bytes.buffer)
  bytes[0] = 1
  let control = input.selfRelative === false ? 0 : 0x8000
  if (acl) control |= 0x0004
  if (input.protectedDacl !== false) control |= 0x1000
  view.setUint16(2, control, true)
  view.setUint32(4, owner ? 20 : 0, true)
  bytes.set(ownerBytes, 20)
  if (acl) {
    view.setUint32(16, 20 + ownerBytes.byteLength, true)
    bytes.set(acl, 20 + ownerBytes.byteLength)
  }
  return bytes
}

const FILE_FULL = 0x1f01ff
const PIPE_FULL = 0x1f019f

function accepted(bytes: Uint8Array, kind: WindowsUserOnlyKind) {
  try {
    verifyUserOnlyDescriptor(bytes, USER, kind)
    return true
  } catch {
    return false
  }
}

describe('Windows user-only security descriptors', () => {
  it('reads a SID and writes it as ConvertSidToStringSid does', () => {
    const token = new Uint8Array(64)
    token.set(USER, 16)
    expect(sidString(sidAt(token, 16))).toBe('S-1-5-21-1000-2000-3000-1001')
    expect(sidString(EVERYONE)).toBe('S-1-1-0')
    expect(() => sidAt(new Uint8Array([1, 15, 0, 0]))).toThrow('malformed')
    expect(() => sidAt(Uint8Array.from([2, 0, 0, 0, 0, 0, 0, 5]))).toThrow('malformed')
  })

  it('builds the one-ACE DACL each kind gets, which its own check accepts', () => {
    for (const [kind, flags, mask] of [
      ['directory', 3, FILE_FULL],
      ['file', 0, FILE_FULL],
      ['pipe', 0, PIPE_FULL],
    ] as const) {
      const acl = userOnlyAcl(USER, kind)
      const view = new DataView(acl.buffer)
      expect(view.getUint8(0)).toBe(2)
      expect(view.getUint16(2, true)).toBe(acl.byteLength)
      expect(view.getUint16(4, true)).toBe(1)
      expect(view.getUint8(9)).toBe(flags)
      expect(view.getUint32(12, true)).toBe(mask)
      expect(acl.subarray(16)).toEqual(USER)
      expect(accepted(descriptor({ aces: [{ flags, mask, sid: USER }] }), kind)).toBe(true)
    }
  })

  it.each([
    ['read only', { aces: [{ mask: 0x120089, sid: USER }] }],
    ['missing change permissions', { aces: [{ mask: 0x1b019f, sid: USER }] }],
    ['missing create instance', { aces: [{ mask: 0x1f019b, sid: USER }] }],
    ['extra system security', { aces: [{ mask: 0x11f019f, sid: USER }] }],
    ['generic all', { aces: [{ mask: 0x10000000, sid: USER }] }],
    ['wrong owner', { owner: OTHER, aces: [{ mask: PIPE_FULL, sid: USER }] }],
    ['no owner', { owner: null, aces: [{ mask: PIPE_FULL, sid: USER }] }],
    ['everyone', { aces: [{ mask: PIPE_FULL, sid: EVERYONE }] }],
    [
      'extra principal',
      {
        aces: [
          { mask: PIPE_FULL, sid: USER },
          { mask: 0x120089, sid: EVERYONE },
        ],
      },
    ],
    ['unprotected', { protectedDacl: false, aces: [{ mask: PIPE_FULL, sid: USER }] }],
    ['deny ace', { aces: [{ type: 1, mask: PIPE_FULL, sid: USER }] }],
    ['inherit only', { aces: [{ flags: 0x08, mask: PIPE_FULL, sid: USER }] }],
    ['inherited', { aces: [{ flags: 0x10, mask: PIPE_FULL, sid: USER }] }],
    ['empty dacl', { aces: [] }],
    ['no dacl (everyone allowed)', { aces: null }],
    ['absolute descriptor', { selfRelative: false, aces: [{ mask: PIPE_FULL, sid: USER }] }],
  ])('rejects a pipe descriptor that is not user-only: %s', (_name, input) => {
    expect(accepted(descriptor(input), 'pipe')).toBe(false)
  })

  it('rejects a directory whose ACE would not reach what it holds, and a truncated descriptor', () => {
    expect(accepted(descriptor({ aces: [{ mask: FILE_FULL, sid: USER }] }), 'directory')).toBe(
      false,
    )
    expect(accepted(descriptor({ aces: [{ flags: 3, mask: FILE_FULL, sid: USER }] }), 'file')).toBe(
      false,
    )
    const whole = descriptor({ aces: [{ mask: FILE_FULL, sid: USER }] })
    expect(accepted(whole.subarray(0, whole.byteLength - 4), 'file')).toBe(false)
    expect(accepted(whole.subarray(0, 12), 'file')).toBe(false)
  })
})

function fakeKernel(readBack: (kind: WindowsUserOnlyKind) => Uint8Array) {
  const calls: string[] = []
  const pending = new Map<bigint, Uint8Array>()
  let next = 1n
  const take = (bytes: Uint8Array) => {
    const address = next++
    pending.set(address, bytes)
    return address
  }
  const kernel: WindowsSecurityKernel = {
    tokenUser: () => {
      const bytes = new Uint8Array(64)
      bytes.set(USER, 16)
      return { bytes, sidOffset: 16 }
    },
    setNamed: (path, owner, dacl) => {
      calls.push(`set ${path} ${String(owner.byteLength)} ${String(dacl[9])}`)
      return 0
    },
    getNamed: (path) => {
      calls.push(`get ${path}`)
      return { error: 0, descriptor: take(readBack(path.endsWith('dir') ? 'directory' : 'file')) }
    },
    openPipe: (path, access) => {
      calls.push(`open ${path} 0x${access.toString(16)}`)
      return path.includes('missing') ? { handle: null, error: 2 } : { handle: 7n, error: 0 }
    },
    setHandle: (handle) => {
      calls.push(`set-handle ${String(handle)}`)
      return 0
    },
    getHandle: (handle) => {
      calls.push(`get-handle ${String(handle)}`)
      return { error: 0, descriptor: take(readBack('pipe')) }
    },
    takeDescriptor: (address) => {
      calls.push(`free ${String(address)}`)
      const bytes = pending.get(address)
      if (!bytes) throw new Error('freed twice')
      pending.delete(address)
      return bytes
    },
    closeHandle: (handle) => void calls.push(`close ${String(handle)}`),
  }
  return { kernel, calls }
}

const USER_ONLY: Record<WindowsUserOnlyKind, Uint8Array> = {
  directory: descriptor({ aces: [{ flags: 3, mask: FILE_FULL, sid: USER }] }),
  file: descriptor({ aces: [{ mask: FILE_FULL, sid: USER }] }),
  pipe: descriptor({ aces: [{ mask: PIPE_FULL, sid: USER }] }),
}

describe('Windows user-only security', () => {
  it('sets each target, reads it back, frees the read-back and returns the SID', () => {
    const { kernel, calls } = fakeKernel((kind) => USER_ONLY[kind])

    expect(
      secureWindowsUserOnlyWith(kernel, [
        { kind: 'directory', path: 'C:\\state\\dir' },
        { kind: 'file', path: 'C:\\state\\capability' },
        { kind: 'pipe', path: '\\\\.\\pipe\\owned' },
      ]),
    ).toEqual({ userSid: 'S-1-5-21-1000-2000-3000-1001' })
    expect(calls).toEqual([
      'set C:\\state\\dir 28 3',
      'get C:\\state\\dir',
      'free 1',
      'set C:\\state\\capability 28 0',
      'get C:\\state\\capability',
      'free 2',
      // READ_CONTROL | WRITE_DAC | WRITE_OWNER: never read or write access.
      'open \\\\.\\pipe\\owned 0xe0000',
      'set-handle 7',
      'get-handle 7',
      'free 3',
      'close 7',
    ])
  })

  it('fails closed when a read-back is not user-only, and still closes the pipe handle', () => {
    const weak = descriptor({ protectedDacl: false, aces: [{ mask: PIPE_FULL, sid: USER }] })
    const { kernel, calls } = fakeKernel(() => weak)

    expect(() =>
      secureWindowsUserOnlyWith(kernel, [{ kind: 'file', path: 'C:\\state\\capability' }]),
    ).toThrow('Windows user-only file security verification failed: the DACL is not protected.')
    expect(() =>
      secureWindowsUserOnlyWith(kernel, [{ kind: 'pipe', path: '\\\\.\\pipe\\owned' }]),
    ).toThrow('pipe security verification failed')
    expect(calls.at(-1)).toBe('close 7')
  })

  it('stops at the first target that fails, with its Win32 code', () => {
    const { kernel, calls } = fakeKernel((kind) => USER_ONLY[kind])

    expect(() =>
      secureWindowsUserOnlyWith(kernel, [
        { kind: 'pipe', path: '\\\\.\\pipe\\missing' },
        { kind: 'file', path: 'C:\\state\\capability' },
      ]),
    ).toThrow('Windows user-only pipe security failed at open (Win32 code 2).')
    expect(calls).toEqual(['open \\\\.\\pipe\\missing 0xe0000'])
    const failing = { ...kernel, setNamed: () => 5 }
    expect(() =>
      secureWindowsUserOnlyWith(failing, [{ kind: 'directory', path: 'C:\\state\\dir' }]),
    ).toThrow('directory security failed at set (Win32 code 5)')
  })

  it('requires a target', () => {
    expect(() => secureWindowsUserOnlyWith(fakeKernel(() => USER_ONLY.file).kernel, [])).toThrow(
      'At least one',
    )
  })
})
