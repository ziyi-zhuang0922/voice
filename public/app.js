const record = document.querySelector('#record');
const status = document.querySelector('#status');
const prompt = document.querySelector('#prompt');
const text = document.querySelector('#text');
const copy = document.querySelector('#copy');
const timer = document.querySelector('#timer');
const model = document.querySelector('#model');
const tabs = [...document.querySelectorAll('.tab')];
const latencyList = document.querySelector('#latency-list');
const latencyEmpty = document.querySelector('#latency-empty');
const providerInfo = { assemblyai: { label: 'ASSEMBLYAI · UNIVERSAL-2', upload: 'Uploading securely to AssemblyAI…', name: 'Universal-2' }, groqTurbo: { label: 'GROQ · WHISPER LARGE V3 TURBO', upload: 'Uploading securely to Groq…', endpoint: '/api/transcripts/groq', name: 'Whisper Large v3 Turbo' }, groqLarge: { label: 'GROQ · WHISPER LARGE V3', upload: 'Uploading securely to Groq…', endpoint: '/api/transcripts/groq/large-v3', name: 'Whisper Large v3' }, elevenLabs: { label: 'ELEVENLABS · SCRIBE V2', upload: 'Uploading securely to ElevenLabs…', endpoint: '/api/transcripts/elevenlabs', name: 'Scribe v2' }, deepgram: { label: 'DEEPGRAM · NOVA-3 · ENGLISH', upload: 'Uploading securely to Deepgram…', endpoint: '/api/transcripts/deepgram', name: 'Nova-3 · English' } };
let provider = 'assemblyai', availability = {}, recorder, stream, interval, started, busy = false;
const transcripts = new Map([['assemblyai', ''], ['groqTurbo', ''], ['groqLarge', ''], ['elevenLabs', ''], ['deepgram', '']]);
const latencyHistory = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, options) { const response = await fetch(path, { ...options, signal: AbortSignal.timeout(90000) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed. Please retry.'); return data; }
function release() { stream?.getTracks().forEach(track => track.stop()); clearInterval(interval); }
function setTranscript(value, target = provider) { transcripts.set(target, value); if (target === provider) { text.value = value; copy.disabled = !value.trim(); } }
function recordLatency(target, stoppedAt) {
  const milliseconds = Math.max(0, Math.round(performance.now() - stoppedAt));
  latencyHistory.unshift({ target, milliseconds }); latencyHistory.splice(5);
  latencyEmpty.hidden = latencyHistory.length > 0;
  latencyList.innerHTML = latencyHistory.map(({ target: itemProvider, milliseconds: itemMilliseconds }) => `<li class="latency-item"><span class="latency-meta">${providerInfo[itemProvider].label.split(' · ')[0]}<small>${providerInfo[itemProvider].name}</small></span><strong>${(itemMilliseconds / 1000).toFixed(2)}s</strong></li>`).join('');
}
function selectProvider(next) {
  if (busy || recorder?.state === 'recording') return;
  provider = next; model.textContent = providerInfo[provider].label;
  tabs.forEach(tab => { const active = tab.dataset.provider === provider; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', active); });
  setTranscript(transcripts.get(provider)); record.disabled = !availability[provider];
  const keyName = provider.startsWith('groq') ? 'GROQ_API_KEY' : provider === 'elevenLabs' ? 'ELEVENLABS_API_KEY' : provider === 'deepgram' ? 'DEEPGRAM_API_KEY' : 'ASSEMBLYAI_API_KEY';
  status.textContent = availability[provider] ? 'Click the microphone to start recording.' : `Setup needed: add ${keyName} on the server and restart.`;
}
async function transcribe(blob, stoppedAt, target = provider) {
  busy = true; record.disabled = true; prompt.textContent = 'Transcribing your recording'; status.textContent = providerInfo[target].upload;
  try {
    if (target !== 'assemblyai') { const result = await request(providerInfo[target].endpoint, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }); setTranscript(result.text || '', target); if (result.text) recordLatency(target, stoppedAt); status.textContent = result.text ? 'Transcript ready. Edit or copy your text below.' : 'No speech detected. Try recording again.'; return; }
    const job = await request('/api/transcripts', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }); const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) { const result = await request(`/api/transcripts/${job.id}`); if (result.status === 'error') throw new Error(result.error); if (result.status === 'completed') { setTranscript(result.text || '', target); if (result.text) recordLatency(target, stoppedAt); status.textContent = result.text ? 'Transcript ready. Edit or copy your text below.' : 'No speech detected. Try recording again.'; return; } status.textContent = 'Turning your speech into text…'; await delay(2000); }
    throw new Error('Transcription timed out. Please try again later.');
  } catch (error) { status.textContent = error.message; } finally { busy = false; record.disabled = !availability[provider]; prompt.textContent = 'Ready when you are'; }
}
record.addEventListener('click', async () => {
  if (busy) return; if (recorder?.state === 'recording') { recorder.stop(); return; } busy = true; record.disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type)); recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); }; recorder.onerror = () => { release(); status.textContent = 'Recording failed. Please retry.'; };
    recorder.onstop = () => { const stoppedAt = performance.now(); const target = provider; release(); record.classList.remove('recording'); record.setAttribute('aria-label', 'Start recording'); const blob = new Blob(chunks, { type: recorder.mimeType }); if (blob.size) void transcribe(blob, stoppedAt, target); else status.textContent = 'Recording is empty. Please retry.'; };
    recorder.start(1000); started = Date.now(); timer.textContent = '00:00'; interval = setInterval(() => { const seconds = Math.floor((Date.now() - started) / 1000); timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; if (seconds >= 300 && recorder.state === 'recording') recorder.stop(); }, 250);
    record.classList.add('recording'); record.setAttribute('aria-label', 'Stop recording'); prompt.textContent = 'Listening to you'; status.textContent = 'Click the microphone again to stop and transcribe.';
  } catch (error) { release(); status.textContent = error.name === 'NotAllowedError' ? 'Microphone access denied. Allow access in browser settings and retry.' : 'Could not access your microphone. Check your device and retry.'; } finally { busy = false; record.disabled = !availability[provider]; }
});
tabs.forEach(tab => tab.addEventListener('click', () => selectProvider(tab.dataset.provider)));
text.addEventListener('input', () => { transcripts.set(provider, text.value); copy.disabled = !text.value.trim(); });
copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text.value); status.textContent = 'Transcript copied.'; } catch { status.textContent = 'Copy unavailable. Select the transcript and copy it manually.'; } });
window.addEventListener('pagehide', release);
try { const health = await request('/api/health'); availability = Object.fromEntries(Object.entries(health.providers).map(([name, value]) => [name, value.ready])); if (!navigator.mediaDevices || !window.MediaRecorder) status.textContent = 'Recording requires a supported browser on localhost or HTTPS.'; else selectProvider(provider); } catch { status.textContent = 'Could not connect to the server. Refresh to retry.'; }
