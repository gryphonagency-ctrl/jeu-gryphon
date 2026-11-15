import * as THREE from 'three';
import { SKY_SCALE, type LightingState, type ThemePalette } from './Atmosphere';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = vec4( p.xy, p.w, p.w );
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec3 vDir;

uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform float turbidity;
uniform float rayleigh;
uniform float mieCoefficient;
uniform float mieDirectionalG;
uniform float skyScale;
uniform vec3 hazeColor;
uniform float hazeAmount;
uniform float cloudCover;
uniform float cloudTime;
uniform vec2 windDir;
uniform float nightFactor;
uniform float daylight;
uniform float twilight;
uniform float starVisibility;
uniform float moonIntensity;
uniform vec3 moonColor;
uniform float cityGlow;
uniform vec3 cityGlowColor;
uniform float envMode;
uniform vec3 groundRadiance;
uniform vec3 sunColor;
uniform float sunIntensity;
uniform float showSunDisc;
uniform float time;

const float pi = 3.141592653589793;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;

float sunIntensityFn( float zenithAngleCos ) {
  zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
  float f = max( 0.0, 1.0 - exp( -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
  return EE * 0.66 * pow( f / 0.66, 0.55 );
}
vec3 totalMie( float T ) {
  float c = ( 0.2 * T ) * 10E-18;
  return 0.434 * c * MieConst;
}
float rayleighPhase( float cosTheta ) { return THREE_OVER_SIXTEENPI * ( 1.0 + cosTheta * cosTheta ); }
float hgPhase( float cosTheta, float g ) {
  float g2 = g * g;
  float inv = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
  return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inv );
}

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float hash13( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash12( i );
  float b = hash12( i + vec2( 1.0, 0.0 ) );
  float c = hash12( i + vec2( 0.0, 1.0 ) );
  float d = hash12( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float fbm( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2( 1.6, 1.2, -1.2, 1.6 );
  for ( int i = 0; i < 5; i ++ ) {
    v += a * vnoise( p );
    p = m * p + 7.3;
    a *= 0.5;
  }
  return v;
}
float cloudField( vec2 uv ) {
  return fbm( uv * 0.9 ) * 0.62 + fbm( uv * 2.7 + 13.1 ) * 0.38;
}

void main() {
  vec3 dir = normalize( vDir );
  vec3 sunDir = normalize( sunDirection );
  vec3 sunDirC = sunDir;
  if ( sunDirC.y < -0.05 ) { sunDirC.y = -0.05; sunDirC = normalize( sunDirC ); }
  float mu = dir.y;
  vec3 skyDir = dir;
  if ( skyDir.y < 0.0 ) skyDir = normalize( vec3( skyDir.x, 0.0, skyDir.z ) + vec3( 0.0, 1e-4, 0.0 ) );

  // ── Preetham daylight scattering
  float sunE = sunIntensityFn( sunDirC.y );
  float sunfade = 1.0 - clamp( 1.0 - exp( sunDirC.y ), 0.0, 1.0 );
  float rayleighCoefficient = rayleigh - ( 1.0 - sunfade );
  vec3 betaR = totalRayleigh * rayleighCoefficient;
  vec3 betaM = totalMie( turbidity ) * mieCoefficient;
  float zenithAngle = acos( max( 0.0, skyDir.y ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( zenithAngle * 180.0 / pi ), -1.253 ) );
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp( -( betaR * sR + betaM * sM ) );
  float cosTheta = dot( skyDir, sunDirC );
  float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaRTheta = betaR * rPhase;
  // Soft-knee the forward Mie peak so the circumsolar glow does not white out a quarter of the frame.
  float mPhase = hgPhase( cosTheta, mieDirectionalG );
  mPhase /= 1.0 + mPhase * 0.25;
  vec3 betaMTheta = betaM * mPhase;
  vec3 phaseTerm = sunE * ( ( betaRTheta + betaMTheta ) / ( betaR + betaM ) );
  vec3 Lin = pow( max( phaseTerm * ( 1.0 - Fex ), 0.0 ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( max( phaseTerm * Fex, 0.0 ), vec3( 0.5 ) ), clamp( pow( 1.0 - sunDirC.y, 5.0 ), 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  // Preetham over-brightens the horizon band relative to the zenith; compress it toward measured sky ratios.
  Lin *= mix( 0.36, 1.0, smoothstep( -0.02, 0.55, mu ) );
  vec3 sky = ( Lin + L0 ) * 0.04 * skyScale;
  sky = mix( vec3( dot( sky, vec3( 0.2126, 0.7152, 0.0722 ) ) ), sky, 0.88 );
  // Hue-preserving shoulder: the analytic model blows past 30× sunlit-white next to a low sun; cap the sky near ~3.
  sky /= 1.0 + dot( sky, vec3( 0.2126, 0.7152, 0.0722 ) ) * ( 1.0 / 2.2 );

  // ── Twilight glow (after the analytic model has faded)
  vec3 dirH = normalize( vec3( dir.x, 0.0, dir.z ) + vec3( 1e-4, 0.0, 0.0 ) );
  vec3 sunH = normalize( vec3( sunDir.x, 0.0, sunDir.z ) + vec3( 1e-4, 0.0, 0.0 ) );
  float facing = max( dot( dirH, sunH ), 0.0 );
  float tw = twilight * exp( -max( mu, 0.0 ) * 5.5 ) * ( 0.07 + 0.93 * pow( facing, 2.5 ) );
  vec3 twColor = mix( vec3( 0.42, 0.12, 0.28 ), vec3( 1.0, 0.42, 0.14 ), pow( facing, 3.0 ) * ( 1.0 - clamp( mu * 4.0, 0.0, 1.0 ) ) );
  sky += twColor * tw * 0.5;
  // Civil-twilight blue: the analytic model is already black once the sun is below the horizon.
  sky += vec3( 0.012, 0.02, 0.05 ) * twilight * ( 0.5 + 0.5 * pow( 1.0 - clamp( mu, 0.0, 1.0 ), 2.5 ) );

  // ── Night sky: deep blue gradient, moon, stars, milky way, city glow
  float horizonNess = pow( 1.0 - clamp( mu, 0.0, 1.0 ), 2.5 );
  vec3 night = vec3( 0.0042, 0.0066, 0.0165 ) * ( 0.45 + 0.55 * horizonNess ) * ( 0.6 + moonIntensity * 3.0 );
  float cosMoon = dot( dir, moonDirection );
  night += moonColor * hgPhase( cosMoon, 0.93 ) * moonIntensity * 0.045;
  vec3 mOff = ( dir - moonDirection * cosMoon ) / 0.0085;
  float mr2 = dot( mOff, mOff );
  if ( mr2 < 1.0 && cosMoon > 0.0 ) {
    vec3 n = mOff + moonDirection * sqrt( 1.0 - mr2 );
    float lit = clamp( dot( n, sunDir ) * 1.3 + 0.2, 0.0, 1.0 );
    float surface = 0.72 + 0.28 * fbm( n.xy * 7.0 + 3.0 );
    float edge = 1.0 - smoothstep( 0.82, 1.0, mr2 );
    night += moonColor * ( 0.02 + lit * 3.2 ) * surface * edge * moonIntensity * 4.0;
  }
  vec3 sp = dir * 160.0;
  vec3 cell = floor( sp );
  float h = hash13( cell );
  vec3 starPos = cell + 0.5 + ( vec3( hash13( cell + 1.7 ), hash13( cell + 9.1 ), hash13( cell + 4.3 ) ) - 0.5 ) * 0.8;
  starPos = normalize( starPos ) * 160.0;
  float sd = length( sp - starPos );
  float twinkle = 0.75 + 0.25 * sin( time * ( 1.5 + h * 4.0 ) + h * 60.0 );
  float star = smoothstep( 0.1, 0.0, sd ) * step( 0.9, h ) * ( pow( hash13( cell + 3.3 ), 6.0 ) * 3.0 + 0.12 ) * twinkle;
  vec3 starTint = mix( vec3( 0.72, 0.84, 1.0 ), vec3( 1.0, 0.9, 0.72 ), hash13( cell + 5.9 ) );
  float starFade = starVisibility * ( 0.3 + 0.7 * smoothstep( 0.0, 0.18, mu ) );
  night += starTint * star * starFade * 0.9;
  vec3 mwNormal = normalize( vec3( 0.3, 0.6, 0.74 ) );
  float band = exp( -pow( dot( dir, mwNormal ), 2.0 ) * 28.0 );
  night += vec3( 0.014, 0.016, 0.024 ) * band * ( 0.35 + 0.65 * fbm( dir.xz * 9.0 + dir.y * 6.0 ) ) * starFade;
  vec3 city = cityGlowColor * cityGlow * exp( -max( mu, 0.0 ) * 8.0 ) * ( 0.7 + 0.3 * vnoise( vec2( atan( dir.x, dir.z ) * 2.5, 0.0 ) ) ) * 0.055;
  sky += night * nightFactor + city * nightFactor;

  // ── Clouds (projected noise sheet)
  float cloudMask = 0.0;
  if ( cloudCover > 0.005 && mu > -0.02 ) {
    float muC = max( mu, 0.03 );
    vec2 cuv = dir.xz / muC * 0.85 + windDir * cloudTime;
    float n = cloudField( cuv );
    // fbm sits around 0.5 ± 0.15: map cover 0..1 onto that range so 0.3 gives scattered cumulus and 0.95 a full deck.
    float th = 0.74 - cloudCover * 0.56;
    float m = smoothstep( th, th + 0.2, n );
    m *= smoothstep( 0.0, 0.08, mu );
    vec2 toSun = normalize( sunDir.xz + vec2( 1e-3, 0.0 ) );
    float n2 = cloudField( cuv + toSun * 0.05 );
    float shade = clamp( ( n2 - n ) * 6.0 + 0.5, 0.0, 1.0 );
    float skyLum = dot( sky, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 ambient = mix( sky, vec3( skyLum ), cloudCover * 0.65 );
    vec3 lit = sunColor * sunIntensity * 0.45 * daylight;
    float silver = pow( max( dot( dir, sunDir ), 0.0 ), 14.0 ) * ( 1.0 - m ) * 0.9;
    vec3 cloudCol = ambient * ( 0.9 - cloudCover * 0.25 ) + lit * ( 0.35 + 0.65 * shade ) * ( 1.0 - cloudCover * 0.4 ) + lit * silver;
    cloudCol += ( moonColor * moonIntensity * 0.4 + cityGlowColor * cityGlow * 0.025 * exp( -max( mu, 0.0 ) * 6.0 ) ) * nightFactor;
    cloudMask = m * ( 0.55 + 0.45 * cloudCover );
    sky = mix( sky, cloudCol, cloudMask );
  }

  // ── Sun disc
  float sunCos = dot( dir, sunDir );
  float disc = smoothstep( 0.999955, 0.99998, sunCos );
  sky += sunColor * sunIntensity * 18.0 * disc * showSunDisc * ( 1.0 - cloudMask ) * smoothstep( -0.03, 0.01, sunDir.y );

  // ── Horizon haze (matches FogExp2 colour so fogged geometry blends into the sky)
  // Thinner on the sun side so the low-sun glow is not flattened by the neutral fog colour.
  float hazeF = hazeAmount * pow( 1.0 - clamp( mu, 0.0, 1.0 ), 7.0 ) * ( 1.0 - 0.65 * pow( facing, 3.0 ) * daylight );
  sky = mix( sky, hazeColor, hazeF );

  if ( envMode > 0.5 && mu < 0.0 ) {
    sky = mix( hazeColor, groundRadiance, smoothstep( 0.0, -0.12, mu ) );
  }

  gl_FragColor = vec4( max( sky, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Procedural sky dome: Preetham daylight + twilight + night (stars, moon, milky way) + noise clouds + horizon haze. */
export class SkyDome {
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  /** Second mesh sharing the material, used in the environment-capture scene. */
  readonly envMesh: THREE.Mesh;
  private readonly geometry: THREE.BoxGeometry;
  private readonly u: Record<string, THREE.IUniform>;
  private time = 0;

  constructor() {
    this.u = {
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      moonDirection: { value: new THREE.Vector3(0, 1, 0) },
      turbidity: { value: 2.5 },
      rayleigh: { value: 1.2 },
      mieCoefficient: { value: 0.005 },
      mieDirectionalG: { value: 0.8 },
      skyScale: { value: SKY_SCALE },
      hazeColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
      hazeAmount: { value: 0.85 },
      cloudCover: { value: 0.25 },
      cloudTime: { value: 0 },
      windDir: { value: new THREE.Vector2(1, 0) },
      nightFactor: { value: 0 },
      daylight: { value: 1 },
      twilight: { value: 0 },
      starVisibility: { value: 0 },
      moonIntensity: { value: 0 },
      moonColor: { value: new THREE.Color(0.6, 0.72, 1.0) },
      cityGlow: { value: 0 },
      cityGlowColor: { value: new THREE.Color(1, 0.7, 0.4) },
      envMode: { value: 0 },
      groundRadiance: { value: new THREE.Color(0.1, 0.1, 0.1) },
      sunColor: { value: new THREE.Color(1, 1, 1) },
      sunIntensity: { value: 3.5 },
      showSunDisc: { value: 1 },
      time: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'ApexSky',
      uniforms: this.u,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'SkyDome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
    this.envMesh = new THREE.Mesh(this.geometry, this.material);
    this.envMesh.frustumCulled = false;
    this.envMesh.matrixAutoUpdate = false;
  }

  /** Push the lighting state into the shader. */
  update(light: LightingState, theme: ThemePalette, weather: { cloud: number; windDir: number; windSpeed: number }, dt: number): void {
    const u = this.u;
    this.time += dt;
    (u.sunDirection.value as THREE.Vector3).copy(light.sunDir);
    (u.moonDirection.value as THREE.Vector3).copy(light.moonDir);
    u.turbidity.value = light.sky.turbidity;
    u.rayleigh.value = light.sky.rayleigh;
    u.mieCoefficient.value = light.sky.mieCoefficient;
    u.mieDirectionalG.value = light.sky.mieDirectionalG;
    (u.hazeColor.value as THREE.Color).copy(light.fogColor);
    u.hazeAmount.value = 0.8 + light.gloom * 0.2;
    u.cloudCover.value = weather.cloud;
    u.cloudTime.value += dt * (0.004 + weather.windSpeed * 0.0012);
    (u.windDir.value as THREE.Vector2).set(Math.sin(weather.windDir), Math.cos(weather.windDir));
    u.nightFactor.value = light.night;
    u.daylight.value = light.daylight;
    u.twilight.value = light.twilight;
    u.starVisibility.value = light.starVisibility;
    u.moonIntensity.value = light.moonIntensity;
    (u.moonColor.value as THREE.Color).copy(light.moonColor);
    u.cityGlow.value = theme.cityGlow;
    (u.cityGlowColor.value as THREE.Color).copy(theme.cityGlowColor);
    (u.groundRadiance.value as THREE.Color).copy(light.groundRadiance);
    (u.sunColor.value as THREE.Color).copy(light.sunColor);
    u.sunIntensity.value = light.sunIntensity;
    u.time.value = this.time;
  }

  /** Switch between the visible dome and the reflection-capture variant (ground below the horizon, no hot sun disc). */
  setEnvCapture(on: boolean): void {
    this.u.envMode.value = on ? 1 : 0;
    this.u.showSunDisc.value = on ? 0 : 1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
