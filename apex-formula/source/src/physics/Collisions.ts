/**
 * Car–wall (track corridor) and car–car (2D OBB SAT) collisions with impulse response and damage.
 */
import * as THREE from 'three';
import { events } from '../core/events';
import { clamp, clamp01 } from '../core/math';
import type { Corridor, TrackProjection, TrackSpline } from '../core/track/TrackSpline';
import { frameCoords, makeScratchSample, updateAxes } from './CarSim';
import type { PhysCar } from './PhysCar';
import { COLLISION } from './tuning';

const _sample = makeScratchSample();
const _proj: TrackProjection = { s: 0, lateral: 0, distance: 0 };
const _corr: Corridor = { kind: 'track', minLateral: 0, maxLateral: 0 };
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _ra = new THREE.Vector3();
const _rb = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [COLLISION.halfWidth, COLLISION.halfLength],
  [-COLLISION.halfWidth, COLLISION.halfLength],
  [COLLISION.halfWidth, -COLLISION.halfLength],
  [-COLLISION.halfWidth, -COLLISION.halfLength],
];

type DamagePart = 'frontWing' | 'rearWing' | 'floor' | 'suspension';

/** Apply impact damage from an impulse (N·s) at a contact point given in the car's local frame (x left, z forward). */
export function applyImpactDamage(car: PhysCar, impulse: number, localX: number, localZ: number): void {
  const st = car.state;
  const dv = impulse * car.invMass;
  const amount = clamp01((dv - COLLISION.damageMinDv) / (COLLISION.damageFullDv - COLLISION.damageMinDv));
  if (amount <= 0.005) return;
  const dmg = st.damage;
  let part: DamagePart;
  if (localZ > 1.9) {
    part = 'frontWing';
    dmg.frontWing = clamp01(dmg.frontWing + amount * 1.2);
    const i = localX >= 0 ? 0 : 1;
    dmg.suspension[i] = clamp01(dmg.suspension[i] + amount * 0.5);
  } else if (localZ < -1.9) {
    part = 'rearWing';
    dmg.rearWing = clamp01(dmg.rearWing + amount);
  } else {
    part = 'suspension';
    const i = (localZ >= 0 ? 0 : 2) + (localX >= 0 ? 0 : 1);
    dmg.suspension[i] = clamp01(dmg.suspension[i] + amount * 0.9);
    dmg.floor = clamp01(dmg.floor + amount * 0.35);
  }
  const susp = 0.25 * (dmg.suspension[0] + dmg.suspension[1] + dmg.suspension[2] + dmg.suspension[3]);
  dmg.total = clamp01(0.35 * dmg.frontWing + 0.25 * dmg.rearWing + 0.15 * dmg.floor + 0.25 * susp);
  if (amount > 0.02) events.emit('car:damage', { carId: st.id, part, amount });
}

const recordCollision = (car: PhysCar, impulse: number, withCar: number, point: THREE.Vector3, normal: THREE.Vector3): void => {
  const c = car.state.collision;
  if (c.active && c.impulse >= impulse) return;
  c.active = true;
  c.impulse = impulse;
  c.withCar = withCar;
  c.point.copy(point);
  c.normal.copy(normal);
};

/**
 * Keep the car inside the corridor walls. Each body corner is projected onto the track; corners beyond the corridor
 * bounds are pushed back with a restitution + friction impulse applied at the corner (so the car rotates to align).
 */
export function resolveWalls(car: PhysCar, track: TrackSpline): void {
  const st = car.state;
  const v = st.velocity;
  const w = st.angularVelocity;
  const com = car.com;
  updateAxes(car);
  const fwd = car.fwd;
  const left = car.left;
  const centreLat = st.track.lateral;
  const Iyy = car.inertia.y;
  const invM = car.invMass;

  for (let c = 0; c < 4; c++) {
    const cz = CORNERS[c];
    _p.set(com.x + left.x * cz[0] + fwd.x * cz[1], com.y, com.z + left.z * cz[0] + fwd.z * cz[1]);
    frameCoords(car, track, _p, _proj);
    track.corridorAt(_proj.s, centreLat, _corr);
    let pen = 0;
    let sign = 0;
    if (_proj.lateral > _corr.maxLateral) {
      pen = _proj.lateral - _corr.maxLateral;
      sign = -1;
    } else if (_proj.lateral < _corr.minLateral) {
      pen = _corr.minLateral - _proj.lateral;
      sign = 1;
    }
    if (pen <= 0) continue;
    track.sample(_proj.s, _sample);
    _n.set(_sample.left.x * sign, 0, _sample.left.z * sign).normalize();

    _r.subVectors(_p, com);
    _r.y = 0;
    com.addScaledVector(_n, pen);
    _vp.crossVectors(w, _r).add(v);
    const vn = _vp.x * _n.x + _vp.z * _n.z;
    if (vn >= 0) continue;

    const rxn = _r.z * _n.x - _r.x * _n.z;
    const denom = invM + (rxn * rxn) / Iyy;
    const j = (-(1 + COLLISION.restitutionWall) * vn) / denom;
    v.addScaledVector(_n, j * invM);
    w.y += (rxn * j) / Iyy;

    _t.set(-_n.z, 0, _n.x);
    _vp.crossVectors(w, _r).add(v);
    const vt = _vp.x * _t.x + _vp.z * _t.z;
    const rxt = _r.z * _t.x - _r.x * _t.z;
    const denomT = invM + (rxt * rxt) / Iyy;
    const jt = clamp(-vt / denomT, -COLLISION.frictionWall * j, COLLISION.frictionWall * j);
    v.addScaledVector(_t, jt * invM);
    w.y += (rxt * jt) / Iyy;
    // Scrubbing a wall also kills roll/pitch rates that the corner impulse cannot model.
    w.x *= 0.5;
    w.z *= 0.5;

    recordCollision(car, j, -1, _p, _n);
    applyImpactDamage(car, j, cz[0], cz[1]);
  }
}

/**
 * Car–car contact: 2D oriented bounding boxes (SAT), positional separation, then a normal + friction impulse at the
 * averaged support points. Frozen cars act as infinite mass. Returns the normal impulse (0 if no contact).
 */
export function resolveCarPair(a: PhysCar, b: PhysCar): number {
  if (a.frozen && b.frozen) return 0;
  const ca = a.com;
  const cb = b.com;
  const dx = cb.x - ca.x;
  const dz = cb.z - ca.z;
  const reach = 2 * Math.sqrt(COLLISION.halfLength * COLLISION.halfLength + COLLISION.halfWidth * COLLISION.halfWidth);
  if (dx * dx + dz * dz > reach * reach) return 0;

  updateAxes(a);
  updateAxes(b);
  const HL = COLLISION.halfLength;
  const HW = COLLISION.halfWidth;
  // Horizontal unit axes of both boxes.
  let afx = a.fwd.x;
  let afz = a.fwd.z;
  let l = Math.sqrt(afx * afx + afz * afz) || 1;
  afx /= l;
  afz /= l;
  let alx = a.left.x;
  let alz = a.left.z;
  l = Math.sqrt(alx * alx + alz * alz) || 1;
  alx /= l;
  alz /= l;
  let bfx = b.fwd.x;
  let bfz = b.fwd.z;
  l = Math.sqrt(bfx * bfx + bfz * bfz) || 1;
  bfx /= l;
  bfz /= l;
  let blx = b.left.x;
  let blz = b.left.z;
  l = Math.sqrt(blx * blx + blz * blz) || 1;
  blx /= l;
  blz /= l;

  let minOverlap = Infinity;
  let nx = 0;
  let nz = 0;
  for (let k = 0; k < 4; k++) {
    const lx = k === 0 ? afx : k === 1 ? alx : k === 2 ? bfx : blx;
    const lz = k === 0 ? afz : k === 1 ? alz : k === 2 ? bfz : blz;
    const d = dx * lx + dz * lz;
    const ra = HL * Math.abs(afx * lx + afz * lz) + HW * Math.abs(alx * lx + alz * lz);
    const rb = HL * Math.abs(bfx * lx + bfz * lz) + HW * Math.abs(blx * lx + blz * lz);
    const overlap = ra + rb - Math.abs(d);
    if (overlap < 0) return 0;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sgn = d >= 0 ? 1 : -1;
      nx = lx * sgn;
      nz = lz * sgn;
    }
  }
  _n.set(nx, 0, nz);

  // Contact point: average of the support points facing each other.
  const sa1 = afx * nx + afz * nz >= 0 ? 1 : -1;
  const sa2 = alx * nx + alz * nz >= 0 ? 1 : -1;
  const sb1 = bfx * nx + bfz * nz >= 0 ? -1 : 1;
  const sb2 = blx * nx + blz * nz >= 0 ? -1 : 1;
  _pa.set(ca.x + afx * HL * sa1 + alx * HW * sa2, ca.y, ca.z + afz * HL * sa1 + alz * HW * sa2);
  _pb.set(cb.x + bfx * HL * sb1 + blx * HW * sb2, cb.y, cb.z + bfz * HL * sb1 + blz * HW * sb2);
  _p.addVectors(_pa, _pb).multiplyScalar(0.5);

  const invA = a.frozen ? 0 : a.invMass;
  const invB = b.frozen ? 0 : b.invMass;
  const invIa = a.frozen ? 0 : 1 / a.inertia.y;
  const invIb = b.frozen ? 0 : 1 / b.inertia.y;
  const totalInv = invA + invB;
  if (totalInv <= 0) return 0;
  const sep = minOverlap * 0.9;
  ca.addScaledVector(_n, (-sep * invA) / totalInv);
  cb.addScaledVector(_n, (sep * invB) / totalInv);

  _ra.subVectors(_p, ca);
  _ra.y = 0;
  _rb.subVectors(_p, cb);
  _rb.y = 0;
  const va = a.state.velocity;
  const vb = b.state.velocity;
  const wa = a.state.angularVelocity;
  const wb = b.state.angularVelocity;
  // relative velocity of b w.r.t. a at the contact (horizontal)
  const vrx = vb.x + wb.y * _rb.z - (va.x + wa.y * _ra.z);
  const vrz = vb.z - wb.y * _rb.x - (va.z - wa.y * _ra.x);
  const vn = vrx * nx + vrz * nz;
  if (vn >= 0) return 0;

  const raxn = _ra.z * nx - _ra.x * nz;
  const rbxn = _rb.z * nx - _rb.x * nz;
  const denom = totalInv + raxn * raxn * invIa + rbxn * rbxn * invIb;
  const j = (-(1 + COLLISION.restitutionCar) * vn) / denom;
  va.addScaledVector(_n, -j * invA);
  vb.addScaledVector(_n, j * invB);
  wa.y -= raxn * j * invIa;
  wb.y += rbxn * j * invIb;

  _t.set(-nz, 0, nx);
  const vrx2 = vb.x + wb.y * _rb.z - (va.x + wa.y * _ra.z);
  const vrz2 = vb.z - wb.y * _rb.x - (va.z - wa.y * _ra.x);
  const vt = vrx2 * _t.x + vrz2 * _t.z;
  const raxt = _ra.z * _t.x - _ra.x * _t.z;
  const rbxt = _rb.z * _t.x - _rb.x * _t.z;
  const denomT = totalInv + raxt * raxt * invIa + rbxt * rbxt * invIb;
  const jt = clamp(-vt / denomT, -COLLISION.frictionCar * j, COLLISION.frictionCar * j);
  va.addScaledVector(_t, -jt * invA);
  vb.addScaledVector(_t, jt * invB);
  wa.y -= raxt * jt * invIa;
  wb.y += rbxt * jt * invIb;

  // Bookkeeping: normal points away from the other car for each participant.
  _n.negate();
  recordCollision(a, j, b.state.id, _p, _n);
  _n.negate();
  recordCollision(b, j, a.state.id, _p, _n);
  applyImpactDamage(a, j, _ra.x * alx + _ra.z * alz, _ra.x * afx + _ra.z * afz);
  applyImpactDamage(b, j, _rb.x * blx + _rb.z * blz, _rb.x * bfx + _rb.z * bfz);
  return j;
}
