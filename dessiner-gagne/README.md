# Dessiner, c’est gagné

The AI drawing game runs as a standalone Render service and is also linked from the existing arcade.

## Deploy on Render

The repository-root `render.yaml` defines this service with `dessiner-gagne` as its root directory. Create it from the Render Blueprint dashboard and provide `OPENAI_API_KEY` when Render requests the secret. Never put this value in source code or in the browser.

The key is only read by `server.js`. The first round starts automatically when the game page opens. Each correct answer reveals the winner, then starts a new round after four seconds without another click. A new round asks the text model for a concrete French subject and then asks the AI to draw it as validated, childlike SVG strokes. The answer remains on the server until a spectator guesses correctly.

Both the subject and the drawing use `OPENAI_TEXT_MODEL` (default: `gpt-4o-mini`); image-model access is not required. `/api/health` reports whether an API key is present and the configured drawing model.

## Usage and limits

Each round makes two OpenAI text API requests. `MAX_DAILY_DRAWS` defaults to 10 to limit unexpected usage, and each IP is limited to 10 new rounds per 10 minutes. The daily limit is held in process memory and resets if Render restarts the service. When the daily limit is reached, automatic rounds stop and the game displays the server error. Increase it only after checking the account’s API usage and budget.

The service generates subjects and drawings when requested; it does not contain a stored collection of 1,000 image files. Recent subjects are excluded from the text model’s next choices while the service process is running.

Run locally with `npm start` and validate with `npm test`.
