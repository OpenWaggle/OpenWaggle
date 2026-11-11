export declare const WGPULoadOp: {
    readonly Undefined: 0;
    readonly Load: 1;
    readonly Clear: 2;
};
export declare const WGPUStoreOp: {
    readonly Undefined: 0;
    readonly Store: 1;
    readonly Discard: 2;
};
type LoadOp = string | number | null | undefined;
type StoreOp = string | number | null | undefined;
export type RenderPassDepthStencilFields = {
    depthClearValue?: number;
    depthLoadOp?: LoadOp;
    depthStoreOp?: StoreOp;
    depthReadOnly?: boolean;
    stencilClearValue?: number;
    stencilLoadOp?: LoadOp;
    stencilStoreOp?: StoreOp;
    stencilReadOnly?: boolean;
};
export declare function mapLoadOp(op: LoadOp): number;
export declare function mapStoreOp(op: StoreOp): number;
export declare function normalizeRenderPassDepthStencilFields(descriptor: RenderPassDepthStencilFields): {
    depthLoadOp: number;
    depthStoreOp: number;
    depthClearValue: number;
    depthReadOnly: boolean;
    stencilLoadOp: number;
    stencilStoreOp: number;
    stencilClearValue: number;
    stencilReadOnly: boolean;
};
export {};
