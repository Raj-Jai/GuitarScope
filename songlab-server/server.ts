/**
 * Local companion server for Song Lab (opt-in, localhost only).
 *
 *   npm run songlab:server   # binds 127.0.0.1:8765
 *
 * POST /api/analyze {url} -> {jobId, status} then GET /api/jobs/:id polls
 * {status, stage, progress} until {status:'complete', analysis} or error.
 * Fixed pipeline only: validate URL -> yt-dlp (arg array, no shell) ->
 * ffmpeg -> existing analyzer library -> JSON. Temp files live under
 * os.tmpdir() and are always cleaned up. Never commit downloads.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { extractVideoIdStrict } from './validate';
import { loadWavStereo } from '../analyzer/wav';
import { analyzeWithBranches } from '../analyzer/branches';
import { decodeChords } from '../analyzer/decode';
import { transcribeNotes } from '../analyzer/notes';
import type { SongAnalysis } from '../analyzer/schema';

const PORT = 8765;
const HOST = '127.0.0.1';
const MAX_DURATION_SEC = 600; // 10 minutes
const MAX_BYTES = 250 * 1024 * 1024;
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_CONCURRENT = 1;

type Stage = 'queued' | 'downloading' | 'decoding' | 'analyzing' | 'complete' | 'error';

interface Job {
  jobId: string;
  url: string;
  videoId: string;
  status: 'queued' | 'running' | 'complete' | 'error';
  stage: Stage;
  progress: number; // 0..1 within stage-weighted overall
  error?: string;
  analysis?: SongAnalysis;
  startedAt: number;
}

const jobs = new Map<string, Job>();
let running = 0;

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** Loopback-only guard: browsers attach Origin; curl/scripts send none. */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function runFile(
  cmd: string,
  args: string[],
  onStdout?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: JOB_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err) => {
      if (err) {
        // Surface yt-dlp/ffmpeg's own ERROR line, not the full command.
        const text = String((err as Error & { stderr?: unknown }).stderr ?? err.message ?? err);
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        const meaningful = [...lines].reverse().find((l) => /^ERROR/i.test(l)) ?? lines[lines.length - 1] ?? 'command failed';
        reject(new Error(`${cmd} failed: ${meaningful.slice(0, 200)}`));
      } else resolve();
    });
    let buf = '';
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        onStdout?.(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
        idx = buf.indexOf('\n');
      }
    });
  });
}

async function ffprobeDurationSec(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { timeout: 60000 },
      (err, stdout) => {
        if (err) reject(new Error('Could not probe audio duration.'));
        else resolve(Number(stdout.toString().trim()));
      },
    );
  });
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

async function processJob(job: Job): Promise<void> {
  const dir = path.join(os.tmpdir(), 'guitarscope', job.jobId);
  await fs.mkdir(dir, { recursive: true });
  const fail = async (message: string): Promise<void> => {
    job.status = 'error';
    job.stage = 'error';
    job.error = message;
    await cleanup(dir);
  };
  try {
    job.status = 'running';
    // 1. Download (fixed argument array — never a shell string).
    job.stage = 'downloading';
    job.progress = 0;
    await runFile(
      'yt-dlp',
      ['--no-playlist', '-x', '--audio-format', 'wav', '-o', path.join(dir, 'audio.%(ext)s'), job.url],
      (line) => {
        const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
        if (m) job.progress = Math.min(0.99, Number(m[1]) / 100);
      },
    );
    const entries = await fs.readdir(dir);
    const wav = entries.find((e) => e.toLowerCase().endsWith('.wav'));
    if (!wav) throw new Error('Download produced no audio file.');
    const wavPath = path.join(dir, wav);
    const stat = await fs.stat(wavPath);
    if (stat.size > MAX_BYTES) throw new Error('Downloaded file exceeds the 250 MB limit.');
    // 2. Decode/standardize.
    job.stage = 'decoding';
    job.progress = 0;
    const wav48 = path.join(dir, 'audio48.wav');
    await runFile('ffmpeg', ['-y', '-v', 'error', '-i', wavPath, '-ar', '48000', '-ac', '2', wav48]);
    const duration = await ffprobeDurationSec(wav48);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read audio duration.');
    if (duration > MAX_DURATION_SEC) throw new Error('Audio exceeds the 10-minute limit.');
    const stereo = loadWavStereo(wav48, 48000);
    // 3. Analyze with the existing library (raw+harmonic; +center-diff on stereo).
    job.stage = 'analyzing';
    const frameOpts = { sampleRate: 48000, windowSize: 16384, hopSize: 4096, topN: 3 };
    const input =
      stereo.stereo && stereo.left && stereo.right
        ? { left: stereo.left, right: stereo.right }
        : { mono: stereo.mono };
    const { agreed, branches } = analyzeWithBranches(input, frameOpts);
    job.progress = 0.6;
    const chords = decodeChords(agreed, {}, 4096 / 48000);
    job.progress = 0.85;
    const notes = transcribeNotes(stereo.mono, { sampleRate: 48000 });
    job.analysis = {
      source: { type: 'youtube', videoId: job.videoId, duration },
      meta: {
        version: 1,
        sampleRate: 48000,
        windowSize: 16384,
        hopSize: 4096,
        dictionary: 'mvp60',
        branches: branches.map((b) => b.name),
        createdAt: new Date().toISOString(),
      },
      frames: [],
      chords,
      notes,
    };
    job.status = 'complete';
    job.stage = 'complete';
    job.progress = 1;
    await cleanup(dir);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  } finally {
    running--;
  }
}

export function createSongLabServer(): Server {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!originAllowed(req)) {
      sendJson(res, 403, { error: 'Forbidden.' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, version: 1 });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      let body: { url?: string };
      try {
        body = JSON.parse(await readBody(req)) as { url?: string };
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body.' });
        return;
      }
      if (!body?.url || typeof body.url !== 'string') {
        sendJson(res, 400, { error: 'Missing "url".' });
        return;
      }
      let videoId: string;
      try {
        videoId = extractVideoIdStrict(body.url);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'Invalid URL.' });
        return;
      }
      if (running >= MAX_CONCURRENT) {
        sendJson(res, 429, { error: 'Another analysis is already running (one at a time).' });
        return;
      }
      const jobId = crypto.randomBytes(8).toString('hex');
      const job: Job = {
        jobId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        startedAt: Date.now(),
      };
      jobs.set(jobId, job);
      if (jobs.size > 20) {
        const oldest = [...jobs.keys()][0];
        jobs.delete(oldest);
      }
      running++;
      void processJob(job);
      sendJson(res, 200, { jobId, status: job.status });
      return;
    }
    const jobMatch = /^\/api\/jobs\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) {
        sendJson(res, 404, { error: 'Unknown job.' });
        return;
      }
      if (Date.now() - job.startedAt > JOB_TIMEOUT_MS && job.status !== 'complete' && job.status !== 'error') {
        job.status = 'error';
        job.stage = 'error';
        job.error = 'Job timed out.';
      }
      const { analysis, ...rest } = job;
      sendJson(res, 200, analysis ? { ...rest, analysis } : rest);
      return;
    }
    sendJson(res, 404, { error: 'Not found.' });
  });
  return server;
}

const invokedAsMain = (process.argv[1] ?? '').endsWith('server.ts') || (process.argv[1] ?? '').endsWith('server.js');
if (invokedAsMain) {
  const server = createSongLabServer();
  server.on('error', (err: unknown) => {
    const code = (err as { code?: string })?.code;
    if (code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} on ${HOST} is already in use — a companion server is already running.\n` +
          `Reuse it (Song Lab will show "connected"), or stop the other instance first:\n` +
          `  kill $(ps -eo pid,args | grep "[s]onglab-server/server" | awk '{print $1}')`,
      );
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Song Lab companion listening on http://${HOST}:${PORT} (localhost only)`);
    console.log('Requires yt-dlp + ffmpeg on PATH. Temp files under os.tmpdir()/guitarscope, always cleaned.');
  });
}
