'use client';
import { useState } from 'react';

export function JudgeActions({ mode }: { mode: 'live' | 'replay' }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function setMode(next: 'live' | 'replay') {
    await fetch('/api/demo/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    });
    window.location.reload();
  }

  async function detect() {
    setMsg('Running detection…');
    const r = await fetch('/api/demo/detect', { method: 'POST' });
    const j = (await r.json()) as { ok?: boolean; error?: string };
    setMsg(
      j.ok
        ? 'Detection started: new exceptions appear in the control room.'
        : `Not run: ${j.error ?? r.status}`,
    );
  }

  async function reset() {
    setMsg('Resetting…');
    const r = await fetch('/api/demo/reset', { method: 'POST' });
    const j = (await r.json()) as { ok?: boolean; error?: string };
    setMsg(
      j.ok
        ? 'Fresh demo data is being created (a minute or two).'
        : `Not reset: ${j.error ?? r.status}`,
    );
  }

  return (
    <div className="row">
      <button onClick={() => setMode(mode === 'live' ? 'replay' : 'live')}>
        Switch to {mode === 'live' ? 'Replay' : 'Live'}
      </button>
      <button
        disabled={mode === 'replay'}
        onClick={reset}
        title="Live only: new holds, captures and ledger rows"
      >
        Reset demo data
      </button>
      <button
        disabled={mode === 'replay'}
        onClick={detect}
        title="Live only: sweep PayPal now (the cron does this every 15 min)"
      >
        Run detection now
      </button>
      <a href="/control-room">Open the control room →</a>
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
