import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  isSameDurableDirectoryIdentity,
  type WorkspaceDirectoryIdentity,
} from '../domain/workspace-generation'

const decimal = Schema.String.pipe(Schema.pattern(/^\d+$/))

const credentialReceiptSchema = Schema.Struct({
  targetPath: Schema.String,
  fingerprint: Schema.String,
  /** Written since #330: survives a reboot, which renumbers macOS volumes (`st_dev`). */
  directory: Schema.optional(
    Schema.Struct({ device: decimal, inode: decimal, birthtime: decimal }),
  ),
  /** Written before #330 as `${st_dev}:${st_ino}` of `fs.Stats` numbers. Read-only now. */
  directoryIdentity: Schema.optional(Schema.String.pipe(Schema.pattern(/^\d+:\d+$/))),
})

/** The destination directory a receipt was written for. */
type ReceiptDirectory =
  | { readonly kind: 'durable'; readonly identity: WorkspaceDirectoryIdentity }
  /** A legacy receipt: its device number may predate a reboot, so only the inode is usable. */
  | { readonly kind: 'legacy'; readonly inode: string }

/** The destination directory as observed now, through one open handle. */
export interface ObservedReceiptDirectory {
  /** `${st_dev}:${st_ino}` of `fs.Stats` numbers, in the format legacy receipts used. */
  readonly directoryIdentity: string
  readonly durableDirectoryIdentity: WorkspaceDirectoryIdentity
}

function invalidReceipt(cause?: unknown) {
  return new Error('Credential installation receipt is invalid.', cause ? { cause } : undefined)
}

function legacyInode(directoryIdentity: string) {
  return directoryIdentity.split(':')[1] ?? ''
}

export function credentialReceiptRecord(input: {
  readonly targetPath: string
  readonly fingerprint: string
  readonly directory: WorkspaceDirectoryIdentity
}) {
  const { device, inode, birthtime } = input.directory
  return {
    targetPath: input.targetPath,
    fingerprint: input.fingerprint,
    directory: { device, inode, birthtime },
  }
}

export function parseCredentialReceipt(value: unknown, targetPath: string) {
  let receipt: Schema.Schema.Type<typeof credentialReceiptSchema>
  try {
    receipt = decodeUnknownExactOrThrow(credentialReceiptSchema, value)
  } catch (cause) {
    throw invalidReceipt(cause)
  }
  if (receipt.targetPath !== targetPath) throw invalidReceipt()
  // A receipt carrying both prefers the durable identity; one carrying neither is refused.
  const directory: ReceiptDirectory | undefined = receipt.directory
    ? { kind: 'durable', identity: receipt.directory }
    : receipt.directoryIdentity
      ? { kind: 'legacy', inode: legacyInode(receipt.directoryIdentity) }
      : undefined
  if (!directory) throw invalidReceipt()
  return { fingerprint: receipt.fingerprint, directory }
}

/**
 * Whether the destination directory is the one a receipt was written for, possibly in an earlier
 * boot. Fails closed: a durable receipt needs the same inode and birth time (and device where no
 * birth time is recorded); a legacy receipt needs the same inode.
 */
export function isSameReceiptDirectory(
  recorded: ReceiptDirectory,
  observed: ObservedReceiptDirectory,
) {
  return recorded.kind === 'durable'
    ? isSameDurableDirectoryIdentity(observed.durableDirectoryIdentity, recorded.identity)
    : legacyInode(observed.directoryIdentity) === recorded.inode
}
