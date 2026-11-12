'use client';
// "Connect PayPal": the merchant pastes their sandbox app's Client ID and Secret. The server
// tests them with PayPal, stores them encrypted, and never sends the Secret back.
import { useEffect, useState } from 'react';

interface Status {
  connected: boolean;
  source: 'settings' | 'server' | 'none';
  clientIdEnding: string | null;
  webhookIdSet: boolean;
  savedAt: string | null;
  sandbox: boolean;
  canEdit: boolean;
}

export function PayPalSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [webhookId, setWebhookId] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'risk' } | null>(null);

  useEffect(() => {
    fetch('/api/settings/paypal', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setMessage({ text: 'Could not load the settings.', tone: 'risk' }));
  }, []);

  async function send(method: 'POST' | 'DELETE') {
    setBusy(true);
    setMessage(null);
    const r = await fetch('/api/settings/paypal', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        method === 'POST' ? { clientId, secret, webhookId, passcode } : { passcode },
      ),
    }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as (Status & { message?: string }) | null;
    setBusy(false);
    if (!r?.ok || !j) {
      setMessage({ text: j?.message ?? 'Something went wrong. Try again.', tone: 'risk' });
      return;
    }
    setStatus(j);
    setSecret('');
    setPasscode('');
    setMessage({
      text:
        method === 'POST'
          ? 'Connected. PayPal accepted the keys and Live mode now uses them.'
          : 'Disconnected. Vigil no longer uses the keys saved here.',
      tone: 'ok',
    });
  }

  if (!status) return <p className="muted">Loading…</p>;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Your PayPal connection</h2>
            <p className="muted">What Live mode is using right now.</p>
          </div>
        </div>
        {status.connected ? (
          <p className="callout ok">
            <strong>Connected</strong> to a PayPal {status.sandbox ? 'sandbox' : ''} app (Client ID
            ending <span className="mono">{status.clientIdEnding}</span>),{' '}
            {status.source === 'settings'
              ? `saved here${status.savedAt ? ` on ${new Date(status.savedAt).toLocaleString()}` : ''}.`
              : 'set up by whoever runs Vigil.'}{' '}
            {status.webhookIdSet
              ? 'PayPal confirmations (webhook) are on.'
              : 'PayPal confirmations (webhook) are not set, so fixes stop at "Done".'}
          </p>
        ) : (
          <p className="callout wait">
            <strong>Not connected.</strong> Add your PayPal keys below to use Live mode. Until then,
            Vigil shows demo data.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Connect PayPal</h2>
            <p className="muted">
              Where to find these: <strong>developer.paypal.com</strong> → Apps &amp; Credentials →
              make sure <strong>Sandbox</strong> is selected → open your app.
            </p>
          </div>
        </div>
        {!status.canEdit && (
          <p className="callout wait">
            Changing keys here is turned off. Whoever runs Vigil needs to set an{' '}
            <strong>admin passcode</strong> (<span className="mono">ADMIN_PASSCODE</span>, 8+
            characters) on the server. This stops visitors to a shared site from changing it.
          </p>
        )}
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send('POST');
          }}
        >
          <label>
            Client ID
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              disabled={!status.canEdit || busy}
            />
          </label>
          <label>
            Secret
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
              required
              disabled={!status.canEdit || busy}
            />
            <span className="muted">Stored encrypted. Vigil never shows it again.</span>
          </label>
          <label>
            Webhook ID (optional)
            <input
              value={webhookId}
              onChange={(e) => setWebhookId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={!status.canEdit || busy}
            />
            <span className="muted">
              Lets PayPal confirm each fix. Find it under your app → Webhooks.
            </span>
          </label>
          <label>
            Admin passcode
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoComplete="current-password"
              required
              disabled={!status.canEdit || busy}
            />
          </label>
          <div className="settings-actions">
            <button type="submit" className="primary" disabled={!status.canEdit || busy}>
              {busy ? 'Checking with PayPal…' : 'Test and save'}
            </button>
            {status.source === 'settings' && (
              <button
                type="button"
                className="danger"
                disabled={!status.canEdit || busy || !passcode}
                onClick={() => void send('DELETE')}
              >
                Disconnect
              </button>
            )}
          </div>
          {message && (
            <p className={`callout ${message.tone}`} role="status">
              {message.text}
            </p>
          )}
        </form>
      </section>
    </>
  );
}
