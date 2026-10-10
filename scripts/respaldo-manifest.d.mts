type Manifest = {
  version: 1;
  entries: ({ path: string; type: 'dir' } | { path: string; type: 'file'; bytes: number; sha256: string })[];
};
export declare function inventory(root: string): Promise<Manifest>;
export declare function createManifest(root: string, manifestFile: string): Promise<Manifest>;
export declare function verifyManifest(root: string, manifestFile: string): Promise<Manifest>;
