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
const REQUIRED_HEALTH_SCHEMA_VERSION = 3;
const providerInfo = { assemblyai: { label: 'ASSEMBLYAI · UNIVERSAL-2', upload: 'Uploading securely to AssemblyAI…', name: 'Universal-2' }, groqTurbo: { label: 'GROQ · WHISPER LARGE V3 TURBO', upload: 'Uploading securely to Groq…', endpoint: '/api/transcripts/groq', name: 'Whisper Large v3 Turbo' }, groqLarge: { label: 'GROQ · WHISPER LARGE V3', upload: 'Uploading securely to Groq…', endpoint: '/api/transcripts/groq/large-v3', name: 'Whisper Large v3' }, elevenLabs: { label: 'ELEVENLABS · SCRIBE V2', upload: 'Uploading securely to ElevenLabs…', endpoint: '/api/transcripts/elevenlabs', name: 'Scribe v2' }, deepgram: { label: 'DEEPGRAM · NOVA-3 · ENGLISH', upload: 'Uploading securely to Deepgram…', endpoint: '/api/transcripts/deepgram', name: 'Nova-3 · English' }, openai: { label: 'OPENAI · GPT-4O MINI TRANSCRIBE', upload: 'Uploading securely to OpenAI…', endpoint: '/api/transcripts/openai', name: 'gpt-4o-mini-transcribe' }, openai4o: { label: 'OPENAI · GPT-4O TRANSCRIBE', upload: 'Uploading securely to OpenAI…', endpoint: '/api/transcripts/openai/gpt-4o-transcribe', name: 'gpt-4o-transcribe' }, openaiLive: { label: 'OPENAI · GPT-LIVE-TRANSCRIBE', upload: 'Uploading securely to OpenAI…', endpoint: '/api/transcripts/openai/gpt-live-transcribe', name: 'gpt-live-transcribe' }, openaiTranscribe: { label: 'OPENAI · GPT-TRANSCRIBE', upload: 'Uploading securely to OpenAI…', endpoint: '/api/transcripts/openai/gpt-transcribe', name: 'gpt-transcribe' }, gemini: { label: 'GEMINI · 3.5 TRANSCRIBE', upload: 'Uploading securely to Gemini…', endpoint: '/api/transcripts/gemini', name: 'gemini-3.5-transcribe' }, geminiLive: { label: 'GEMINI · 3.5 TRANSCRIBE LIVE', upload: 'Connecting securely to Gemini…', name: 'gemini-3.5-transcribe-live' } };
let provider = 'assemblyai', availability = {}, serverSchemaCurrent = true, recorder, stream, interval, started, busy = false;
let livePeer, liveChannel, liveTranscript = '', liveStoppedAt, liveTimeout;
let geminiSocket, geminiAudioContext, geminiSource, geminiProcessor, geminiFinalTranscript = '', geminiInterimTranscript = '', geminiStoppedAt, geminiTimeout;
const transcripts = new Map(Object.keys(providerInfo).map(name => [name, '']));
const latencyHistory = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, options) { const response = await fetch(path, { ...options, signal: AbortSignal.timeout(90000) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed. Please retry.'); return data; }
function release() {
  stream?.getTracks().forEach(track => track.stop());
  clearInterval(interval); clearTimeout(liveTimeout);
  liveChannel?.close(); livePeer?.close();
  if (geminiProcessor) { geminiProcessor.onaudioprocess = null; geminiProcessor.disconnect(); }
  geminiSource?.disconnect(); geminiAudioContext?.close().catch(() => {});
  geminiSocket?.close(); clearTimeout(geminiTimeout);
  stream = undefined; liveChannel = undefined; livePeer = undefined;
  geminiSocket = undefined; geminiAudioContext = undefined; geminiSource = undefined; geminiProcessor = undefined;
}
async function convertToWav(blob) {
  if (blob.type.startsWith('audio/wav')) return blob;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser cannot prepare compatible audio. Try Chrome or Safari.');
  const context = new AudioContextClass();
  try {
    const source = await blob.arrayBuffer();
    const audio = await context.decodeAudioData(source);
    const channels = Math.min(audio.numberOfChannels, 2);
    const frameCount = audio.length;
    const output = new ArrayBuffer(44 + frameCount * channels * 2);
    const view = new DataView(output);
    view.setUint32(0, 0x52494646, false); view.setUint32(4, 36 + frameCount * channels * 2, true); view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false); view.setUint32(40, frameCount * channels * 2, true);
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) for (let channel = 0; channel < channels; channel += 1) { const sample = Math.max(-1, Math.min(1, audio.getChannelData(channel)[frame])); view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2; }
    return new Blob([output], { type: 'audio/wav' });
  } finally { await context.close(); }
}
function setTranscript(value, target = provider) { transcripts.set(target, value); if (target === provider) { text.value = value; copy.disabled = !value.trim(); } }
function recordLatency(target, stoppedAt) {
  const milliseconds = Math.max(0, Math.round(performance.now() - stoppedAt));
  latencyHistory.unshift({ target, milliseconds }); latencyHistory.splice(5);
  latencyEmpty.hidden = latencyHistory.length > 0;
  latencyList.innerHTML = latencyHistory.map(({ target: itemProvider, milliseconds: itemMilliseconds }) => `<li class="latency-item"><span class="latency-meta">${providerInfo[itemProvider].label.split(' · ')[0]}<small>${providerInfo[itemProvider].name}</small></span><strong>${(itemMilliseconds / 1000).toFixed(2)}s</strong></li>`).join('');
}
function selectProvider(next) {
  if (busy || recorder?.state === 'recording' || livePeer || geminiSocket) return;
  provider = next; model.textContent = providerInfo[provider].label;
  tabs.forEach(tab => { const active = tab.dataset.provider === provider; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', active); });
  setTranscript(transcripts.get(provider)); record.disabled = !availability[provider];
  if (!serverSchemaCurrent || !(provider in availability)) { record.disabled = true; status.textContent = 'Server update detected. Stop the old process and restart npm start.'; return; }
  const keyName = provider.startsWith('groq') ? 'GROQ_API_KEY' : provider === 'elevenLabs' ? 'ELEVENLABS_API_KEY' : provider === 'deepgram' ? 'DEEPGRAM_API_KEY' : provider.startsWith('openai') ? 'OPENAI_API_KEY (or VOICE_OPENAI_API_KEY)' : provider.startsWith('gemini') ? 'GEMINI_API_KEY (or GOOGLE_API_KEY)' : 'ASSEMBLYAI_API_KEY';
  status.textContent = availability[provider] ? 'Click the microphone to start recording.' : `Setup needed: add ${keyName} on the server and restart.`;
}
function finishLiveTranscription(message, transcript = liveTranscript) {
  const target = 'openaiLive';
  if (transcript) { setTranscript(transcript, target); if (liveStoppedAt) recordLatency(target, liveStoppedAt); }
  release(); busy = false; liveTranscript = ''; liveStoppedAt = undefined;
  record.classList.remove('recording'); record.setAttribute('aria-label', 'Start recording');
  record.disabled = !availability[provider]; prompt.textContent = 'Ready when you are'; status.textContent = message;
}
async function startLiveTranscription() {
  busy = true; record.disabled = true; liveTranscript = ''; setTranscript('', 'openaiLive');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    livePeer = new RTCPeerConnection();
    stream.getTracks().forEach(track => livePeer.addTrack(track, stream));
    liveChannel = livePeer.createDataChannel('oai-events');
    liveChannel.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.type === 'conversation.item.input_audio_transcription.delta') {
        liveTranscript += data.delta || ''; setTranscript(liveTranscript, 'openaiLive');
      } else if (data.type === 'conversation.item.input_audio_transcription.completed') {
        finishLiveTranscription(data.transcript ? 'Transcript ready. Edit or copy your text below.' : 'No speech detected. Try recording again.', data.transcript || '');
      } else if (data.type === 'error') {
        finishLiveTranscription(data.error?.message || 'OpenAI live transcription failed. Please retry.');
      }
    });
    const opened = new Promise((resolve, reject) => {
      liveChannel.addEventListener('open', resolve, { once: true });
      liveChannel.addEventListener('error', () => reject(new Error('Could not open the OpenAI live transcription channel.')), { once: true });
    });
    const offer = await livePeer.createOffer(); await livePeer.setLocalDescription(offer);
    const response = await fetch('/api/transcripts/openai/live/session', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp, signal: AbortSignal.timeout(90000) });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Could not start OpenAI live transcription.'); }
    await livePeer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    await Promise.race([opened, delay(15000).then(() => { throw new Error('OpenAI live transcription connection timed out.'); })]);
    started = Date.now(); timer.textContent = '00:00';
    interval = setInterval(() => { const seconds = Math.floor((Date.now() - started) / 1000); timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; if (seconds >= 300 && livePeer) stopLiveTranscription(); }, 250);
    record.classList.add('recording'); record.setAttribute('aria-label', 'Stop recording');
    prompt.textContent = 'Listening to you'; status.textContent = 'Live speech-to-text is active. Click the microphone to finish.';
  } catch (error) {
    release(); status.textContent = error.name === 'NotAllowedError' ? 'Microphone access denied. Allow access in browser settings and retry.' : error.message;
  } finally { busy = false; record.disabled = !availability[provider]; }
}
function stopLiveTranscription() {
  if (!livePeer || liveChannel?.readyState !== 'open') return;
  busy = true; liveStoppedAt = performance.now();
  liveChannel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  stream?.getTracks().forEach(track => track.stop()); clearInterval(interval);
  record.classList.remove('recording'); record.disabled = true; record.setAttribute('aria-label', 'Start recording');
  prompt.textContent = 'Transcribing your recording'; status.textContent = 'Finalizing the live transcript…';
  liveTimeout = setTimeout(() => finishLiveTranscription('OpenAI live transcription timed out. Please retry.'), 90000);
}
function floatAudioToBase64Pcm16(samples, inputRate) {
  const ratio = inputRate / 16000;
  const outputLength = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((index + 1) * ratio)));
    let total = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) total += samples[inputIndex];
    const sample = Math.max(-1, Math.min(1, total / (end - start)));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
}
function finishGeminiLiveTranscription(message) {
  const transcript = geminiFinalTranscript.trim();
  if (transcript) { setTranscript(transcript, 'geminiLive'); if (geminiStoppedAt) recordLatency('geminiLive', geminiStoppedAt); }
  release(); busy = false; geminiFinalTranscript = ''; geminiInterimTranscript = ''; geminiStoppedAt = undefined;
  record.classList.remove('recording'); record.setAttribute('aria-label', 'Start recording');
  record.disabled = !availability[provider]; prompt.textContent = 'Ready when you are'; status.textContent = message;
}
function updateGeminiTranscript() {
  setTranscript([geminiFinalTranscript, geminiInterimTranscript].filter(Boolean).join(' ').trim(), 'geminiLive');
}
async function startGeminiLiveTranscription() {
  busy = true; record.disabled = true; geminiFinalTranscript = ''; geminiInterimTranscript = ''; setTranscript('', 'geminiLive');
  try {
    const { token } = await request('/api/transcripts/gemini/live/token', { method: 'POST' });
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const socket = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`);
    geminiSocket = socket;
    const ready = new Promise((resolve, reject) => {
      socket.addEventListener('open', () => socket.send(JSON.stringify({ setup: { model: 'models/gemini-3.5-transcribe-live', generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: { languageCodes: [] } } })), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not open the Gemini live transcription channel.')), { once: true });
      socket.addEventListener('message', event => {
        const data = JSON.parse(event.data);
        if (data.setupComplete) resolve();
        const content = data.serverContent || data.server_content;
        if (!content) return;
        const interim = content.interimInputTranscription || content.interim_input_transcription;
        const final = content.inputTranscription || content.input_transcription;
        if (interim?.text) { geminiInterimTranscript = interim.text; updateGeminiTranscript(); }
        if (final?.text) {
          geminiFinalTranscript = [geminiFinalTranscript, final.text].filter(Boolean).join(' ').trim();
          geminiInterimTranscript = ''; updateGeminiTranscript();
          if (geminiStoppedAt) { clearTimeout(geminiTimeout); geminiTimeout = setTimeout(() => finishGeminiLiveTranscription('Transcript ready. Edit or copy your text below.'), 750); }
        }
        if ((content.turnComplete || content.turn_complete) && geminiStoppedAt) finishGeminiLiveTranscription(geminiFinalTranscript ? 'Transcript ready. Edit or copy your text below.' : 'No speech detected. Try recording again.');
      });
      socket.addEventListener('close', () => { if (geminiSocket === socket) finishGeminiLiveTranscription(geminiFinalTranscript ? 'Transcript ready. Edit or copy your text below.' : 'Gemini live transcription disconnected. Please retry.'); reject(new Error('Gemini live transcription disconnected. Please retry.')); });
    });
    await Promise.race([ready, delay(15000).then(() => { throw new Error('Gemini live transcription connection timed out.'); })]);
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser cannot stream PCM audio. Try Chrome or Safari.');
    geminiAudioContext = new AudioContextClass();
    geminiSource = geminiAudioContext.createMediaStreamSource(stream);
    geminiProcessor = geminiAudioContext.createScriptProcessor(4096, 1, 1);
    geminiProcessor.onaudioprocess = event => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const data = floatAudioToBase64Pcm16(event.inputBuffer.getChannelData(0), geminiAudioContext.sampleRate);
      socket.send(JSON.stringify({ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } }));
    };
    geminiSource.connect(geminiProcessor); geminiProcessor.connect(geminiAudioContext.destination);
    started = Date.now(); timer.textContent = '00:00';
    interval = setInterval(() => { const seconds = Math.floor((Date.now() - started) / 1000); timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; if (seconds >= 300 && geminiSocket) stopGeminiLiveTranscription(); }, 250);
    record.classList.add('recording'); record.setAttribute('aria-label', 'Stop recording');
    prompt.textContent = 'Listening to you'; status.textContent = 'Gemini live speech-to-text is active. Click the microphone to finish.';
  } catch (error) {
    release(); status.textContent = error.name === 'NotAllowedError' ? 'Microphone access denied. Allow access in browser settings and retry.' : error.message;
  } finally { busy = false; record.disabled = !availability[provider]; }
}
function stopGeminiLiveTranscription() {
  if (!geminiSocket || geminiSocket.readyState !== WebSocket.OPEN) return;
  busy = true; geminiStoppedAt = performance.now();
  geminiProcessor.onaudioprocess = null; geminiProcessor.disconnect(); geminiSource.disconnect();
  stream?.getTracks().forEach(track => track.stop()); clearInterval(interval);
  geminiSocket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  record.classList.remove('recording'); record.disabled = true; record.setAttribute('aria-label', 'Start recording');
  prompt.textContent = 'Transcribing your recording'; status.textContent = 'Finalizing the Gemini live transcript…';
  geminiTimeout = setTimeout(() => finishGeminiLiveTranscription(geminiFinalTranscript ? 'Transcript ready. Edit or copy your text below.' : 'Gemini live transcription timed out. Please retry.'), 90000);
}
async function transcribe(blob, stoppedAt, target = provider) {
  busy = true; record.disabled = true; prompt.textContent = 'Transcribing your recording'; status.textContent = providerInfo[target].upload;
  try {
    if (target !== 'assemblyai') { let audio = blob; if (target === 'elevenLabs' || (target.startsWith('openai') && blob.type.startsWith('audio/ogg'))) { status.textContent = 'Preparing a compatible WAV…'; audio = await convertToWav(blob); } const result = await request(providerInfo[target].endpoint, { method: 'POST', headers: { 'Content-Type': audio.type }, body: audio }); setTranscript(result.text || '', target); if (result.text) recordLatency(target, stoppedAt); status.textContent = result.text ? 'Transcript ready. Edit or copy your text below.' : 'No speech detected. Try recording again.'; return; }
    const job = await request('/api/transcripts', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }); const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) { const result = await request(`/api/transcripts/${job.id}`); if (result.status === 'error') throw new Error(result.error); if (result.status === 'completed') { setTranscript(result.text || '', target); if (result.text) recordLatency(target, stoppedAt); status.textContent = result.text ? 'Transcript ready. Edit or copy your text below.' : 'No speech detected. Try recording again.'; return; } status.textContent = 'Turning your speech into text…'; await delay(2000); }
    throw new Error('Transcription timed out. Please try again later.');
  } catch (error) { status.textContent = error.message; } finally { busy = false; record.disabled = !availability[provider]; prompt.textContent = 'Ready when you are'; }
}
record.addEventListener('click', async () => {
  if (busy) return;
  if (provider === 'openaiLive') { if (livePeer) stopLiveTranscription(); else await startLiveTranscription(); return; }
  if (provider === 'geminiLive') { if (geminiSocket) stopGeminiLiveTranscription(); else await startGeminiLiveTranscription(); return; }
  if (recorder?.state === 'recording') { recorder.stop(); return; } busy = true; record.disabled = true;
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
try { const health = await request('/api/health'); serverSchemaCurrent = health.schemaVersion === REQUIRED_HEALTH_SCHEMA_VERSION; availability = Object.fromEntries(Object.entries(health.providers).map(([name, value]) => [name, value.ready])); if (!navigator.mediaDevices || !window.MediaRecorder) status.textContent = 'Recording requires a supported browser on localhost or HTTPS.'; else selectProvider(provider); } catch { status.textContent = 'Could not connect to the server. Refresh to retry.'; }
