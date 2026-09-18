import { describe, expect, test } from 'vitest';
import {
  checkAudioSupport,
  getAudioSupport,
  mapMicFailure,
  MicError,
} from '../lib/audio/microphone';

function domErr(name: string, message = 'x'): DOMException {
  return new DOMException(message, name);
}

describe('mapMicFailure', () => {
  test('NotAllowedError -> permission-denied', () => {
    const e = mapMicFailure(domErr('NotAllowedError'));
    expect(e).toBeInstanceOf(MicError);
    expect(e.reason).toBe('permission-denied');
  });
  test('NotFoundError / OverconstrainedError -> no-microphone', () => {
    expect(mapMicFailure(domErr('NotFoundError')).reason).toBe('no-microphone');
    expect(mapMicFailure(domErr('OverconstrainedError')).reason).toBe('no-microphone');
  });
  test('NotReadableError -> unknown with helpful text', () => {
    const e = mapMicFailure(domErr('NotReadableError', 'busy'));
    expect(e.reason).toBe('unknown');
    expect(e.message).toMatch(/another app/);
  });
  test('arbitrary values -> unknown without throwing', () => {
    expect(mapMicFailure(null).reason).toBe('unknown');
    expect(mapMicFailure('nope').reason).toBe('unknown');
    expect(mapMicFailure(undefined).reason).toBe('unknown');
  });
  test('MicError passes through with its reason', () => {
    const original = new MicError('worklet-load-failed', 'boom');
    expect(mapMicFailure(original)).toBe(original);
  });
});

describe('getAudioSupport', () => {
  test('insecure origin wins over missing APIs (phone on http://LAN-ip)', () => {
    expect(
      getAudioSupport({ isSecureContext: false, hasMediaDevices: false, hasAudioContext: true }),
    ).toBe('insecure-origin');
    expect(
      getAudioSupport({ isSecureContext: false, hasMediaDevices: true, hasAudioContext: true }),
    ).toBe('insecure-origin');
  });
  test('secure but missing APIs -> not-supported', () => {
    expect(
      getAudioSupport({ isSecureContext: true, hasMediaDevices: false, hasAudioContext: true }),
    ).toBe('not-supported');
    expect(
      getAudioSupport({ isSecureContext: true, hasMediaDevices: true, hasAudioContext: false }),
    ).toBe('not-supported');
  });
  test('secure with APIs -> ok', () => {
    expect(
      getAudioSupport({ isSecureContext: true, hasMediaDevices: true, hasAudioContext: true }),
    ).toBe('ok');
  });
});

describe('checkAudioSupport', () => {
  test('insecure origin throws actionable insecure-origin error', () => {
    try {
      checkAudioSupport({ isSecureContext: false });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MicError);
      expect((err as MicError).reason).toBe('insecure-origin');
      expect((err as MicError).message).toMatch(/HTTPS/);
      expect((err as MicError).message).toMatch(/dev:https/);
    }
  });
  test('ok state does not throw', () => {
    expect(() =>
      checkAudioSupport({ isSecureContext: true, hasMediaDevices: true, hasAudioContext: true }),
    ).not.toThrow();
  });
});
