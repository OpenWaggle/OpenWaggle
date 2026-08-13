export declare const WHISPER_TARGET_SAMPLE_RATE = 16000;
interface DecodedAudioBuffer {
    durationSeconds: number;
    sampleRate: number;
    samples: Float32Array;
}
export declare function downsampleAudio(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array;
export declare function decodeAudioBlob(blob: Blob): Promise<DecodedAudioBuffer>;
export declare function trimSilence(samples: Float32Array, sampleRate: number, threshold?: number, paddingMs?: number): Float32Array;
export declare function toPcm16(samples: Float32Array): Uint8Array;
export {};
