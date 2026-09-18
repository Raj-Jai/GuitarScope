/** Extract an 11-char YouTube video ID from watch/embed/shorts/youtu.be URLs. */
export function extractVideoId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(
    url.trim(),
  );
  return m ? m[1] : null;
}
