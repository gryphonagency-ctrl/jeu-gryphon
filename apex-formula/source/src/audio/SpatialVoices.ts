/**
 * Pool of spatialised engine voices for the nearest AI cars. Each voice: 2 oscillators + speed noise → lowpass → panner.
 * Voices are re-assigned with hysteresis so cars don't swap voices every frame; Doppler is applied via detune.
 */
import * as THREE from 'three';
import type { CarState, World } from '../core/types';
import { CAR } from '../core/constants';
import { AudioCore, approach, clampSafe } from './core';

const MAX_VOICES = 6;
const SPEED_OF_SOUND = 343;
const DOPPLER_CAP = 0.25;
const SWAP_MARGIN = 0.8; // a new car must be this fraction of the current car's distance to take over the voice
const SWAP_COOLDOWN = 0.45;

class Voice {
  readonly oscA: OscillatorNode;
  readonly oscB: OscillatorNode;
  readonly mix: GainNode;
  readonly noise: AudioBufferSourceNode;
  readonly noiseGain: GainNode;
  readonly lpf: BiquadFilterNode;
  readonly panner: PannerNode;
  readonly nodes: AudioNode[];
  carId = -1;
  cooldown = 0;
  fade = 0; // 0..1 fade-in after (re)assignment
  rpm: number = CAR.idleRpm;

  constructor(core: AudioCore, hrtf: boolean, dest: AudioNode) {
    const f0 = (CAR.idleRpm / 60) * 3;
    this.oscA = core.osc('sawtooth', f0, -5);
    this.oscB = core.osc('square', f0 * 2, 6);
    this.mix = core.gain(0);
    this.noise = core.noise('pink');
    this.noiseGain = core.gain(0);
    this.lpf = core.filter('lowpass', 2500, 0.8);
    this.panner = core.panner(hrtf);
    // Exhaust is loudest behind the car: orientation is set to -forward each frame.
    this.panner.coneInnerAngle = 140;
    this.panner.coneOuterAngle = 320;
    this.panner.coneOuterGain = 0.55;
    this.oscA.connect(this.mix);
    this.oscB.connect(this.mix);
    this.mix.connect(this.lpf);
    this.noise.connect(this.noiseGain).connect(this.lpf);
    this.lpf.connect(this.panner).connect(dest);
    const t = core.now;
    this.oscA.start(t);
    this.oscB.start(t);
    this.noise.start(t, Math.random() * 2);
    this.nodes = [this.oscA, this.oscB, this.mix, this.noise, this.noiseGain, this.lpf, this.panner];
  }
}

const _camPos = new THREE.Vector3();
const _camVel = new THREE.Vector3();
const _prevCamPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _carFwd = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);

export class SpatialVoices {
  private readonly core: AudioCore;
  private readonly out: GainNode;
  private readonly voices: Voice[] = [];
  private activeCount = MAX_VOICES;
  private hrtf = true;
  private hasPrevCam = false;
  private alive = true;

  // Scratch for nearest selection (fixed size, no per-frame allocation).
  private readonly nearIds = new Int32Array(MAX_VOICES + 2);
  private readonly nearDist = new Float64Array(MAX_VOICES + 2);
  private readonly carDist = new Float64Array(64);

  constructor(core: AudioCore, dest: AudioNode, hrtf: boolean, count: number) {
    this.core = core;
    this.hrtf = hrtf;
    this.out = core.gain(0);
    this.out.connect(dest);
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(core, hrtf, this.out));
    this.setQuality(hrtf, count);
    core.gainTo(this.out.gain, 1, 0.2);
  }

  setQuality(hrtf: boolean, count: number): void {
    this.activeCount = clampSafe(count, 0, MAX_VOICES, MAX_VOICES) | 0;
    if (hrtf !== this.hrtf) {
      this.hrtf = hrtf;
      for (const v of this.voices) v.panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
    }
    for (let i = this.activeCount; i < MAX_VOICES; i++) {
      const v = this.voices[i];
      if (v.carId >= 0) this.unassign(v);
    }
  }

  private unassign(v: Voice): void {
    v.carId = -1;
    v.fade = 0;
    this.core.gainTo(v.mix.gain, 0, 0.03);
    this.core.gainTo(v.noiseGain.gain, 0, 0.03);
  }

  private static audible(car: CarState): boolean {
    return car.status !== 'retired' && car.status !== 'dnf' && car.status !== 'dsq' && car.engine.health > 0.001 && car.engine.rpm > 300;
  }

  update(world: World, camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.alive) return;
    const c = this.core;
    const cars = world.cars;
    const playerId = world.playerCarId;

    // Listener from the camera.
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _fwd.set(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[9], -camera.matrixWorld.elements[10]).normalize();
    _up.set(camera.matrixWorld.elements[4], camera.matrixWorld.elements[5], camera.matrixWorld.elements[6]).normalize();
    if (this.hasPrevCam && dt > 0.0005) {
      _camVel.subVectors(_camPos, _prevCamPos).divideScalar(dt);
      // Camera cuts: ignore implausible velocities.
      if (_camVel.lengthSq() > 150 * 150) _camVel.set(0, 0, 0);
    } else {
      _camVel.set(0, 0, 0);
    }
    _prevCamPos.copy(_camPos);
    this.hasPrevCam = true;
    this.setListener(_camPos, _fwd, _up);

    // Distances of all audible non-player cars; select the N nearest (+2 for hysteresis).
    const n = Math.min(cars.length, this.carDist.length);
    const want = this.activeCount;
    let found = 0;
    for (let i = 0; i < n; i++) {
      const car = cars[i];
      if (i === playerId || !SpatialVoices.audible(car)) {
        this.carDist[i] = Infinity;
        continue;
      }
      const d = car.position.distanceToSquared(_camPos);
      this.carDist[i] = d;
      // Insertion into the sorted nearest list.
      const cap = want + 2;
      if (found < cap || d < this.nearDist[found - 1]) {
        let j = found < cap ? found : cap - 1;
        while (j > 0 && this.nearDist[j - 1] > d) {
          this.nearDist[j] = this.nearDist[j - 1];
          this.nearIds[j] = this.nearIds[j - 1];
          j--;
        }
        this.nearDist[j] = d;
        this.nearIds[j] = i;
        if (found < cap) found++;
      }
    }

    // Keep/re-assign voices with hysteresis.
    for (let vi = 0; vi < want; vi++) {
      const v = this.voices[vi];
      v.cooldown -= dt;
      if (v.carId >= 0) {
        const cd = v.carId < n ? this.carDist[v.carId] : Infinity;
        let rank = -1;
        for (let k = 0; k < found; k++) if (this.nearIds[k] === v.carId) rank = k;
        if (cd === Infinity || (rank < 0 && v.cooldown <= 0)) {
          this.unassign(v);
        } else if (rank >= want && v.cooldown <= 0) {
          // Fell outside the strict top-N: swap only if an unassigned nearer car is meaningfully closer.
          const cand = this.pickUnassigned(found);
          if (cand >= 0 && this.carDist[cand] < cd * SWAP_MARGIN * SWAP_MARGIN) {
            this.assign(v, cand);
          }
        }
      }
    }
    for (let vi = 0; vi < want; vi++) {
      const v = this.voices[vi];
      if (v.carId >= 0) continue;
      const cand = this.pickUnassigned(Math.min(found, want));
      if (cand >= 0) this.assign(v, cand);
    }

    // Drive voices.
    for (let vi = 0; vi < MAX_VOICES; vi++) {
      const v = this.voices[vi];
      if (v.carId < 0 || v.carId >= n) continue;
      const car = cars[v.carId];
      v.fade = approach(v.fade, 1, 0.08, dt);
      this.driveVoice(v, car, dt);
    }
  }

  private pickUnassigned(count: number): number {
    for (let k = 0; k < count; k++) {
      const id = this.nearIds[k];
      let taken = false;
      for (let vi = 0; vi < MAX_VOICES; vi++) {
        if (this.voices[vi].carId === id) {
          taken = true;
          break;
        }
      }
      if (!taken) return id;
    }
    return -1;
  }

  private assign(v: Voice, carId: number): void {
    v.carId = carId;
    v.cooldown = SWAP_COOLDOWN;
    v.fade = 0;
    const c = this.core;
    c.gainTo(v.mix.gain, 0, 0.005);
    c.gainTo(v.noiseGain.gain, 0, 0.005);
  }

  private setListener(pos: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3): void {
    const l = this.core.ctx.listener;
    const t = this.core.now;
    const px = clampSafe(pos.x, -1e5, 1e5);
    const py = clampSafe(pos.y, -1e5, 1e5);
    const pz = clampSafe(pos.z, -1e5, 1e5);
    const fx = clampSafe(fwd.x, -1, 1);
    const fy = clampSafe(fwd.y, -1, 1);
    const fz = clampSafe(fwd.z, -1, 1, 1);
    const ux = clampSafe(up.x, -1, 1);
    const uy = clampSafe(up.y, -1, 1, 1);
    const uz = clampSafe(up.z, -1, 1);
    if (l.positionX) {
      l.positionX.setTargetAtTime(px, t, 0.02);
      l.positionY.setTargetAtTime(py, t, 0.02);
      l.positionZ.setTargetAtTime(pz, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      const legacy = l as AudioListener & { setPosition?: (x: number, y: number, z: number) => void; setOrientation?: (...v: number[]) => void };
      legacy.setPosition?.(px, py, pz);
      legacy.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
  }

  private driveVoice(v: Voice, car: CarState, dt: number): void {
    const c = this.core;
    const t = c.now;
    const p = car.position;
    const px = clampSafe(p.x, -1e5, 1e5);
    const py = clampSafe(p.y, -1e5, 1e5);
    const pz = clampSafe(p.z, -1e5, 1e5);
    _carFwd.copy(_zAxis).applyQuaternion(car.quaternion);
    const pan = v.panner;
    if (pan.positionX) {
      pan.positionX.setTargetAtTime(px, t, 0.02);
      pan.positionY.setTargetAtTime(py, t, 0.02);
      pan.positionZ.setTargetAtTime(pz, t, 0.02);
      pan.orientationX.setTargetAtTime(clampSafe(-_carFwd.x, -1, 1), t, 0.03);
      pan.orientationY.setTargetAtTime(clampSafe(-_carFwd.y, -1, 1), t, 0.03);
      pan.orientationZ.setTargetAtTime(clampSafe(-_carFwd.z, -1, 1, -1), t, 0.03);
    } else {
      const legacy = pan as PannerNode & { setPosition?: (x: number, y: number, z: number) => void; setOrientation?: (x: number, y: number, z: number) => void };
      legacy.setPosition?.(px, py, pz);
      legacy.setOrientation?.(-_carFwd.x, -_carFwd.y, -_carFwd.z);
    }

    // Doppler: relative closing speed along the car→listener direction.
    _dir.subVectors(_camPos, p);
    const dist = _dir.length();
    let ratio = 1;
    if (dist > 0.5) {
      _dir.divideScalar(dist);
      const vSrc = car.velocity.dot(_dir); // source speed toward the listener
      const vLis = _camVel.dot(_dir); // listener speed away from the source
      const denom = SPEED_OF_SOUND - clampSafe(vSrc, -300, 300);
      ratio = (SPEED_OF_SOUND - clampSafe(vLis, -300, 300)) / (denom < 20 ? 20 : denom);
      ratio = clampSafe(ratio, 1 - DOPPLER_CAP, 1 + DOPPLER_CAP, 1);
    }
    const dopplerCents = 1200 * Math.log2(ratio);

    // Pitch & timbre
    const rpm = clampSafe(car.engine.rpm, 300, CAR.maxRpm * 1.1, CAR.idleRpm);
    v.rpm = approach(v.rpm, rpm, 0.03, dt);
    const nrm = clampSafe((v.rpm - CAR.idleRpm) / (CAR.maxRpm - CAR.idleRpm), 0, 1);
    const th = clampSafe(car.engine.throttle, 0, 1);
    const f0 = (v.rpm / 60) * 3;
    c.freqTo(v.oscA.frequency, f0, 0.015);
    c.freqTo(v.oscB.frequency, f0 * 2, 0.015);
    c.detuneTo(v.oscA.detune, dopplerCents - 5, 0.03);
    c.detuneTo(v.oscB.detune, dopplerCents + 6, 0.03);
    c.freqTo(v.lpf.frequency, 900 + 4200 * nrm * (0.5 + 0.5 * th), 0.04);

    // Gain: throttle & fade-in. The panner handles distance.
    const level = (0.28 + 0.72 * th) * (0.55 + 0.45 * nrm) * v.fade * 0.55;
    c.gainTo(v.mix.gain, level, 0.04);
    // Wind/tyre layer scales with that car's speed.
    const spd = clampSafe(car.speedAbs, 0, 120) / 95;
    c.gainTo(v.noiseGain.gain, spd * spd * 0.4 * v.fade, 0.05);
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    const c = this.core;
    c.gainTo(this.out.gain, 0, 0.03);
    const voices = this.voices;
    const out = this.out;
    setTimeout(() => {
      for (const v of voices) for (const nd of v.nodes) c.release(nd);
      c.release(out);
    }, 160);
  }
}
