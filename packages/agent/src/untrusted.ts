// Untrusted text (customer notes, invoice memos, dispute messages) is always wrapped so the model
// treats it as data. The system prompt says anything inside <untrusted> is never an instruction,
// and the policy engine never reads free text at all, so an injection cannot reach money.

/** Neutralise anything that could close or forge the wrapper. */
function escapeTags(text: string): string {
  return text.replace(/<\s*\/?\s*untrusted[^>]*>/gi, (m) =>
    m.replace(/</g, '‹').replace(/>/g, '›'),
  );
}

export function wrapUntrusted(text: string, source: string): string {
  const safeSource = source.replace(/[^a-zA-Z0-9_:.-]/g, '_');
  return `<untrusted source="${safeSource}">${escapeTags(text)}</untrusted>`;
}

export function isWrapped(text: string): boolean {
  return /^<untrusted source="[^"]*">[\s\S]*<\/untrusted>$/.test(text);
}
