import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { createEdgeFadeTexture, createFloorRoughnessTexture, createHazeTexture } from './textures';

let rectAreaInitialised = false;
const _up = new THREE.Vector3(0, 1, 0);

const backdropMaterial = () =>
  new THREE.ShaderMaterial({
    name: 'StudioBackdrop',
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { glowDir: { value: new THREE.Vector3(0, 0.15, -1).normalize() }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize( position ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 glowDir;
      uniform float time;
      void main() {
        float h = vDir.y;
        vec3 top = vec3( 0.006, 0.007, 0.011 );
        vec3 band = vec3( 0.035, 0.037, 0.046 );
        vec3 floorC = vec3( 0.012, 0.012, 0.015 );
        vec3 c = h > 0.0 ? mix( band, top, pow( clamp( h, 0.0, 1.0 ), 0.45 ) ) : mix( band, floorC, pow( clamp( -h, 0.0, 1.0 ), 0.5 ) );
        float g = pow( max( dot( vDir, glowDir ), 0.0 ), 6.0 ) * ( 1.0 - smoothstep( 0.0, 0.5, abs( h ) ) );
        c += vec3( 0.06, 0.07, 0.095 ) * g;
        float sweep = pow( max( dot( normalize( vec3( vDir.x, 0.0, vDir.z ) ), vec3( sin( time * 0.11 ), 0.0, cos( time * 0.11 ) ) ), 0.0 ), 40.0 );
        c += vec3( 0.03, 0.033, 0.045 ) * sweep * ( 1.0 - smoothstep( 0.0, 0.35, abs( h ) ) );
        gl_FragColor = vec4( c, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

const reflectorShader = {
  name: 'StudioFloor',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    tRough: { value: null as THREE.Texture | null },
    lightPos: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    lightColor: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    fadeRadius: { value: 18 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv4;
    varying vec3 vWorldPos;
    void main() {
      vUv4 = textureMatrix * vec4( position, 1.0 );
      vec4 wp = modelMatrix * vec4( position, 1.0 );
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tRough;
    uniform vec3 lightPos[4];
    uniform vec3 lightColor[4];
    uniform float fadeRadius;
    varying vec4 vUv4;
    varying vec3 vWorldPos;
    void main() {
      vec3 V = normalize( cameraPosition - vWorldPos );
      vec3 N = vec3( 0.0, 1.0, 0.0 );
      float rough = texture2D( tRough, vWorldPos.xz * 0.22 ).r;
      vec2 uv = vUv4.xy / vUv4.w;
      float blur = 0.0012 + rough * 0.009;
      vec3 refl = texture2D( tDiffuse, uv ).rgb * 0.36;
      refl += texture2D( tDiffuse, uv + vec2( blur, 0.0 ) ).rgb * 0.16;
      refl += texture2D( tDiffuse, uv - vec2( blur, 0.0 ) ).rgb * 0.16;
      refl += texture2D( tDiffuse, uv + vec2( 0.0, blur ) ).rgb * 0.16;
      refl += texture2D( tDiffuse, uv - vec2( 0.0, blur ) ).rgb * 0.16;
      float NdotV = clamp( dot( N, V ), 0.0, 1.0 );
      float fresnel = 0.05 + 0.95 * pow( 1.0 - NdotV, 5.0 );
      vec3 col = color;
      for ( int i = 0; i < 4; i ++ ) {
        vec3 toL = lightPos[ i ] - vWorldPos;
        float d2 = dot( toL, toL );
        vec3 L = toL * inversesqrt( d2 );
        vec3 H = normalize( L + V );
        float spec = pow( max( dot( N, H ), 0.0 ), mix( 900.0, 60.0, rough ) );
        float atten = 1.0 / ( 1.0 + d2 * 0.02 );
        col += lightColor[ i ] * ( spec * ( 1.2 - rough * 0.6 ) + max( dot( N, L ), 0.0 ) * 0.006 ) * atten;
      }
      col += refl * fresnel * 1.35 * ( 1.0 - rough * 0.45 );
      float r = length( vWorldPos.xz );
      float fade = 1.0 - smoothstep( fadeRadius * 0.5, fadeRadius * 0.98, r );
      col = mix( vec3( 0.012, 0.012, 0.015 ), col, fade );
      gl_FragColor = vec4( col, 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * Menu showroom: black-gradient cyclorama, glossy reflective floor, area key/rim/fill lights with visible softboxes,
 * a shadow-casting top light, additive haze cards + a light shaft, and slow light sweeps. Everything lives in `group`.
 */
export class Studio {
  readonly group = new THREE.Group();
  private readonly backdrop: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private floor: THREE.Mesh | Reflector;
  private readonly floorGeometry = new THREE.CircleGeometry(19, 96);
  private readonly physicalFloor: THREE.MeshPhysicalMaterial;
  private readonly edgeFade: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly key: THREE.RectAreaLight;
  private readonly rim: THREE.RectAreaLight;
  private readonly fill: THREE.RectAreaLight;
  private readonly top: THREE.SpotLight;
  private readonly sweep: THREE.SpotLight;
  private readonly rimPivot = new THREE.Group();
  private readonly hazeCards: THREE.Mesh[] = [];
  private readonly shaft: THREE.Mesh;
  private readonly softboxes: THREE.Mesh[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private useReflector = false;
  private time = 0;

  constructor() {
    if (!rectAreaInitialised) {
      RectAreaLightUniformsLib.init();
      rectAreaInitialised = true;
    }
    this.group.name = 'Studio';
    this.group.visible = false;

    const backGeo = new THREE.SphereGeometry(48, 48, 32);
    this.backdrop = new THREE.Mesh(backGeo, backdropMaterial());
    this.backdrop.name = 'StudioBackdrop';
    this.disposables.push(backGeo, this.backdrop.material);
    this.group.add(this.backdrop);

    const roughTex = createFloorRoughnessTexture();
    roughTex.repeat.set(6, 6);
    this.textures.push(roughTex);
    this.physicalFloor = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.012, 0.012, 0.015),
      roughness: 0.28,
      roughnessMap: roughTex,
      metalness: 0.0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.2,
    });
    this.disposables.push(this.floorGeometry, this.physicalFloor);
    this.floor = new THREE.Mesh(this.floorGeometry, this.physicalFloor);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.group.add(this.floor);

    const fadeTex = createEdgeFadeTexture();
    this.textures.push(fadeTex);
    const fadeGeo = new THREE.PlaneGeometry(40, 40);
    const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: fadeTex, transparent: true, depthWrite: false, toneMapped: false });
    fadeMat.color.setRGB(0.012, 0.012, 0.015);
    this.disposables.push(fadeGeo, fadeMat);
    this.edgeFade = new THREE.Mesh(fadeGeo, fadeMat);
    this.edgeFade.rotation.x = -Math.PI / 2;
    this.edgeFade.position.y = 0.012;
    this.edgeFade.renderOrder = 5;
    this.group.add(this.edgeFade);

    const ringGeo = new THREE.RingGeometry(4.15, 4.3, 128);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.85, 1.25), toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false });
    this.disposables.push(ringGeo, ringMat);
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.006;
    this.ring.renderOrder = 6;
    this.group.add(this.ring);

    // Lights
    this.key = new THREE.RectAreaLight(new THREE.Color(1.0, 0.97, 0.92), 9, 6, 3);
    this.key.position.set(5.5, 4.6, 4.5);
    this.key.lookAt(0, 0.5, 0);
    this.group.add(this.key);

    this.rim = new THREE.RectAreaLight(new THREE.Color(0.78, 0.86, 1.0), 8, 5, 2.2);
    this.rim.position.set(-5, 3.6, -6);
    this.rim.lookAt(0, 0.6, 0);
    this.rimPivot.add(this.rim);
    this.group.add(this.rimPivot);

    this.fill = new THREE.RectAreaLight(new THREE.Color(0.95, 0.96, 1.0), 2.4, 9, 4);
    this.fill.position.set(-6.5, 3, 6.5);
    this.fill.lookAt(0, 0.6, 0);
    this.group.add(this.fill);

    this.top = new THREE.SpotLight(new THREE.Color(1, 0.98, 0.95), 320, 40, THREE.MathUtils.degToRad(34), 0.75, 2);
    this.top.position.set(1.2, 9.5, 0.8);
    this.top.target.position.set(0, 0, 0);
    this.top.castShadow = true;
    this.top.shadow.mapSize.set(2048, 2048);
    this.top.shadow.camera.near = 3;
    this.top.shadow.camera.far = 20;
    this.top.shadow.bias = -0.0003;
    this.top.shadow.normalBias = 0.015;
    this.top.shadow.radius = 4;
    this.group.add(this.top);
    this.group.add(this.top.target);

    this.sweep = new THREE.SpotLight(new THREE.Color(0.9, 0.94, 1.0), 180, 60, THREE.MathUtils.degToRad(22), 0.9, 2);
    this.sweep.position.set(10, 6, 0);
    this.sweep.target.position.set(0, 0.7, 0);
    this.group.add(this.sweep);
    this.group.add(this.sweep.target);

    // Softboxes: emissive quads coincident with the area lights so they show in floor/car reflections.
    const softbox = (light: THREE.RectAreaLight, parent: THREE.Object3D, r: number, g: number, b: number) => {
      const geo = new THREE.PlaneGeometry(light.width, light.height);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false, side: THREE.DoubleSide });
      this.disposables.push(geo, mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(light.position);
      m.quaternion.copy(light.quaternion);
      m.rotateY(Math.PI);
      parent.add(m);
      this.softboxes.push(m);
    };
    // Kept just above white so they read as light sources without the bloom pass fogging the whole frame.
    softbox(this.key, this.group, 1.9, 1.85, 1.75);
    softbox(this.rim, this.rimPivot, 1.3, 1.45, 1.75);
    softbox(this.fill, this.group, 0.8, 0.82, 0.88);

    // Haze cards (billboarded, additive) and a light shaft under the top light.
    const hazeTex = createHazeTexture(256, 0.65);
    this.textures.push(hazeTex);
    const hazeGeo = new THREE.PlaneGeometry(1, 1);
    this.disposables.push(hazeGeo);
    const hazeSpec: [number, number, number, number, number, number, number][] = [
      [0, 2.5, -9, 30, 16, 0.03, 0.9],
      [8, 1.5, -4, 18, 10, 0.022, 1.0],
      [-7, 2, 3, 16, 9, 0.018, 0.85],
    ];
    for (const [x, y, z, w, h, opacity, warmth] of hazeSpec) {
      const mat = new THREE.MeshBasicMaterial({
        map: hazeTex,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        color: new THREE.Color(0.7 * warmth, 0.78, 0.95),
      });
      this.disposables.push(mat);
      const card = new THREE.Mesh(hazeGeo, mat);
      card.position.set(x, y, z);
      card.scale.set(w, h, 1);
      card.renderOrder = 10;
      this.group.add(card);
      this.hazeCards.push(card);
    }
    const shaftGeo = new THREE.CylinderGeometry(0.6, 5.2, 9.4, 40, 1, true);
    const shaftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { opacity: { value: 0.05 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vWp;
        void main() { vUv = uv; vN = normalize( normalMatrix * normal ); vec4 wp = modelMatrix * vec4( position, 1.0 ); vWp = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vWp;
        uniform float opacity;
        void main() {
          vec3 V = normalize( cameraPosition - vWp );
          float rim = pow( 1.0 - abs( dot( normalize( vN ), V ) ), 1.5 );
          float a = opacity * ( 0.35 + 0.65 * rim ) * smoothstep( 0.0, 0.35, vUv.y ) * ( 1.0 - smoothstep( 0.55, 1.0, vUv.y ) ) * 2.5;
          gl_FragColor = vec4( vec3( 0.85, 0.9, 1.0 ) * a, a );
        }`,
    });
    this.disposables.push(shaftGeo, shaftMat);
    this.shaft = new THREE.Mesh(shaftGeo, shaftMat);
    this.shaft.position.set(1.2 * 0.5, 4.75, 0.8 * 0.5);
    this.shaft.rotation.z = -0.062;
    this.shaft.rotation.x = 0.042;
    this.shaft.renderOrder = 11;
    this.group.add(this.shaft);
  }

  /** Switch the floor between the planar Reflector (high/ultra) and the clearcoat physical disc. */
  setReflector(enabled: boolean, textureSize: number): void {
    if (enabled === this.useReflector && (!enabled || !(this.floor instanceof Reflector) || this.floor.getRenderTarget().width === textureSize)) return;
    this.group.remove(this.floor);
    if (this.floor instanceof Reflector) this.floor.dispose();
    this.useReflector = enabled;
    if (enabled) {
      const shader = {
        ...reflectorShader,
        uniforms: THREE.UniformsUtils.clone(reflectorShader.uniforms) as typeof reflectorShader.uniforms,
      };
      const reflector = new Reflector(this.floorGeometry, {
        color: new THREE.Color(0.012, 0.012, 0.015),
        textureWidth: textureSize,
        textureHeight: textureSize,
        clipBias: 0.002,
        shader,
        multisample: 4,
      });
      const mat = reflector.material as THREE.ShaderMaterial;
      mat.uniforms.tRough.value = this.textures[0];
      const pos = mat.uniforms.lightPos.value as THREE.Vector3[];
      const col = mat.uniforms.lightColor.value as THREE.Color[];
      pos[0].copy(this.key.position);
      col[0].copy(this.key.color).multiplyScalar(0.55);
      pos[1].copy(this.rim.position);
      col[1].copy(this.rim.color).multiplyScalar(0.45);
      pos[2].copy(this.fill.position);
      col[2].copy(this.fill.color).multiplyScalar(0.18);
      pos[3].copy(this.top.position);
      col[3].copy(this.top.color).multiplyScalar(0.5);
      reflector.rotation.x = -Math.PI / 2;
      reflector.receiveShadow = true;
      this.floor = reflector;
    } else {
      this.floor = new THREE.Mesh(this.floorGeometry, this.physicalFloor);
      this.floor.rotation.x = -Math.PI / 2;
      this.floor.receiveShadow = true;
    }
    this.group.add(this.floor);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  update(camera: THREE.Camera, dt: number): void {
    this.time += dt;
    this.backdrop.material.uniforms.time.value = this.time;
    this.rimPivot.rotation.y = this.time * 0.09;
    const a = this.time * 0.31;
    this.sweep.position.set(Math.cos(a) * 10, 5.5 + Math.sin(this.time * 0.17) * 1.5, Math.sin(a) * 10);
    this.sweep.intensity = 120 + 90 * (0.5 + 0.5 * Math.sin(this.time * 0.43));
    for (let i = 0; i < this.hazeCards.length; i++) {
      const card = this.hazeCards[i];
      card.quaternion.copy(camera.quaternion);
      const mat = card.material as THREE.MeshBasicMaterial;
      mat.opacity = (0.018 + 0.008 * i) * (0.8 + 0.2 * Math.sin(this.time * (0.21 + i * 0.07) + i));
    }
    if (this.floor instanceof Reflector) {
      const mat = this.floor.material as THREE.ShaderMaterial;
      (mat.uniforms.lightPos.value as THREE.Vector3[])[1].copy(this.rim.position).applyAxisAngle(_up, this.rimPivot.rotation.y);
    }
  }

  dispose(): void {
    if (this.floor instanceof Reflector) this.floor.dispose();
    for (const d of this.disposables) d.dispose();
    for (const t of this.textures) t.dispose();
    this.top.shadow.map?.dispose();
    this.top.dispose();
    this.sweep.dispose();
    this.key.dispose();
    this.rim.dispose();
    this.fill.dispose();
  }
}
