/**
 * Exhaust heat haze: one instanced quad per car behind the exhaust, oriented along the plume (up when stationary,
 * trailing backward at speed). No scene texture is available, so the shader fakes refraction with an animated
 * noise-driven brightness ripple on a soft alpha-faded quad.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aDir;
attribute vec4 aData; // intensity, seed, width, length
uniform float uTime;
varying vec2 vUv;
varying float vIntensity;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  vec3 dv = (modelViewMatrix * vec4(aDir, 0.0)).xyz;
  vec2 axisY = normalize(dv.xy + vec2(0.0, 1e-4));
  vec2 axisX = vec2(axisY.y, -axisY.x);
  // uv.y 0 at the exhaust, 1 at the plume end.
  mv.xy += axisX * (position.x * aData.z) + axisY * (uv.y * aData.w);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vIntensity = aData.x;
  vSeed = aData.y;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uLight;
varying vec2 vUv;
varying float vIntensity;
varying float vSeed;
void main() {
  float t = uTime * (1.6 + vSeed * 0.4);
  vec2 uv1 = vec2(vUv.x * 1.3 + vSeed, vUv.y * 1.8 - t * 0.9);
  vec2 uv2 = vec2(vUv.x * 2.1 - vSeed * 3.0, vUv.y * 2.6 - t * 1.4);
  float n1 = texture2D(uNoise, uv1).r;
  float n2 = texture2D(uNoise, uv2).g;
  float shimmer = (n1 - n2) * 2.2;
  float across = 1.0 - smoothstep(0.15, 0.5, abs(vUv.x - 0.5) + (n1 - 0.5) * 0.25);
  float along = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  float a = vIntensity * across * along * (0.2 + 0.8 * abs(shimmer)) * 0.15;
  if (a < 0.003) discard;
  vec3 col = (vec3(0.62, 0.6, 0.58) + shimmer * vec3(0.45, 0.42, 0.38)) * uLight;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class HeatHaze {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly pos: Float32Array;
  private readonly dir: Float32Array;
  private readonly data: Float32Array;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aDir: THREE.InstancedBufferAttribute;
  private readonly aData: THREE.InstancedBufferAttribute;
  private readonly capacity: number;
  private used = 0;

  constructor(capacity: number, noise: THREE.Texture) {
    this.capacity = capacity;
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(capacity * 3);
    this.dir = new Float32Array(capacity * 3);
    this.data = new Float32Array(capacity * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aDir = new THREE.InstancedBufferAttribute(this.dir, 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aPos', this.aPos);
    this.geometry.setAttribute('aDir', this.aDir);
    this.geometry.setAttribute('aData', this.aData);
    this.geometry.instanceCount = 0;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uNoise: { value: noise }, uTime: { value: 0 }, uLight: { value: new THREE.Vector3(1, 1, 1) } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'vfx-heat-haze';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
  }

  begin(): void {
    this.used = 0;
  }

  add(x: number, y: number, z: number, dx: number, dy: number, dz: number, intensity: number, seed: number, width: number, length: number): void {
    if (this.used >= this.capacity || intensity <= 0.01) return;
    const i = this.used++;
    const i3 = i * 3;
    const i4 = i * 4;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.dir[i3] = dx;
    this.dir[i3 + 1] = dy;
    this.dir[i3 + 2] = dz;
    this.data[i4] = intensity;
    this.data[i4 + 1] = seed;
    this.data[i4 + 2] = width;
    this.data[i4 + 3] = length;
  }

  /** Scene brightness the shimmer is tinted by (ambient + sun), so the plume is not a lit puff at night. */
  setLighting(sunColor: THREE.Vector3, ambient: THREE.Vector3): void {
    const l = this.material.uniforms.uLight.value as THREE.Vector3;
    l.copy(ambient).addScaledVector(sunColor, 0.6);
    const m = Math.max(l.x, l.y, l.z);
    if (m > 1) l.multiplyScalar(1 / m);
  }

  commit(time: number): void {
    this.material.uniforms.uTime.value = time;
    this.geometry.instanceCount = this.used;
    if (this.used === 0) return;
    this.aPos.addUpdateRange(0, this.used * 3);
    this.aDir.addUpdateRange(0, this.used * 3);
    this.aData.addUpdateRange(0, this.used * 4);
    this.aPos.needsUpdate = true;
    this.aDir.needsUpdate = true;
    this.aData.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
