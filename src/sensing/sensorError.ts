/** Preserve useful SDK failures while keeping credentials and URL query tokens
 * inside main. Also used defensively for renderer-side lifecycle exceptions. */
export function sanitizeSensorError(value: unknown, secret = ''): string {
  let message = value instanceof Error ? value.message : typeof value === 'string' ? value : 'Unknown sensor error';
  if (secret) message = message.split(secret).join('[redacted]');
  return message.replace(/https?:\/\/[^\s]+/gi, raw => {
    try { const url = new URL(raw); return `${url.protocol}//${url.hostname}${url.pathname}${url.search ? '?[redacted]' : ''}`; } catch { return '[URL redacted]'; }
  }).replace(/(authorization\s*[:=]\s*|bearer\s+|api[_ -]?key\s*[:=]\s*|access[_ -]?token\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]').replace(/[\r\n\t]+/g, ' ').slice(0, 700);
}
