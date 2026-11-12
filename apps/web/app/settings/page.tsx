import { cookies } from 'next/headers';
import { defaultMode, getServer } from '../../lib/server';
import { TopBar } from '../ui/top-bar';
import { PayPalSettings } from './paypal-settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const cookieMode = (await cookies()).get('vigil_mode')?.value;
  const requested = cookieMode === 'live' || cookieMode === 'replay' ? cookieMode : defaultMode();
  const s = await getServer(requested);
  return (
    <>
      <TopBar page="settings" mode={s.mode} />
      <main className="page">
        <div className="page-intro">
          <h1>Settings</h1>
          <p>
            Connect your PayPal account so Vigil can watch it in Live mode. Vigil only works with a
            PayPal <strong>sandbox</strong> (test) app, never real money.
          </p>
        </div>
        <PayPalSettings />
      </main>
    </>
  );
}
