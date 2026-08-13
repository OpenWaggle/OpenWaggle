export interface ScrollPosition {
    readonly scrollTop: number;
    readonly clientHeight: number;
    readonly scrollHeight: number;
}
export declare function isScrollContainerNearBottom(position: ScrollPosition, thresholdPx?: number): boolean;
export declare function getMaxScrollTop(el: HTMLElement): number;
export declare function scrollElementToBottom(el: HTMLElement, behavior: ScrollBehavior): void;
