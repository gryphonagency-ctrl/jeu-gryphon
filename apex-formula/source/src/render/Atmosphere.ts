import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep } from '../core/math';
import type { TrackTheme, WeatherState } from '../core/types';

/** Per-theme look: scattering parameters, haze tint, fog density, ground albedo. */
export interface ThemePalette {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  /** Tint multiplied into the horizon haze / fog colour. */
  hazeTint: THREE.Color;
  /** Base FogExp2 density in clear weather. */
  fogDensity: number;
  /** Average ground albedo seen in reflections / hemisphere bounce. */
  groundAlbedo: THREE.Color;
  /** Night-time city glow at the horizon (street circuits). */
  cityGlow: number;
  cityGlowColor: THREE.Color;
  /** Extra warmth of the sun (multiplied into the transmitted sun colour). */
  sunWarmth: THREE.Color;
  /** Solar azimuth offset (radians) so the light falls nicely across the pit straight. */
  azimuthOffset: number;
}

export const THEMES: Record<TrackTheme, ThemePalette> = {
  permanent: {
    turbidity: 2.6,
    rayleigh: 1.25,
    mieCoefficient: 0.0045,
    mieDirectionalG: 0.9,
    hazeTint: new THREE.Color(0.92, 0.96, 1.0),
    fogDensity: 0.0011,
    groundAlbedo: new THREE.Color(0.16, 0.2, 0.1),
    cityGlow: 0.05,
    cityGlowColor: new THREE.Color(1.0, 0.75, 0.5),
    sunWarmth: new THREE.Color(1.0, 0.98, 0.95),
    azimuthOffset: 0.35,
  },
  street: {
    turbidity: 6.5,
    rayleigh: 1.0,
    mieCoefficient: 0.009,
    mieDirectionalG: 0.91,
    hazeTint: new THREE.Color(1.0, 0.92, 0.86),
    fogDensity: 0.0019,
    groundAlbedo: new THREE.Color(0.12, 0.12, 0.13),
    cityGlow: 1.0,
    cityGlowColor: new THREE.Color(1.0, 0.62, 0.32),
    sunWarmth: new THREE.Color(1.0, 0.95, 0.9),
    azimuthOffset: -0.6,
  },
  desert: {
    turbidity: 4.5,
    rayleigh: 0.85,
    mieCoefficient: 0.011,
    mieDirectionalG: 0.92,
    hazeTint: new THREE.Color(1.0, 0.86, 0.68),
    fogDensity: 0.0008,
    groundAlbedo: new THREE.Color(0.42, 0.34, 0.22),
    cityGlow: 0.1,
    cityGlowColor: new THREE.Color(1.0, 0.7, 0.45),
    sunWarmth: new THREE.Color(1.0, 0.93, 0.82),
    azimuthOffset: 0.9,
  },
  forest: {
    turbidity: 2.2,
    rayleigh: 1.35,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.89,
    hazeTint: new THREE.Color(0.86, 0.95, 0.94),
    fogDensity: 0.0024,
    groundAlbedo: new THREE.Color(0.1, 0.16, 0.07),
    cityGlow: 0.0,
    cityGlowColor: new THREE.Color(1.0, 0.8, 0.6),
    sunWarmth: new THREE.Color(0.98, 1.0, 0.94),
    azimuthOffset: -0.2,
  },
  coastal: {
    turbidity: 3.2,
    rayleigh: 1.15,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.9,
    hazeTint: new THREE.Color(0.86, 0.96, 1.0),
    fogDensity: 0.0014,
    groundAlbedo: new THREE.Color(0.22, 0.24, 0.2),
    cityGlow: 0.25,
    cityGlowColor: new THREE.Color(1.0, 0.78, 0.6),
    sunWarmth: new THREE.Color(1.0, 0.97, 0.9),
    azimuthOffset: 0.55,
  },
};

// Tuned so sunrise ≈ 05:50, sunset ≈ 18:55 (floodlights take over at 20:00 per the world contract).
const LATITUDE = THREE.MathUtils.degToRad(44);
const DECLINATION = THREE.MathUtils.degToRad(8);
const SOLAR_NOON = 12.4;

/** Sun direction (unit vector pointing AT the sun) for an hour of the day. */
export function sunDirection(timeOfDay: number, azimuthOffset: number, out: THREE.Vector3): THREE.Vector3 {
  const H = ((timeOfDay - SOLAR_NOON) / 12) * Math.PI;
  const sinEl = Math.sin(LATITUDE) * Math.sin(DECLINATION) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(H);
  const el = Math.asin(clamp(sinEl, -1, 1));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LATITUDE) - Math.tan(DECLINATION) * Math.cos(LATITUDE)) + azimuthOffset;
  const c = Math.cos(el);
  return out.set(c * Math.sin(az), Math.sin(el), c * Math.cos(az));
}

/* ─── Preetham scattering (CPU twin of the sky shader, used for fog / hemisphere / metering) ─── */

const TOTAL_RAYLEIGH = new THREE.Vector3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
const MIE_CONST = new THREE.Vector3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
const CUTOFF_ANGLE = 1.6110731556870734;
const STEEPNESS = 1.5;
const EE = 1000;
const RAYLEIGH_ZENITH = 8.4e3;
const MIE_ZENITH = 1.25e3;
const THREE_OVER_16PI = 0.05968310365946075;
const ONE_OVER_4PI = 0.07957747154594767;

/** Radiance scale applied to the analytic sky so a sunlit white surface (~0.9) sits above the horizon (~0.45) and zenith (~0.13). */
export const SKY_SCALE = 0.17;

const _betaR = new THREE.Vector3();
const _betaM = new THREE.Vector3();
const _fex = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class SkyModel {
  turbidity = 2.5;
  rayleigh = 1.2;
  mieCoefficient = 0.005;
  mieDirectionalG = 0.8;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private sunE = 0;

  /** Call once per frame after changing parameters. */
  prepare(): void {
    const up = clamp(this.sunDir.y, -1, 1);
    // Preetham's sun-energy curve collapses too early; lift the low-sun tail so golden hour keeps a bright sky.
    const f = Math.max(0, 1 - Math.exp(-((CUTOFF_ANGLE - Math.acos(up)) / STEEPNESS)));
    this.sunE = EE * 0.66 * Math.pow(f / 0.66, 0.55);
    const sunfade = 1 - clamp01(1 - Math.exp(this.sunDir.y));
    const rayleighCoefficient = this.rayleigh - 1 * (1 - sunfade);
    _betaR.copy(TOTAL_RAYLEIGH).multiplyScalar(rayleighCoefficient);
    const c = 0.2 * this.turbidity * 10e-18;
    _betaM.copy(MIE_CONST).multiplyScalar(0.434 * c * this.mieCoefficient);
  }

  /** Transmittance along the sun's own path (how much red the low sun keeps). */
  sunTransmittance(out: THREE.Color): THREE.Color {
    const zenithAngle = Math.acos(Math.max(0, this.sunDir.y));
    const inverse = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
    const sR = RAYLEIGH_ZENITH * inverse;
    const sM = MIE_ZENITH * inverse;
    out.r = Math.exp(-(_betaR.x * sR + _betaM.x * sM));
    out.g = Math.exp(-(_betaR.y * sR + _betaM.y * sM));
    out.b = Math.exp(-(_betaR.z * sR + _betaM.z * sM));
    return out;
  }

  /** Sky radiance (linear HDR, before skyScale) in direction `dir`. */
  radiance(dir: THREE.Vector3, out: THREE.Color): THREE.Color {
    const zenithAngle = Math.acos(Math.max(0, dir.y));
    const inverse = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
    const sR = RAYLEIGH_ZENITH * inverse;
    const sM = MIE_ZENITH * inverse;
    _fex.set(Math.exp(-(_betaR.x * sR + _betaM.x * sM)), Math.exp(-(_betaR.y * sR + _betaM.y * sM)), Math.exp(-(_betaR.z * sR + _betaM.z * sM)));
    const cosTheta = dir.dot(this.sunDir);
    const ct = cosTheta * 0.5 + 0.5;
    const rPhase = THREE_OVER_16PI * (1 + ct * ct);
    const g = this.mieDirectionalG;
    const g2 = g * g;
    let mPhase = ONE_OVER_4PI * ((1 - g2) / Math.pow(1 - 2 * g * cosTheta + g2, 1.5));
    mPhase /= 1 + mPhase * 0.25;
    const horizonMix = clamp01(Math.pow(1 - this.sunDir.y, 5));
    const horizonCompress = lerp(0.36, 1, smoothstep(-0.02, 0.55, dir.y));
    const sunE = this.sunE;
    for (let i = 0; i < 3; i++) {
      const bR = _betaR.getComponent(i);
      const bM = _betaM.getComponent(i);
      const fex = _fex.getComponent(i);
      const phaseTerm = (sunE * (bR * rPhase + bM * mPhase)) / (bR + bM);
      let lin = Math.pow(Math.max(0, phaseTerm * (1 - fex)), 1.5);
      lin *= lerp(1, Math.sqrt(Math.max(0, phaseTerm * fex)), horizonMix) * horizonCompress;
      _tmp.setComponent(i, (lin + 0.1 * fex) * 0.04 * SKY_SCALE);
    }
    const lum = 0.2126 * _tmp.x + 0.7152 * _tmp.y + 0.0722 * _tmp.z;
    out.setRGB(lerp(lum, _tmp.x, 0.88), lerp(lum, _tmp.y, 0.88), lerp(lum, _tmp.z, 0.88));
    return out.multiplyScalar(1 / (1 + lum / 2.2));
  }
}

/** Everything the renderer needs to light a frame, derived from time of day + weather + theme. Values are smoothed. */
export class LightingState {
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, 1, 0);
  /** Elevation of the sun in radians. */
  sunElevation = 0;
  /** 0 = sun fully down, 1 = sun well up. */
  daylight = 1;
  /** 0 = day, 1 = deep night. */
  night = 0;
  /** Floodlight rig intensity 0..1. */
  flood = 0;
  sunIntensity = 3.5;
  readonly sunColor = new THREE.Color(1, 1, 1);
  moonIntensity = 0;
  readonly moonColor = new THREE.Color(0.6, 0.72, 1.0);
  readonly skyZenith = new THREE.Color();
  readonly skyHorizon = new THREE.Color();
  readonly fogColor = new THREE.Color();
  fogDensity = 0.001;
  readonly hemiSky = new THREE.Color();
  readonly hemiGround = new THREE.Color();
  hemiIntensity = 0.3;
  readonly groundRadiance = new THREE.Color();
  exposure = 1;
  exposureTarget = 1;
  envIntensity = 1;
  /** Grade parameters. */
  readonly whiteBalance = new THREE.Color(1, 1, 1);
  saturation = 1.08;
  contrast = 1.06;
  /** 0..1 how much the weather dulls the image (drives haze/desaturation). */
  gloom = 0;
  starVisibility = 0;
  twilight = 0;
  cloud = 0.25;
  wetness = 0;
  rain = 0;

  readonly sky = new SkyModel();
  theme: ThemePalette = THEMES.permanent;

  private readonly _c = new THREE.Color();
  private readonly _c2 = new THREE.Color();
  private readonly _v = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private initialised = false;

  setTheme(theme: ThemePalette): void {
    this.theme = theme;
    this.sky.turbidity = theme.turbidity;
    this.sky.rayleigh = theme.rayleigh;
    this.sky.mieCoefficient = theme.mieCoefficient;
    this.sky.mieDirectionalG = theme.mieDirectionalG;
  }

  /** Recompute from environment. `dt` drives exposure adaptation; pass a large dt to snap. */
  update(timeOfDay: number, weather: WeatherState, dt: number): void {
    const theme = this.theme;
    this.cloud = clamp01(weather.cloud);
    this.wetness = clamp01(weather.wetness);
    this.rain = clamp01(weather.rain);
    const fogAmount = clamp01(weather.fog);

    sunDirection(timeOfDay, theme.azimuthOffset, this.sunDir);
    this.sunElevation = Math.asin(clamp(this.sunDir.y, -1, 1));
    // Moon roughly opposite the sun, tilted so it never sits exactly at the anti-solar point.
    this.moonDir.set(-this.sunDir.x * 0.85, -this.sunDir.y, -this.sunDir.z).normalize();
    this.moonDir.x += 0.3;
    this.moonDir.normalize();

    const elDeg = THREE.MathUtils.radToDeg(this.sunElevation);
    this.daylight = smoothstep(-3, 8, elDeg);
    this.night = 1 - smoothstep(-14, -1, elDeg);
    this.twilight = smoothstep(-16, -4, elDeg) * (1 - smoothstep(-1, 6, elDeg));
    this.flood = 1 - smoothstep(-5, 1.5, elDeg);
    this.starVisibility = (1 - smoothstep(-12, -3, elDeg)) * (1 - this.cloud * 0.95);

    // Atmosphere twin.
    const sky = this.sky;
    // Keep scattering parameters live (weather thickens the atmosphere).
    sky.turbidity = theme.turbidity + this.cloud * 3 + fogAmount * 4 + this.wetness * 1.5;
    sky.mieCoefficient = theme.mieCoefficient * (1 + this.cloud * 0.6 + this.wetness * 0.4);
    sky.sunDir.copy(this.sunDir);
    if (sky.sunDir.y < -0.05) sky.sunDir.y = -0.05;
    sky.sunDir.normalize();
    sky.prepare();

    // Sun.
    sky.sunTransmittance(this._c);
    const transLum = 0.2126 * this._c.r + 0.7152 * this._c.g + 0.0722 * this._c.b;
    this._c.multiplyScalar(1 / Math.max(0.2, transLum));
    // The analytic transmittance stays yellow even at high sun; pull it toward neutral daylight when the sun is up.
    this._c.lerp(this._c2.setRGB(1, 1, 1), smoothstep(8, 45, elDeg) * 0.7);
    // Low sun: exaggerate warmth a little for a golden-hour look.
    const lowSun = 1 - smoothstep(0, 25, elDeg);
    this._c.r = Math.min(1.2, this._c.r * (1 + lowSun * 0.12));
    this._c.b *= 1 - lowSun * 0.18;
    this.sunColor.copy(this._c).multiply(theme.sunWarmth);
    const cloudBlock = 1 - this.cloud * 0.88;
    this.sunIntensity = 3.6 * smoothstep(-1.5, 7, elDeg) * Math.pow(Math.max(0.05, transLum), 0.55) * cloudBlock;

    // Moon light (bluish, weak, only when the sun is well down).
    this.moonIntensity = 0.22 * this.night * Math.max(0.15, this.moonDir.y) * (1 - this.cloud * 0.8);

    // Sky colours (unshadowed radiance, already at SKY_SCALE like the shader).
    sky.radiance(this._v.set(0, 1, 0), this.skyZenith);
    // Horizon colour: average of two directions perpendicular to the sun so fog is not sun-tinted.
    this._v.set(-this.sunDir.z, 0, this.sunDir.x).normalize();
    this._v.y = 0.06;
    this._v.normalize();
    sky.radiance(this._v, this.skyHorizon);
    this._v2.set(this.sunDir.z, 0, -this.sunDir.x).normalize();
    this._v2.y = 0.06;
    this._v2.normalize();
    sky.radiance(this._v2, this._c2);
    this.skyHorizon.lerp(this._c2, 0.5);

    // Civil-twilight blue (matches the shader's twilight floor).
    this.skyZenith.r += 0.006 * this.twilight;
    this.skyZenith.g += 0.01 * this.twilight;
    this.skyZenith.b += 0.025 * this.twilight;
    this.skyHorizon.r += 0.012 * this.twilight;
    this.skyHorizon.g += 0.02 * this.twilight;
    this.skyHorizon.b += 0.05 * this.twilight;

    // Night floor for the sky colours.
    const nightZenith = this._c.setRGB(0.004, 0.006, 0.014).multiplyScalar(0.5 + this.moonIntensity * 2.5);
    const nightHorizon = this._c2.setRGB(0.012, 0.014, 0.024).multiplyScalar(0.6 + this.moonIntensity * 2.5);
    nightHorizon.r += theme.cityGlow * 0.045 * theme.cityGlowColor.r * this.night;
    nightHorizon.g += theme.cityGlow * 0.045 * theme.cityGlowColor.g * this.night;
    nightHorizon.b += theme.cityGlow * 0.045 * theme.cityGlowColor.b * this.night;
    this.skyZenith.r = Math.max(this.skyZenith.r, nightZenith.r);
    this.skyZenith.g = Math.max(this.skyZenith.g, nightZenith.g);
    this.skyZenith.b = Math.max(this.skyZenith.b, nightZenith.b);
    this.skyHorizon.r = Math.max(this.skyHorizon.r, nightHorizon.r);
    this.skyHorizon.g = Math.max(this.skyHorizon.g, nightHorizon.g);
    this.skyHorizon.b = Math.max(this.skyHorizon.b, nightHorizon.b);

    // Overcast: flatten sky toward a grey lit by the (dimmed) sun.
    const overcast = smoothstep(0.45, 0.95, this.cloud);
    const overcastLum = (0.22 + 0.55 * this.daylight) * (1 - this.cloud * 0.35);
    this._c.setRGB(overcastLum * 0.95, overcastLum * 0.97, overcastLum * 1.0).multiplyScalar(this.daylight * 0.9 + 0.1);
    this.skyZenith.lerp(this._c, overcast * 0.85);
    this.skyHorizon.lerp(this._c, overcast * 0.7);

    // Fog. Preetham's side-horizon goes greenish at low sun; steer it toward a warm grey instead.
    this.fogColor.copy(this.skyHorizon).multiply(theme.hazeTint);
    const hzLum = 0.2126 * this.fogColor.r + 0.7152 * this.fogColor.g + 0.0722 * this.fogColor.b;
    this.fogColor.lerp(this._c.setRGB(hzLum * 1.14, hzLum * 0.98, hzLum * 0.9), lowSun * this.daylight * 0.6);
    this.fogColor.lerp(this._c.setRGB(0.55, 0.58, 0.62).multiplyScalar(this.daylight * 0.9 + 0.08), fogAmount * 0.6 + this.rain * 0.25);
    // Night fog is dark; floodlit haze keeps a hint of warmth.
    this.fogColor.lerp(this._c2.setRGB(0.028, 0.028, 0.036), this.night * 0.75);
    this.fogColor.r += this.flood * 0.022;
    this.fogColor.g += this.flood * 0.02;
    this.fogColor.b += this.flood * 0.016;
    this.fogDensity = theme.fogDensity * (1 + this.cloud * 0.6) + fogAmount * 0.012 + this.rain * 0.0035 + this.wetness * 0.0006;
    this.fogDensity *= 1 + this.night * 0.4;

    // Hemisphere fill + ground bounce.
    this.hemiSky.copy(this.skyZenith).lerp(this.skyHorizon, 0.45);
    this.groundRadiance.copy(theme.groundAlbedo);
    this._c.copy(this.sunColor).multiplyScalar(this.sunIntensity * Math.max(0, this.sunDir.y) * 0.3);
    this._c2.copy(this.skyHorizon).multiplyScalar(0.7);
    this._c.add(this._c2);
    this.groundRadiance.multiply(this._c);
    this.groundRadiance.lerp(this._c2.setRGB(0.08, 0.08, 0.075), this.wetness * 0.5);
    this.hemiGround.copy(this.groundRadiance);
    this.hemiIntensity = 0.55 + this.flood * 0.25;
    // Floodlights add a warm-white ambient bounce at night (kept low so the real spot lights carry the modelling).
    this.hemiSky.r += this.flood * 0.11;
    this.hemiSky.g += this.flood * 0.104;
    this.hemiSky.b += this.flood * 0.088;
    this.hemiGround.r += this.flood * 0.03;
    this.hemiGround.g += this.flood * 0.03;
    this.hemiGround.b += this.flood * 0.027;

    // Environment reflections gleam more on wet surfaces.
    this.envIntensity = 1.0 + this.wetness * 0.25;

    // Grade.
    this.gloom = clamp01(this.cloud * 0.5 + this.wetness * 0.35 + this.rain * 0.4 + fogAmount * 0.3);
    const cool = this.wetness * 0.07 + this.rain * 0.04 + this.night * 0.05;
    const warm = lowSun * this.daylight * 0.05;
    this.whiteBalance.setRGB(1 + warm - cool * 0.7, 1 + warm * 0.3 - cool * 0.2, 1 - warm * 0.6 + cool);
    this.saturation = 1.1 - this.rain * 0.18 - this.gloom * 0.06;
    this.contrast = 1.07 - this.gloom * 0.06 + this.night * 0.03;

    // Exposure metering: a rough scene-luminance estimate from the key light, sky and floodlights.
    const sunTerm = 0.32 * this.sunIntensity * 0.75 * (0.2126 * this.sunColor.r + 0.7152 * this.sunColor.g + 0.0722 * this.sunColor.b);
    const hLum = 0.2126 * this.skyHorizon.r + 0.7152 * this.skyHorizon.g + 0.0722 * this.skyHorizon.b;
    const zLum = 0.2126 * this.skyZenith.r + 0.7152 * this.skyZenith.g + 0.0722 * this.skyZenith.b;
    const lum = sunTerm + 0.6 * hLum + 0.4 * zLum + this.flood * 0.72 + this.moonIntensity * 0.4;
    const key = 1.05;
    // By day the sky sets the ceiling (a sunset must read as a bright sky over a dim ground); at night open up for the floodlights.
    const maxExposure = lerp(1.9, 4.0, this.night);
    this.exposureTarget = clamp(Math.pow(key / Math.max(0.02, lum), 0.8), 0.6, maxExposure);
    if (!this.initialised || dt >= 1) {
      this.exposure = this.exposureTarget;
      this.initialised = true;
    } else {
      // Adapt faster when it gets darker (entering shade / dusk) than when brightening.
      const rate = this.exposureTarget > this.exposure ? 1.2 : 1.8;
      this.exposure = damp(this.exposure, this.exposureTarget, rate, dt);
    }
  }
}
