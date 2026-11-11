export declare const native: {
    available: boolean;
    path: string | null;
    symbols: Record<string, never>;
    close: () => void;
} | {
    available: boolean;
    path: string;
    symbols: any;
    close: any;
};
declare const WGPU: {
    native: {
        available: boolean;
        path: string | null;
        symbols: Record<string, never>;
        close: () => void;
    } | {
        available: boolean;
        path: string;
        symbols: any;
        close: any;
    };
};
export default WGPU;
