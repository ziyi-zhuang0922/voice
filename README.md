# Voice workspace

Minimal browser desktop workspace for recording audio and transcribing it with AssemblyAI Universal-2. English interface, automatic language detection, editable transcript and clipboard copy. This is asynchronous transcription after recording stops, not live streaming.

## Run

Requires Node.js 22+; no third-party dependencies or install step.

1. Set `ASSEMBLYAI_API_KEY` securely in your environment, or copy `.env.example` to the ignored `.env` and set the key locally. Never commit the key. The start command enables Node's environment-proxy support, which is required in this cloud environment.
2. From `/workspace/voice`, run `npm start`.
3. Open the local server on port 3000 in a supported desktop browser. Allow microphone permission, click the microphone to record, then click again to stop and transcribe. Recording stops automatically after five minutes.

Browser microphone access requires localhost or HTTPS. The local MVP has no user accounts or persistence. Audio is sent to AssemblyAI; provider retention and billing apply. The server does not save recordings to disk.

Outbound HTTPS access to `api.assemblyai.com` is required. Credentials stay on the server. Universal-2 is explicitly selected through `speech_models: ['universal-2']`; there is no model fallback.

## Validate

Run `npm test`. Tests exercise upload, submission, model selection, polling, missing configuration, invalid input, cross-origin rejection, and provider failure through mocked provider responses. They do not verify microphone hardware or actual AssemblyAI recognition.

Check `/api/health` for configured status. A complete live check requires a real API key and a browser microphone: record a short English phrase and confirm the returned transcript. The cloud onboarding run verified server behavior but had no key for live transcription.

## Deploy

The project includes a Docker deployment definition. Deploy it through a platform that supplies HTTPS and set these secrets in that platform's environment settings: `ASSEMBLYAI_API_KEY`, `APP_BASIC_AUTH_USER`, and `APP_BASIC_AUTH_PASSWORD`. Keep the password long and unique. When both access-protection variables are set, the application requires HTTP Basic authentication for the workspace and transcription API; `/api/health` remains available for the platform health check.
