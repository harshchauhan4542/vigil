// Where recordings live: memory (tests), JSON files (fixtures/recordings, committed), or the
// `recordings` table (see @vigil/db createDbFixtureStore).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type RecordingKind = 'paypal' | 'llm';

export interface Recording {
  key: string;
  kind: RecordingKind;
  request: { method: string; url: string; body: unknown };
  response: { status: number; headers: Record<string, string>; body: string };
  recordedAt: string;
}

export interface FixtureStore {
  get(kind: RecordingKind, key: string): Promise<Recording | null>;
  put(recording: Recording): Promise<void>;
}

export class MemoryFixtureStore implements FixtureStore {
  readonly recordings = new Map<string, Recording>();

  async get(kind: RecordingKind, key: string) {
    return this.recordings.get(`${kind}/${key}`) ?? null;
  }

  async put(recording: Recording) {
    this.recordings.set(`${recording.kind}/${recording.key}`, recording);
  }
}

/** One pretty-printed JSON file per recording: `<dir>/<kind>/<key>.json`. */
export class FileFixtureStore implements FixtureStore {
  constructor(private readonly dir: string) {}

  private file(kind: RecordingKind, key: string) {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error(`Invalid fixture key: ${key}`);
    return path.join(this.dir, kind, `${key}.json`);
  }

  async get(kind: RecordingKind, key: string) {
    try {
      return JSON.parse(await readFile(this.file(kind, key), 'utf8')) as Recording;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async put(recording: Recording) {
    const file = this.file(recording.kind, recording.key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
  }
}

/** Read from several stores in order (e.g. DB first, then committed files); write to the first. */
export class LayeredFixtureStore implements FixtureStore {
  constructor(private readonly stores: readonly FixtureStore[]) {
    if (stores.length === 0) throw new Error('LayeredFixtureStore needs at least one store');
  }

  async get(kind: RecordingKind, key: string) {
    for (const s of this.stores) {
      const hit = await s.get(kind, key);
      if (hit) return hit;
    }
    return null;
  }

  async put(recording: Recording) {
    await this.stores[0]!.put(recording);
  }
}
