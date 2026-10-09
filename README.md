# Voice workspace

Minimal browser desktop workspace for recording audio and transcribing it with AssemblyAI Universal-2, Groq Whisper Large v3 Turbo, Groq Whisper Large v3, ElevenLabs Scribe v2, or Deepgram Nova-3 (English single-language mode). Each model has its own tab and editable transcript. AssemblyAI is asynchronous after recording stops; the other providers return the transcription in the same request.

## Run

Requires Node.js 22+; no third-party dependencies or install step.

1. Clone the repository and enter it: `git clone https://github.com/ziyi-zhuang0922/voice.git && cd voice`.
2. Copy the local configuration template: `cp .env.example .env`. Set the provider keys you need (`ASSEMBLYAI_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, or `DEEPGRAM_API_KEY`) in `.env`; never commit this file. The start command enables Node's environment-proxy support, which is required in the cloud environment and harmless locally.
3. Run `npm start`.
4. Open `http://127.0.0.1:3000` in a supported desktop browser. Allow microphone permission, click the microphone to record, then click again to stop and transcribe. Recording stops automatically after five minutes.

Browser microphone access requires localhost or HTTPS. The local MVP has no user accounts or persistence. Audio is sent to AssemblyAI; provider retention and billing apply. The server does not save recordings to disk.

Outbound HTTPS access to `api.assemblyai.com` is required. Credentials stay on the server. Universal-2 is explicitly selected through `speech_models: ['universal-2']`; there is no model fallback.

## Validate

Run `npm test`. Tests exercise upload, submission, model selection, polling, missing configuration, invalid input, cross-origin rejection, and provider failure through mocked provider responses. They do not verify microphone hardware or actual AssemblyAI recognition.

Check `/api/health` for configured status. A complete live check requires a real API key and a browser microphone: record a short English phrase and confirm the returned transcript. The cloud run has verified the real upload, submission, polling, and completion path using a valid silent WAV; a browser microphone check remains the final UI validation.

## Deploy

The project includes a Docker deployment definition. Deploy it through a platform that supplies HTTPS and set these secrets in that platform's environment settings: `ASSEMBLYAI_API_KEY`, `APP_BASIC_AUTH_USER`, and `APP_BASIC_AUTH_PASSWORD`. Keep the password long and unique. When both access-protection variables are set, the application requires HTTP Basic authentication for the workspace and transcription API; `/api/health` remains available for the platform health check.
