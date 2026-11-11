import { WGPUView } from "./core/WGPUView";
import { GpuWindow } from "./core/GpuWindow";
declare class GPUTexture {
    ptr: number;
    format?: number;
    private readonly _views;
    private readonly _presentationContext?;
    constructor(ptr: number, format?: number, presentationContext?: GPUCanvasContext);
    createView(descriptor?: {
        format?: string;
        dimension?: string;
        baseMipLevel?: number;
        mipLevelCount?: number;
        baseArrayLayer?: number;
        arrayLayerCount?: number;
        aspect?: string;
        usage?: number;
    }): GPUTextureView;
    destroy(): void;
    _releaseReference(): void;
    private _releaseViews;
}
declare class GPUTextureView {
    ptr: number;
    format?: number;
    readonly _presentationContext?: GPUCanvasContext;
    private _onRelease?;
    constructor(ptr: number, format?: number, onRelease?: () => void, presentationContext?: GPUCanvasContext);
    _releaseReference(): void;
    release(): void;
}
declare class GPUQueue {
    ptr: number;
    _device?: GPUDevice;
    constructor(ptr: number);
    submit(commandBuffers: GPUCommandBuffer[]): void;
    writeBuffer(buffer: GPUBuffer, offset: number, data: ArrayBufferView): void;
    writeTexture(destination: {
        texture: GPUTexture;
        mipLevel?: number;
        origin?: {
            x?: number;
            y?: number;
            z?: number;
        };
    }, data: ArrayBufferView, dataLayout: {
        bytesPerRow: number;
        rowsPerImage?: number;
    }, size: {
        width: number;
        height: number;
        depthOrArrayLayers?: number;
    }): void;
    onSubmittedWorkDone(): Promise<boolean>;
    _releaseReference(releaseSurfaceContexts?: boolean): void;
}
declare class GPUDevice {
    ptr: number;
    queue: GPUQueue;
    features: Set<string>;
    limits: Record<string, number>;
    _uncapturedErrorListeners: ((event: {
        error: Error;
    }) => void)[];
    instancePtr: number | null;
    constructor(ptr: number, instancePtr?: number);
    destroy(): void;
    _invalidateInstance(instancePtr: number): void;
    private _assertLive;
    createBuffer(descriptor: {
        size: number;
        usage: number;
        mappedAtCreation?: boolean;
    }): GPUBuffer;
    createTexture(descriptor: {
        size: {
            width: number;
            height: number;
            depthOrArrayLayers?: number;
        };
        format: string;
        usage: number;
        mipLevelCount?: number;
        sampleCount?: number;
        viewFormats?: string[];
    }): GPUTexture;
    createSampler(descriptor?: {
        addressModeU?: string;
        addressModeV?: string;
        addressModeW?: string;
        magFilter?: string;
        minFilter?: string;
        mipmapFilter?: string;
        lodMinClamp?: number;
        lodMaxClamp?: number;
        compare?: string;
        maxAnisotropy?: number;
    }): GPUSampler;
    createBindGroupLayout(descriptor: {
        entries: any[];
    }): GPUBindGroupLayout;
    createBindGroup(descriptor: {
        layout: GPUBindGroupLayout;
        entries: any[];
    }): GPUBindGroup;
    createPipelineLayout(descriptor: {
        bindGroupLayouts: GPUBindGroupLayout[];
    }): GPUPipelineLayout;
    createShaderModule(descriptor: {
        code: string;
    }): GPUShaderModule;
    createRenderPipeline(descriptor: any): GPURenderPipeline;
    createComputePipeline(descriptor: {
        layout?: GPUPipelineLayout | "auto";
        compute: {
            module: GPUShaderModule;
            entryPoint?: string;
        };
    }): GPUComputePipeline;
    createCommandEncoder(): GPUCommandEncoder;
    addEventListener(type: string, handler: (event: any) => void): void;
    pushErrorScope(_filter: any): void;
    popErrorScope(): Promise<null>;
}
declare class GPUBuffer {
    ptr: number;
    size: number;
    usage: bigint;
    _device: GPUDevice;
    _mapped: boolean;
    constructor(ptr: number, size: number, usage: bigint, device: GPUDevice, mapped?: boolean);
    private _assertLive;
    getMappedRange(_offset?: number, _size?: number): any;
    mapAsync(mode?: number, offset?: number, size?: number): Promise<boolean>;
    unmap(): void;
    readSync(offset?: number, size?: number, timeoutNs?: number): ArrayBuffer | null;
    readbackAsync(dst: Uint8Array, offset?: number, size?: number, timeoutMs?: number): Promise<number>;
    destroy(): void;
}
declare class GPUSampler {
    ptr: number;
    constructor(ptr: number);
    release(): void;
}
declare class GPUBindGroupLayout {
    ptr: number;
    constructor(ptr: number);
    release(): void;
}
declare class GPUBindGroup {
    ptr: number;
    constructor(ptr: number);
    release(): void;
}
declare class GPUPipelineLayout {
    ptr: number;
    constructor(ptr: number);
    release(): void;
}
declare class GPUShaderModule {
    ptr: number;
    constructor(ptr: number);
    release(): void;
}
declare class GPURenderPipeline {
    ptr: number;
    constructor(ptr: number);
    getBindGroupLayout(index: number): GPUBindGroupLayout;
    release(): void;
}
declare class GPUComputePipeline {
    ptr: number;
    constructor(ptr: number);
    getBindGroupLayout(index: number): GPUBindGroupLayout;
    release(): void;
}
declare class GPUCommandBuffer {
    ptr: number;
    private readonly _presentationContexts;
    constructor(ptr: number, presentationContexts: Set<GPUCanvasContext>);
    _consumePresentationContexts(): GPUCanvasContext[];
    _releaseReference(): void;
}
declare class GPUCommandEncoder {
    ptr: number;
    _device: GPUDevice;
    private readonly _presentationContexts;
    constructor(ptr: number, device: GPUDevice);
    private _assertLive;
    beginRenderPass(descriptor: {
        colorAttachments: Array<{
            view: GPUTextureView;
            resolveTarget?: GPUTextureView | null;
            clearValue?: {
                r: number;
                g: number;
                b: number;
                a: number;
            };
            loadOp?: string;
            storeOp?: string;
        }>;
        depthStencilAttachment?: {
            view: GPUTextureView;
            depthClearValue?: number;
            depthLoadOp?: string;
            depthStoreOp?: string;
            depthReadOnly?: boolean;
            stencilClearValue?: number;
            stencilLoadOp?: string;
            stencilStoreOp?: string;
            stencilReadOnly?: boolean;
        };
    }): GPURenderPassEncoder;
    beginComputePass(): GPUComputePassEncoder;
    copyBufferToTexture(source: {
        buffer: GPUBuffer;
        offset?: number;
        bytesPerRow?: number;
        rowsPerImage?: number;
    }, destination: {
        texture: GPUTexture;
        mipLevel?: number;
        origin?: {
            x?: number;
            y?: number;
            z?: number;
        };
    }, size: {
        width: number;
        height: number;
        depthOrArrayLayers?: number;
    }): void;
    copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number): void;
    finish(): GPUCommandBuffer;
}
declare class GPURenderPassEncoder {
    ptr: number;
    constructor(ptr: number);
    private _assertLive;
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup, offsets?: number[]): void;
    setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
    setIndexBuffer(buffer: GPUBuffer, indexFormat: string, offset?: number, size?: number): void;
    setViewport(x: number, y: number, width: number, height: number, minDepth?: number, maxDepth?: number): void;
    setScissorRect(x: number, y: number, width: number, height: number): void;
    draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
    drawIndexed(indexCount: number, instanceCount?: number, firstIndex?: number, baseVertex?: number, firstInstance?: number): void;
    end(): void;
}
declare class GPUComputePassEncoder {
    ptr: number;
    constructor(ptr: number);
    private _assertLive;
    setPipeline(pipeline: GPUComputePipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup, offsets?: number[]): void;
    dispatchWorkgroups(x: number, y?: number, z?: number): void;
    end(): void;
}
declare class GPUAdapter {
    instancePtr: number;
    surfacePtr: number;
    features: Set<string>;
    limits: Record<string, number>;
    info: Record<string, string>;
    private _compatibleSurface;
    private readonly _devices;
    constructor(instancePtr: number, surfacePtr: number, compatibleSurface?: GPUCanvasContext);
    requestDevice(): Promise<GPUDevice>;
    _invalidateFromSurface(surface: GPUCanvasContext): void;
}
declare class GPUCanvasContext {
    surfacePtr: number;
    instancePtr: number | null;
    devicePtr: number | null;
    format: number;
    alphaMode: number;
    supportedAlphaModes: Set<number>;
    width: number;
    height: number;
    private _usage;
    private _configured;
    private _device;
    private _currentTexture;
    private readonly _adapters;
    private readonly _contextKey;
    _fallbackSize?: {
        width: number;
        height: number;
    };
    constructor(surfacePtr: number, instancePtr: number, contextKey: number);
    configure(options: {
        device: GPUDevice;
        format?: number | string;
        alphaMode?: number | string;
        usage?: number;
        size?: {
            width: number;
            height: number;
        };
    }): void;
    private _configureSurface;
    getCurrentTexture(): GPUTexture;
    present(): number | undefined;
    unconfigure(): any;
    _presentNative(): number;
    _onQueueReleased(queue: GPUQueue): void;
    _releaseForDeviceDestroy(queue: GPUQueue): boolean;
    _registerAdapter(adapter: GPUAdapter): void;
    _matchesNativeHandles(instancePtr: number, surfacePtr: number): boolean;
    _prepareRelease(): boolean;
    private _releaseCurrentTexture;
    private _assertLive;
    private _assertConfigured;
}
declare function createContext(view: WGPUView | GpuWindow): import("./webgpuContextRegistry").WebgpuContextEntry<GPUCanvasContext>;
declare function createCanvasShim(win: GpuWindow): {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
    style: {};
    getContext: (type: string) => GPUCanvasContext | null;
    getBoundingClientRect: () => {
        left: number;
        top: number;
        width: number;
        height: number;
    };
    addEventListener: () => void;
    removeEventListener: () => void;
    setAttribute: () => void;
};
declare function decodePngRGBA(data: Uint8Array): {
    width: number;
    height: number;
    data: Uint8Array<ArrayBuffer>;
};
declare const webgpu: {
    navigator: {
        requestAdapter(options?: {
            compatibleSurface?: GPUCanvasContext;
        }): Promise<GPUAdapter>;
        getPreferredCanvasFormat(): string;
    };
    createContext: typeof createContext;
    GPUCanvasContext: typeof GPUCanvasContext;
    utils: {
        createCanvasShim: typeof createCanvasShim;
        decodePngRGBA: typeof decodePngRGBA;
    };
    install(): void;
};
export { webgpu, GPUCanvasContext, GPUAdapter, GPUDevice, GPUQueue, GPUTexture, GPUTextureView, GPUBuffer, GPUSampler, GPUBindGroupLayout, GPUBindGroup, GPUPipelineLayout, GPUShaderModule, GPURenderPipeline, GPUComputePipeline, GPUCommandEncoder, GPUCommandBuffer, GPURenderPassEncoder, createCanvasShim, decodePngRGBA, };
export default webgpu;
