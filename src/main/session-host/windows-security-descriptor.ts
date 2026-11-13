/**
 * The Windows security descriptors the Session Host gives its state directory, endpoint capability
 * file and named pipe (`windows-user-only-security.ts`): owned by the current user, with a
 * protected DACL holding one full-control ACE for that user and nothing else. Pure byte layouts of
 * `SID`, `ACL` and self-relative `SECURITY_DESCRIPTOR`, so the checks run on every platform.
 */
export type WindowsUserOnlyKind = 'directory' | 'file' | 'pipe'

const ACL_REVISION = 2
const ACL_HEADER_BYTES = 8
const ACE_HEADER_BYTES = 4
const ACE_MASK_BYTES = 4
const ACCESS_ALLOWED_ACE_TYPE = 0
const OBJECT_INHERIT_ACE = 0x01
const CONTAINER_INHERIT_ACE = 0x02
const SID_HEADER_BYTES = 8
const SID_SUB_AUTHORITY_BYTES = 4
const SID_AUTHORITY_OFFSET = 2
const SID_AUTHORITY_BYTES = 6
const SID_MAX_SUB_AUTHORITIES = 15
const SE_DACL_PRESENT = 0x0004
const SE_DACL_PROTECTED = 0x1000
const SE_SELF_RELATIVE = 0x8000
const DESCRIPTOR_HEADER_BYTES = 20
const DESCRIPTOR_CONTROL_OFFSET = 2
const DESCRIPTOR_OWNER_OFFSET = 4
const DESCRIPTOR_DACL_OFFSET = 16
const ACL_SIZE_OFFSET = 2
const ACL_COUNT_OFFSET = 4
const HEX_RADIX = 16
const ACE_SIZE_OFFSET = 2
const BYTE_BITS = 8
/** `FileSystemRights.FullControl`. */
const FILE_FULL_CONTROL = 0x001f_01ff
/**
 * `PipeAccessRights.FullControl`. Specific rights, not `GENERIC_ALL`: Windows maps generic bits
 * before a read-back returns them.
 */
const PIPE_FULL_CONTROL = 0x001f_019f

interface ExpectedAce {
  readonly flags: number
  readonly mask: number
}

const EXPECTED_ACE: Record<WindowsUserOnlyKind, ExpectedAce> = {
  // Inherited by what the directory holds, so a file created in it is user-only too.
  directory: { flags: OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE, mask: FILE_FULL_CONTROL },
  file: { flags: 0, mask: FILE_FULL_CONTROL },
  pipe: { flags: 0, mask: PIPE_FULL_CONTROL },
}

export class WindowsUserOnlyVerificationError extends Error {
  constructor(kind: WindowsUserOnlyKind, reason: string) {
    super(`Windows user-only ${kind} security verification failed: ${reason}.`)
    this.name = 'WindowsUserOnlyVerificationError'
  }
}

/** The length of the SID at `offset`, or null when `bytes` cannot hold it. */
function sidLength(bytes: Uint8Array, offset: number) {
  if (offset + SID_HEADER_BYTES > bytes.byteLength) return null
  const subAuthorities = bytes[offset + 1] ?? 0
  if (subAuthorities > SID_MAX_SUB_AUTHORITIES) return null
  const length = SID_HEADER_BYTES + SID_SUB_AUTHORITY_BYTES * subAuthorities
  return offset + length <= bytes.byteLength ? length : null
}

/** The SID at the start of `bytes` (a `TOKEN_USER`'s, say), copied; throws if it is malformed. */
export function sidAt(bytes: Uint8Array, offset = 0) {
  const length = sidLength(bytes, offset)
  if (length === null || bytes[offset] !== 1) throw new Error('The Windows user SID is malformed.')
  return Uint8Array.from(bytes.subarray(offset, offset + length))
}

/** `S-1-5-21-…`, as `ConvertSidToStringSid` writes it. */
export function sidString(sid: Uint8Array) {
  const view = new DataView(sid.buffer, sid.byteOffset, sid.byteLength)
  let authority = 0n
  for (let index = 0; index < SID_AUTHORITY_BYTES; index += 1) {
    authority = (authority << BigInt(BYTE_BITS)) | BigInt(sid[SID_AUTHORITY_OFFSET + index] ?? 0)
  }
  const subAuthorities: string[] = []
  for (let index = 0; index < (sid[1] ?? 0); index += 1) {
    subAuthorities.push(
      String(view.getUint32(SID_HEADER_BYTES + SID_SUB_AUTHORITY_BYTES * index, true)),
    )
  }
  return ['S', String(sid[0] ?? 0), String(authority), ...subAuthorities].join('-')
}

/** An `ACL` with the one `ACCESS_ALLOWED_ACE` a `kind` gets, granting `user` full control. */
export function userOnlyAcl(user: Uint8Array, kind: WindowsUserOnlyKind) {
  const expected = EXPECTED_ACE[kind]
  const aceBytes = ACE_HEADER_BYTES + ACE_MASK_BYTES + user.byteLength
  const acl = new Uint8Array(ACL_HEADER_BYTES + aceBytes)
  const view = new DataView(acl.buffer)
  view.setUint8(0, ACL_REVISION)
  view.setUint16(ACL_SIZE_OFFSET, acl.byteLength, true)
  view.setUint16(ACL_COUNT_OFFSET, 1, true)
  view.setUint8(ACL_HEADER_BYTES, ACCESS_ALLOWED_ACE_TYPE)
  view.setUint8(ACL_HEADER_BYTES + 1, expected.flags)
  view.setUint16(ACL_HEADER_BYTES + ACE_SIZE_OFFSET, aceBytes, true)
  view.setUint32(ACL_HEADER_BYTES + ACE_HEADER_BYTES, expected.mask, true)
  acl.set(user, ACL_HEADER_BYTES + ACE_HEADER_BYTES + ACE_MASK_BYTES)
  return acl
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}

function checkOwner(descriptor: Uint8Array, view: DataView, user: Uint8Array) {
  const ownerOffset = view.getUint32(DESCRIPTOR_OWNER_OFFSET, true)
  const ownerLength = ownerOffset === 0 ? null : sidLength(descriptor, ownerOffset)
  if (ownerLength === null) return false
  return sameBytes(descriptor.subarray(ownerOffset, ownerOffset + ownerLength), user)
}

/** The offset of the DACL's only ACE, or the reason there is none. */
function onlyAceOffset(descriptor: Uint8Array, view: DataView, control: number) {
  if ((control & SE_DACL_PRESENT) === 0) return 'there is no DACL'
  if ((control & SE_DACL_PROTECTED) === 0) return 'the DACL is not protected'
  const daclOffset = view.getUint32(DESCRIPTOR_DACL_OFFSET, true)
  if (daclOffset === 0 || daclOffset + ACL_HEADER_BYTES > descriptor.byteLength) {
    return 'there is no DACL'
  }
  if (view.getUint16(daclOffset + ACL_COUNT_OFFSET, true) !== 1) {
    return 'the DACL does not hold exactly one ACE'
  }
  const ace = daclOffset + ACL_HEADER_BYTES
  if (ace + ACE_HEADER_BYTES + ACE_MASK_BYTES > descriptor.byteLength) return 'the ACE is truncated'
  return ace
}

/** Null when the ACE at `ace` allows `user` exactly what `kind` gets, else the reason. */
function aceMismatch(
  descriptor: Uint8Array,
  view: DataView,
  ace: number,
  user: Uint8Array,
  kind: WindowsUserOnlyKind,
) {
  const expected = EXPECTED_ACE[kind]
  if (view.getUint8(ace) !== ACCESS_ALLOWED_ACE_TYPE) return 'the ACE does not allow access'
  if (view.getUint8(ace + 1) !== expected.flags) return 'the ACE has unexpected flags'
  const mask = view.getUint32(ace + ACE_HEADER_BYTES, true)
  if (mask !== expected.mask) {
    return `the access mask 0x${mask.toString(HEX_RADIX)} is not 0x${expected.mask.toString(HEX_RADIX)}`
  }
  const sidOffset = ace + ACE_HEADER_BYTES + ACE_MASK_BYTES
  const length = sidLength(descriptor, sidOffset)
  const sizeMatches =
    length !== null &&
    view.getUint16(ace + ACE_SIZE_OFFSET, true) === ACE_HEADER_BYTES + ACE_MASK_BYTES + length
  if (!sizeMatches || !sameBytes(descriptor.subarray(sidOffset, sidOffset + length), user)) {
    return 'the ACE grants another principal'
  }
  return null
}

/**
 * Checks a self-relative security descriptor read back from an object: owned by `user`, with a
 * protected DACL of exactly one ACE, which allows `user` the full control `kind` gets, with the
 * inheritance `kind` gets and no other flag. Throws `WindowsUserOnlyVerificationError` otherwise.
 */
export function verifyUserOnlyDescriptor(
  descriptor: Uint8Array,
  user: Uint8Array,
  kind: WindowsUserOnlyKind,
) {
  const fail = (reason: string) => new WindowsUserOnlyVerificationError(kind, reason)
  if (descriptor.byteLength < DESCRIPTOR_HEADER_BYTES) throw fail('the descriptor is truncated')
  const view = new DataView(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength)
  const control = view.getUint16(DESCRIPTOR_CONTROL_OFFSET, true)
  if ((control & SE_SELF_RELATIVE) === 0) throw fail('the descriptor is not self-relative')
  if (!checkOwner(descriptor, view, user)) throw fail('the owner is not the current user')
  const ace = onlyAceOffset(descriptor, view, control)
  if (typeof ace === 'string') throw fail(ace)
  const mismatch = aceMismatch(descriptor, view, ace, user, kind)
  if (mismatch !== null) throw fail(mismatch)
}
