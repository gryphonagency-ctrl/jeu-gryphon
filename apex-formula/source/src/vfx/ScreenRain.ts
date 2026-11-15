/**
 * Full-screen lens droplets/streaks for onboard cameras in the rain, plus fine lens spray when following a car
 * closely through its spray. Rendered last with depth testing off; vertex shader writes clip space directly.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uRain;    // 0..1 droplet coverage
uniform float uSpeed;   // 0..1 car speed (airflow pushes droplets up/out)
uniform float uSpray;   // 0..1 fine mist coverage
uniform float uAspect;
uniform sampler2D uNoise;
varying vec2 vUv;

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// One layer of droplets sliding along the screen. Returns (coverage, highlight).
vec2 dropLayer(vec2 uv, float scale, float slide, float density, float rnd) {
  vec2 gv = uv * scale;
  gv.y += uTime * slide;
  vec2 id = floor(gv) + rnd * 17.0;
  vec2 f = fract(gv) - 0.5;
  vec2 h = hash22(id);
  float h2 = hash12(id + 3.7);
  if (h2 > density) return vec2(0.0);
  float ph = h.x * 6.2831;
  // Droplet wobbles slightly as it creeps.
  vec2 c = (h - 0.5) * 0.55 + vec2(sin(uTime * 2.3 + ph) * 0.06, cos(uTime * 1.7 + ph) * 0.03);
  float r = 0.04 + h.y * 0.09;
  vec2 d = f - c;
  d.y *= 0.82;
  float dist = length(d);
  float drop = smoothstep(r, r * 0.72, dist);
  // Trail left behind against the slide direction.
  float dir = slide >= 0.0 ? -1.0 : 1.0;
  float along = (f.y - c.y) * dir;
  float trail = smoothstep(r * 0.55, 0.0, abs(f.x - c.x)) * smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.0, 0.5, along)) * 0.55;
  float hi = smoothstep(r * 0.45, 0.0, length(d + vec2(r * 0.32, -r * 0.30)));
  return vec2(max(drop, trail), hi * drop);
}

void main() {
  vec2 uv = vec2(vUv.x * uAspect, vUv.y);
  float airflow = smoothstep(0.05, 0.6, uSpeed);
  // Slow creep downward when slow; streak upward/outward with airflow at speed.
  float slide1 = mix(-0.05, 0.9, airflow);
  float slide2 = mix(-0.02, 1.6, airflow);
  vec2 l1 = dropLayer(uv, 7.0, slide1, uRain * 0.4, 0.0);
  vec2 l2 = dropLayer(uv + vec2(0.31, 0.17), 13.0, slide2, uRain * 0.32, 1.0);
  vec2 l3 = dropLayer(uv * vec2(1.0, 1.3) + vec2(0.71, 0.43), 23.0, slide2 * 1.4, uRain * 0.25, 2.0);
  // Lens spray: dense fine mist droplets that flicker in and out.
  float sprayPhase = floor(uTime * 3.0);
  vec2 s1 = dropLayer(uv + vec2(0.13 * sprayPhase, 0.07 * sprayPhase), 42.0, 0.0, uSpray * 0.6, 3.0 + sprayPhase);
  vec2 s2 = dropLayer(uv + vec2(0.57, 0.21 * sprayPhase), 70.0, 0.0, uSpray * 0.5, 5.0 + sprayPhase);

  float cover = max(max(l1.x, l2.x * 0.9), max(l3.x * 0.8, max(s1.x * 0.7, s2.x * 0.6)));
  float hi = l1.y + l2.y * 0.8 + l3.y * 0.6 + (s1.y + s2.y) * 0.5;
  float n = texture2D(uNoise, uv * 0.6 + vec2(0.0, uTime * 0.02)).r;
  // Droplets refract: darker rim, bright highlight, slight blue-grey tint. Haze adds a faint wet blur.
  float haze = (uRain * 0.06 + uSpray * 0.12) * (0.8 + 0.4 * n);
  vec3 col = mix(vec3(0.55, 0.6, 0.7), vec3(1.0, 1.0, 1.05), clamp(hi * 1.8, 0.0, 1.0));
  float alpha = cover * (0.22 + 0.3 * clamp(hi * 1.8, 0.0, 1.0)) + haze;
  alpha *= smoothstep(0.0, 0.02, uRain + uSpray);
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(col, min(alpha, 0.85));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ScreenRain {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private rain = 0;
  private spray = 0;
  private speed = 0;

  constructor(noise: THREE.Texture) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uRain: { value: 0 },
        uSpeed: { value: 0 },
        uSpray: { value: 0 },
        uAspect: { value: 16 / 9 },
        uNoise: { value: noise },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'vfx-screen-rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.visible = false;
  }

  /**
   * @param rainTarget 0..1 droplet coverage wanted (already gated by camera mode)
   * @param sprayTarget 0..1 lens spray wanted
   * @param speed01 0..1 normalised car speed
   */
  update(dt: number, time: number, rainTarget: number, sprayTarget: number, speed01: number, aspect: number): void {
    // Droplets accumulate quickly and clear slowly (airflow dries the lens).
    const kUp = 3.0;
    const kDown = 0.8 + speed01 * 1.2;
    this.rain += (rainTarget - this.rain) * Math.min(1, dt * (rainTarget > this.rain ? kUp : kDown));
    this.spray += (sprayTarget - this.spray) * Math.min(1, dt * (sprayTarget > this.spray ? 6 : 1.5));
    this.speed += (speed01 - this.speed) * Math.min(1, dt * 4);
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uRain.value = this.rain;
    u.uSpray.value = this.spray;
    u.uSpeed.value = this.speed;
    u.uAspect.value = aspect;
    this.mesh.visible = this.rain + this.spray > 0.01;
  }

  reset(): void {
    this.rain = 0;
    this.spray = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
