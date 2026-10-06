import path from 'node:path';

const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.eps': 'application/postscript', '.ps': 'application/postscript',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.tex': 'text/plain; charset=utf-8',
  '.bib': 'text/plain; charset=utf-8', '.sty': 'text/plain; charset=utf-8', '.cls': 'text/plain; charset=utf-8',
  '.bst': 'text/plain; charset=utf-8', '.mmd': 'text/plain; charset=utf-8', '.c': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8', '.ts': 'text/plain; charset=utf-8', '.js': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8', '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8', '.html': 'text/plain; charset=utf-8', '.htm': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function contentTypeFor(p: string): string {
  return TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
}
