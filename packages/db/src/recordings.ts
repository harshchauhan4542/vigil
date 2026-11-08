// FixtureStore backed by the `recordings` table (hosted demo keeps fresh recordings here;
// committed JSON fixtures in fixtures/recordings are the read-only fallback).
import type { FixtureStore, Recording, RecordingKind } from '@vigil/replay';
import { and, eq } from 'drizzle-orm';
import type { Executor } from './client.js';
import { recordings } from './schema.js';

export function createDbFixtureStore(db: Executor): FixtureStore {
  return {
    async get(kind: RecordingKind, key: string) {
      const [row] = await db
        .select()
        .from(recordings)
        .where(and(eq(recordings.fixtureKey, key), eq(recordings.kind, kind)));
      return row ? (row.response as unknown as { recording: Recording }).recording : null;
    },
    async put(recording: Recording) {
      const values = {
        fixtureKey: recording.key,
        kind: recording.kind,
        request: recording.request,
        // Stored whole so get() returns exactly what was recorded.
        response: { recording },
        recordedAt: new Date(recording.recordedAt),
      };
      await db
        .insert(recordings)
        .values(values)
        .onConflictDoUpdate({ target: recordings.fixtureKey, set: values });
    },
  };
}
