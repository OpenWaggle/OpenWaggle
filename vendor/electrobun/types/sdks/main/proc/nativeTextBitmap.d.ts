import { type Pointer } from "bun:ffi";
export declare function rasterizeNativeText(symbols: {
    rasterizeText: (text: Pointer, font: Pointer, size: number, scale: number, width: Pointer, height: Pointer) => Pointer | null;
    freeTextBitmap: (pixels: Pointer) => void;
}, text: string, fontName: string, size: number, scale: number): {
    width: number;
    height: number;
    data: Uint8Array;
} | null;
