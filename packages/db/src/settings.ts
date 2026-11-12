// Key/value app settings (see `app_settings`). Values are opaque strings to this package.
import { eq } from 'drizzle-orm';
import type { Executor } from './client.js';
import { appSettings } from './schema.js';

export async function getSetting(db: Executor, key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function putSetting(db: Executor, key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function deleteSetting(db: Executor, key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}
