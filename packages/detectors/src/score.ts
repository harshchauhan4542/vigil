// Prioritisation: money at risk × urgency.

const HOUR = 3_600_000;

/** 4 = deadline passed, 3 = ≤ 12 h, 2 = ≤ 24 h, 1 = later or no deadline. */
export function urgency(deadlineAt: Date | null, now: Date): 1 | 2 | 3 | 4 {
  if (!deadlineAt) return 1;
  const hoursLeft = (deadlineAt.getTime() - now.getTime()) / HOUR;
  if (hoursLeft <= 0) return 4;
  if (hoursLeft <= 12) return 3;
  if (hoursLeft <= 24) return 2;
  return 1;
}

export function score(amountAtRiskCents: number, deadlineAt: Date | null, now: Date) {
  const u = urgency(deadlineAt, now);
  return { severity: u, score: Math.abs(amountAtRiskCents) * u };
}

/** Highest score first; ties broken by earliest deadline, then target ref (stable). */
export function byPriority<T extends { score: number; deadlineAt: Date | null; targetRef: string }>(
  a: T,
  b: T,
): number {
  if (b.score !== a.score) return b.score - a.score;
  const da = a.deadlineAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const db = b.deadlineAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return a.targetRef < b.targetRef ? -1 : a.targetRef > b.targetRef ? 1 : 0;
}
