import { describe, expect, test } from 'vitest';
import { extractVideoIdStrict } from '../../songlab-server/validate';

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
