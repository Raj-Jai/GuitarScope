/**
 * Strict YouTube watch-URL validation for the local companion server.
 * Only single-video watch URLs are accepted — never playlists, channels,
 * searches, or non-YouTube targets. Returns the 11-char video ID.
 */
export function extractVideoIdStrict(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('Not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) YouTube URLs are accepted.');
  }
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') {
    const m = /^\/([\w-]{11})\/?$/.exec(url.pathname);
    id = m ? m[1] : null;
  } else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') {
      const v = url.searchParams.get('v');
      id = v && /^[\w-]{11}$/.test(v) ? v : null;
    } else {
      const m = /^\/(embed|shorts|live)\/([\w-]{11})\/?$/.exec(url.pathname);
      id = m ? m[2] : null;
    }
  }
  if (!id) {
    throw new Error('Only single YouTube video URLs are accepted (no playlists, channels, or searches).');
  }
  // Playlists must be explicit opt-in later — reject playlist URLs outright.
  if (url.searchParams.get('list')) {
    throw new Error('Playlist URLs are not accepted; paste a single video URL.');
  }
  return id;
}
