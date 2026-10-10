# Voice workspace

Minimal browser desktop workspace for turning speech into text with AssemblyAI, Groq, ElevenLabs, Deepgram, OpenAI, and Gemini transcription models. Each model has its own tab and editable transcript. OpenAI and Gemini live models stream text while you speak; AssemblyAI is asynchronous after recording stops; the other providers return text from an uploaded recording.

## Run

Requires Node.js 22+; no third-party dependencies or install step.

1. Clone the repository and enter it: `git clone https://github.com/ziyi-zhuang0922/voice.git && cd voice`.
2. Copy the local configuration template: `cp .env.example .env`. Set the provider keys you need (`ASSEMBLYAI_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`) in `.env`; never commit this file. The start command enables Node's environment-proxy support, which is required in the cloud environment and harmless locally.
3. Run `npm start`. Local start uses Node watch mode, so pulling backend code automatically restarts the process. Use `npm run start:once` when watch mode is not wanted.
4. Open `http://127.0.0.1:3000` in a supported desktop browser. Allow microphone permission, click the microphone to record, then click again to stop and transcribe. Recording stops automatically after five minutes.

Browser microphone access requires localhost or HTTPS. The local MVP has no user accounts or persistence. Audio is sent to the selected provider; provider retention and billing apply. The server does not save recordings to disk.

Outbound HTTPS access to `api.assemblyai.com` is required. Credentials stay on the server. Universal-2 is explicitly selected through `speech_models: ['universal-2']`; there is no model fallback.

## Validate

Run `npm test`. Tests exercise upload, submission, model selection, polling, missing configuration, invalid input, cross-origin rejection, and provider failure through mocked provider responses. They do not verify microphone hardware or actual AssemblyAI recognition.

Check `/api/health` for configured status. A complete live check requires a real API key and a browser microphone: record a short English phrase and confirm the returned transcript. The cloud run has verified the real upload, submission, polling, and completion path using a valid silent WAV; a browser microphone check remains the final UI validation.

## Deploy

The project includes a Docker deployment definition. Deploy it through a platform that supplies HTTPS and set these secrets in that platform's environment settings: `ASSEMBLYAI_API_KEY`, `APP_BASIC_AUTH_USER`, and `APP_BASIC_AUTH_PASSWORD`. Keep the password long and unique. When both access-protection variables are set, the application requires HTTP Basic authentication for the workspace and transcription API; `/api/health` remains available for the platform health check.

## OpenAI transcription

Set `OPENAI_API_KEY` in your existing `.env` (do not overwrite it with the template). `VOICE_OPENAI_API_KEY` is also supported and takes precedence when both are set. Restart the running Node process after changing `.env` or pulling code:

```sh
cd ~/voice
git pull
PORT=3009 npm start
```

Stop the previous process with Ctrl+C in its terminal first. Open `http://127.0.0.1:3009` and select one of the four OpenAI speech-to-text models. Check `http://127.0.0.1:3009/api/health`: the OpenAI `ready` fields mean a key was loaded, not that OpenAI has accepted it. Record a short phrase with each model to verify account access and model availability.

`gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, and `gpt-transcribe` process the recording after you stop. `gpt-live-transcribe` uses a WebRTC realtime transcription session and displays partial text while you speak. The standard API key remains on the server. Ogg file recordings are converted to WAV in the browser for OpenAI compatibility.

For Docker hosting, configure the API key in the hosting platform as well; the image does not include your local `.env`. The host must allow outbound HTTPS to `api.openai.com`.

## Gemini transcription

Set `GEMINI_API_KEY` in your existing `.env`; `GOOGLE_API_KEY` is also supported as a fallback. `gemini-3.5-transcribe` uploads the completed recording through Gemini's Files API and submits it to the Interactions API. `gemini-3.5-transcribe-live` converts microphone audio to 16 kHz PCM in the browser and streams it over a Gemini Live WebSocket.

The permanent Gemini API key remains on the server. Live mode requests a constrained, single-use ephemeral token and sends only that temporary token to the browser. Check `/api/health` for `gemini.ready` and `geminiLive.ready`, then test both models with a short recording. For Docker hosting, configure `GEMINI_API_KEY` on the platform and allow outbound HTTPS and WebSocket access to `generativelanguage.googleapis.com`.
