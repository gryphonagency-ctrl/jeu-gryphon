import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export type FallingCharacter = {
  body: CANNON.Body;
  color: string;
  rewardStars: number;
  createdAt: number;
  won: boolean;
  wonAt: number;
  instanceId: number;
};

export type CoinPusherOptions = {
  onCharacterWon?: (character: FallingCharacter) => void;
  onCharacterSpawn?: () => void;
  onPrizePoolChange?: (remaining: number) => void;
  onPersistenceError?: (error: Error) => void;
};

export const CHARACTER_REWARD_DISTRIBUTION = [
  { stars: 1, count: 1000 },
  { stars: 2, count: 100 },
  { stars: 3, count: 50 },
  { stars: 10, count: 10 },
  { stars: 30, count: 5 },
  { stars: 100, count: 1 },
  { stars: 25, count: 1 },
] as const;
export const TOTAL_PRIZE_CHARACTERS = 10000;

const PRIZE_POOL_KEY = 'squid-storm-prize-pool-v1';
const PRIZE_PROGRESS_KEY = 'squid-storm-prize-progress-v3';
const DECK_W = 13.5;
const DECK_D = 6;
const DECK_Y = 0;
const PUSHER_W = 12.8;
const PUSHER_H = 4.8;
const WALL_H = PUSHER_H;
const PUSHER_D = 0.35;
const CHARACTER_COLLISION_HALF_WIDTH = 0.25;
const CHARACTER_COLLISION_HALF_HEIGHT = 0.4;
const CHARACTER_COLLISION_HALF_DEPTH = 0.18;
const CHARACTER_SPRITE_SIZE = 1.15;
const FRONT_EDGE_Z = DECK_D / 2;
const INITIAL_CHARACTER_COUNT = 24;
const MAX_ACTIVE_CHARACTERS = 512;
const MAX_PENDING_CHARACTERS = 10000;
const CHARACTERS_PER_FRAME = 6;
const COIN_DROP_MIN_Z = 0.55;
const COIN_DROP_MAX_Z = 1.35;
const PUSHER_CENTER_Z = -0.25;
const PUSHER_TRAVEL = 1;
const PUSHER_BASE_OMEGA = 0.95;
const CHARACTER_GIF_PATH = `${import.meta.env.BASE_URL}images/squid-game-sticker-pildyk.gif`;
const SKY_GIF_PATH = `${import.meta.env.BASE_URL}images/squid-storm-sky.gif`;
const PUSHER_SYMBOLS_GIF_PATH = `${import.meta.env.BASE_URL}images/squid-storm-icons.gif`;
const HANGING_PIG_GIF_PATH = `${import.meta.env.BASE_URL}images/squid-storm-hanging-pig.gif`;
const WHEEL_BONUS_STARS_KEY = 'squid-storm-wheel-bonus-stars-v1';
const CHARACTER_GIF_CREDIT_URL = 'https://giphy.com/stickers/Pildyk-transparent-etJwkfG5JFf23pPVZQ';

type CharacterSpawnRequest = { color: string; count: number };
type CharacterAnimationFrame = { bitmap: ImageBitmap; duration: number };
type FallingHammer = { body: CANNON.Body; mesh: THREE.Group; createdAt: number };
type DecodedGifImage = CanvasImageSource & {
  displayWidth: number;
  displayHeight: number;
  duration: number | null;
  close: () => void;
};
type GifImageDecoder = {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode: (options: { frameIndex: number }) => Promise<{ image: DecodedGifImage }>;
  close: () => void;
};
type GifImageDecoderConstructor = new (options: { data: ArrayBuffer; type: string }) => GifImageDecoder;
type PrizeProgress = {
  nextIndex: number;
  earnedStars: number;
  wonCount: number;
  wonRewards: Record<string, number>;
  pendingRewards: number[];
  abandonedRewards: number[];
};

function createPrizePool(): number[] {
  const pool = CHARACTER_REWARD_DISTRIBUTION.flatMap(({ stars, count }) => Array<number>(count).fill(stars));
  pool.push(...Array<number>(TOTAL_PRIZE_CHARACTERS - pool.length).fill(0));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool;
}

function isPrizePool(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== TOTAL_PRIZE_CHARACTERS || !value.every((stars) => Number.isSafeInteger(stars) && stars >= 0)) return false;
  const counts = new Map<number, number>();
  for (const stars of value) counts.set(stars, (counts.get(stars) ?? 0) + 1);
  const zeroStarCount = TOTAL_PRIZE_CHARACTERS - CHARACTER_REWARD_DISTRIBUTION.reduce((sum, reward) => sum + reward.count, 0);
  return [...CHARACTER_REWARD_DISTRIBUTION, { stars: 0, count: zeroStarCount }]
    .every(({ stars, count }) => counts.get(stars) === count);
}

function loadPrizePool(): number[] {
  const storedPool = window.localStorage.getItem(PRIZE_POOL_KEY);
  if (storedPool) {
    try {
      const parsed: unknown = JSON.parse(storedPool);
      if (isPrizePool(parsed)) return parsed;
    } catch (error) {
      console.warn('La réserve locale de récompenses est illisible. Une nouvelle réserve va être créée.', error);
    }
    console.warn('La réserve locale de récompenses ne respecte plus la distribution prévue. Elle va être recréée.');
    window.localStorage.removeItem(PRIZE_PROGRESS_KEY);
  }

  const pool = createPrizePool();
  window.localStorage.setItem(PRIZE_POOL_KEY, JSON.stringify(pool));
  return pool;
}

function loadPrizeProgress(): PrizeProgress {
  const storedProgress = window.localStorage.getItem(PRIZE_PROGRESS_KEY);
  if (!storedProgress) {
    return { nextIndex: 0, earnedStars: 0, wonCount: 0, wonRewards: {}, pendingRewards: [], abandonedRewards: [] };
  }
  try {
    const parsed: unknown = JSON.parse(storedProgress);
    if (typeof parsed === 'object' && parsed !== null) {
      const { nextIndex, earnedStars, wonCount, wonRewards, pendingRewards, abandonedRewards } = parsed as Record<string, unknown>;
      if (
        typeof nextIndex === 'number' && Number.isSafeInteger(nextIndex) && nextIndex >= 0 && nextIndex <= TOTAL_PRIZE_CHARACTERS &&
        typeof earnedStars === 'number' && Number.isSafeInteger(earnedStars) && earnedStars >= 0 &&
        typeof wonCount === 'number' && Number.isSafeInteger(wonCount) && wonCount >= 0 && wonCount <= nextIndex &&
        Array.isArray(pendingRewards) && pendingRewards.every(isValidReward) &&
        Array.isArray(abandonedRewards) && abandonedRewards.every(isValidReward) &&
        isWonRewards(wonRewards) &&
        Object.values(wonRewards).reduce<number>((sum, count) => sum + count, 0) === wonCount &&
        Object.entries(wonRewards).reduce((sum, [stars, count]) => sum + Number(stars) * count, 0) === earnedStars &&
        pendingRewards.length + abandonedRewards.length + wonCount === nextIndex
      ) {
        const remainingCounts = new Map<number, number>();
        for (const stars of (JSON.parse(window.localStorage.getItem(PRIZE_POOL_KEY) ?? '[]') as number[]).slice(0, nextIndex)) {
          remainingCounts.set(stars, (remainingCounts.get(stars) ?? 0) + 1);
        }
        for (const [stars, count] of Object.entries(wonRewards)) {
          remainingCounts.set(Number(stars), (remainingCounts.get(Number(stars)) ?? 0) - count);
        }
        for (const stars of [...pendingRewards, ...abandonedRewards]) {
          remainingCounts.set(stars, (remainingCounts.get(stars) ?? 0) - 1);
        }
        if ([...remainingCounts.values()].every((count) => count === 0)) {
          return {
            nextIndex,
            earnedStars,
            wonCount,
            wonRewards,
            pendingRewards: [],
            abandonedRewards: [...abandonedRewards, ...pendingRewards],
          };
        }
      }
    }
  } catch (error) {
    console.warn('La progression locale des récompenses est illisible. Elle va être réinitialisée.', error);
  }
  console.warn('La progression locale des récompenses est invalide. Elle va être réinitialisée.');
  window.localStorage.removeItem(PRIZE_PROGRESS_KEY);
  return { nextIndex: 0, earnedStars: 0, wonCount: 0, wonRewards: {}, pendingRewards: [], abandonedRewards: [] };
}

function isValidReward(value: unknown): value is number {
  return typeof value === 'number' && (value === 0 || CHARACTER_REWARD_DISTRIBUTION.some((reward) => reward.stars === value));
}

function isWonRewards(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([stars, count]) => isValidReward(Number(stars)) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0);
}

function pmaterial(color: number, roughness: number, metalness: number, emissive = 0x000000, emissiveIntensity = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
}

export class CoinPusherEngine {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  world: CANNON.World;
  characters: FallingCharacter[] = [];

  private frameId = 0;
  private container: HTMLElement;
  private options: CoinPusherOptions;
  private elapsed = 0;
  private pusherPhase = 0;
  private startTime = 0;
  private previousFrameTime = 0;
  private characterMesh!: THREE.InstancedMesh;
  private characterTexture!: THREE.CanvasTexture;
  private characterCanvas!: HTMLCanvasElement;
  private characterContext!: CanvasRenderingContext2D;
  private characterImage: HTMLImageElement | null = null;
  private characterFrames: CharacterAnimationFrame[] = [];
  private characterFrameIndex = 0;
  private characterAnimationStartedAt = 0;
  private characterAnimationDuration = 0;
  private disposed = false;
  private characterImageLoaded = false;
  private characterTextureUpdatedAt = 0;
  private skyCanvas!: HTMLCanvasElement;
  private skyContext!: CanvasRenderingContext2D;
  private skyTexture!: THREE.CanvasTexture;
  private skyFrames: CharacterAnimationFrame[] = [];
  private skyAnimationStartedAt = 0;
  private skyAnimationDuration = 0;
  private skyTextureUpdatedAt = 0;
  private skyImage: HTMLImageElement | null = null;
  private symbolImage: HTMLImageElement | null = null;
  private symbolTextures: THREE.CanvasTexture[] = [];
  private hangingPigCanvas!: HTMLCanvasElement;
  private hangingPigContext!: CanvasRenderingContext2D;
  private hangingPigTexture!: THREE.CanvasTexture;
  private hangingPigFrames: CharacterAnimationFrame[] = [];
  private hangingPigAnimationStartedAt = 0;
  private hangingPigAnimationDuration = 0;
  private hangingPigTextureUpdatedAt = 0;
  private hangingPigMesh!: THREE.Mesh;
  private freeCharacterSlots: number[] = [];
  private pendingCharacterSpawns: CharacterSpawnRequest[] = [];
  private pendingCharacterCount = 0;
  private instanceTransform = new THREE.Object3D();
  private prizePool: number[];
  private nextPrizeIndex = 0;
  private earnedStars = 0;
  private wheelBonusStars = 0;
  private wonRewards: Record<string, number> = {};
  private pendingRewards: number[] = [];
  private abandonedRewards: number[] = [];

  private pusherBody!: CANNON.Body;
  private pusherMesh!: THREE.Group;
  private pusherAmplitude = PUSHER_TRAVEL;
  private pusherOmega = PUSHER_BASE_OMEGA;
  private pusherCenterZ = PUSHER_CENTER_Z;
  private hammerCharacterCount = 0;
  private hammers: FallingHammer[] = [];

  private coinMat!: CANNON.Material;
  private deckMat!: CANNON.Material;
  private pusherPMat!: CANNON.Material;
  private wallPMat!: CANNON.Material;

  private wonCount = 0;
  private initialCharactersSpawned = false;
  private pusherBurstActive = false;
  private flashIntensity = 0;
  private accentLight!: THREE.PointLight;
  private neonStrips: THREE.Mesh[] = [];
  private cameraBaseY = 2.8;
  private cameraBaseZ = 14.5;

  constructor(container: HTMLElement, options: CoinPusherOptions = {}) {
    this.container = container;
    this.options = options;
    this.prizePool = loadPrizePool();
    const progress = loadPrizeProgress();
    this.nextPrizeIndex = progress.nextIndex;
    this.earnedStars = progress.earnedStars;
    this.wonCount = progress.wonCount;
    this.wonRewards = progress.wonRewards;
    this.pendingRewards = progress.pendingRewards;
    this.abandonedRewards = progress.abandonedRewards;
    const storedBonusStars = window.localStorage.getItem(WHEEL_BONUS_STARS_KEY);
    if (storedBonusStars !== null) {
      const parsedBonusStars: unknown = JSON.parse(storedBonusStars);
      if (typeof parsedBonusStars !== 'number' || !Number.isSafeInteger(parsedBonusStars) || parsedBonusStars < 0) {
        throw new Error('Le bonus d’étoiles de la roue est invalide dans ce navigateur.');
      }
      this.wheelBonusStars = parsedBonusStars;
    }

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05080a);
    this.scene.fog = new THREE.Fog(0x05080a, 32, 70);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this.camera.position.set(0, this.cameraBaseY, this.cameraBaseZ);
    this.camera.lookAt(0, 1.7, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    (this.world.solver as CANNON.GSSolver).iterations = 8;

    this.setupMaterials();
    this.setupEnvironment();
    this.setupLights();
    this.buildMachine();
    this.setupCharacterRenderer();
    this.setupHangingPig();
    this.setupResize();
    this.frameId = requestAnimationFrame(this.animate);
  }

  private setupCharacterRenderer() {
    this.characterCanvas = document.createElement('canvas');
    this.characterCanvas.width = 256;
    this.characterCanvas.height = 256;
    const context = this.characterCanvas.getContext('2d');
    if (!context) throw new Error('Impossible de créer la texture animée des personnages.');
    this.characterContext = context;
    this.characterTexture = new THREE.CanvasTexture(this.characterCanvas);
    this.characterTexture.colorSpace = THREE.SRGBColorSpace;
    this.characterTexture.minFilter = THREE.LinearFilter;
    this.characterTexture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: this.characterTexture,
      transparent: true,
      alphaTest: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const geometry = new THREE.PlaneGeometry(CHARACTER_SPRITE_SIZE, CHARACTER_SPRITE_SIZE);
    this.characterMesh = new THREE.InstancedMesh(geometry, material, MAX_ACTIVE_CHARACTERS);
    this.characterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.characterMesh.frustumCulled = false;
    this.characterMesh.renderOrder = 2;
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_ACTIVE_CHARACTERS; i++) {
      this.characterMesh.setMatrixAt(i, hiddenMatrix);
      this.freeCharacterSlots.push(MAX_ACTIVE_CHARACTERS - i - 1);
    }
    this.characterMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.characterMesh);

    const decoderConstructor = (window as Window & { ImageDecoder?: GifImageDecoderConstructor }).ImageDecoder;
    if (decoderConstructor) {
      void this.loadCharacterFrames(decoderConstructor).catch((error: unknown) => {
        console.error(`Impossible de décoder l’animation des personnages : ${CHARACTER_GIF_PATH}`, error);
        if (!this.disposed) this.loadCharacterImage();
      });
    } else {
      this.loadCharacterImage();
    }
  }

  private loadCharacterImage() {
    const image = new Image();
    this.characterImage = image;
    image.onload = () => {
      this.characterImageLoaded = true;
      this.characterTextureUpdatedAt = performance.now();
      this.updateCharacterTexture(performance.now(), true);
    };
    image.onerror = () => {
      console.error(`Impossible de charger le GIF des personnages : ${CHARACTER_GIF_PATH} (${CHARACTER_GIF_CREDIT_URL})`);
    };
    image.src = CHARACTER_GIF_PATH;
  }

  private async loadCharacterFrames(Decoder: GifImageDecoderConstructor) {
    const response = await fetch(CHARACTER_GIF_PATH);
    if (!response.ok) throw new Error(`Le GIF des personnages a répondu avec le statut ${response.status}.`);
    const decoder = new Decoder({ data: await response.arrayBuffer(), type: 'image/gif' });
    const frames: CharacterAnimationFrame[] = [];
    try {
      await decoder.tracks.ready;
      const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
      if (frameCount === 0) throw new Error('Le GIF ne contient aucune image animée.');

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        try {
          const cropHeight = Math.floor(image.displayHeight * 0.88);
          const bitmap = await createImageBitmap(
            image as ImageBitmapSource,
            0,
            0,
            image.displayWidth,
            cropHeight,
            { resizeHeight: this.characterCanvas.height },
          );
          frames.push({ bitmap, duration: Math.max(20, (image.duration ?? 100000) / 1000) });
        } finally {
          image.close();
        }
      }

      if (this.disposed) {
        frames.forEach(({ bitmap }) => bitmap.close());
        return;
      }
      this.characterFrames = frames;
      this.characterAnimationDuration = frames.reduce((duration, frame) => duration + frame.duration, 0);
      this.characterAnimationStartedAt = performance.now();
      this.characterTextureUpdatedAt = this.characterAnimationStartedAt;
      this.characterImageLoaded = true;
      this.updateCharacterTexture(this.characterAnimationStartedAt, true);
    } catch (error) {
      frames.forEach(({ bitmap }) => bitmap.close());
      throw error;
    } finally {
      decoder.close();
    }
  }

  private updateCharacterTexture(timestamp: number, force = false) {
    if (!this.characterImageLoaded || (!force && timestamp - this.characterTextureUpdatedAt < 33)) return;
    this.characterContext.clearRect(0, 0, this.characterCanvas.width, this.characterCanvas.height);
    if (this.characterFrames.length > 0) {
      let frameElapsed = (timestamp - this.characterAnimationStartedAt) % this.characterAnimationDuration;
      this.characterFrameIndex = 0;
      while (frameElapsed >= this.characterFrames[this.characterFrameIndex].duration) {
        frameElapsed -= this.characterFrames[this.characterFrameIndex].duration;
        this.characterFrameIndex = (this.characterFrameIndex + 1) % this.characterFrames.length;
      }
      const currentFrame = this.characterFrames[this.characterFrameIndex];
      const drawX = (this.characterCanvas.width - currentFrame.bitmap.width) / 2;
      this.characterContext.drawImage(currentFrame.bitmap, drawX, 0);
    } else if (this.characterImage) {
      const sourceHeight = this.characterImage.naturalHeight * 0.88;
      const scale = this.characterCanvas.height / sourceHeight;
      const drawWidth = this.characterImage.naturalWidth * scale;
      const drawX = (this.characterCanvas.width - drawWidth) / 2;
      this.characterContext.drawImage(
        this.characterImage,
        0, 0, this.characterImage.naturalWidth, sourceHeight,
        drawX, 0, drawWidth, this.characterCanvas.height,
      );
    }
    this.characterTexture.needsUpdate = true;
    this.characterTextureUpdatedAt = timestamp;
  }

  private setupMaterials() {
    this.coinMat = new CANNON.Material({ friction: 0.14, restitution: 0.35 });
    this.deckMat = new CANNON.Material({ friction: 0.06, restitution: 0.12 });
    this.pusherPMat = new CANNON.Material({ friction: 0.03, restitution: 0.15 });
    this.wallPMat = new CANNON.Material({ friction: 0.1, restitution: 0.3 });

    this.world.addContactMaterial(new CANNON.ContactMaterial(this.coinMat, this.deckMat, { friction: 0.05, restitution: 0.15 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.coinMat, this.coinMat, { friction: 0.2, restitution: 0.04 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.coinMat, this.pusherPMat, { friction: 0.1, restitution: 0.04 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.coinMat, this.wallPMat, { friction: 0.08, restitution: 0.35 }));
  }

  private setupEnvironment() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#0a1a18');
    grad.addColorStop(0.3, '#142e28');
    grad.addColorStop(0.5, '#2a2218');
    grad.addColorStop(0.7, '#142e28');
    grad.addColorStop(1, '#040806');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(255,200,100,0.25)';
    ctx.beginPath(); ctx.arc(256, 130, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(80,200,180,0.15)';
    ctx.beginPath(); ctx.arc(100, 70, 24, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(412, 70, 24, 0, Math.PI * 2); ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose(); pmrem.dispose();
  }

  private setupLights() {
    this.scene.add(new THREE.AmbientLight(0x2a3a38, 0.55));

    const key = new THREE.DirectionalLight(0xffe6c0, 2.5);
    key.position.set(4, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -9; key.shadow.camera.right = 9;
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.bias = -0.0003;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x60d8b0, 0.6);
    fill.position.set(-6, 4, -2);
    this.scene.add(fill);

    const spot = new THREE.SpotLight(0xfff0d0, 2.0, 25, Math.PI / 4.5, 0.35, 1.5);
    spot.position.set(0, 12, 4);
    spot.target.position.set(0, 0, 0);
    this.scene.add(spot); this.scene.add(spot.target);

    const tealL = new THREE.PointLight(0x40e0c0, 1.5, 14, 1.8);
    tealL.position.set(-4, 2, 2); this.scene.add(tealL);
    const tealR = new THREE.PointLight(0x40e0c0, 1.5, 14, 1.8);
    tealR.position.set(4, 2, 2); this.scene.add(tealR);
    const goldBack = new THREE.PointLight(0xffc54a, 1.0, 12, 2);
    goldBack.position.set(0, 3, -4); this.scene.add(goldBack);

    this.accentLight = new THREE.PointLight(0xffc54a, 0.8, 12, 2);
    this.accentLight.position.set(0, 1, 4); this.scene.add(this.accentLight);
  }

  private addStaticBox(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, hw: number, hh: number, hd: number, pmat: CANNON.Material, castShadow = true) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow; mesh.receiveShadow = true;
    this.scene.add(mesh);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hw, hh, hd)), material: pmat });
    body.position.set(x, y, z);
    this.world.addBody(body);
    return { mesh, body };
  }

  private addVisual(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rotX = 0, rotY = 0, rotZ = 0) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, rotY, rotZ);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private addTextPanel(text: string, subtext: string, width: number, height: number, x: number, y: number, z: number, accent = '#d86cff') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#090b18';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18;
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8edff';
    ctx.font = '800 68px Outfit, Arial';
    ctx.fillText(text, canvas.width / 2, 112);
    ctx.fillStyle = '#b8c8ef';
    ctx.font = '600 26px Outfit, Arial';
    ctx.fillText(subtext, canvas.width / 2, 170);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const mesh = this.addVisual(new THREE.PlaneGeometry(width, height), material, x, y, z);
    return mesh;
  }

  private buildMachine() {
    const deckMaterial = pmaterial(0x1e2a24, 0.3, 0.7, 0x0a1a16, 0.06);
    const wallMaterial = pmaterial(0x0a1e1a, 0.1, 0.2, 0x0a3a30, 0.05);
    const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x1a4a3e, metalness: 0.1, roughness: 0.04, transmission: 0.75, transparent: true, opacity: 0.22, ior: 1.4, thickness: 0.3 });
    const goldTrimMat = pmaterial(0xffc54a, 0.18, 0.9, 0x4a3a0a, 0.25);
    const neonTealMat = pmaterial(0x40e0c0, 0.25, 0.4, 0x209a80, 1.5);
    const neonGoldMat = pmaterial(0xffc54a, 0.25, 0.4, 0xaa8030, 1.2);
    const neonPinkMat = pmaterial(0xff60d8, 0.25, 0.4, 0x80306a, 1.4);
    const purpleCabinetMat = pmaterial(0x24144f, 0.32, 0.5, 0x16072e, 0.2);
    const purpleEdgeMat = pmaterial(0x6b2b9c, 0.24, 0.6, 0x3c1468, 0.35);

    // ===== Room floor =====
    this.addVisual(new THREE.PlaneGeometry(40, 40), pmaterial(0x080c0a, 0.4, 0.4), 0, -5, 0, -Math.PI / 2);

    // ===== Back wall (room) =====
    this.setupSkyDisplays();

    // ===== Cabinet base (the big box the machine sits on) =====
    const cabW = DECK_W + 1.6;
    const cabD = DECK_D + 2.5;
    const cabH = 4.5;
    const cabY = -2.25;
    this.addVisual(new THREE.BoxGeometry(0.45, cabH, cabD), purpleCabinetMat, -(cabW / 2 - 0.225), cabY, 0.5);
    this.addVisual(new THREE.BoxGeometry(0.45, cabH, cabD), purpleCabinetMat, cabW / 2 - 0.225, cabY, 0.5);
    this.addVisual(new THREE.BoxGeometry(cabW, cabH, 0.4), purpleCabinetMat, 0, cabY, 0.5 - cabD / 2 + 0.2);
    this.addVisual(new THREE.BoxGeometry(cabW, 0.65, cabD), purpleCabinetMat, 0, -4.175, 0.5);
    this.addVisual(new THREE.BoxGeometry(cabW + 0.12, 0.12, 0.14), purpleEdgeMat, 0, -3.84, 0.5 + cabD / 2 + 0.06);

    // ===== Deck (play surface) =====
    this.addStaticBox(new THREE.BoxGeometry(DECK_W, 0.3, DECK_D), deckMaterial, 0, DECK_Y - 0.15, 0, DECK_W / 2, 0.15, DECK_D / 2, this.deckMat);

    // Decorative deck rings
    this.addVisual(new THREE.RingGeometry(1.5, 1.6, 64), neonTealMat, 0, DECK_Y + 0.001, 0, -Math.PI / 2);
    // Deck surface pattern lines
    for (let i = 0; i < 4; i++) {
      const z = -2.5 + i * 1.6;
      this.addVisual(new THREE.BoxGeometry(DECK_W - 0.6, 0.002, 0.03), pmaterial(0x2a4a3e, 0.5, 0.4, 0x0a2a20, 0.15), 0, DECK_Y + 0.002, z);
    }

    // ===== Glass side walls =====
    const wallGeo = new THREE.BoxGeometry(0.12, WALL_H, DECK_D);
    this.addStaticBox(wallGeo, glassMaterial, -DECK_W / 2, WALL_H / 2, 0, 0.06, WALL_H / 2, DECK_D / 2, this.wallPMat);
    this.addStaticBox(wallGeo, glassMaterial, DECK_W / 2, WALL_H / 2, 0, 0.06, WALL_H / 2, DECK_D / 2, this.wallPMat);

    // Front lip (raised edge — coins fall over this)
    this.addVisual(new THREE.BoxGeometry(DECK_W, 0.06, 0.1), goldTrimMat, 0, 0.03, FRONT_EDGE_Z - 0.05);

    // Neon strips
    const stripGeo = new THREE.BoxGeometry(0.04, 0.06, DECK_D);
    this.neonStrips.push(this.addVisual(stripGeo, neonTealMat, -DECK_W / 2 + 0.08, WALL_H - 0.05, 0));
    this.neonStrips.push(this.addVisual(stripGeo, neonTealMat, DECK_W / 2 - 0.08, WALL_H - 0.05, 0));
    this.addVisual(new THREE.BoxGeometry(DECK_W, 0.06, 0.04), neonGoldMat, 0, WALL_H - 0.05, -DECK_D / 2 + 0.08);
    this.addVisual(new THREE.BoxGeometry(DECK_W + 0.2, 0.05, 0.08), neonPinkMat, 0, 0.04, FRONT_EDGE_Z + 0.02);
    this.addTextPanel('SQUID', 'STORM', 2.2, 0.6, 0, 0.08, FRONT_EDGE_Z - 0.08, '#40e0c0');

    // ===== Moving pusher wall and marquee =====
    this.pusherMesh = new THREE.Group();
    const pusherWall = new THREE.Mesh(new THREE.BoxGeometry(PUSHER_W, PUSHER_H, PUSHER_D), wallMaterial);
    pusherWall.position.y = PUSHER_H / 2;
    pusherWall.castShadow = true;
    pusherWall.receiveShadow = true;
    this.pusherMesh.add(pusherWall);
    const pusherTrim = new THREE.Mesh(new THREE.BoxGeometry(PUSHER_W, 0.08, 0.1), goldTrimMat);
    pusherTrim.position.set(0, PUSHER_H - 0.04, PUSHER_D / 2);
    this.pusherMesh.add(pusherTrim);
    const banner = this.addTextPanel('SQUID STORM', '', DECK_W - 1, 1.05, 0, 3.75, PUSHER_D / 2 + 0.02, '#40e0c0');
    this.scene.remove(banner);
    this.pusherMesh.add(banner);
    this.setupPusherSymbols();
    this.pusherMesh.position.set(0, 0, this.pusherCenterZ);
    this.scene.add(this.pusherMesh);

    this.pusherBody = new CANNON.Body({ type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(PUSHER_W / 2, PUSHER_H / 2, PUSHER_D / 2)), material: this.pusherPMat });
    this.pusherBody.position.set(0, PUSHER_H / 2, this.pusherCenterZ);
    this.world.addBody(this.pusherBody);

    // ===== Floor reflection plane (subtle) =====
    const reflectGeo = new THREE.PlaneGeometry(20, 20);
    const reflectMat = new THREE.MeshStandardMaterial({ color: 0x080c0a, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.6 });
    this.addVisual(reflectGeo, reflectMat, 0, -4.98, 0, -Math.PI / 2);
  }

  private setupSkyDisplays() {
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 224;
    this.skyCanvas.height = 224;
    const context = this.skyCanvas.getContext('2d');
    if (!context) throw new Error('Impossible de créer la texture animée du ciel.');
    this.skyContext = context;
    this.skyTexture = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.skyTexture.minFilter = THREE.LinearFilter;
    this.skyTexture.magFilter = THREE.LinearFilter;
    this.scene.background = this.skyTexture;

    const decoderConstructor = (window as Window & { ImageDecoder?: GifImageDecoderConstructor }).ImageDecoder;
    if (decoderConstructor) {
      void this.loadSkyFrames(decoderConstructor).catch((error: unknown) => {
        console.error(`Impossible de décoder l’animation du ciel : ${SKY_GIF_PATH}`, error);
        if (!this.disposed) this.loadSkyImage();
      });
    } else {
      this.loadSkyImage();
    }
  }

  private setupPusherSymbols() {
    const image = new Image();
    this.symbolImage = image;
    image.onload = () => {
      if (this.disposed) return;
      const symbolWidth = image.naturalWidth / 3;
      for (let index = 0; index < 3; index++) {
        const canvas = document.createElement('canvas');
        canvas.width = 224;
        canvas.height = 224;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Impossible de créer les textures des symboles du poussoir.');
        context.drawImage(image, index * symbolWidth, 0, symbolWidth, image.naturalHeight, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let pixel = 0; pixel < pixels.data.length; pixel += 4) {
          if (pixels.data[pixel] > 200 && pixels.data[pixel + 1] < 80 && pixels.data[pixel + 2] < 130) pixels.data[pixel + 3] = 0;
        }
        context.putImageData(pixels, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.symbolTextures.push(texture);
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, toneMapped: false, side: THREE.DoubleSide });
        const symbol = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25), material);
        symbol.position.set((index - 1) * 4, 1.65, PUSHER_D / 2 + 0.025);
        this.pusherMesh.add(symbol);
      }
    };
    image.onerror = () => console.error(`Impossible de charger les symboles du poussoir : ${PUSHER_SYMBOLS_GIF_PATH}`);
    image.src = PUSHER_SYMBOLS_GIF_PATH;
  }

  private setupHangingPig() {
    this.hangingPigCanvas = document.createElement('canvas');
    this.hangingPigCanvas.width = 224;
    this.hangingPigCanvas.height = 224;
    const context = this.hangingPigCanvas.getContext('2d');
    if (!context) throw new Error('Impossible de créer la texture du cochon suspendu.');
    this.hangingPigContext = context;
    this.hangingPigTexture = new THREE.CanvasTexture(this.hangingPigCanvas);
    this.hangingPigTexture.colorSpace = THREE.SRGBColorSpace;
    this.hangingPigTexture.minFilter = THREE.LinearFilter;
    this.hangingPigTexture.magFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({ map: this.hangingPigTexture, transparent: true, alphaTest: 0.04, toneMapped: false, side: THREE.DoubleSide });
    this.hangingPigMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), material);
    this.hangingPigMesh.position.set(0, -0.75, 5.35);
    this.hangingPigMesh.renderOrder = 1;
    this.scene.add(this.hangingPigMesh);
    const decoderConstructor = (window as Window & { ImageDecoder?: GifImageDecoderConstructor }).ImageDecoder;
    if (decoderConstructor) {
      void this.loadHangingPigFrames(decoderConstructor).catch((error: unknown) => {
        console.error(`Impossible de décoder l’animation du cochon suspendu : ${HANGING_PIG_GIF_PATH}`, error);
      });
    } else {
      const image = new Image();
      image.onload = () => {
        if (this.disposed) return;
        this.drawPigImage(image);
        this.hangingPigTexture.needsUpdate = true;
      };
      image.onerror = () => console.error(`Impossible de charger le cochon suspendu : ${HANGING_PIG_GIF_PATH}`);
      image.src = HANGING_PIG_GIF_PATH;
    }
  }

  private async loadHangingPigFrames(Decoder: GifImageDecoderConstructor) {
    const response = await fetch(HANGING_PIG_GIF_PATH);
    if (!response.ok) throw new Error(`Le GIF du cochon suspendu a répondu avec le statut ${response.status}.`);
    const decoder = new Decoder({ data: await response.arrayBuffer(), type: 'image/gif' });
    const frames: CharacterAnimationFrame[] = [];
    try {
      await decoder.tracks.ready;
      const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
      if (frameCount === 0) throw new Error('Le GIF du cochon suspendu ne contient aucune image animée.');
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        try {
          const bitmap = await createImageBitmap(image as ImageBitmapSource, 43, 245, 184, 190, { resizeWidth: 224, resizeHeight: 224 });
          frames.push({ bitmap, duration: Math.max(20, (image.duration ?? 100000) / 1000) });
        } finally {
          image.close();
        }
      }
      if (this.disposed) {
        frames.forEach(({ bitmap }) => bitmap.close());
        return;
      }
      this.hangingPigFrames = frames;
      this.hangingPigAnimationDuration = frames.reduce((duration, frame) => duration + frame.duration, 0);
      this.hangingPigAnimationStartedAt = performance.now();
      this.updateHangingPigTexture(this.hangingPigAnimationStartedAt, true);
    } catch (error) {
      frames.forEach(({ bitmap }) => bitmap.close());
      throw error;
    } finally {
      decoder.close();
    }
  }

  private drawPigImage(image: CanvasImageSource) {
    this.hangingPigContext.clearRect(0, 0, this.hangingPigCanvas.width, this.hangingPigCanvas.height);
    if (image instanceof ImageBitmap) {
      this.hangingPigContext.drawImage(image, 0, 0, 224, 224);
    } else {
      this.hangingPigContext.drawImage(image, 43, 245, 184, 190, 0, 0, 224, 224);
    }
    const pixels = this.hangingPigContext.getImageData(0, 0, 224, 224);
    for (let pixel = 0; pixel < pixels.data.length; pixel += 4) {
      if (pixels.data[pixel] > 235 && pixels.data[pixel + 1] > 235 && pixels.data[pixel + 2] > 235) pixels.data[pixel + 3] = 0;
    }
    this.hangingPigContext.putImageData(pixels, 0, 0);
  }

  private updateHangingPigTexture(timestamp: number, force = false) {
    if (!force && timestamp - this.hangingPigTextureUpdatedAt < 33) return;
    if (this.hangingPigFrames.length === 0) return;
    let frameElapsed = (timestamp - this.hangingPigAnimationStartedAt) % this.hangingPigAnimationDuration;
    let frameIndex = 0;
    while (frameElapsed >= this.hangingPigFrames[frameIndex].duration) {
      frameElapsed -= this.hangingPigFrames[frameIndex].duration;
      frameIndex = (frameIndex + 1) % this.hangingPigFrames.length;
    }
    this.drawPigImage(this.hangingPigFrames[frameIndex].bitmap);
    this.hangingPigTexture.needsUpdate = true;
    this.hangingPigTextureUpdatedAt = timestamp;
  }

  private async loadSkyFrames(Decoder: GifImageDecoderConstructor) {
    const response = await fetch(SKY_GIF_PATH);
    if (!response.ok) throw new Error(`Le GIF du ciel a répondu avec le statut ${response.status}.`);
    const decoder = new Decoder({ data: await response.arrayBuffer(), type: 'image/gif' });
    const frames: CharacterAnimationFrame[] = [];
    try {
      await decoder.tracks.ready;
      const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
      if (frameCount === 0) throw new Error('Le GIF du ciel ne contient aucune image animée.');

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        try {
          const bitmap = await createImageBitmap(
            image as ImageBitmapSource,
            0,
            0,
            image.displayWidth,
            image.displayHeight,
            { resizeWidth: this.skyCanvas.width, resizeHeight: this.skyCanvas.height },
          );
          frames.push({ bitmap, duration: Math.max(20, (image.duration ?? 100000) / 1000) });
        } finally {
          image.close();
        }
      }

      if (this.disposed) {
        frames.forEach(({ bitmap }) => bitmap.close());
        return;
      }
      this.skyFrames = frames;
      this.skyAnimationDuration = frames.reduce((duration, frame) => duration + frame.duration, 0);
      this.skyAnimationStartedAt = performance.now();
      this.updateSkyTexture(this.skyAnimationStartedAt, true);
    } catch (error) {
      frames.forEach(({ bitmap }) => bitmap.close());
      throw error;
    } finally {
      decoder.close();
    }
  }

  private loadSkyImage() {
    const image = new Image();
    this.skyImage = image;
    image.onload = () => this.updateSkyTexture(performance.now(), true);
    image.onerror = () => {
      console.error(`Impossible de charger le GIF du ciel : ${SKY_GIF_PATH}`);
    };
    image.src = SKY_GIF_PATH;
  }

  private updateSkyTexture(timestamp: number, force = false) {
    if (!force && timestamp - this.skyTextureUpdatedAt < 33) return;
    if (this.skyFrames.length > 0) {
      let frameElapsed = (timestamp - this.skyAnimationStartedAt) % this.skyAnimationDuration;
      let frameIndex = 0;
      while (frameElapsed >= this.skyFrames[frameIndex].duration) {
        frameElapsed -= this.skyFrames[frameIndex].duration;
        frameIndex = (frameIndex + 1) % this.skyFrames.length;
      }
      this.skyContext.drawImage(this.skyFrames[frameIndex].bitmap, 0, 0);
    } else if (this.skyImage?.complete && this.skyImage.naturalWidth > 0) {
      this.skyContext.drawImage(this.skyImage, 0, 0, this.skyCanvas.width, this.skyCanvas.height);
    } else {
      return;
    }
    this.skyTexture.needsUpdate = true;
    this.skyTextureUpdatedAt = timestamp;
  }

  private spawnInitialCharacters(count: number) {
    for (let i = 0; i < count; i++) {
      const col = i % 12;
      const row = Math.floor(i / 12);
      const x = -3.85 + col * 0.7 + (Math.random() - 0.5) * 0.015;
      const z = 0.35 + row * 0.38 + (Math.random() - 0.5) * 0.015;
      const colorName = i % 6 === 0 ? 'silver' : i % 9 === 0 ? 'bronze' : 'gold';
      this.spawnCharacterAt(x, CHARACTER_COLLISION_HALF_HEIGHT, z, colorName);
    }
  }

  private spawnCharacterAt(x: number, y: number, z: number, colorName: string) {
    if (this.characters.length >= MAX_ACTIVE_CHARACTERS) this.trimCharacterCount();
    const instanceId = this.freeCharacterSlots.pop();
    if (instanceId === undefined) {
      console.error('Aucun emplacement disponible pour afficher un personnage.');
      return;
    }
    const rewardStars = this.prizePool[this.nextPrizeIndex];
    if (rewardStars === undefined) {
      console.warn('La réserve de 10 000 personnages est épuisée. Aucun personnage supplémentaire ne sera créé.');
      this.freeCharacterSlots.push(instanceId);
      return;
    }
    this.nextPrizeIndex++;
    this.pendingRewards.push(rewardStars);
    this.persistPrizeProgress();
    const body = new CANNON.Body({
      mass: 0.6,
      shape: new CANNON.Box(new CANNON.Vec3(
        CHARACTER_COLLISION_HALF_WIDTH,
        CHARACTER_COLLISION_HALF_HEIGHT,
        CHARACTER_COLLISION_HALF_DEPTH,
      )),
      position: new CANNON.Vec3(x, y, z),
      material: this.coinMat,
    });
    body.fixedRotation = true;
    body.updateMassProperties();
    body.linearDamping = 0.08;
    body.angularDamping = 0.2;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.08;
    body.sleepTimeLimit = 0.35;
    if (this.pusherBurstActive) this.launchCharacter(body);
    this.world.addBody(body);

    const transform = this.instanceTransform;
    transform.position.set(x, y, z);
    transform.scale.set(1, 1, 1);
    transform.rotation.set(0, 0, 0);
    transform.updateMatrix();
    this.characterMesh.setMatrixAt(instanceId, transform.matrix);
    this.characterMesh.instanceMatrix.needsUpdate = true;
    this.characters.push({ body, color: colorName, rewardStars, createdAt: performance.now(), won: false, wonAt: 0, instanceId });
    this.hammerCharacterCount++;
    if (this.hammerCharacterCount % 100 === 0) this.dropGiantHammers();
    this.options.onPrizePoolChange?.(this.getRemainingCharacterCount());
  }

  spawnCharacters(colorName = 'gold', count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError('Le nombre de personnages à créer doit être un entier positif.');
    }
    if (count === 0) return;
    const availableQueue = Math.min(MAX_PENDING_CHARACTERS - this.pendingCharacterCount, this.getRemainingCharacterCount());
    const acceptedCount = Math.min(count, availableQueue);
    if (acceptedCount < count) {
      console.warn(`La file d’attente des personnages est pleine : ${count - acceptedCount} personnage(s) ignoré(s).`);
    }
    if (acceptedCount > 0) {
      const lastRequest = this.pendingCharacterSpawns[this.pendingCharacterSpawns.length - 1];
      if (lastRequest?.color === colorName) {
        lastRequest.count += acceptedCount;
      } else {
        this.pendingCharacterSpawns.push({ color: colorName, count: acceptedCount });
      }
      this.pendingCharacterCount += acceptedCount;
      this.options.onCharacterSpawn?.();
      this.options.onPrizePoolChange?.(this.getRemainingCharacterCount());
    }
  }

  private launchCharacter(body: CANNON.Body) {
    body.wakeUp();
    body.velocity.set(0, 4, 12);
  }

  pushAllCharacters() {
    this.pusherBurstActive = true;
    for (const character of this.characters) {
      if (!character.won) this.launchCharacter(character.body);
    }
  }

  private dropGiantHammers() {
    for (const [index, x] of [-3.6, 3.6].entries()) {
      const mesh = new THREE.Group();
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.85, 1.05),
        new THREE.MeshStandardMaterial({ color: 0xffc54a, metalness: 0.82, roughness: 0.2, emissive: 0x7a3d08, emissiveIntensity: 0.35 }),
      );
      head.position.y = 0.85;
      head.castShadow = true;
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.28, 2.8, 12),
        new THREE.MeshStandardMaterial({ color: 0x492616, metalness: 0.25, roughness: 0.4 }),
      );
      handle.position.y = -0.75;
      handle.castShadow = true;
      mesh.add(head, handle);
      mesh.position.set(x, 8, 0.5);
      mesh.rotation.z = index === 0 ? 0.12 : -0.12;
      this.scene.add(mesh);

      const body = new CANNON.Body({ mass: 24, material: this.coinMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(1.2, 0.425, 0.525)), new CANNON.Vec3(0, 0.85, 0));
      body.addShape(new CANNON.Cylinder(0.2, 0.28, 2.8, 8), new CANNON.Vec3(0, -0.75, 0));
      body.position.set(x, 8, 0.5);
      body.quaternion.setFromEuler(0, 0, mesh.rotation.z);
      body.angularVelocity.z = index === 0 ? 0.25 : -0.25;
      this.world.addBody(body);
      this.hammers.push({ body, mesh, createdAt: performance.now() });
    }
  }

  private processPendingCharacterSpawns() {
    let remaining = CHARACTERS_PER_FRAME;
    while (remaining > 0 && this.pendingCharacterCount > 0) {
      const request = this.pendingCharacterSpawns[0];
      if (!request) break;
      const x = (Math.random() - 0.5) * (DECK_W - CHARACTER_COLLISION_HALF_WIDTH * 2);
      const pusherFront = this.pusherBody.position.z + PUSHER_D / 2 + CHARACTER_COLLISION_HALF_DEPTH + 0.12;
      const minZ = Math.max(COIN_DROP_MIN_Z, pusherFront);
      const z = minZ + Math.random() * Math.max(0, COIN_DROP_MAX_Z - minZ);
      request.count--;
      this.pendingCharacterCount--;
      this.spawnCharacterAt(x, 2.2, z, request.color);
      remaining--;
      if (request.count === 0) this.pendingCharacterSpawns.shift();
    }
    if (this.pendingCharacterCount === 0) this.pusherBurstActive = false;
  }

  private removeCharacter(character: FallingCharacter) {
    if (!character.won) {
      const rewardIndex = this.pendingRewards.indexOf(character.rewardStars);
      if (rewardIndex >= 0) {
        this.pendingRewards.splice(rewardIndex, 1);
        this.abandonedRewards.push(character.rewardStars);
        this.persistPrizeProgress();
        this.options.onPrizePoolChange?.(this.getRemainingCharacterCount());
      }
    }
    const index = this.characters.indexOf(character);
    if (index >= 0) this.characters.splice(index, 1);
    this.world.removeBody(character.body);
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    this.characterMesh.setMatrixAt(character.instanceId, hiddenMatrix);
    this.characterMesh.instanceMatrix.needsUpdate = true;
    this.freeCharacterSlots.push(character.instanceId);
  }

  private trimCharacterCount(): void {
    const oldestWon = this.characters.find((character) => character.won);
    const oldestResting = this.characters.find((character) => character.body.sleepState === CANNON.Body.SLEEPING);
    const characterToRemove = oldestWon ?? oldestResting ?? this.characters[0];
    if (characterToRemove) this.removeCharacter(characterToRemove);
  }

  getCharacterCount(): number {
    return this.characters.filter((character) => !character.won).length + this.pendingCharacterCount;
  }

  getRemainingCharacterCount(): number {
    return this.prizePool.length - this.nextPrizeIndex - this.pendingCharacterCount;
  }

  getEarnedStars(): number { return this.earnedStars + this.wheelBonusStars; }
  getWonCount(): number { return this.wonCount; }

  awardWheelBonusStars(stars: number) {
    if (!Number.isSafeInteger(stars) || stars <= 0) throw new RangeError('Le bonus de la roue doit être un nombre positif d’étoiles.');
    const nextBonus = this.wheelBonusStars + stars;
    try {
      window.localStorage.setItem(WHEEL_BONUS_STARS_KEY, String(nextBonus));
    } catch (cause) {
      const error = new Error('Impossible d’enregistrer le bonus de la roue dans ce navigateur.');
      console.error(error, cause);
      this.options.onPersistenceError?.(error);
      return false;
    }
    this.wheelBonusStars = nextBonus;
    return true;
  }

  setPusherTravel(amplitude: number): void {
    if (!Number.isFinite(amplitude) || amplitude < 0.2 || amplitude > 2.4) {
      throw new RangeError('Le déplacement du mur doit être compris entre 0,2 et 2,4.');
    }
    this.pusherAmplitude = amplitude;
  }

  setPusherSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < 0.4 || speed > 3) {
      throw new RangeError('Le multiplicateur de vitesse du mur doit être compris entre 0,4 et 3.');
    }
    this.pusherOmega = PUSHER_BASE_OMEGA * speed;
  }

  private persistPrizeProgress() {
    try {
      window.localStorage.setItem(PRIZE_PROGRESS_KEY, JSON.stringify({
        nextIndex: this.nextPrizeIndex,
        earnedStars: this.earnedStars,
        wonCount: this.wonCount,
        wonRewards: this.wonRewards,
        pendingRewards: this.pendingRewards,
        abandonedRewards: this.abandonedRewards,
      }));
    } catch (cause) {
      const error = new Error('Impossible d’enregistrer la progression des récompenses dans ce navigateur.');
      console.error(error);
      console.error(cause);
      this.options.onPersistenceError?.(error);
    }
  }

  private syncCharacters() {
    const transform = this.instanceTransform;
    for (const character of this.characters) {
      const { x, y, z } = character.body.position;
      transform.position.set(x, y, z);
      transform.scale.set(1, 1, 1);
      transform.rotation.set(0, 0, 0);
      transform.updateMatrix();
      this.characterMesh.setMatrixAt(character.instanceId, transform.matrix);
    }
    this.characterMesh.instanceMatrix.needsUpdate = true;
  }

  private syncHammers(now: number) {
    for (const hammer of [...this.hammers]) {
      hammer.mesh.position.set(hammer.body.position.x, hammer.body.position.y, hammer.body.position.z);
      hammer.mesh.quaternion.set(hammer.body.quaternion.x, hammer.body.quaternion.y, hammer.body.quaternion.z, hammer.body.quaternion.w);
      if (now - hammer.createdAt > 9000) {
        this.world.removeBody(hammer.body);
        this.scene.remove(hammer.mesh);
        hammer.mesh.children.forEach((part) => {
          if (part instanceof THREE.Mesh) {
            part.geometry.dispose();
            (part.material as THREE.Material).dispose();
          }
        });
        this.hammers.splice(this.hammers.indexOf(hammer), 1);
      }
    }
  }

  private expireCharacters(now: number) {
    for (const character of [...this.characters]) {
      if (character.won && now - character.wonAt > 12000) {
        this.removeCharacter(character);
      } else if (!character.won && now - character.createdAt > 90000) {
        this.removeCharacter(character);
      }
    }
  }

  private handleCharacterWins(now: number) {
    for (const character of this.characters) {
      if (!character.won && character.body.position.y < -0.5 && character.body.position.z > FRONT_EDGE_Z - 0.5) {
        character.won = true;
        character.wonAt = now;
        this.wonCount++;
        this.earnedStars += character.rewardStars;
        const rewardIndex = this.pendingRewards.indexOf(character.rewardStars);
        if (rewardIndex >= 0) this.pendingRewards.splice(rewardIndex, 1);
        const rewardKey = String(character.rewardStars);
        this.wonRewards[rewardKey] = (this.wonRewards[rewardKey] ?? 0) + 1;
        this.persistPrizeProgress();
        this.flashIntensity = 1.0;
        this.options.onCharacterWon?.(character);
      }
    }
  }

  private updatePusher(deltaTime: number) {
    this.pusherPhase += this.pusherOmega * deltaTime;
    const pz = this.pusherCenterZ + this.pusherAmplitude * Math.sin(this.pusherPhase);
    const pvz = this.pusherAmplitude * this.pusherOmega * Math.cos(this.pusherPhase);
    this.pusherBody.position.z = pz;
    this.pusherBody.velocity.z = pvz;
    this.pusherMesh.position.z = pz;
  }

  private animate = (timestamp: number) => {
    this.frameId = requestAnimationFrame(this.animate);
    if (this.startTime === 0) this.startTime = timestamp;
    const dt = this.previousFrameTime === 0 ? 1 / 60 : Math.min((timestamp - this.previousFrameTime) / 1000, 1 / 30);
    this.previousFrameTime = timestamp;
    this.elapsed = (timestamp - this.startTime) / 1000;

    this.updatePusher(dt);
    if (!this.initialCharactersSpawned) {
      this.initialCharactersSpawned = true;
      this.spawnInitialCharacters(INITIAL_CHARACTER_COUNT);
      this.options.onPrizePoolChange?.(this.getRemainingCharacterCount());
    }
    this.processPendingCharacterSpawns();
    this.updateCharacterTexture(timestamp);
    this.updateSkyTexture(timestamp);
    this.updateHangingPigTexture(timestamp);

    // Neon + marquee pulsing
    const pulse = 0.8 + 0.35 * Math.sin(this.elapsed * 2.2);
    for (const strip of this.neonStrips) {
      (strip.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }
    // Flash effect on character win
    if (this.flashIntensity > 0) {
      this.flashIntensity = Math.max(0, this.flashIntensity - dt * 3);
      this.accentLight.intensity = 0.8 + this.flashIntensity * 3.5;
    }

    // Camera subtle breathing
    this.camera.position.x = Math.sin(this.elapsed * 0.25) * 0.14;
    this.camera.position.y = this.cameraBaseY + Math.sin(this.elapsed * 0.35) * 0.06;
    this.camera.lookAt(0, 1.7, 0);

    this.world.step(1 / 60, dt, 3);
    const now = performance.now();
    this.handleCharacterWins(now);
    this.syncHammers(now);
    this.syncCharacters();
    this.expireCharacters(now);

    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private setupResize() { window.addEventListener('resize', this.onResize); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.onResize);
    for (const character of this.characters) this.world.removeBody(character.body);
    this.characters = [];
    for (const hammer of this.hammers) {
      this.world.removeBody(hammer.body);
      this.scene.remove(hammer.mesh);
    }
    this.hammers = [];
    if (this.characterImage) {
      this.characterImage.onload = null;
      this.characterImage.onerror = null;
    }
    this.characterFrames.forEach(({ bitmap }) => bitmap.close());
    this.skyFrames.forEach(({ bitmap }) => bitmap.close());
    this.hangingPigFrames.forEach(({ bitmap }) => bitmap.close());
    if (this.skyImage) {
      this.skyImage.onload = null;
      this.skyImage.onerror = null;
    }
    if (this.symbolImage) {
      this.symbolImage.onload = null;
      this.symbolImage.onerror = null;
    }
    this.characterMesh.geometry.dispose();
    (this.characterMesh.material as THREE.Material).dispose();
    this.characterTexture.dispose();
    this.skyTexture.dispose();
    this.hangingPigMesh.geometry.dispose();
    (this.hangingPigMesh.material as THREE.Material).dispose();
    this.hangingPigTexture.dispose();
    this.symbolTextures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
