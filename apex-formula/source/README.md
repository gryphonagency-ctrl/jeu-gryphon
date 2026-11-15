# APEX FORMULA

**A Formula 1 racing game for the browser, built entirely with Three.js. Every car, circuit, texture, sound and voice line is generated in code at load time. There are no asset files in this repository.**

The game was built by Claude Fable 5.1 working as a lead agent plus ten parallel sub-agents, each owning one module of the codebase against a shared architecture contract. The contract is reproduced in [ARCHITECTURE.md](ARCHITECTURE.md).

<p align="center">
  <a href="https://bridge-mind.github.io/apex-formula/"><strong>▶ Play it in your browser</strong></a>
</p>

## Play

Open **https://bridge-mind.github.io/apex-formula/** in a desktop browser with WebGL2 (Chrome, Edge, Firefox or Safari). Press Enter on the title screen, pick a driver from the showroom, choose a circuit, session type and difficulty, then start. Keyboard and gamepad both work.

Quick Race, Time Trial, or a Grand Prix Weekend where an eight-minute qualifying session sets the grid. Dry, wet and dynamic weather. Up to 19 AI drivers.

## Mode TikTok LIVE

Le panneau « GRYPHON ARCADE · TIKTOK LIVE » se connecte au relais WebSocket du même hôte. Pendant le direct :

- Chaque pseudo unique qui écrit `go` rejoint la grille; la course démarre automatiquement 10 secondes après la première inscription.
- Jusqu’à 4 spectateurs peuvent participer. Leurs voitures sont pilotées automatiquement; les places restantes sont occupées par l’IA. L’écran se répartit en une vue par participant, jusqu’à quatre, avec une caméra qui suit sa voiture. Chaque vue affiche le circuit et la vitesse de la voiture suivie, dans les coins supérieurs pour laisser la voiture visible.
- Chaque voiture participante démarre avec une vitesse maximale de 50 km/h. Un cadeau augmente la limite de son expéditeur de 1 km/h par pièce, jusqu’à 300 km/h. Les cadeaux envoyés pendant les 10 secondes d’inscription sont appliqués au départ.
- Les cadeaux ne donnent pas de voiture : le spectateur doit d’abord écrire `go`. Les inscriptions rouvrent après l’arrivée.
- Le bouton en forme d’œil masque/réaffiche le panneau; les boutons `−` et `+` règlent le volume et enregistrent le réglage. Le pseudo de chaque participant apparaît en bannière au-dessus de sa voiture.

La connexion utilise `CONNECT_TIKTOK` sur le WebSocket de même origine. Dans Griffon Arcade, le jeu est servi sur `/apex-formula.html`; les fichiers compilés Vite sont dans `../` et les scripts d’effets de la plateforme sont injectés par le serveur. Les boutons de test du panneau permettent de vérifier `go` et les cadeaux sans live.

Pour reconstruire les fichiers publiés depuis `source/`, lance `npm run build -- --base=/apex-formula/`, puis copie le contenu de `dist/` dans le dossier parent `apex-formula/`.

## Features

- **Six circuits**, each with a distinct theme and corner names: Kingsmere Circuit (British countryside), Porto Azzurro Street Circuit (harbour city night race), Al Sahra International (desert at dusk), Circuit de la Riviera (coastal), Schwarzwald Ring (forest) and Autodromo Velocità (high speed).
- **Ten teams, twenty drivers**, each with a procedural livery, driver decals, helmet, personality and pace profile.
- **Vehicle physics** at 120 Hz: four independent suspensions, a combined-slip tyre model with load sensitivity, temperature and wear, aero downforce and drag, DRS, slipstream and dirty air, a V6 turbo-hybrid torque curve with an eight-speed gearbox, ERS deploy and harvest, brake lock-ups, ABS/TC/auto-gear assists, surfaces (asphalt, kerb, grass, gravel, run-off, wet), car-to-car and wall collisions, damage, and a reset.
- **AI drivers** on an optimised racing line with a braking model, overtaking and defending, side-by-side awareness, blue-flag compliance, pit strategy, mistakes scaled by consistency and difficulty, qualifying push laps, race starts and wet-weather pace.
- **Race director**: formation lap and start lights, sector and lap timing, gaps and intervals, DRS detection zones, pit stops with tyre changes and pit-lane speed limit, yellow and blue flags, track-limits warnings and time penalties, weather evolution, team radio, fastest lap, points and results.
- **Procedural F1 cars**: sculpted monocoque, multi-element wings with an animated DRS flap, halo, floor and diffuser, articulating suspension, steering wheel and driver, glowing brake discs, rain light, T-cam, compound-coloured tyres, damage states, two LODs.
- **Broadcast-style HUD**: timing tower, speed/gear/RPM strip, ERS and DRS indicators, delta bar, live sector times, minimap, flags, race-control ticker, radio subtitles, weather widget and a multi-function display for pit requests, tyre choice and ERS mode.
- **Cameras**: chase, T-cam, cockpit, nose, trackside TV, helicopter, grid fly-over, podium cinematic, and a replay director that auto-cuts between TV cameras.
- **Instant replay** of the last 90 seconds with scrubbing and speed control.
- **Fully synthesised audio**: layered engine with turbo, wastegate and limiter cut, ERS whine, gear cracks, tyre squeal, kerb rumble, wind, collisions, spatialised AI engines, crowd, start-light beeps, menu music and team radio.
- **Effects**: tyre smoke, sparks, gravel and grass kick-up, rain and spray, heat haze, skid marks, debris, confetti, screen droplets, racing-line ribbon, plus bloom, ambient occlusion, anti-aliasing, motion blur and colour grading.
- **Quality presets** from low to ultra, settings persisted to `localStorage`.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle / brake | W / S or Up / Down | RT / LT |
| Steer | A / D or Left / Right | Left stick |
| Shift up / down | E or Shift / Q or Ctrl | A / B |
| DRS (hold) | Space | X |
| ERS overtake (hold) | R | Y |
| Cycle ERS mode | V | |
| Pit limiter | L | |
| Request pit | P | |
| MFD toggle / prev / next | Tab / , / . | D-pad |
| Cycle camera | C | RB |
| Look back (hold) | B | LB |
| Reset car | Backspace | Right-stick click |
| Instant replay | I | Back |
| Toggle HUD / mute | H / M | |
| Team radio | T | |
| Pause | Esc | Start |

Menus: arrows, WASD or D-pad to navigate; Enter, Space or A to confirm; Esc or B to go back.

## Run it locally

```bash
git clone https://github.com/bridge-mind/apex-formula.git
cd apex-formula
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5200/ by default).

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build |

Each module also ships an isolated harness at `http://localhost:5200/src/<module>/dev.html` (physics, AI, race director, UI, audio, VFX, cameras, track and render) for testing that module on its own.

## How it was built

The lead agent wrote the architecture contract and the shared `src/core` (types, constants, math, event bus, teams, base circuit, track spline) first, then launched ten sub-agents. Each owned exactly one folder, imported only `three` and `src/core`, and never edited another agent's files.

| Module | Owns |
| --- | --- |
| Render | HDR pipeline, sky and sun, shadows, post-processing, menu showroom lighting |
| Track | Swept circuit geometry, kerbs, gravel, barriers, pit complex, grandstands and crowd, scenery, five extra circuits |
| Car | Procedural F1 car model, liveries and decals, LODs, animation, damage |
| Physics | Vehicle dynamics, tyres, aero, powertrain, collisions, surfaces |
| AI | Racing line, speed profile, racecraft, pit-lane driving, difficulty |
| Race | Timing, positions, flags, penalties, DRS, pit stops, weather, radio, results |
| UI | Menus, HUD, MFD, replay controls, settings |
| Audio | Procedural engine, effects, spatial audio, music, radio |
| Input / Camera / Replay | Keyboard and gamepad, camera modes and cinematics, replay ring buffer |
| VFX | Particles, weather, skid marks, screen effects |

## Stack

Vite 8, TypeScript 7 (strict), Three.js 0.185. No other runtime dependencies.

## License

[MIT](LICENSE) © 2026 BridgeMind
