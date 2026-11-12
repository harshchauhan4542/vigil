'use client';
import { useEffect, useState } from 'react';
// Shared top bar: wordmark, page links, the light/dark toggle and the Demo / Live switch.

type Page = 'control-room' | 'audit' | 'settings' | 'judge';

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: 'control-room', href: '/control-room', label: 'Problems' },
  { page: 'audit', href: '/audit', label: 'History' },
  { page: 'settings', href: '/settings', label: 'Settings' },
  { page: 'judge', href: '/judge', label: 'Help' },
];

async function switchMode(next: 'live' | 'replay') {
  await fetch('/api/demo/mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: next }),
  });
  window.location.reload();
}

/** Sun/moon button: switches the soft light and dark themes and remembers the choice. */
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  const flip = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('vigil-theme', next);
    } catch {
      // Storage blocked: the theme still applies for this page view.
    }
    setDark(!dark);
  };
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button className="theme-toggle" onClick={flip} aria-label={label} title={label}>
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </g>
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

export function TopBar({
  page,
  mode,
  children,
}: {
  page: Page;
  mode?: 'live' | 'replay';
  children?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <a className="wordmark" href="/control-room" aria-label="Vigil home">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3.4" fill="currentColor" />
        </svg>
        Vigil
      </a>
      <nav className="nav" aria-label="Pages">
        {LINKS.map((l) => (
          <a key={l.page} href={l.href} aria-current={l.page === page ? 'page' : undefined}>
            {l.label}
          </a>
        ))}
      </nav>
      <span className="spacer" />
      {children}
      <ThemeToggle />
      {mode && (
        <div className="mode-switch" role="group" aria-label="Data mode">
          <button
            aria-pressed={mode === 'replay'}
            title="Sample data, safe to click around"
            onClick={() => mode !== 'replay' && switchMode('replay')}
          >
            Demo
          </button>
          <button
            aria-pressed={mode === 'live'}
            title="Your PayPal test (sandbox) account and a real AI"
            onClick={() => mode !== 'live' && switchMode('live')}
          >
            Live
          </button>
        </div>
      )}
    </header>
  );
}
