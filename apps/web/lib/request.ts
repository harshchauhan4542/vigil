// Per-request helpers: which mode (Live/Replay) this judge is in, and the matching server.
import { VigilMode } from '@vigil/core';
import { MODE_COOKIE, cookies } from './guards';
import { getServer, type Server } from './server';

export function requestMode(req: Request): VigilMode | undefined {
  const parsed = VigilMode.safeParse(cookies(req)[MODE_COOKIE]);
  return parsed.success ? parsed.data : undefined;
}

export function serverFor(req: Request): Promise<Server> {
  return getServer(requestMode(req));
}

export type IdParams = { params: Promise<{ id: string }> };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
