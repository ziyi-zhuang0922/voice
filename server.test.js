import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './server.js';
async function run(t, options) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('serves workspace and exposes missing configuration without leaking keys', async t => {
  const base = await run(t, { apiKey: '', groqApiKey: '', elevenLabsApiKey: '', deepgramApiKey: '' });
  assert.match(await (await fetch(base)).text(), /Speak your mind/);
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { providers: { assemblyai: { ready: false, model: 'universal-2' }, groqTurbo: { ready: false, model: 'whisper-large-v3-turbo' }, groqLarge: { ready: false, model: 'whisper-large-v3' }, elevenLabs: { ready: false, model: 'scribe_v2' }, deepgram: { ready: false, model: 'nova-3', language: 'en' } } });
  assert.equal((await fetch(`${base}/api/transcripts`, { method: 'POST', body: 'audio' })).status, 503);
});
test('uploads recorded audio, selects Universal-2 and returns completed transcript', async t => {
  const calls = [];
  const upstream = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.authorization, 'test-key');
    const result = url.endsWith('/upload') ? { upload_url: 'https://example.com/audio' } : options.method === 'POST' ? { id: 'job-123', status: 'queued' } : { status: 'completed', text: 'Hello world.' };
    return Response.json(result);
  };
  const base = await run(t, { apiKey: 'test-key', upstream });
  const response = await fetch(`${base}/api/transcripts`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: 'recorded-audio' });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).id, 'job-123');
  assert.equal(calls[0].options.body.toString(), 'recorded-audio');
  assert.deepEqual(JSON.parse(calls[1].options.body), { audio_url: 'https://example.com/audio', speech_models: ['universal-2'], language_detection: true });
  assert.equal((await (await fetch(`${base}/api/transcripts/job-123`)).json()).text, 'Hello world.');
});
test('submits audio to Groq Whisper Large v3 Turbo and returns text directly', async t => {
  const upstream = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(options.headers.authorization, 'Bearer groq-key');
    assert.equal(await options.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(await options.body.get('response_format'), 'json');
    assert.equal((await options.body.get('file')).type, 'audio/webm');
    return Response.json({ text: 'Hello from Groq.' });
  };
  const base = await run(t, { apiKey: '', groqApiKey: 'groq-key', upstream });
  const response = await fetch(`${base}/api/transcripts/groq`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: 'recorded-audio' });
  assert.deepEqual(await response.json(), { text: 'Hello from Groq.' });
});
test('submits audio to Groq Whisper Large v3 and returns text directly', async t => {
  const upstream = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(await options.body.get('model'), 'whisper-large-v3');
    return Response.json({ text: 'Hello from Groq Large.' });
  };
  const base = await run(t, { apiKey: '', groqApiKey: 'groq-key', upstream });
  const response = await fetch(`${base}/api/transcripts/groq/large-v3`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: 'recorded-audio' });
  assert.deepEqual(await response.json(), { text: 'Hello from Groq Large.' });
});
test('submits audio to ElevenLabs Scribe v2 and returns text directly', async t => {
  const upstream = async (url, options) => {
    assert.equal(url, 'https://api.elevenlabs.io/v1/speech-to-text');
    assert.equal(options.headers['xi-api-key'], 'eleven-key');
    assert.equal(await options.body.get('model_id'), 'scribe_v2');
    return Response.json({ text: 'Hello from ElevenLabs.' });
  };
  const base = await run(t, { apiKey: '', groqApiKey: '', elevenLabsApiKey: 'eleven-key', upstream });
  const response = await fetch(`${base}/api/transcripts/elevenlabs`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: 'recorded-audio' });
  assert.deepEqual(await response.json(), { text: 'Hello from ElevenLabs.' });
});
test('submits audio to Deepgram Nova-3 with English single-language mode', async t => {
  const upstream = async (url, options) => {
    assert.equal(url, 'https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true');
    assert.equal(options.headers.authorization, 'Token deepgram-key');
    assert.equal(options.headers['content-type'], 'audio/webm');
    return Response.json({ results: { channels: [{ alternatives: [{ transcript: 'Hello from Deepgram.' }] }] } });
  };
  const base = await run(t, { apiKey: '', groqApiKey: '', deepgramApiKey: 'deepgram-key', upstream });
  const response = await fetch(`${base}/api/transcripts/deepgram`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: 'recorded-audio' });
  assert.deepEqual(await response.json(), { text: 'Hello from Deepgram.' });
});
test('rejects invalid recordings and cross-origin requests before calling provider', async t => {
  const base = await run(t, { apiKey: 'test-key', upstream: () => { throw new Error('must not call'); } });
  assert.equal((await fetch(`${base}/api/transcripts`, { method: 'POST', body: 'invalid' })).status, 415);
  assert.equal((await fetch(`${base}/api/transcripts`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: '' })).status, 400);
  assert.equal((await fetch(`${base}/api/transcripts`, { method: 'POST', headers: { origin: 'https://other.example' } })).status, 403);
});
test('handles provider failure without leaking provider response or secret', async t => {
  const base = await run(t, { apiKey: 'private-key', upstream: async () => new Response('private-key', { status: 401 }) });
  const response = await fetch(`${base}/api/transcripts`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: 'audio' });
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.match(body, /AssemblyAI rejected the API key or account access/);
  assert.doesNotMatch(body, /private-key/);
});

test('protects the workspace when basic authentication is configured', async t => {
  const base = await run(t, { apiKey: 'test-key', basicAuthUser: 'tester', basicAuthPassword: 'safe-password' });
  const denied = await fetch(base);
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate'), /^Basic /);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const allowed = await fetch(base, { headers: { authorization: `Basic ${Buffer.from('tester:safe-password').toString('base64')}` } });
  assert.equal(allowed.status, 200);
});

test('requires both basic authentication settings when protection is enabled', () => {
  assert.throws(() => createServer({ apiKey: 'test-key', basicAuthUser: 'tester' }), /Set both/);
});
