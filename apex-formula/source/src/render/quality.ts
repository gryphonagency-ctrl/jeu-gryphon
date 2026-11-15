import type { QualityLevel } from '../core/constants';

export interface QualityConfig {
  /** Multiplier on min(devicePixelRatio, dprCap). */
  resolutionScale: number;
  dprCap: number;
  cascades: number;
  shadowMapSize: number;
  shadowMaxFar: number;
  softShadows: boolean;
  ao: 'off' | 'gtao';
  aoScale: number;
  aoSamples: number;
  bloom: boolean;
  motionBlur: boolean;
  motionBlurTaps: number;
  dof: boolean;
  antialias: 'fxaa' | 'smaa';
  chromaticAberration: boolean;
  filmGrain: boolean;
  lensFlare: boolean;
  lensDirt: boolean;
  floodlightShadows: number;
  floodlightShadowSize: number;
  studioReflector: boolean;
  envMapSize: number;
  anisotropy: number;
}

export const QUALITY: Record<QualityLevel, QualityConfig> = {
  low: {
    resolutionScale: 0.75,
    dprCap: 1,
    cascades: 1,
    shadowMapSize: 1024,
    shadowMaxFar: 90,
    softShadows: false,
    ao: 'off',
    aoScale: 0.5,
    aoSamples: 8,
    bloom: false,
    motionBlur: false,
    motionBlurTaps: 6,
    dof: false,
    antialias: 'fxaa',
    chromaticAberration: false,
    filmGrain: false,
    lensFlare: false,
    lensDirt: false,
    floodlightShadows: 0,
    floodlightShadowSize: 512,
    studioReflector: false,
    envMapSize: 128,
    anisotropy: 2,
  },
  medium: {
    resolutionScale: 1,
    dprCap: 1,
    cascades: 2,
    shadowMapSize: 1536,
    shadowMaxFar: 160,
    softShadows: true,
    ao: 'off',
    aoScale: 0.5,
    aoSamples: 8,
    bloom: true,
    motionBlur: true,
    motionBlurTaps: 6,
    dof: true,
    antialias: 'smaa',
    chromaticAberration: false,
    filmGrain: true,
    lensFlare: true,
    lensDirt: false,
    floodlightShadows: 1,
    floodlightShadowSize: 1024,
    studioReflector: false,
    envMapSize: 256,
    anisotropy: 4,
  },
  high: {
    resolutionScale: 1,
    dprCap: 1.5,
    cascades: 3,
    shadowMapSize: 2048,
    shadowMaxFar: 220,
    softShadows: true,
    ao: 'gtao',
    aoScale: 0.5,
    aoSamples: 8,
    bloom: true,
    motionBlur: true,
    motionBlurTaps: 8,
    dof: true,
    antialias: 'smaa',
    chromaticAberration: true,
    filmGrain: true,
    lensFlare: true,
    lensDirt: true,
    floodlightShadows: 2,
    floodlightShadowSize: 1024,
    studioReflector: true,
    envMapSize: 256,
    anisotropy: 8,
  },
  ultra: {
    resolutionScale: 1,
    dprCap: 2,
    cascades: 4,
    shadowMapSize: 2048,
    shadowMaxFar: 300,
    softShadows: true,
    ao: 'gtao',
    aoScale: 0.75,
    aoSamples: 16,
    bloom: true,
    motionBlur: true,
    motionBlurTaps: 12,
    dof: true,
    antialias: 'smaa',
    chromaticAberration: true,
    filmGrain: true,
    lensFlare: true,
    lensDirt: true,
    floodlightShadows: 2,
    floodlightShadowSize: 2048,
    studioReflector: true,
    envMapSize: 256,
    anisotropy: 16,
  },
};
