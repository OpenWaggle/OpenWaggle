/**
 * `heic-decode` ships no types. Its default export decodes one HEIC/HEIF buffer into RGBA pixels,
 * applying the container's own rotation and mirroring.
 */
declare module 'heic-decode' {
  export interface DecodedHeicImage {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number
  }

  export default function decodeHeic(input: {
    readonly buffer: Uint8Array
  }): Promise<DecodedHeicImage>
}
