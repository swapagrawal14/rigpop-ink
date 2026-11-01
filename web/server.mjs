/**
 * The darkroom — a local web surface for rigpop-ink.
 *
 *   GET  /                     the UI
 *   GET  /api/library          clips the server will let you ink
 *   GET  /api/analyze?file=    cuts, onsets, tempo, letterbox, duration
 *   GET  /api/preview?...      one stilled frame as PNG (this is the live slider)
 *   POST /api/render           start a job, returns {id}
 *   GET  /api/job/:id          progress
 *   GET  /api/out/:id          finished mp4 (range-capable, plays inline)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseSource, stillFrame, restyle, cropFromBars } from '../src/restyle.mjs';
import { PRESETS } from '../src/presets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const MIME = {
  '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
};

export async function startServer({ port = 8137, host = '0.0.0.0', files = [] } = {}) {
  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const library = (files.length ? files : defaultLibrary()).filter((f) => fs.existsSync(f));
  if (!library.length) console.warn('darkroom: no playable clips found — pass --file <clip>');

  const analysisCache = new Map();
  const jobs = new Map();

  const analyse = async (file) => {
    const key = file;
    if (analysisCache.has(key)) return analysisCache.get(key);
    const a = await analyseSource(file, { features: {} });
    analysisCache.set(key, a);
    return a;
  };

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'local'}`);
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = fs.readFileSync(path.join(HERE, 'index.html'));
        res.writeHead(200, { 'content-type': MIME['.html'] });
        return res.end(html);
      }

      if (url.pathname === '/api/presets') {
        return json(res, 200, Object.fromEntries(
          Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, blurb: v.blurb, style: v.style }]),
        ));
      }

      if (url.pathname === '/api/library') {
        return json(res, 200, library.map((f) => ({
          path: f, name: path.basename(f), bytes: fs.statSync(f).size,
        })));
      }

      if (url.pathname === '/api/analyze') {
        const file = url.searchParams.get('file') || library[0];
        if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'no such clip' });
        const a = await analyse(file);
        return json(res, 200, {
          file,
          duration: a.info.duration,
          fps: a.info.fps,
          width: a.info.width,
          height: a.info.height,
          audio: a.info.audio,
          cuts: a.cuts.map((f) => f / a.fps),
          onsets: a.onsets,
          bars: a.bars,
          crop: cropFromBars(a.bars, a.info.width, a.info.height),
          drama: Array.from(a.drama).filter((_, i) => i % Math.max(1, Math.round(a.fps / 30)) === 0),
          dramaStep: Math.max(1, Math.round(a.fps / 30)) / a.fps,
        });
      }

      if (url.pathname === '/api/preview') {
        const q = url.searchParams;
        const file = q.get('file') || library[0];
        const t = Number(q.get('t') || 0);
        if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'no such clip' });
        const a = await analyse(file);
        const crop = q.get('crop') === '0' ? null : cropFromBars(a.bars, a.info.width, a.info.height);
        const overrides = {};
        for (const k of ['thick', 'half', 'paperAmt', 'levels', 'lineGain', 'tintAmt', 'sat', 'edgeHi', 'radius']) {
          if (q.get(k) !== null) overrides[k] = Number(q.get(k));
        }
        const r = await stillFrame({
          input: file,
          at: t,
          preset: q.get('preset') || 'manga-noir',
          scale: Number(q.get('scale') || 0.55),
          seed: Number(q.get('seed') || 1),
          overrides,
          crop,
          frameIndex: Math.round(t * a.info.fps),
          onsets: a.onsets,
          cuts: a.cuts.map((f) => f / a.info.fps),
          drama: a.drama,
        });
        res.writeHead(200, { 'content-type': MIME['.png'], 'cache-control': 'no-store' });
        return res.end(r.png);
      }

      if (url.pathname === '/api/render' && req.method === 'POST') {
        const body = await readJson(req);
        const file = body.file || library[0];
        const id = Math.random().toString(36).slice(2, 10);
        const out = path.join(outDir, `job-${id}.mp4`);
        const job = { id, state: 'running', progress: 0, frame: 0, total: 0, out, started: Date.now() };
        jobs.set(id, job);
        restyle({
          input: file,
          output: out,
          preset: body.preset || 'manga-noir',
          start: Number(body.start || 0),
          dur: Number(body.dur || 0),
          scale: Number(body.scale || 0.7),
          seed: Number(body.seed || 1),
          features: {},
          onProgress: (p) => {
            job.frame = p.frame;
            job.total = p.total;
            job.progress = Math.min(1, p.frame / (p.total || 1));
            job.fps = p.fps;
            job.eta = p.eta;
          },
        }).then((r) => Object.assign(job, { state: 'done', result: r, progress: 1 }))
          .catch((e) => Object.assign(job, { state: 'error', error: e.message }));
        return json(res, 200, { id });
      }

      const jobMatch = /^\/api\/job\/(\w+)$/.exec(url.pathname);
      if (jobMatch) {
        const job = jobs.get(jobMatch[1]);
        if (!job) return json(res, 404, { error: 'no such job' });
        return json(res, 200, {
          state: job.state, progress: job.progress, frame: job.frame, total: job.total,
          fps: job.fps, eta: job.eta, error: job.error,
          result: job.state === 'done' ? { ...job.result, url: `/api/out/${job.id}` } : null,
        });
      }

      const outMatch = /^\/api\/out\/(\w+)$/.exec(url.pathname);
      if (outMatch) {
        const job = jobs.get(outMatch[1]);
        if (!job || !fs.existsSync(job.out)) { res.writeHead(404); return res.end('no'); }
        return sendFile(req, res, job.out);
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`rigpop-ink darkroom → http://${shown}:${port}`);
  console.log(`  ${library.length} clip(s): ${library.map((f) => path.basename(f)).join(', ')}`);
  return server;
}

function defaultLibrary() {
  const demo = path.join(ROOT, 'demo');
  if (!fs.existsSync(demo)) return [];
  return fs.readdirSync(demo)
    .filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f))
    .map((f) => path.join(demo, f));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : stat.size - 1;
    res.writeHead(206, {
      'content-type': type,
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}
