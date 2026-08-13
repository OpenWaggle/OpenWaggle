/**
 * Width of the Changed-file navigator, draggable and persisted.
 *
 * Deliberately local rather than reusing useRightSidebarResizeRail: that hook is
 * typed and positioned for the app-level right sidebar (absolute inset rail,
 * main-content min-width coupling), so reusing it would mean generalising it
 * first. This is the smaller half of that work, kept until a second caller earns
 * the abstraction.
 */
export declare function useNavigatorResize(): {
    width: number;
    isResizing: boolean;
    startResizing: () => void;
    nudge: (delta: number) => void;
    minWidth: number;
    maxWidth: number;
};
