import { loadWebEnv } from '@vigil/config';
import { cookies } from 'next/headers';
import { ControlRoom } from './control-room';

export const dynamic = 'force-dynamic';

export default async function ControlRoomPage() {
  const env = loadWebEnv();
  const cookieMode = (await cookies()).get('vigil_mode')?.value;
  const mode = cookieMode === 'live' || cookieMode === 'replay' ? cookieMode : env.VIGIL_MODE;
  // The AG Studio licence key is a client-side licence by design (it unlocks the watermark).
  return <ControlRoom mode={mode} studioLicense={env.AG_STUDIO ?? ''} />;
}
