/**
 * Companion-server address resolution.
 * The helper binds loopback by default but may live on the LAN
 * (SONGLAB_HOST) while the page itself was opened via a LAN URL —
 * notably on phones, where 127.0.0.1 means the phone, not the laptop.
 */

/** Candidate bases in probe order: loopback first, then the page host. */
export function candidateBases(pageHostname: string): string[] {
  const host = (pageHostname || '').trim().toLowerCase();
  const bases = ['http://127.0.0.1:8765'];
  if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    bases.push(`http://${host}:8765`);
  }
  return bases;
}

/** True when a page at this hostname can ever reach a companion. */
export function companionReachableNote(pageHostname: string, secure: boolean): string | null {
  const host = (pageHostname || '').trim().toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (loopback) return null; // 127.0.0.1 path just works
  // LAN host: plain http page + http helper is fine; https page + http
  // helper is blocked as mixed content (helper has no TLS yet).
  if (secure) {
    return 'opened via HTTPS LAN address: the local analyzer needs plain HTTP or a trusted-TLS helper (not yet supported)';
  }
  return null;
}
