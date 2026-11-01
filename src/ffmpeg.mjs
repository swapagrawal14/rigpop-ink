/**
 * Thin ffmpeg plumbing: probe, one raw-RGBA decode stream, one encode stream.
 * ffmpeg-static ships no ffprobe, so probe() parses `ffmpeg -i` stderr.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

export function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const candidates = [
    () => require('/home/user/rigpop-agents/node_modules/ffmpeg-static'),
    () => require('ffmpeg-static'),
  ];
  for (const c of candidates) {
    try {
      const p = c();
      if (p && fs.existsSync(p)) return p;
    } catch { /* keep looking */ }
  }
  throw new Error('ffmpeg not found — set FFMPEG_PATH or install ffmpeg-static');
}

export function probe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(err);
      const vid = /Stream #0:\d+.*?: Video: (\w+).*?, (\d+)x(\d+)[^,]*,.*?([\d.]+) fps/.exec(err);
      if (!dur || !vid) return reject(new Error(`could not probe ${file}`));
      resolve({
        file,
        duration: (+dur[1]) * 3600 + (+dur[2]) * 60 + (+dur[3]),
        vcodec: vid[1],
        width: +vid[2],
        height: +vid[3],
        fps: +vid[4],
        audio: /Stream #0:\d+.*?: Audio: /.test(err),
      });
    });
    p.on('error', reject);
  });
}

/** yields Buffer chunks of exactly frameBytes from a rawvideo stream */
export class RawReader {
  constructor(file, { width, height, fps, start = 0, dur = 0, pixFmt = 'rgba', extra = [], vf = '' }) {
    this.frameBytes = width * height * 4;
    this.pending = Buffer.alloc(0);
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (start > 0) args.push('-ss', String(start));
    args.push('-i', file);
    if (dur > 0) args.push('-t', String(dur));
    if (vf) args.push('-vf', vf);
    args.push('-an', '-f', 'rawvideo', '-pix_fmt', pixFmt, '-s', `${width}x${height}`, '-r', String(fps), ...extra, '-');
    this.proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'inherit'] });
    this.it = this.proc.stdout[Symbol.asyncIterator]();
    this.done = false;
  }

  async next() {
    while (!this.done) {
      if (this.pending.length >= this.frameBytes) {
        const f = this.pending.subarray(0, this.frameBytes);
        this.pending = this.pending.subarray(this.frameBytes);
        return f;
      }
      const { value, done } = await this.it.next();
      if (done) { this.done = true; break; }
      this.pending = this.pending.length ? Buffer.concat([this.pending, value]) : value;
    }
    return null;
  }

  kill() { try { this.proc.kill('SIGKILL'); } catch { /* gone */ } }
}

/** raw RGBA frames into stdin → h264 mp4, audio muxed from the source */
export class RawWriter {
  constructor(out, { width, height, fps, srcFile, hasAudio, crf = 18, start = 0, dur = 0, preset = 'medium' }) {
    const args = ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-'];
    if (hasAudio) {
      if (start > 0) args.push('-ss', String(start));
      if (dur > 0) args.push('-t', String(dur));
      args.push('-i', srcFile);
    }
    args.push('-map', '0:v');
    if (hasAudio) args.push('-map', '1:a', '-c:a', 'aac', '-b:a', '160k');
    args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    if (hasAudio) args.push('-shortest');
    args.push(out);
    this.proc = spawn(ffmpegPath(), args, { stdio: ['pipe', 'inherit', 'inherit'] });
  }

  async write(buf) {
    if (!this.proc.stdin.write(buf)) {
      await new Promise((r) => this.proc.stdin.once('drain', r));
    }
  }

  close() {
    return new Promise((resolve, reject) => {
      this.proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg encode exited ${code}`))));
      this.proc.stdin.end();
    });
  }
}
