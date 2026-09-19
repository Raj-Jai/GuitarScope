import { describe, expect, test } from 'vitest';
import { extractVideoIdStrict } from '../../songlab-server/validate';
import { buildYtDlpArgs, isAllowedOrigin, parseDownloadProgress, selectEvictions } from '../../songlab-server/server';
import { candidateBases, companionReachableNote } from '../lib/song/companion';

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

describe('isAllowedOrigin', () => {
  const local = new Set(['localhost', '127.0.0.1', '::1', '10.105.24.22']);
  test('no origin (curl/scripts) allowed', () => {
    expect(isAllowedOrigin(undefined, local)).toBe(true);
  });
  test('pages served from this machine allowed (loopback + own LAN IP)', () => {
    expect(isAllowedOrigin('http://localhost:5199', local)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5199', local)).toBe(true);
    expect(isAllowedOrigin('https://10.105.24.22:5200', local)).toBe(true);
  });
  test('foreign websites blocked', () => {
    expect(isAllowedOrigin('https://evil.com', local)).toBe(false);
    expect(isAllowedOrigin('http://10.9.9.9:5199', local)).toBe(false);
    expect(isAllowedOrigin('not a url', local)).toBe(false);
  });
});

describe('candidateBases', () => {
  test('loopback page -> loopback only', () => {
    expect(candidateBases('localhost')).toEqual(['http://127.0.0.1:8765']);
    expect(candidateBases('127.0.0.1')).toEqual(['http://127.0.0.1:8765']);
    expect(candidateBases('')).toEqual(['http://127.0.0.1:8765']);
  });
  test('LAN page -> loopback first, then page host (phone fix)', () => {
    expect(candidateBases('10.105.24.22')).toEqual([
      'http://127.0.0.1:8765',
      'http://10.105.24.22:8765',
    ]);
  });
});

describe('companionReachableNote', () => {
  test('loopback needs no note', () => {
    expect(companionReachableNote('localhost', true)).toBeNull();
  });
  test('plain-HTTP LAN page is fine', () => {
    expect(companionReachableNote('10.0.0.5', false)).toBeNull();
  });
  test('HTTPS LAN page warns about mixed content', () => {
    expect(companionReachableNote('10.0.0.5', true)).toMatch(/HTTPS/);
  });
});
