const record = document.querySelector('#record');
const status = document.querySelector('#status');
const prompt = document.querySelector('#prompt');
const text = document.querySelector('#text');
const copy = document.querySelector('#copy');
const timer = document.querySelector('#timer');
let recorder, stream, interval, started, busy = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, options) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(90000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed. Please retry.');
  return data;
}
function release() { stream?.getTracks().forEach(track => track.stop()); clearInterval(interval); }
async function transcribe(blob) {
  busy = true; record.disabled = true; prompt.textContent = 'Transcribing your recording';
  status.textContent = 'Uploading securely to AssemblyAI…';
  try {
    const job = await request('/api/transcripts', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const result = await request(`/api/transcripts/${job.id}`);
      if (result.status === 'error') throw new Error(result.error);
      if (result.status === 'completed') {
        text.value = result.text || ''; copy.disabled = !text.value.trim();
        status.textContent = result.text ? 'Transcript ready. Edit or copy your text below.' : 'No speech detected. Try recording again.';
        return;
      }
      status.textContent = 'Turning your speech into text…'; await delay(2000);
    }
    throw new Error('Transcription timed out. Please try again later.');
  } catch (error) { status.textContent = error.message; }
  finally { busy = false; record.disabled = false; prompt.textContent = 'Ready when you are'; }
}
record.addEventListener('click', async () => {
  if (busy) return;
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  busy = true; record.disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { release(); status.textContent = 'Recording failed. Please retry.'; };
    recorder.onstop = () => {
      release(); record.classList.remove('recording'); record.setAttribute('aria-label', 'Start recording');
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (blob.size) void transcribe(blob);
      else { status.textContent = 'Recording is empty. Please retry.'; }
    };
    recorder.start(1000); started = Date.now(); timer.textContent = '00:00';
    interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      if (seconds >= 300 && recorder.state === 'recording') recorder.stop();
    }, 250);
    record.classList.add('recording'); record.setAttribute('aria-label', 'Stop recording');
    prompt.textContent = 'Listening to you'; status.textContent = 'Click the microphone again to stop and transcribe.';
  } catch (error) {
    release(); status.textContent = error.name === 'NotAllowedError' ? 'Microphone access denied. Allow access in browser settings and retry.' : 'Could not access your microphone. Check your device and retry.';
  } finally { busy = false; record.disabled = false; }
});
text.addEventListener('input', () => { copy.disabled = !text.value.trim(); });
copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(text.value); status.textContent = 'Transcript copied.'; }
  catch { status.textContent = 'Copy unavailable. Select the transcript and copy it manually.'; }
});
window.addEventListener('pagehide', release);
try {
  const health = await request('/api/health');
  if (!navigator.mediaDevices || !window.MediaRecorder) status.textContent = 'Recording requires a supported browser on localhost or HTTPS.';
  else if (!health.ready) status.textContent = 'Setup needed: add ASSEMBLYAI_API_KEY on the server and restart.';
  else { record.disabled = false; status.textContent = 'Click the microphone to start recording.'; }
} catch { status.textContent = 'Could not connect to the server. Refresh to retry.'; }
