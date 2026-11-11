/**
 * Return the WGPU-view namespace key for a render target.
 *
 * GpuWindow IDs and WGPUView IDs come from independent counters. A GpuWindow
 * renders through its backing WGPUView, so keying it by the window ID can
 * collide with an unrelated child WGPUView and return the wrong surface.
 */
export declare function getWebgpuContextKey(target: {
    id: number;
    wgpuViewId?: number;
}): number;
