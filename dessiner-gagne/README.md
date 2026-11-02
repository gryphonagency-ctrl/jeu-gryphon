# Dessiner, c’est gagné

The AI drawing game runs as a standalone Render service and is also linked from the existing arcade.

## Deploy on Render

The repository-root `render.yaml` defines this service with `dessiner-gagne` as its root directory. Create it from the Render Blueprint dashboard and provide `OPENAI_API_KEY` when Render requests the secret. Never put this value in source code or in the browser.

The key is only read by `server.js`. The first round starts automatically when the game page opens. Each correct answer reveals the winner, then starts a new round after four seconds without another click. A new round asks the text model for a concrete French subject, then requests a fresh childlike computer-doodle image from the image model. The answer remains on the server until a spectator guesses correctly.

The default image model is `gpt-image-2`; `/api/health` reports the configured model and whether an API key is present. A present key does not guarantee model access. If the game reports that OpenAI rejects the model, check `OPENAI_IMAGE_MODEL` in Render and confirm the OpenAI organization/project has access to that model.

## Usage and limits

Each round makes two OpenAI API requests. `MAX_DAILY_DRAWS` defaults to 10 to limit unexpected image-generation usage, and each IP is limited to 10 new rounds per 10 minutes. The daily limit is held in process memory and resets if Render restarts the service. When the daily limit is reached, automatic rounds stop and the game displays the server error. Increase it only after checking the account’s API usage and budget.

The service generates subjects and drawings when requested; it does not contain a stored collection of 1,000 image files. Recent subjects are excluded from the text model’s next choices while the service process is running.

Run locally with `npm start` and validate with `npm test`.
