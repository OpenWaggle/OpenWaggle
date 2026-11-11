import "./global.d.ts";
type WgpuEventTypes = "ready";
/**
 * Interface representing an <electrobun-wgpu> custom element.
 * Use this to properly type wgpu elements obtained via querySelector.
 *
 * @example
 * const wgpu = document.querySelector('electrobun-wgpu') as WgpuTagElement;
 * wgpu.toggleTransparent(true);
 */
interface WgpuTagElement extends HTMLElement {
    wgpuViewId: number | null;
    transparent: boolean;
    passthroughEnabled: boolean;
    hidden: boolean;
    toggleTransparent(transparent?: boolean): void;
    togglePassthrough(enablePassthrough?: boolean): void;
    toggleHidden(hidden?: boolean): void;
    syncDimensions(force?: boolean): void;
    runTest(): void;
    addMaskSelector(selector: string): void;
    removeMaskSelector(selector: string): void;
    on(event: WgpuEventTypes, listener: (event: CustomEvent) => void): void;
    off(event: WgpuEventTypes, listener: (event: CustomEvent) => void): void;
    emit(event: WgpuEventTypes, detail: unknown): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "electrobun-wgpu": WgpuTagElement;
    }
}
export { type WgpuTagElement, type WgpuEventTypes };
