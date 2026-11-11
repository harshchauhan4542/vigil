'use client';
import { useState } from 'react';

export function JudgeActions({ mode }: { mode: 'live' | 'replay' }) {
  const [msg, setMsg] = useState<string | null>(null);
  const live = mode === 'live';

  async function detect() {
    setMsg('Checking your PayPal account…');
    const r = await fetch('/api/demo/detect', { method: 'POST' });
    const j = (await r.json()) as { ok?: boolean; error?: string };
    setMsg(
      j.ok
        ? 'Checking now. Any new problems will show up on the Problems page in a few seconds.'
        : `Couldn't check PayPal (${j.error ?? r.status}). Try again in a minute.`,
    );
  }

  async function reset() {
    setMsg('Starting over with fresh test data…');
    const r = await fetch('/api/demo/reset', { method: 'POST' });
    const j = (await r.json()) as { ok?: boolean; error?: string };
    setMsg(
      j.ok
        ? 'Creating fresh test orders in your PayPal sandbox. This takes a minute or two.'
        : `Couldn't reset (${j.error ?? r.status}). Try again in a minute.`,
    );
  }

  return (
    <>
      <div className="row">
        <a className="btn-link primary" href="/control-room">
          See the problems
        </a>
        <button
          disabled={!live}
          onClick={detect}
          title="Vigil also checks by itself every 15 minutes"
        >
          Check PayPal now
        </button>
        <button disabled={!live} onClick={reset} title="Creates new test orders and payments">
          Start over with fresh test data
        </button>
      </div>
      <p className="status-line muted" role="status">
        {msg ??
          (live
            ? 'Vigil checks your PayPal account every 15 minutes. Press "Check PayPal now" to check right away.'
            : 'These two buttons only work in Live mode. Switch with Demo / Live at the top right.')}
      </p>
    </>
  );
}
