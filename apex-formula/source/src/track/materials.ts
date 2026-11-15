import * as THREE from 'three';
import type { Disposer } from './util';
import type { TextureLib } from './textures';

export interface SharedUniforms {
  uTime: THREE.IUniform<number>;
  uWet: THREE.IUniform<number>;
  uNight: THREE.IUniform<number>;
  uCheer: THREE.IUniform<number>;
  uWind: THREE.IUniform<number>;
}

export const createSharedUniforms = (): SharedUniforms => ({
  uTime: { value: 0 },
  uWet: { value: 0 },
  uNight: { value: 0 },
  uCheer: { value: 0.25 },
  uWind: { value: 1 },
});

type Shader = THREE.WebGLProgramParametersWithUniforms;

const attach = (shader: Shader, u: SharedUniforms): void => {
  shader.uniforms.uTime = u.uTime;
  shader.uniforms.uWet = u.uWet;
  shader.uniforms.uNight = u.uNight;
  shader.uniforms.uCheer = u.uCheer;
  shader.uniforms.uWind = u.uWind;
};
const UNIFORM_DECL = 'uniform float uTime; uniform float uWet; uniform float uNight; uniform float uCheer; uniform float uWind;';

/**
 * Racing asphalt. Vertex attribute aTrack = (lateral, racingLineLateral, halfWidth, s).
 * Paints the white edge lines and the rubbered-in racing line in the shader; wetness darkens and polishes.
 */
export const makeAsphaltMaterial = (d: Disposer, tex: TextureLib, u: SharedUniforms, opts: { pit?: boolean } = {}): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({
    map: tex.asphaltMap,
    normalMap: tex.asphaltNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: tex.asphaltRough,
    roughness: 1,
    metalness: 0.02,
    vertexColors: true,
    color: opts.pit ? new THREE.Color('#9a9a98') : new THREE.Color('#8f8f8f'),
  });
  m.onBeforeCompile = (shader) => {
    attach(shader, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTrack;\nvarying vec4 vTrack;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrack = aTrack;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECL}\nvarying vec4 vTrack;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float tLat = vTrack.x; float tLine = vTrack.y; float tHw = vTrack.z;
        float dLine = abs(tLat - tLine);
        float rubber = (1.0 - smoothstep(0.5, 2.6, dLine)) * step(0.5, tHw);
        float rubberNoise = 0.85 + 0.15 * sin(vTrack.w * 0.37) * sin(vTrack.w * 0.11 + tLat);
        diffuseColor.rgb *= mix(1.0, 0.62, rubber * rubberNoise);
        float aLat = abs(tLat);
        float edgeLine = smoothstep(tHw - 0.40, tHw - 0.33, aLat) * (1.0 - smoothstep(tHw - 0.12, tHw - 0.05, aLat));
        float wear = 0.75 + 0.25 * sin(vTrack.w * 1.7) * sin(vTrack.w * 0.23);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.88, 0.86), edgeLine * wear);
        diffuseColor.rgb *= mix(1.0, 0.45, uWet);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor *= mix(1.0, 0.78, rubber);
        roughnessFactor = mix(roughnessFactor, 0.42, edgeLine * 0.6);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.18, uWet);`,
      );
  };
  m.customProgramCacheKey = () => (opts.pit ? 'apex-asphalt-pit' : 'apex-asphalt');
  return d.mat(m);
};

/** Ground / run-off surfaces: darker and glossier when wet. */
export const makeWetAwareMaterial = (d: Disposer, u: SharedUniforms, params: THREE.MeshStandardMaterialParameters, key: string, wetDarken = 0.7, wetRough = 0.6): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    attach(shader, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, ${wetDarken.toFixed(2)}, uWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, roughnessFactor * ${wetRough.toFixed(2)}, uWet);`);
  };
  m.customProgramCacheKey = () => `apex-wet-${key}`;
  return d.mat(m);
};

/**
 * Crowd billboards: instanced quads (1 x 1, origin at the feet). Instance matrix = translation only.
 * aCrowd = (random 0..1, atlas cell 0..7, scale, unused). Body (white in the atlas) is tinted by instanceColor.
 */
export const makeCrowdMaterial = (d: Disposer, tex: TextureLib, u: SharedUniforms): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ map: tex.crowdMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    attach(shader, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECL}\nattribute vec4 aCrowd;\nvec3 bbRight; vec3 bbToCam;`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 ipos = vec3(instanceMatrix[3]);
        bbToCam = cameraPosition - ipos; bbToCam.y = 0.0; bbToCam = normalize(bbToCam + vec3(1e-4, 0.0, 0.0));
        bbRight = vec3(bbToCam.z, 0.0, -bbToCam.x);
        vec3 objectNormal = normalize(bbToCam + vec3(0.0, 0.6, 0.0));`,
      )
      .replace(
        '#include <begin_vertex>',
        `float ph = aCrowd.x * 6.2831;
        float sway = sin(uTime * 1.3 + ph) * 0.025 + sin(uTime * 2.9 + ph * 1.7) * 0.03 * uCheer;
        float bounce = max(0.0, sin(uTime * 4.2 + ph)) * 0.14 * uCheer * step(0.45, fract(aCrowd.x * 7.31));
        vec3 transformed = bbRight * (position.x * aCrowd.z + sway * position.y) + vec3(0.0, position.y * aCrowd.z + bounce, 0.0);`,
      )
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (uv + vec2(mod(aCrowd.y, 4.0), floor(aCrowd.y / 4.0))) * vec2(0.25, 0.5);\n#endif`);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
        float isBody = step(0.93, min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)));
        diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, isBody);
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'apex-crowd';
  return d.mat(m);
};

/**
 * Waving flags: instanced quads, x in [0, w] from the pole, y in [0, h]. aFlag = (phase, type, speed, unused).
 * type 0 = solid instanceColor, 1 = chequered, 2 = striped (double yellow).
 */
export const makeFlagMaterial = (d: Disposer, u: SharedUniforms): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, metalness: 0, color: 0xffffff });
  m.onBeforeCompile = (shader) => {
    attach(shader, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECL}\nattribute vec4 aFlag;\nvarying vec2 vFlagUv;\nvarying float vFlagType;`)
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float fw = max(uv.x, 0.0);
        float t = uTime * (4.5 + aFlag.z) + aFlag.x * 6.2831 + fw * 6.0;
        transformed.z += (sin(t) * 0.10 + sin(t * 1.9 + 1.3) * 0.05) * fw * uWind;
        transformed.y += sin(t * 0.8) * 0.04 * fw * uWind;
        vFlagUv = uv; vFlagType = aFlag.y;`,
      )
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(normal);\nfloat fwn = max(uv.x, 0.0);\nfloat tn = uTime * (4.5 + aFlag.z) + aFlag.x * 6.2831 + fwn * 6.0;\nobjectNormal = normalize(objectNormal + vec3(cos(tn) * 0.6 * fwn, 0.0, 0.0));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFlagUv;\nvarying float vFlagType;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vFlagType > 0.5 && vFlagType < 1.5) {
          float chk = mod(floor(vFlagUv.x * 6.0) + floor(vFlagUv.y * 4.0), 2.0);
          diffuseColor.rgb = mix(vec3(0.05), vec3(0.95), chk);
        } else if (vFlagType > 1.5) {
          float stripe = step(0.5, fract((vFlagUv.x - vFlagUv.y) * 3.0));
          diffuseColor.rgb *= mix(1.0, 0.55, stripe);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'apex-flag';
  return d.mat(m);
};

/** Cross-billboard trees with wind sway; instance position drives the phase. */
export const makeTreeMaterial = (d: Disposer, map: THREE.Texture, u: SharedUniforms): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95, metalness: 0, color: 0xffffff });
  m.onBeforeCompile = (shader) => {
    attach(shader, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECL}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(normal.x * 0.3, 1.0, normal.z * 0.3));')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
        vec3 tp = vec3(instanceMatrix[3]);
        float tph = tp.x * 0.13 + tp.z * 0.17;
        float h01 = clamp(position.y, 0.0, 1.0);
        transformed.x += sin(uTime * 1.1 + tph) * 0.035 * h01 * h01 * uWind;
        transformed.z += cos(uTime * 0.9 + tph * 1.3) * 0.03 * h01 * h01 * uWind;
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'apex-tree';
  return d.mat(m);
};

/** Animated water: two scrolling normal samples, glossy, tinted. */
export const makeWaterMaterial = (d: Disposer, tex: TextureLib, u: SharedUniforms, color: string): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    normalMap: tex.waterNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.08,
    metalness: 0.35,
    transparent: true,
    opacity: 0.94,
  });
  m.onBeforeCompile = (shader) => {
    attach(shader, u);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${UNIFORM_DECL}`);
    const line = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';
    if (shader.fragmentShader.includes(line)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        line,
        `vec3 mapN = texture2D( normalMap, vNormalMapUv + vec2(uTime * 0.012, uTime * 0.007) ).xyz * 2.0 - 1.0;
        vec3 mapN2 = texture2D( normalMap, vNormalMapUv * 1.83 + vec2(-uTime * 0.009, uTime * 0.011) ).xyz * 2.0 - 1.0;
        mapN = normalize(vec3(mapN.xy + mapN2.xy, mapN.z * mapN2.z));`,
      );
    }
  };
  m.customProgramCacheKey = () => 'apex-water';
  return d.mat(m);
};

/**
 * Buildings: procedural window grid in world space; windows glow warm at night (uNight).
 * Works instanced (facade tint from instanceColor, per-instance lit pattern from the instance position).
 */
export const makeBuildingMaterial = (d: Disposer, u: SharedUniforms, base: THREE.MeshStandardMaterialParameters, cell: [number, number] = [3.4, 3.6], litRatio = 0.55): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, ...base });
  m.onBeforeCompile = (shader) => {
    attach(shader, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * objectNormal));
          vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.91;
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * objectNormal);
          vSeed = 0.0;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECL}\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;\nfloat bhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float vertical = 1.0 - smoothstep(0.35, 0.6, abs(vWNormal.y));
        vec2 fdir = normalize(vec2(vWNormal.z, -vWNormal.x) + vec2(1e-4, 0.0));
        float fu = dot(vWPos.xz, fdir);
        float fv = vWPos.y;
        vec2 cellSz = vec2(${cell[0].toFixed(2)}, ${cell[1].toFixed(2)});
        vec2 cellId = floor(vec2(fu, fv) / cellSz);
        vec2 cf = fract(vec2(fu, fv) / cellSz);
        float win = step(0.2, cf.x) * step(cf.x, 0.8) * step(0.25, cf.y) * step(cf.y, 0.78) * vertical * step(0.9, fv);
        float lit = step(${(1 - litRatio).toFixed(2)}, bhash(cellId + vec2(vSeed, floor(vWNormal.x * 3.0 + vWNormal.z * 7.0))));
        vec3 dayGlass = vec3(0.10, 0.13, 0.17);
        diffuseColor.rgb = mix(diffuseColor.rgb, dayGlass, win);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.2, win);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, win);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 warm = mix(vec3(1.0, 0.82, 0.55), vec3(0.75, 0.9, 1.0), bhash(cellId * 1.7 + vSeed));
        totalEmissiveRadiance += warm * win * lit * uNight * 1.6;`,
      );
  };
  m.customProgramCacheKey = () => `apex-building-${cell[0]}-${cell[1]}-${litRatio}`;
  return d.mat(m);
};

/** Instanced ad/sign boards sampling a text atlas cell: aCell = (u0, v0, u1, v1). */
export const makeAtlasBoardMaterial = (d: Disposer, atlas: THREE.Texture, u: SharedUniforms, emissiveNight = 0.7): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, roughness: 0.55, metalness: 0.05, side: THREE.FrontSide });
  m.onBeforeCompile = (shader) => {
    attach(shader, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvec2 cuv = mix(aCell.xy, aCell.zw, uv);\n#ifdef USE_MAP\nvMapUv = cuv;\n#endif\n#ifdef USE_EMISSIVEMAP\nvEmissiveMapUv = cuv;\n#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= ${emissiveNight.toFixed(2)} * uNight;`);
  };
  m.emissiveIntensity = 1;
  m.customProgramCacheKey = () => `apex-board-${emissiveNight}`;
  return d.mat(m);
};

/** Emissive light source material whose intensity is driven from update() via NightItem. */
export const makeLampMaterial = (d: Disposer, color: string, intensity: number): THREE.MeshStandardMaterial =>
  d.mat(new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.4, metalness: 0 }));
