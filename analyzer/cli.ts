#!/usr/bin/env node
/**
 * Offline song analyzer CLI (M1).
 *   npm run analyze -- --input song.wav --output song.analysis.json [--top 3] [--chroma]
 *                          [--branches raw|multi] [--stereo]
 * Mono WAVs only run raw+harmonic; stereo files add the center-diff branch.
 * Reads WAV (any rate/channels; resampled to 48k mono), runs frame-level
 * chord candidates, writes the analysis JSON contract. Chords/notes event
 * decoding lands in M3/M5; this milestone proves full-song throughput.
 */
import { writeFileSync } from 'node:fs';
import { loadWavStereo } from './wav';
import { analyzeFrames } from './frames';
import { analyzeWithBranches } from './branches';
import { decodeChords } from './decode';
import { transcribeNotes } from './notes';
import { analyzeRhythm } from './rhythm';
import { validateAnalysis, type SongAnalysis } from './schema';

function argVal(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i])) return args[i + 1];
    for (const n of names) {
      if (args[i].startsWith(n + '=')) return args[i].slice(n.length + 1);
    }
  }
  return undefined;
}

function main(): void {
  const args = process.argv.slice(2);
  const input = argVal(args, '--input', '-i');
  const output = argVal(args, '--output', '-o') ?? 'analysis.json';
  const topN = parseInt(argVal(args, '--top') ?? '3', 10);
  const includeChroma = args.includes('--chroma');
  const multi = (argVal(args, '--branches') ?? 'raw') === 'multi';
  if (!input) {
    console.error('Usage: npm run analyze -- --input song.wav --output song.analysis.json [--top 3] [--chroma] [--branches raw|multi] [--stereo]');
    process.exitCode = 1;
    return;
  }
  const started = performance.now();
  const stereo = loadWavStereo(input, 48000);
  const mono = stereo.mono;
  const sampleRate = stereo.sampleRate;
  console.log(`loaded ${(mono.length / sampleRate).toFixed(1)}s @${sampleRate}Hz ${stereo.stereo ? 'stereo' : 'mono'} (${mono.length} samples)`);
  const frameOpts = { sampleRate, windowSize: 16384, hopSize: 4096, topN, includeChroma };
  let frames;
  let branchNames = ['raw'];
  let t0 = performance.now();
  if (multi) {
    const branchInput =
      stereo.stereo && stereo.left && stereo.right
        ? { left: stereo.left, right: stereo.right }
        : { mono };
    const res = analyzeWithBranches(branchInput, frameOpts);
    frames = res.agreed;
    branchNames = res.branches.map((b) => b.name);
    console.log(`  branches [${branchNames.join('+')}] agreeRate=${res.agreeRate.toFixed(2)}`);
  } else {
    frames = analyzeFrames(mono, frameOpts).frames;
  }
  const analysisMs = performance.now() - t0;
  const audioSeconds = mono.length / sampleRate;
  const chords = decodeChords(frames, {}, 4096 / sampleRate);
  console.log(`  decoded ${chords.length} chord events`);
  const t1 = performance.now();
  const notes = transcribeNotes(mono, { sampleRate });
  console.log(`  transcribed ${notes.length} note events in ${((performance.now() - t1) / 1000).toFixed(1)}s`);
  const t2 = performance.now();
  const rhythm = analyzeRhythm(mono, sampleRate);
  console.log(
    `  rhythm: ${rhythm.tempo ? `${rhythm.tempo.bpm} BPM (conf ${rhythm.tempo.confidence})` : 'no tempo'} + ${rhythm.beats.length} beats in ${((performance.now() - t2) / 1000).toFixed(1)}s`,
  );
  const analysis: SongAnalysis = {
    source: { type: 'file', fileName: input.split('/').pop() ?? input, duration: audioSeconds },
    meta: {
      version: 2,
      sampleRate,
      windowSize: 16384,
      hopSize: 4096,
      dictionary: 'mvp60',
      branches: branchNames,
      createdAt: new Date().toISOString(),
    },
    frames,
    chords,
    notes,
    tempo: rhythm.tempo ?? undefined,
    meter: rhythm.meter,
    beats: rhythm.beats,
  };
  const errors = validateAnalysis(analysis);
  if (errors.length > 0) {
    console.error('invalid analysis:', errors.join('; '));
    process.exitCode = 1;
    return;
  }
  writeFileSync(output, JSON.stringify(analysis));
  const wall = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `wrote ${output}: ${frames.length} frames, ` +
      `dsp ${(analysisMs / 1000).toFixed(1)}s, wall ${wall}s ` +
      `(${(audioSeconds / (analysisMs / 1000)).toFixed(1)}x realtime for DSP)`,
  );
}

main();
