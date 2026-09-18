import { describe, expect, test } from 'vitest';
import { extractVideoIdStrict } from '../../songlab-server/validate';
import { buildYtDlpArgs, parseDownloadProgress, selectEvictions } from '../../songlab-server/server';

describe('extractVideoIdStrict', () => {
  test('accepts single-video URLs', () => {
    expect(extractVideoIdStrict('https://www.youtube.com/watch?v=hwZNL7QVJjE')).toBe('hwZNL7QVJjE');
    expect(extractVideoIdStrict('https://youtu.be/hwZNL7QVJjE')).toBe('hwZNL7QVJjE');
    expect(extractVideoIdStrict('https://www.youtube.com/embed/hwZNL7QVJjE')).toBe('hwZNL7QVJjE');
    expect(extractVideoIdStrict('https://www.youtube.com/shorts/hwZNL7QVJjE')).toBe('hwZNL7QVJjE');
    expect(extractVideoIdStrict('http://m.youtube.com/watch?v=hwZNL7QVJjE&t=30s')).toBe('hwZNL7QVJjE');
  });
  test('rejects playlists even with a video id', () => {
    expect(() => extractVideoIdStrict('https://www.youtube.com/watch?v=hwZNL7QVJjE&list=PLabc1234567')).toThrow(/laylist/);
  });
  test('rejects channels, searches, and non-YouTube targets', () => {
    expect(() => extractVideoIdStrict('https://www.youtube.com/@somechannel')).toThrow();
    expect(() => extractVideoIdStrict('https://www.youtube.com/results?search_query=x')).toThrow();
    expect(() => extractVideoIdStrict('https://vimeo.com/12345')).toThrow();
    expect(() => extractVideoIdStrict('file:///etc/passwd')).toThrow();
    expect(() => extractVideoIdStrict('http://localhost:8765/api/health')).toThrow();
    expect(() => extractVideoIdStrict('not a url')).toThrow();
    expect(() => extractVideoIdStrict('javascript:alert(1)')).toThrow();
  });
});

describe('buildYtDlpArgs', () => {
  const url = 'https://www.youtube.com/watch?v=hwZNL7QVJjE';
  test('fixed pipeline, URL always last', () => {
    const args = buildYtDlpArgs(url, '/tmp/x/audio.%(ext)s', '');
    expect(args).toEqual([
      '--no-playlist', '-x', '--audio-format', 'wav',
      '--concurrent-fragments', '4',
      '-o', '/tmp/x/audio.%(ext)s', url,
    ]);
  });
  test('known browser adds cookie extraction', () => {
    const args = buildYtDlpArgs(url, 'o', 'chrome');
    expect(args).toContain('--cookies-from-browser');
    expect(args).toContain('chrome');
    expect(args[args.length - 1]).toBe(url);
  });
  test('unknown browser names are ignored (never passed through)', () => {
    const args = buildYtDlpArgs(url, 'o', 'evil; rm -rf /');
    expect(args).not.toContain('--cookies-from-browser');
    expect(args[args.length - 1]).toBe(url);
  });
  test('pinned player client is allowlisted', () => {
    const args = buildYtDlpArgs(url, 'o', '', 'visionos');
    expect(args).toContain('--extractor-args');
    expect(args).toContain('youtube:player_client=visionos');
    expect(args[args.length - 1]).toBe(url);
    const bad = buildYtDlpArgs(url, 'o', '', 'evil; rm -rf /');
    expect(bad).not.toContain('--extractor-args');
  });
});

describe('parseDownloadProgress', () => {
  test('percent with speed and ETA', () => {
    expect(parseDownloadProgress('[download]  12.3% of 4.50MiB at 1.23MiB/s ETA 00:03')).toEqual({
      pct: 0.123,
      detail: '1.23MiB/s ETA 00:03',
    });
  });
  test('percent alone', () => {
    expect(parseDownloadProgress('[download] 100% of 4.50MiB')).toEqual({ pct: 0.99, detail: '' });
  });
  test('non-progress lines ignored', () => {
    expect(parseDownloadProgress('[youtube] Downloading webpage')).toBeNull();
    expect(parseDownloadProgress('')).toBeNull();
  });
});

describe('selectEvictions', () => {
  test('keeps newest N, evicts oldest first', () => {
    expect(selectEvictions(['a', 'b', 'c'], 5)).toEqual([]);
    expect(selectEvictions(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5)).toEqual(['a', 'b']);
  });
});
