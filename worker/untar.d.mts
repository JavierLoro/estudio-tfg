export const MAX_ENTRIES: number;
export class TarError extends Error { status: number; constructor(message: string, status?: number); }
export function extractTar(stream: AsyncIterable<Uint8Array>, dest: string, options?: { maxBytes?: number }): Promise<void>;
