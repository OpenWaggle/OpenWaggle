/**
 * The part of Bun's `bun:ffi` that OpenWaggle and the Electrobun SDK's declarations use (ADR
 * 0064). Bun's own types (`bun-types`) also retype globals such as `fetch`, which the rest of the
 * main process and its tests are written against Node's types for, so the main process declares
 * only this module. Types are named as strings (`'ptr'`), which `dlopen` accepts like `FFIType`.
 */
declare module 'bun:ffi' {
  /** A native address. Bun hands it out as a number; it is never null (Bun returns `null`). */
  export type Pointer = number & { readonly __bunPointer: unique symbol }

  export type FFITypeName = 'ptr' | 'void' | 'bool' | 'u32' | 'i32' | 'cstring'

  interface FFIValues {
    readonly ptr: Pointer | null
    readonly void: undefined
    readonly bool: boolean
    readonly u32: number
    readonly i32: number
    readonly cstring: Pointer | null
  }

  export interface FFIFunction {
    readonly args: readonly FFITypeName[]
    readonly returns: FFITypeName
  }

  type FFIArguments<Names extends readonly FFITypeName[]> = {
    -readonly [Index in keyof Names]: FFIValues[Names[Index]]
  }

  export interface Library<Functions extends Readonly<Record<string, FFIFunction>>> {
    readonly symbols: {
      readonly [Name in keyof Functions]: (
        ...args: FFIArguments<Functions[Name]['args']>
      ) => FFIValues[Functions[Name]['returns']]
    }
    close(): void
  }

  export function dlopen<const Functions extends Readonly<Record<string, FFIFunction>>>(
    path: string,
    symbols: Functions,
  ): Library<Functions>

  /** The address of a typed array's or buffer's bytes, valid while it is referenced. */
  export function ptr(view: ArrayBufferView | ArrayBuffer): Pointer

  export class CString extends String {
    constructor(pointer: Pointer, byteOffset?: number, byteLength?: number)
  }
}
