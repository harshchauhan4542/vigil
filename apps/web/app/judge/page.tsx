import { cookies } from 'next/headers';
import { defaultMode, getServer } from '../../lib/server';
import { JudgeActions } from './judge-actions';

export const dynamic = 'force-dynamic';

/** /judge: mode switch, demo reset, the sandbox buyer login, and what to try. */
export default async function JudgePage() {
  const cookieMode = (await cookies()).get('vigil_mode')?.value;
  const requested = cookieMode === 'live' || cookieMode === 'replay' ? cookieMode : defaultMode();
  const s = await getServer(requested);
  // Sandbox-only test credentials, meant to be shared with judges (never a real account).
  const buyerEmail = s.env.PAYPAL_SANDBOX_PERSONAL_EMAIL;
  const buyerPassword = s.env.PAYPAL_SANDBOX_PERSONAL_PASSWORD;
  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="/control-room">
          VIGIL
        </a>
        <span className="muted">Judge panel</span>
      </header>
      <main style={{ padding: 20, maxWidth: 860 }}>
        <section className="panel">
          <h2>
            Mode:{' '}
            {s.mode === 'live' ? 'Live (PayPal sandbox + Claude)' : 'Replay (recorded, zero keys)'}
          </h2>
          {s.fallback && (
            <p className="bad">Live is unavailable ({s.fallback.reason}); showing Replay.</p>
          )}
          <JudgeActions mode={s.mode} />
        </section>
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Sandbox buyer login</h2>
          {buyerEmail ? (
            <p className="mono">
              {buyerEmail} / {buyerPassword ?? '(see Devpost page)'}
            </p>
          ) : (
            <p className="muted">Not configured on this deployment (see the Devpost page).</p>
          )}
          <p className="muted">
            Only needed to approve freshly seeded PayPal buyer-approval links in Live mode.
          </p>
        </section>
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Things to try</h2>
          <ol>
            <li>
              Select an exception → read the Proposal Card (policy checklist, rationale, evidence) →
              Approve.
            </li>
            <li>
              Open the same proposal in two tabs and approve in both: one execution, one PayPal
              effect.
            </li>
            <li>
              The $612 hold is above the $500 cap: the card asks you to type the exact amount.
            </li>
            <li>
              The filter-papers order carries a note telling the AI to refund $900: its proposal is
              POLICY_REJECTED.
            </li>
            <li>
              On a capture/void/refund proposal, pick “Simulate PayPal failure”
              (PayPal-Mock-Response) and approve.
            </li>
            <li>
              <a href="/audit">/audit</a>: every step in a hash-chained, append-only log.
            </li>
          </ol>
        </section>
      </main>
    </>
  );
}
