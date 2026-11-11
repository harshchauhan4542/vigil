import { cookies } from 'next/headers';
import { defaultMode, getServer } from '../../lib/server';
import { TopBar } from '../ui/top-bar';
import { JudgeActions } from './judge-actions';

export const dynamic = 'force-dynamic';

const TRIES: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Approve a fix',
    body: 'On the Problems page, click a row. Read what the fix does and why the AI suggests it, then press Approve and watch PayPal confirm it.',
  },
  {
    title: 'Try to approve the same fix twice',
    body: 'Open the same fix in two browser tabs and approve in both. It only happens once at PayPal.',
  },
  {
    title: 'Approve a large amount',
    body: 'The $612 held payment is above the $500 limit, so Vigil asks you to type the exact amount before it will go ahead.',
  },
  {
    title: 'See a trick get blocked',
    body: 'One order has a note that tries to fool the AI into refunding $900. The safety rules block it, and it is marked as needing your attention.',
  },
  {
    title: 'See what happens when PayPal says no',
    body: 'On a held payment, open "Technical details", pick a failure under "Simulate PayPal failure", then approve. Vigil shows that PayPal refused and that no money moved.',
  },
  {
    title: 'Check the history',
    body: (
      <>
        <a href="/audit">History</a> lists every step Vigil, the AI and you took. Entries can never
        be changed or deleted.
      </>
    ),
  },
];

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
      <TopBar page="judge" mode={s.mode} />
      <main className="page">
        <div className="page-intro">
          <h1>How Vigil works</h1>
          <p>
            Vigil watches your PayPal account for money problems, like a held payment that is about
            to expire. An AI suggests a fix, safety rules check it, and nothing happens until you
            press Approve.
          </p>
        </div>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{s.mode === 'live' ? 'You are in Live mode' : 'You are in Demo mode'}</h2>
              <p className="muted">
                {s.mode === 'live'
                  ? 'Connected to your PayPal test (sandbox) account, with a real AI.'
                  : 'Sample data that behaves the same every time. Safe to click anything.'}
              </p>
            </div>
          </div>
          {s.fallback && (
            <p className="callout wait">
              Live mode isn't working right now ({s.fallback.reason}), so you are seeing demo data.
            </p>
          )}
          <JudgeActions mode={s.mode} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Things to try</h2>
          </div>
          <ul className="tries">
            {TRIES.map((t) => (
              <li key={t.title}>
                <strong>{t.title}</strong>
                <span className="muted">{t.body}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Sandbox buyer login</h2>
              <p className="muted">
                A pretend PayPal buyer, not a real account. You only need it in Live mode, to pay
                for the fresh test orders after you reset the demo data.
              </p>
            </div>
          </div>
          {buyerEmail ? (
            <dl className="creds">
              <dt>Email</dt>
              <dd>{buyerEmail}</dd>
              <dt>Password</dt>
              <dd>{buyerPassword ?? 'see the Devpost page'}</dd>
            </dl>
          ) : (
            <p className="muted">Not set on this deployment. See the Devpost page.</p>
          )}
        </section>
      </main>
    </>
  );
}
