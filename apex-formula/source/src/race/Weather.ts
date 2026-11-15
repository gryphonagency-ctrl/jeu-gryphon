import { Rng, clamp, clamp01, damp } from '../core/math';
import type { EnvironmentState } from '../core/types';

export interface WeatherEvent {
  /** Race-control text, e.g. "RAIN EXPECTED IN 2 MINUTES". */
  description: string;
  /** Engineer radio line for the player (null = none). */
  radio: string | null;
}

type RainBand = 'dry' | 'light' | 'heavy';

/** Owns world.env progression: time of day, rain random walk with showers, wetness lag, cloud/temps/fog coupling. */
export class WeatherSim {
  private readonly rng: Rng;
  private rainTarget: number;
  private readonly baseCloud: number;
  private readonly baseAir: number;
  private walkTimer = 0;
  private showerIn = -1;
  private showerIntensity = 0;
  private showerLeft = 0;
  private band: RainBand;
  private peakWetness: number;
  private dryingSaid = false;
  private drySaid = true;
  private showerAnnounced = false;

  constructor(env: EnvironmentState, private readonly dynamic: boolean, seed: number) {
    this.rng = new Rng(seed);
    this.rainTarget = env.weather.rain;
    this.baseCloud = env.weather.cloud;
    this.baseAir = env.weather.airTempC;
    this.band = WeatherSim.bandOf(env.weather.rain);
    this.peakWetness = env.weather.wetness;
    this.drySaid = env.weather.wetness < 0.15;
    // A dynamic session has a decent chance of a shower some time in the first ten minutes.
    if (dynamic && this.rng.next() < 0.55) this.scheduleShower(this.rng.range(90, 480));
  }

  private static bandOf(rain: number): RainBand {
    return rain > 0.55 ? 'heavy' : rain > 0.08 ? 'light' : 'dry';
  }

  private scheduleShower(inSeconds: number): void {
    this.showerIn = inSeconds;
    this.showerIntensity = this.rng.range(0.3, 0.95);
    this.showerLeft = this.rng.range(100, 260);
    this.showerAnnounced = false;
  }

  /** Sun factor 0..1 from the time of day (0 at night). */
  static sun(timeOfDay: number): number {
    return clamp01(Math.sin(((timeOfDay - 6) / 12) * Math.PI));
  }

  update(env: EnvironmentState, dt: number, out: WeatherEvent[]): void {
    const w = env.weather;
    env.timeOfDay = (env.timeOfDay + dt / 1200) % 24;
    const sun = WeatherSim.sun(env.timeOfDay);

    if (this.dynamic) {
      this.walkTimer -= dt;
      if (this.walkTimer <= 0) {
        this.walkTimer = 20;
        if (this.showerLeft > 0 && this.showerIn < 0) {
          this.rainTarget = clamp(this.showerIntensity + this.rng.gaussian() * 0.06, 0.1, 1);
        } else {
          // Slow random walk with mean reversion toward dry.
          this.rainTarget = clamp(this.rainTarget * 0.9 + this.rng.gaussian() * 0.03, 0, 1);
          if (this.rainTarget < 0.04) this.rainTarget = 0;
          if (this.showerIn < 0 && this.rng.next() < 0.05) this.scheduleShower(this.rng.range(120, 200));
        }
      }
      if (this.showerIn >= 0) {
        if (!this.showerAnnounced && this.showerIn <= 120) {
          this.showerAnnounced = true;
          out.push({
            description: this.showerIntensity > 0.6 ? 'HEAVY RAIN EXPECTED IN 2 MINUTES' : 'RAIN EXPECTED IN 2 MINUTES',
            radio: "Radar's showing rain in about two minutes. Start thinking about inters.",
          });
        }
        this.showerIn -= dt;
        if (this.showerIn < 0) {
          this.rainTarget = this.showerIntensity;
          this.walkTimer = 0;
        }
      } else if (this.showerLeft > 0) {
        this.showerLeft -= dt;
        if (this.showerLeft <= 0) {
          this.showerLeft = 0;
          this.rainTarget = 0;
          this.walkTimer = 0;
        }
      }
    }

    w.rain = damp(w.rain, this.rainTarget, 1 / 25, dt);
    if (w.rain < 0.005 && this.rainTarget === 0) w.rain = 0;

    // Wetness: soaks quickly, dries slowly (~1 unit per 6 minutes in full sun, slower under cloud / at night).
    const wetTarget = clamp01(w.rain * 1.3);
    if (wetTarget > w.wetness) {
      w.wetness += (wetTarget - w.wetness) * Math.min(1, dt / 15);
    } else {
      const dryRate = (1 / 360) * (0.25 + 0.75 * sun) * (1 - 0.6 * w.cloud) + 0.0003;
      w.wetness = Math.max(wetTarget, w.wetness - dryRate * dt);
    }

    const cloudTarget = Math.max(this.baseCloud, w.rain > 0.02 || this.showerIn >= 0 ? 0.4 + w.rain * 0.6 : 0);
    w.cloud = damp(w.cloud, clamp01(cloudTarget), 1 / 45, dt);
    w.fog = damp(w.fog, w.rain > 0.6 ? (w.rain - 0.6) * 0.7 : 0, 1 / 40, dt);
    w.airTempC = damp(w.airTempC, this.baseAir + (sun - 0.6) * 4 - w.rain * 3, 1 / 300, dt);
    w.trackTempC = damp(w.trackTempC, w.airTempC + 14 * sun * (1 - w.cloud) - 10 * w.wetness, 1 / 120, dt);

    // Notable changes.
    const band = WeatherSim.bandOf(w.rain);
    if (band !== this.band) {
      if (band === 'heavy') out.push({ description: 'HEAVY RAIN FALLING', radio: "It's properly raining now. Full wets are the call if it keeps building." });
      else if (band === 'light' && this.band === 'dry') out.push({ description: 'LIGHT RAIN FALLING', radio: 'Light rain reported. Track will get slippery, adjust your braking points.' });
      else if (band === 'light' && this.band === 'heavy') out.push({ description: 'RAIN EASING', radio: "Rain's easing off. Stay on the wets for now." });
      else if (band === 'dry') out.push({ description: 'RAIN HAS STOPPED', radio: "Rain's stopped. Track will start to dry, we'll call the crossover." });
      this.band = band;
      if (band !== 'dry') {
        this.dryingSaid = false;
        this.drySaid = false;
      }
    }
    if (w.wetness > this.peakWetness) this.peakWetness = w.wetness;
    if (band === 'dry' && !this.dryingSaid && this.peakWetness > 0.45 && w.wetness < this.peakWetness - 0.15 && w.wetness > 0.2) {
      this.dryingSaid = true;
      out.push({ description: 'TRACK DRYING', radio: 'Track is drying. A dry line is forming, slicks in a couple of laps.' });
    }
    if (!this.drySaid && w.wetness < 0.15 && band === 'dry' && this.peakWetness > 0.3) {
      this.drySaid = true;
      this.peakWetness = w.wetness;
      out.push({ description: 'TRACK CONDITIONS: DRY', radio: 'Track is dry enough for slicks. Box when you are ready.' });
    }
  }

  /** Positive = getting wetter soon. Used by the tyre strategy. */
  rainTrend(): number {
    if (this.showerIn >= 0 && this.showerIn < 150) return 1;
    if (this.showerLeft > 0 && this.showerLeft < 60) return -1;
    return 0;
  }
}
