import { cookies } from 'next/headers';
import { defaultMode, getServer, readReplayInfo } from '../../lib/server';
import { ControlRoom } from './control-room';

export const dynamic = 'force-dynamic';

export default async function ControlRoomPage() {
  const cookieMode = (await cookies()).get('vigil_mode')?.value;
  const requested = cookieMode === 'live' || cookieMode === 'replay' ? cookieMode : defaultMode();
  const server = await getServer(requested);
  // The AG Studio licence key is a client-side licence by design (it unlocks the watermark).
  return (
    <ControlRoom
      mode={server.mode}
      fallbackReason={server.fallback?.reason ?? null}
      replaySynthetic={server.mode === 'replay' && (readReplayInfo()?.synthetic ?? false)}
      serverNow={server.gate.now?.().toISOString() ?? new Date().toISOString()}
      studioLicense={server.env.AG_STUDIO ?? ''}
    />
  );
}
