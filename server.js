import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://api.assemblyai.com/v2';
const MAX_BYTES = 25 * 1024 * 1024;
export function createServer({
  apiKey = process.env.ASSEMBLYAI_API_KEY,
  basicAuthUser = process.env.APP_BASIC_AUTH_USER,
  basicAuthPassword = process.env.APP_BASIC_AUTH_PASSWORD,
  upstream = fetch,
} = {}) {
  const accessProtectionEnabled = Boolean(basicAuthUser || basicAuthPassword);
  if (accessProtectionEnabled && (!basicAuthUser || !basicAuthPassword)) {
    throw new Error('Set both APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASSWORD to enable access protection.');
  }
  async function api(path, options = {}) {
    const response = await upstream(`${API}${path}`, {
      ...options, headers: { authorization: apiKey, ...options.headers },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Speech provider request failed (${response.status}).`);
    return response.json();
  }
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(200, { ready: Boolean(apiKey), model: 'universal-2' });
      }
      if (accessProtectionEnabled) {
        const expected = `Basic ${Buffer.from(`${basicAuthUser}:${basicAuthPassword}`).toString('base64')}`;
        if (req.headers.authorization !== expected) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Voice workspace", charset="UTF-8"', 'Cache-Control': 'no-store' });
          return res.end('Authentication required.');
        }
      }
      if (url.pathname.startsWith('/api/')) {
        // This MVP is local-only. Reject cross-origin browser requests.
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          req.resume(); return send(403, { error: 'Cross-origin requests are not allowed.' });
        }
        if (!apiKey) { req.resume(); return send(503, { error: 'Set ASSEMBLYAI_API_KEY on the server before transcribing.' }); }
        if (req.method === 'POST' && url.pathname === '/api/transcripts') {
          if (!/^audio\/(webm|ogg|mp4|wav)(;|$)/i.test(req.headers['content-type'] || '')) {
            req.resume(); return send(415, { error: 'Unsupported recording format.' });
          }
          const chunks = []; let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BYTES) { send(413, { error: 'Recording exceeds 25 MB.' }); req.resume(); return; }
            chunks.push(chunk);
          }
          if (!size) return send(400, { error: 'Recording is empty.' });
          const upload = await api('/upload', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.concat(chunks) });
          const job = await api('/transcript', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio_url: upload.upload_url, speech_models: ['universal-2'], language_detection: true }) });
          return send(202, { id: job.id, status: job.status });
        }
        const match = url.pathname.match(/^\/api\/transcripts\/([a-zA-Z0-9-]{1,100})$/);
        if (req.method === 'GET' && match) {
          const job = await api(`/transcript/${match[1]}`);
          return send(200, { status: job.status, text: job.text, error: job.status === 'error' ? 'Transcription failed. Please try another recording.' : undefined });
        }
        return send(404, { error: 'Not found.' });
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method !== 'GET' || !files[url.pathname]) return send(404, { error: 'Not found.' });
      const [file, type] = files[url.pathname];
      const body = await readFile(new URL(`./public/${file}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    } catch {
      if (!res.headersSent) send(502, { error: 'Speech service unavailable. Check your API key and connection, then retry.' });
      else res.end();
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '0.0.0.0', () => console.log(`Voice workbench listening on port ${port}`));
}
