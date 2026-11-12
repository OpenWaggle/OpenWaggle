import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { ClipboardShape } from '../../clipboard'

export interface ClipboardContractHarness {
  readonly subject: ClipboardShape
  /** A small image in an encoding the port accepts (PNG). */
  readonly encodedImage: Uint8Array
  /** Whether the system clipboard now holds an image. */
  readonly holdsImage: () => boolean
}

export const clipboardContract = definePortContract<ClipboardContractHarness>('Clipboard', {
  'reads back the text it wrote': async ({ subject }) => {
    subject.writeText('copied from OpenWaggle')
    expect(subject.readText()).toBe('copied from OpenWaggle')
  },

  'writes a decodable image and leaves the clipboard alone for bytes it cannot decode': async ({
    subject,
    encodedImage,
    holdsImage,
  }) => {
    expect(subject.writeImage(Uint8Array.from([1, 2, 3]))).toBe('undecodable')
    expect(holdsImage()).toBe(false)
    expect(subject.writeImage(encodedImage)).toBe('written')
    expect(holdsImage()).toBe(true)
  },
})
