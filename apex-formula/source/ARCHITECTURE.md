# APEX FORMULA — Architecture Contract

A AAA-quality Formula 1 racing game in the browser. Ten engineers build it in parallel. **This document plus `src/core/*` is the
contract. Read both fully before writing a line of code.** `src/main.ts` shows exactly how and when your module is called.

## Stack & hard rules
- Vite 8 + TypeScript 7 (strict) + Three.js 0.185 (`three` and `three/examples/jsm/*` only). **No other dependencies. No `package.json` edits. No `npm install`.**
- **Everything is procedural.** No external assets or URLs (no glTF, no image/audio files, no web fonts). Generate textures with `CanvasTexture`/`DataTexture`/shaders, geometry in code, audio with Web Audio.
- Work only inside `F1/`. Never look at or touch anything outside `F1/`.
- You own exactly the folder(s) in the table below. Create as many files as you like **inside your folder**. **Do not edit any file outside your folder** — not `core/`, not `main.ts`, not another agent's folder. If you truly need a contract change, mention it in your final report; do not make it.
- Import only from `three`, `src/core/*`, and your own folder. **Never import another agent's folder.**
- `npx tsc --noEmit` (from `F1/`) must pass with **zero errors** and `npx vite build` must succeed before you finish. No `any` unless bridging an untyped browser API. No unused imports.
- Stub files already exist in your folder — overwrite them. Keep the exported class names and constructor signatures exactly as the stubs.
- Performance target: **60 fps at 1080p on an M-series MacBook at quality `high` with 20 cars on track**. Zero per-frame allocations in hot loops (reuse vectors). Instancing for anything repeated. Provide `low/medium/high/ultra` behaviour for `setQuality`.

## Folder ownership
| # | Folder(s) | Agent | Exports (exact) |
|---|---|---|---|
| — | `src/core/`, `src/main.ts`, `index.html` | **Lead** (read-only for all) | `types.ts`, `constants.ts`, `events.ts`, `math.ts`, `world.ts`, `teams.ts`, `circuits.ts`, `track/TrackSpline.ts` |
| 1 | `src/render/` | Graphics / Renderer / Environment | `RenderSystem.ts` → `export class RenderSystem implements IRenderSystem` ctor `(canvas: HTMLCanvasElement)` |
| 2 | `src/track/` | Circuit geometry & world dressing + more circuits | `TrackBuilder.ts` → `export class TrackBuilder implements ITrackBuilder` ctor `()`; `circuits.ts` → `export const CIRCUITS: TrackDefinition[]` |
| 3 | `src/car/` | F1 car visuals (models, liveries, animation) | `CarVisuals.ts` → `export class CarVisuals implements ICarVisuals` ctor `()` |
| 4 | `src/physics/` | Vehicle dynamics | `VehiclePhysics.ts` → `export class VehiclePhysics implements IVehiclePhysics` ctor `()` |
| 5 | `src/ai/` | AI drivers & racing line | `AIDrivers.ts` → `export class AIDrivers implements IAIDrivers` ctor `()` |
| 6 | `src/race/` | Race director: timing, rules, flags, pits, weather, results | `RaceDirector.ts` → `export class RaceDirector implements IRaceDirector` ctor `()` |
| 7 | `src/ui/` | Menus + broadcast HUD (HTML/CSS) | `UISystem.ts` → `export class UISystem implements IUISystem` ctor `(root: HTMLElement)` |
| 8 | `src/audio/` | Procedural audio | `AudioSystem.ts` → `export class AudioSystem implements IAudioSystem` ctor `()` |
| 9 | `src/input/`, `src/camera/`, `src/replay/` | Input, cameras, replay | `InputSystem` ctor `()`, `CameraSystem` ctor `(aspect: number)`, `ReplaySystem` ctor `()` (these three folders MAY import each other) |
| 10 | `src/vfx/` | Particles, weather, skid marks, screen effects, racing-line ribbon | `VFXSystem.ts` → `export class VFXSystem implements IVFXSystem` ctor `()` |

Lifetimes: `RenderSystem`, `UISystem`, `AudioSystem`, `InputSystem`, `CameraSystem` are created once. `TrackBuilder`, `CarVisuals`, `VehiclePhysics`,
`AIDrivers`, `RaceDirector`, `VFXSystem`, `ReplaySystem` are **re-created for every session** and `dispose()`d after — dispose must free GPU
resources, remove your objects from their parent, and unsubscribe from `events`.

## World conventions (memorise)
- Y up. Metres, seconds, m/s, kg, N, radians. UI converts to km/h.
- Track centreline = closed 3D spline (`TrackSpline`). `s` = arc length from the start/finish line in `[0, length)`. `lateral` = signed offset from the
  centreline, **positive = LEFT of the direction of travel**. `left = (T.z, 0, -T.x)`. `heading = atan2(T.x, T.z)`; **turning left increases heading/yaw**.
- Car local frame: **+Z forward, +X left, +Y up**. Car origin = centre of the wheelbase on the ground plane at static ride height (chassis floats
  `CAR.rideHeight` above it; wheel centres at `y = CAR.wheelRadius`). Wheel order **FL, FR, RL, RR** (`WHEEL_LOCAL_POSITIONS`).
- `DriverInput.steer`: **positive = steer LEFT**. `WheelState.steerAngle` same sign. Input system maps `A`/`←` to +1.
- Physics runs at fixed `PHYSICS_DT = 1/120`. Visual modules get the real frame `dt`.
- `World.cars` is a stable array of stable `CarState` objects (index === carId), mutated in place by physics. Read fields directly; never cache copies
  across frames. During replay, `main` swaps `world.cars` for the replay array and sets `world.mode = 'replay'`.
- `World.race` is a stable `RaceState` owned by the race director; `race.entries` is sorted by position, `race.entryByCar[carId]` indexes the same objects.
- `World.env` (time of day + weather) is owned by the race director (it progresses weather); everyone reads it.
- Player car is always `carId 0` (`world.playerCarId`). Time-trial = player alone.

## Per-frame data flow (see `main.ts`)
1. `input.update(dt)`; non-driving commands → `main` (pause/camera/mute/hud/replay/screenshot/look-back) or `ui.handleCommand` (menu/MFD nav).
2. Fixed steps while live: player `DriverInput` → `physics.setInput(0, …)` (or `ai.computeInput(0, world, dt, 'pit-lane')` when the pit assist is
   driving); `ai.update(world, dt)` then `physics.setInput(id, ai.getInput(id))` per AI car; `physics.step(world, dt)`; `race.update(world, dt)`.
3. `replay.record(world, dt)`.
4. `camera.update(world, dt)` → `track.update` → `cars.update` → `vfx.update` → `render.update` → `audio.update` → `ui.update` → `render.render()`.

## App phases (`AppPhase`)
`title` → `menu` → (start-session) `loading` (track.build + cars.build report progress) → race: `pre-session` (cars held on the grid, camera
`grid-flyover`, UI shows the grid + "START") → (ready) `session` (race director `startProcedure()` runs formation → 5 lights → lights out) →
`paused` ⇄ `session` → `replay` (from session/paused/results) → `results` (podium cinematic; sim keeps running so stragglers finish) → `menu` or
`next-session` (Grand Prix mode: qualifying → race with `gridOrder: 'qualifying'`). Practice/qualifying/time-trial skip `pre-session`: cars start
spread around the lap for a flying out-lap (lap 0 does not count).

## Cross-module protocols

### Start procedure (race director ⇄ physics ⇄ UI/audio/track)
`startProcedure()` → phase `formation` (~2 s, cars `held`) → `lights`: emit `race:lights {1..5}` one per `TIMING.lightsIntervalSeconds`, then hold a random
`TIMING.lightsHoldMin..Max` → emit `race:lights {0}`, phase `green`, `cars.holdCar(id,false)` for all → after ~3 s phase `racing`. Track builder shows
the lights on the gantry from `race.lightsOn`; audio beeps; UI shows the light strip.

### Lap timing & classification (race director)
Laps count on forward S/F crossings via `car.track.lap`/`progress`. Sector times from `car.track.sector` changes. Position = sort by `status`
(finished first by finish order) then `progress`. Gaps in seconds (`gapToLeader`, `interval`) from progress delta / speed (use the leader's recent
speed profile per s for accuracy). Race ends when the leader completes `totalLaps` (`finished`), each car is classified when it next crosses the line,
`complete` once all are classified (or 60 s after the leader). Qualifying: `timeRemaining` counts down from `SESSION_LIMITS.qualifyingMinutes`;
classification by `bestLap`; `results.gridDriverIds` = order. Practice: `practiceMinutes`. Time-trial (`config.mode === 'time-trial'`): unlimited
(`timeRemaining = -1`), ends only via `endSession()`. Points per `POINTS_TABLE` (+1 fastest lap in top 10) in races.

### DRS
Race director: `race.drsEnabled` = phase `racing` && leader lap ≥ `DRS.enabledFromLap` && wetness < 0.3. Per car: at a zone's `detectionS` crossing,
record the time gap to the car directly ahead (`drsDetectionGap`). While inside `[startS, endS]` of the zone and gap < `DRS.detectionGap`, grant DRS via
the `ICarService` it received in `createSession`: **`cars.setDrsAvailable(carId, true)`** (false when leaving the zone / conditions lost) and mirror
the value into `entry.drsAvailable`. In non-race sessions DRS is available in every zone. Physics stores availability in `CarState.drs.available`,
opens the flap when `input.drs && drs.available` (or `assists.drsAssist`), closes on brake > 0.2 or when unavailable, applies
`DRS.dragReductionFactor` / `downforceLossFactor`, emits `car:drs`.

### Pit stops
- Request: player → UI MFD → `UICommand request-pit {compound}` → `race.requestPit(0, compound)`. AI → sets `DriverInput.pitRequest = true` and
  `pitCompound` (or null → the director picks: soft→medium→hard progression, inters/wets when `wetness > 0.45`).
- Director: `pitPhase`: `requested` → `entering` (car within the pit entry transition: `track.pitD(car.track.s)` in `[0, transition]`) → `in-lane`
  (`car.track.inPitLane`) [emit `race:pit-entry`] → `stopped` when the car is within 1.5 m of `track.pitBox(team.pitBoxIndex)` and `speedAbs < 0.5`
  [`cars.holdCar(id,true)`, `pitStopTimer = TIMING.pitStopBaseSeconds + variance / team.performance.pitCrew`, emit `race:pit-stop-start`] → timer
  done: `cars.serviceCar(id,{compound, repair:true})`, `cars.holdCar(id,false)`, `released` [emit `race:pit-stop-end`], `tyreAge = 0`, `pitStops++` →
  `exiting` when moving → `none` when `!inPitLane` [emit `race:pit-exit`]. Pit-lane speeding (`speedLimited` zone, speed > limit + 1 m/s) → 5 s penalty.
- AI (`update` and `computeInput(…, 'pit-lane')`): follow `track.pitLaneSample(s)` from `pitLane.entryS`, `pitLimiter = true` in the limited zone,
  brake to a stop centred on the box, throttle 0 while `pitPhase === 'stopped'`, leave on `released`, rejoin at the exit blend. Physics: `pitLimiter`
  caps forward speed at `CAR.pitSpeedLimit`; `inPitLane` from `track.isInPitLane(s, lateral)`; corridor walls from `track.corridorAt`.
- Player with `assists.pitAssist`: `main` switches the player's input to `ai.computeInput(0, world, dt, 'pit-lane')` from `in-lane` to `released`.

### Flags, penalties, incidents (race director)
Yellow in a sector when a car is stopped/spinning/very slow on the racing surface or after a heavy collision; clears after ~8 s. Blue flag to a car
about to be lapped (leader within 2 s behind). Track limits: `car.track.wheelsOff === 4` on asphalt exit while gaining time → warning; 3 warnings →
5 s time penalty (`race:penalty`). Collisions with `impulse` above a threshold where the car behind is at fault → warning/penalty. `randomEvents`:
small per-lap chance of AI engine failure → `cars.retireCar(id)` + yellow. Safety car / VSC are optional stretch goals (phase values exist).

### Weather & time of day (race director writes `world.env`)
`config.weather` presets set the initial `WeatherState` (`main` does this); `dynamic` lets the director evolve rain with a slow random walk. `wetness`
follows `rain` with lag (dries slower than it wets). `timeOfDay` advances ~1 game-hour per 20 real minutes. Physics: grip × `(1 - 0.45·wetness)` for
slicks, inters best at 0.3–0.7, wets best > 0.6; aquaplaning risk at high speed on standing water. Renderer: sun from time of day, overcast lighting,
fog; VFX: rain, spray, wet reflections; audio: rain noise. UI shows a weather widget.

### Replay
`ReplaySystem` records a compact snapshot of every car (pose, wheel spin/steer/travel, engine rpm/gear/throttle/brake, drs, speed, slips) at ≥ 30 Hz
into a ring buffer (last 90 s). `enter()` returns cloned `CarState`s (use `createEmptyCarState` + `copyCarState` from `core/world.ts`) which `main`
swaps into `world.cars`; `update(dt)` interpolates and writes into them. Camera `replay-director` cinematic auto-cuts TV cameras following the target.

### Cameras (`ICameraSystem`)
`cycle()` order: `chase → chase-far → tcam → cockpit → nose → tv → helicopter → chase`. Chase: spring-damped follow with speed-dependent distance/FOV,
yaw lag on slides, g-force sway, rumble from `chassis.kerbRumble`/`bottoming`, shake on `car:collision`. Cockpit: helmet-cam at the driver's eye
point (≈ local `(0, 0.78, -0.35)`), looking forward over the halo, with head bob and g-force lean. `main` calls
`cars.setCockpitView(playerCarId, mode === 'cockpit')` every frame — car visuals hide the driver's helmet/head (keep the halo, wheel, hands, mirrors)
so the view is clean. TV: trackside cameras auto-placed at every corner (`track.cornersWithS()`)
plus straights, choose the camera ahead of the target, pan/zoom like a broadcast. Cinematics: `menu-orbit` (orbit the origin: radius 7 m, height 1.2 m,
slow), `grid-flyover` (sweep down the grid toward the front), `podium` (slow orbit of the winner), `replay-director`.

### Menu showroom
`CarVisuals.buildShowcase(team, driver, parent)` builds a static hero car at the origin. `RenderSystem.setMenuMode(true)` shows a studio look
(dark gradient backdrop, rim/key lights, glossy reflective floor, soft volumetric haze) with no track. UI menus keep the right ~55% of the screen
clear so the car is visible; UI emits `preview-driver` when the highlighted driver changes.

### Quality
`QualityLevel` `low|medium|high|ultra`. Render: resolution scale, shadow map size/cascades, post effects (bloom, GTAO/SSAO, SMAA/TAA, motion blur,
DoF for cinematics, lens flare, vignette, chromatic aberration, film grain, colour grading). Track/cars: LOD and instancing counts. VFX: particle
budget. Each module gets `setQuality` — respond live without rebuilding where possible.

## Controls (Agent 9 implements; everyone honours the resulting `DriverInput` / `InputCommand`s)
Keyboard: `W`/`↑` throttle · `S`/`↓` brake · `A`/`←` steer LEFT (+1) · `D`/`→` steer RIGHT (−1) · `E` / `Shift` shift up · `Q` / `Ctrl` shift down ·
`Space` DRS (hold) · `R` ERS overtake (hold; releases to previous mode) · `V` cycle ERS mode · `L` pit limiter · `P` request pit (UI opens MFD) ·
`Tab` MFD toggle · `,` / `.` MFD prev/next · `Enter` confirm · `C` cycle camera · `B` look back (hold) · `Backspace` reset car · `I` instant replay ·
`H` toggle HUD · `M` mute · `T` team radio · `F8` screenshot · `Esc` pause. Keyboard steering: speed-sensitive rate with smoothing and auto-centre so
it feels like a wheel, not a light switch.
Gamepad (standard mapping): left stick steer · RT throttle · LT brake · A shift up · B shift down · X DRS · Y ERS overtake · LB look back · RB camera ·
D-pad MFD nav · Start pause · Back replay · right-stick click reset. Rumble on kerbs, lock-ups, collisions.
Menus: arrows/WASD/D-pad navigate, Enter/Space/A confirm, Esc/B back.

## Quality bar (this must feel like a current-gen console F1 title)
- **Graphics (1):** HDR pipeline, ACES/AgX tone mapping, physically-based sun + procedural sky/atmosphere (day/sunset/night with stadium floodlights),
  cascaded shadow maps that follow the camera, GTAO/SSAO, bloom, SMAA/TAA, per-object/camera motion blur, lens flare & dirt, heat shimmer hooks,
  exposure adaptation, colour grading, vignette, film grain; wet-weather look (darker, reflective asphalt via env/SSR-like reflections); 60 fps.
- **Track (2):** asphalt with mown-stripe grass, red/white kerbs, gravel traps, painted white lines & pit-lane markings, grid boxes, S/F line, DRS
  boards, braking marker boards (100/50), marshal posts with flag animation, tyre walls/Tecpro/Armco/concrete by theme, catch fences, pit complex
  (garages with team colours, pit wall gantries, lollipop crews), start-light gantry (lights driven by `race.lightsOn`), grandstands full of animated
  instanced crowd with team-coloured flags, buildings/trees/bridges/ad boards (fictional brands), helicopter, distant scenery matching the theme.
  Geometry swept from `TrackSpline.sample` so it exactly matches physics `heightAt`. **Plus 5 more circuits** with distinct themes (street night race
  in a harbour city, desert dusk, coastal, forest, high-speed) authored per the notes in `core/circuits.ts`, exported as `CIRCUITS`.
- **Cars (3):** 2022+-regulation F1 shapes — sculpted monocoque, nose & multi-element front wing with endplates, sidepods with undercut, engine cover
  fin, airbox, halo, floor with edge wing, beam wing, rear wing with animated DRS flap, wheel covers, tyres with correct compound sidewall colours and
  wear/marbles, brake discs that glow, suspension arms that articulate with `suspensionTravel`, steering, driver with helmet & gloved hands on a wheel
  that turns, rain light, T-cam, numbers & driver TLA decals, procedural liveries per `TeamDef.liveryStyle` with fictional sponsors, clearcoat/carbon/
  metallic materials, LODs, damage states (missing front wing endplate/elements, bent rear wing).
- **Physics (4):** rigid body with 4 independent suspensions (spring/damper/anti-roll), tyre model with slip curves (Pacejka-like) combined slip,
  load sensitivity, temperature & wear affecting grip, aero downforce/drag scaling with speed, DRS, dirty air/slipstream from cars ahead, ~1000 hp
  V6 turbo-hybrid torque curve with 8-speed gearbox & realistic shift times, ERS deploy/harvest per mode, brakes with lock-up, ABS/TC/auto-gear
  assists, surfaces (asphalt/kerb/grass/gravel/runoff/pit/wet), car-vs-car collisions (OBB or capsule), wall collisions via `track.corridorAt`,
  damage, bottoming sparks flag, reset. Believable: ~0-100 km/h in 2.6 s, top speed ~340 km/h with DRS, 5 g braking, 4-5 g lateral.
- **AI (5):** optimised racing line (minimise curvature within track width), speed profile from lateral grip + braking model + tyre/fuel state,
  look-ahead pursuit steering, overtaking (slipstream, DRS, late braking, switch-back), defending (cover inside), avoidance & side-by-side awareness,
  blue-flag compliance, pit strategy, mistakes scaled by `consistency` and difficulty, personalities, qualifying push laps, race starts, pit-lane
  driving, wet-weather speed reduction. Difficulty 0..1 maps roughly 85 % → 103 % of `referenceLapTime` pace.
- **Race director (6):** everything in the protocols above, plus race-control messages, team-radio lines (`radio:message`) with personality,
  fastest-lap/purple/green sector logic, overtakes, results & points, qualifying and Grand Prix weekend flow.
- **UI (7):** F1-TV-style HUD — timing tower with team colour bars, positions, TLAs, gaps/intervals, tyre compound dots with age, DRS/pit flags;
  speedo/gear/RPM strip with limiter flash, ERS bar & mode, DRS indicator, fuel/tyre wear, delta bar, live lap/sector times with purple/green/yellow,
  minimap from `track.samples` with car dots, lap counter, position badge, flags, race-control ticker, radio subtitles, weather widget, start lights,
  penalty/warning toasts, MFD (tyre choice, ERS, pit request). Menus: title with animated logo, main menu, mode select, driver/team select with car
  showroom (emit `preview-driver`), circuit select with an SVG track map drawn from `TrackSpline` and stats, race settings, assists, graphics/audio
  settings persisted to `localStorage`, loading screen with progress, pre-session grid screen, pause, results/podium with points, replay controls.
  Broadcast typography (system sans, italics, tight tracking), skewed panels, motion. Full keyboard + gamepad navigation.
- **Audio (8):** layered procedural V6 turbo-hybrid engine (fundamental + harmonics + turbo whine + wastegate + downshift blip + limiter cut),
  ERS whine, gear-shift crack, tyre squeal/scrub keyed to `wheels[i].slip`, kerb rumble, gravel/grass, wind by speed, brake squeal, collision
  crunch, DRS clunk, pit limiter beep, spatialised (PannerNode) engines for nearby AI cars with doppler, crowd swell on events, start-light beeps,
  UI sounds, procedural menu music, team-radio beep + optional `speechSynthesis` for radio lines.
- **Input/Camera/Replay (9):** see protocols. Cameras must never clip through the car or ground; smooth mode transitions.
- **VFX (10):** GPU/instanced particles — tyre smoke from `wheels[i].slip` & surface, sparks from `chassis.bottoming`, gravel/dust kick-up, grass
  clippings, rain (camera-attached volume), spray plumes behind cars scaling with speed × wetness, heat haze quad behind exhausts, brake-disc glow
  halo, DRS-flap air wisps at speed in the wet, debris on `car:collision`, confetti on the podium, skid marks (persistent decals via strips), screen
  rain droplets/streaks for cockpit/T-cam in rain, racing-line ribbon from `world.racingLine` when `config.assists.racingLine !== 'off'`.

## Running
```bash
npm run dev        # http://localhost:5200
npm run typecheck
npm run build
```
Isolated testing: you may add `dev.html` + `dev.ts` **inside your own folder** (Vite serves `http://localhost:5200/src/<folder>/dev.html`) that
imports only `core/*` and your module for a harness. Delete nothing of the shared scaffold.
