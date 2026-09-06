export function classifyTelegramError(err) {
  const raw = String(err?.errorMessage || err?.message || err || 'UNKNOWN_ERROR');
  const upper = raw.toUpperCase();
  const flood = upper.match(/FLOOD_WAIT[_\s-]?(\d+)?/) || upper.match(/WAIT OF (\d+) SECONDS/);
  if (flood) {
    const retry = Number(flood[1] || 0) || Number((upper.match(/WAIT OF (\d+) SECONDS/) || [])[1] || 0) || 1;
    return { code: 'FLOOD_WAIT', message: raw, retry_after: retry, definitive: false };
  }
  if (['USER_DEACTIVATED_BAN','USER_DEACTIVATED','AUTH_KEY_UNREGISTERED','SESSION_REVOKED','AUTH_KEY_DUPLICATED'].some(x => upper.includes(x))) {
    return { code: 'DEFINITIVE_AUTH_FAILURE', message: raw, definitive: true };
  }
  if (upper.includes('SESSION_PASSWORD_NEEDED')) return { code: 'PASSWORD_REQUIRED', message: raw, definitive: false };
  if (upper.includes('AUTH_USER_CANCEL')) return { code: 'AUTH_CANCELLED', message: raw, definitive: false };
  return { code: 'TEMPORARY', message: raw, definitive: false };
}
