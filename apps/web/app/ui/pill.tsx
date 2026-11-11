import type { Tone } from './labels';

/** A status pill: plain-language label, the raw code as a tooltip. */
export function Pill({ label, tone, code }: { label: string; tone: Tone; code?: string }) {
  return (
    <span className={`pill ${tone}`} title={code}>
      {label}
    </span>
  );
}
