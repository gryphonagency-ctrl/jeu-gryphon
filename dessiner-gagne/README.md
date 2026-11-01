# Dessiner, c’est gagné

Standalone Render web service. It does not add a route or page to the existing arcade.

## Deploy on Render

The repository-root `render.yaml` defines this service with `dessiner-gagne` as its root directory. Create it from the Render Blueprint dashboard and provide `OPENAI_API_KEY` when Render requests the secret. Never put this value in source code or in the browser.

The key is only read by `server.js`. A new round asks the text model for a concrete French subject, then requests a fresh childlike computer-doodle image from the image model. The answer remains on the server until a spectator guesses correctly.

## Usage and limits

Each round makes two OpenAI API requests. `MAX_DAILY_DRAWS` defaults to 10 to limit unexpected image-generation usage. The limit is held in process memory and resets if Render restarts the service. Increase it only after checking the account’s API usage and budget.

The service generates subjects and drawings when requested; it does not contain a stored collection of 1,000 image files. Recent subjects are excluded from the text model’s next choices while the service process is running.

Run locally with `npm start` and validate with `npm test`.
