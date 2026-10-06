import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return part.slice(i + 1).trim();
      }
    }
  }
  return null;
}

export function isAuthorized(req: FastifyRequest, token: string): boolean {
  if (!token) return true;
  const h = req.headers.authorization;
  if (h && /^Bearer\s+/i.test(h) && safeEqual(h.replace(/^Bearer\s+/i, '').trim(), token)) return true;
  const c = cookieValue(req.headers.cookie, 'et_token');
  return c !== null && safeEqual(c, token);
}
