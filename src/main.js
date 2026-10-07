import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- Configuration ---
const CONFIG = {
  starCount: 90000,
  nebulaCount: 700,
  spaceDepth: 36000,
  spaceWidth: 2800,
  spaceHeight: 2000,
  scrollSensitivity: 1.1,
  lerpFactor: 0.075,
  driftSpeed: 0.0,      // Only moves when scrolled
  pushForce: 2.2,       // Gentle touch impulse (moves just a little, no yeeting)
  touchDamping: 0.94,   // Heavy, laggy viscous drag that smoothly settles the touch
};

// --- DOM Setup ---
const container = document.getElementById("webgl-container");
const crawlIntro = document.getElementById("star-wars-intro");
const crawlStage1 = document.getElementById("crawl-stage-1");
const crawlStage2 = document.getElementById("crawl-stage-2");
const crawlStage3 = document.getElementById("crawl-stage-3");
const crawlStage4 = document.getElementById("crawl-stage-4");
const crawlShade = document.getElementById("crawl-shade");
const scrollHud = document.getElementById("scroll-hud");
const spaceHud = document.getElementById("space-hud");
const projectStage = document.getElementById("project-stage");
const projectTextInner = document.getElementById("project-text-inner");
const project2Stage = document.getElementById("project2-stage");
const project2TextInner = document.getElementById("project2-text-inner");
const projectVideos = projectStage ? [...projectStage.querySelectorAll("video")] : [];
const project2Videos = project2Stage ? [...project2Stage.querySelectorAll("video")] : [];
const project3Stage = document.getElementById("project3-stage");
const project3TextInner = document.getElementById("project3-text-inner");
const project3Videos = project3Stage ? [...project3Stage.querySelectorAll("video")] : [];

// Loop positions where space movement freezes and each showcase takes over.
// Stage 2 parks at 12600 — the start of its peak plateau, right where the
// 12000→12600 fade-in completes. Stage 3 parks at 15900 the same way.
const PROJECT_SCROLL_START = 9400;
const PROJECT2_SCROLL_START = 12600;
const PROJECT3_SCROLL_START = 15900;

// --- Scene, Camera, Renderer ---
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020206, 0.00015);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  1,
  19000
);
camera.position.set(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x020206, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
container.appendChild(renderer.domElement);

// --- Space Lighting for 3D Models ---
const ambientLight = new THREE.AmbientLight(0x202a45, 4.8);
scene.add(ambientLight);

// Key celestial sun light
const sunLight = new THREE.DirectionalLight(0xfff5e6, 9.6);
sunLight.position.set(1200, 900, 600);
scene.add(sunLight);

// Cyan rim light from opposite angle for dramatic cosmic edge highlights
const rimLight = new THREE.DirectionalLight(0x4bf2ff, 6.6);
rimLight.position.set(-1000, -700, -900);
scene.add(rimLight);

// Soft camera fill light
const camLight = new THREE.PointLight(0x9bc2ff, 5.4, 1600);
scene.add(camLight);

// --- Procedural Textures ---
function createStarTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
  gradient.addColorStop(0.12, "rgba(240, 250, 255, 0.95)");
  gradient.addColorStop(0.35, "rgba(140, 195, 255, 0.45)");
  gradient.addColorStop(0.7, "rgba(60, 120, 255, 0.12)");
  gradient.addColorStop(1.0, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  return texture;
}

function createNebulaTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0.0, "rgba(120, 160, 255, 0.35)");
  gradient.addColorStop(0.3, "rgba(130, 90, 240, 0.2)");
  gradient.addColorStop(0.65, "rgba(50, 160, 255, 0.07)");
  gradient.addColorStop(1.0, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

const starTexture = createStarTexture();
const nebulaTexture = createNebulaTexture();

// --- Star Palette ---
const starPalette = [
  new THREE.Color("#ffffff"),
  new THREE.Color("#e6f1ff"),
  new THREE.Color("#a2c8ff"),
  new THREE.Color("#7ee7ff"),
  new THREE.Color("#ffecc9"),
  new THREE.Color("#ffcca3"),
  new THREE.Color("#e7b8ff"),
];

// --- Starfield Shader Materials (Seamless Loop & Center Fade) ---
const starVertexShader = `
  uniform float uScroll;
  uniform float uDepth;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uVelocity;
  uniform vec2 uResolution;
  uniform vec2 uHoleCenter;

  attribute vec3 aColor;
  attribute float aSize;
  attribute float aTwinkleSpeed;
  attribute float aTwinkleOffset;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;

    // Seamless toroidal infinite loop along Z (forward motion with +uScroll)
    float z = mod(position.z + uScroll + uDepth * 0.5, uDepth) - uDepth * 0.5;
    
    vec3 worldPos = vec3(position.xy, z);
    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float dist = -mvPosition.z;

    // 1. Center Fade anchored to a projected world point (doesn't follow camera)
    vec2 ndc = gl_Position.xy / max(gl_Position.w, 0.0001);
    ndc.x *= (uResolution.x / uResolution.y);
    vec2 holeCenter = vec2(uHoleCenter.x * (uResolution.x / uResolution.y), uHoleCenter.y);
    float screenRadius = length(ndc - holeCenter);

    // Center fade away: stars fade away smoothly towards the screen center
    float screenCenterFade = smoothstep(0.22, 0.68, screenRadius);
    float worldRadius = length(position.xy);
    float worldCenterFade = smoothstep(110.0, 280.0, worldRadius);

    // 2. Seamless depth boundaries
    float nearFade = smoothstep(30.0, 160.0, dist);
    float farBoundary = uDepth * 0.5;
    float farFade = smoothstep(farBoundary, farBoundary * 0.75, dist);

    // 3. Subtle star twinkling
    float twinkle = 0.82 + 0.18 * sin(uTime * aTwinkleSpeed + aTwinkleOffset);

    vAlpha = screenCenterFade * worldCenterFade * nearFade * farFade * twinkle * 1.6;

    float speedBoost = 1.0 + min(abs(uVelocity) * 0.03, 1.4);
    gl_PointSize = (aSize * speedBoost * (620.0 / max(dist, 10.0))) * uPixelRatio;
    gl_PointSize = clamp(gl_PointSize, 1.0, 220.0);
  }
`;

const starFragmentShader = `
  uniform sampler2D uTexture;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.002) discard;

    vec4 tex = texture2D(uTexture, gl_PointCoord);
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
  }
`;

// Uniforms
const uniforms = {
  uScroll: { value: 0.0 },
  uDepth: { value: CONFIG.spaceDepth },
  uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
  uTime: { value: 0.0 },
  uVelocity: { value: 0.0 },
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uHoleCenter: { value: new THREE.Vector2(0, 0) },
  uTexture: { value: starTexture },
};

const starMaterial = new THREE.ShaderMaterial({
  vertexShader: starVertexShader,
  fragmentShader: starFragmentShader,
  uniforms: uniforms,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

// Build Star Geometry
const starGeo = new THREE.BufferGeometry();
const starPositions = new Float32Array(CONFIG.starCount * 3);
const starColors = new Float32Array(CONFIG.starCount * 3);
const starSizes = new Float32Array(CONFIG.starCount);
const starTwinkleSpeed = new Float32Array(CONFIG.starCount);
const starTwinkleOffset = new Float32Array(CONFIG.starCount);

for (let i = 0; i < CONFIG.starCount; i++) {
  const i3 = i * 3;

  const spread = Math.pow(Math.random(), 0.65);
  const angle = Math.random() * Math.PI * 2;
  const radius = 60 + spread * (CONFIG.spaceWidth / 2);

  starPositions[i3] = Math.cos(angle) * radius;
  starPositions[i3 + 1] = (Math.sin(angle) * radius * CONFIG.spaceHeight) / CONFIG.spaceWidth;
  starPositions[i3 + 2] = (Math.random() - 0.5) * CONFIG.spaceDepth;

  const color = starPalette[Math.floor(Math.random() * starPalette.length)];
  starColors[i3] = color.r;
  starColors[i3 + 1] = color.g;
  starColors[i3 + 2] = color.b;

  const rand = Math.random();
  if (rand > 0.988) {
    starSizes[i] = 16.0;
  } else if (rand > 0.88) {
    starSizes[i] = 8.5;
  } else {
    starSizes[i] = 3.0 + Math.random() * 3.0;
  }

  starTwinkleSpeed[i] = 1.5 + Math.random() * 4.0;
  starTwinkleOffset[i] = Math.random() * Math.PI * 2;
}

starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
starGeo.setAttribute("aColor", new THREE.BufferAttribute(starColors, 3));
starGeo.setAttribute("aSize", new THREE.BufferAttribute(starSizes, 1));
starGeo.setAttribute("aTwinkleSpeed", new THREE.BufferAttribute(starTwinkleSpeed, 1));
starGeo.setAttribute("aTwinkleOffset", new THREE.BufferAttribute(starTwinkleOffset, 1));

const starField = new THREE.Points(starGeo, starMaterial);
scene.add(starField);

// --- Volumetric Nebula Dust Clouds (with Center Fade) ---
const nebulaUniforms = {
  uScroll: uniforms.uScroll,
  uDepth: uniforms.uDepth,
  uPixelRatio: uniforms.uPixelRatio,
  uTime: uniforms.uTime,
  uVelocity: uniforms.uVelocity,
  uResolution: uniforms.uResolution,
  uHoleCenter: uniforms.uHoleCenter,
  uTexture: { value: nebulaTexture },
};

const nebulaVertexShader = `
  uniform float uScroll;
  uniform float uDepth;
  uniform float uPixelRatio;
  uniform vec2 uResolution;
  uniform vec2 uHoleCenter;

  attribute vec3 aColor;
  attribute float aSize;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;

    float z = mod(position.z + uScroll + uDepth * 0.5, uDepth) - uDepth * 0.5;
    vec3 worldPos = vec3(position.xy, z);
    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float dist = -mvPosition.z;

    vec2 ndc = gl_Position.xy / max(gl_Position.w, 0.0001);
    ndc.x *= (uResolution.x / uResolution.y);
    vec2 holeCenter = vec2(uHoleCenter.x * (uResolution.x / uResolution.y), uHoleCenter.y);
    float screenRadius = length(ndc - holeCenter);

    float screenCenterFade = smoothstep(0.25, 0.70, screenRadius);
    float worldRadius = length(position.xy);
    float worldCenterFade = smoothstep(120.0, 320.0, worldRadius);

    float nearFade = smoothstep(40.0, 200.0, dist);
    float farBoundary = uDepth * 0.5;
    float farFade = smoothstep(farBoundary, farBoundary * 0.7, dist);

    vAlpha = screenCenterFade * worldCenterFade * nearFade * farFade * 0.38;

    gl_PointSize = (aSize * (600.0 / max(dist, 10.0))) * uPixelRatio;
    gl_PointSize = clamp(gl_PointSize, 5.0, 500.0);
  }
`;

const nebulaFragmentShader = `
  uniform sampler2D uTexture;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.001) discard;
    vec4 tex = texture2D(uTexture, gl_PointCoord);
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
  }
`;

const nebulaMaterial = new THREE.ShaderMaterial({
  vertexShader: nebulaVertexShader,
  fragmentShader: nebulaFragmentShader,
  uniforms: nebulaUniforms,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const nebulaGeo = new THREE.BufferGeometry();
const nebulaPositions = new Float32Array(CONFIG.nebulaCount * 3);
const nebulaColors = new Float32Array(CONFIG.nebulaCount * 3);
const nebulaSizes = new Float32Array(CONFIG.nebulaCount);

const nebulaColorsList = [
  new THREE.Color("#18325a"),
  new THREE.Color("#301a52"),
  new THREE.Color("#0c384d"),
  new THREE.Color("#1a1a45"),
];

for (let i = 0; i < CONFIG.nebulaCount; i++) {
  const i3 = i * 3;
  nebulaPositions[i3] = (Math.random() - 0.5) * (CONFIG.spaceWidth * 1.3);
  nebulaPositions[i3 + 1] = (Math.random() - 0.5) * (CONFIG.spaceHeight * 1.3);
  nebulaPositions[i3 + 2] = (Math.random() - 0.5) * CONFIG.spaceDepth;

  const color = nebulaColorsList[Math.floor(Math.random() * nebulaColorsList.length)];
  nebulaColors[i3] = color.r;
  nebulaColors[i3 + 1] = color.g;
  nebulaColors[i3 + 2] = color.b;

  nebulaSizes[i] = 180.0 + Math.random() * 220.0;
}

nebulaGeo.setAttribute("position", new THREE.BufferAttribute(nebulaPositions, 3));
nebulaGeo.setAttribute("aColor", new THREE.BufferAttribute(nebulaColors, 3));
nebulaGeo.setAttribute("aSize", new THREE.BufferAttribute(nebulaSizes, 1));

const nebulaField = new THREE.Points(nebulaGeo, nebulaMaterial);
scene.add(nebulaField);

// ==========================================
// --- 3D Floating Models & Zero-Gravity Physics ---
// ==========================================

const MODEL_FILENAMES = [
  "satellite.glb",
  "laptop.glb",
  "panasonic_nv-m50_vhs_video_camera.glb",
  "sony_mdr-7506_headphones.glb",
  "radio_transistor.glb",
  "office_pc.glb",
  "antenna_0.8m.glb",
  "server_cabinet_test_-_argos.glb",
  "speaker_silver.glb",
  "logitech_audio_speaker.glb",
  "scp_radio.glb",
  "laptop (1).glb",
  "dj_controller.glb",
  "iphone_5s.glb",
  "low-poly_radar_dish.glb",
  "monitor.glb",
  "old_pc.glb",
  "oscillograph.glb",
  "pc_mouse_type-r.glb",
  "wi-fi_router.glb",
  "xbox_wireless_controller_3d_scan_data.glb",
  "xenyx_music_mixer.glb",
  "yamaha_mv1602_-_vintage_rack_mount_mixer.glb",
];

const floatingObjects = [];
const interactableMeshes = [];
const floatingBodiesMap = new Map();
let nextBodyId = 1;
const gltfLoader = new GLTFLoader();

// Helper to spawn a floating object with zero gravity state
function setupFloatingObject(rootMesh, fileName, index, totalCount) {
  // Compute bounds and re-center pivot
  const box = new THREE.Box3().setFromObject(rootMesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  rootMesh.position.sub(center);

  // Normalize scale so models look great together in space
  const maxDim = Math.max(size.x, size.y, size.z);
  const targetDimension = 65.0; // Units in 3D world
  const normScale = targetDimension / (maxDim || 1);

  const wrapper = new THREE.Group();
  wrapper.add(rootMesh);
  wrapper.scale.setScalar(normScale);

  // Fully random spatial placement: random angle, radius and height
  // kept away from the center corridor so objects don't crowd the view
  const angle = Math.random() * Math.PI * 2;
  const radius = 200 + Math.random() * 480;
  const posX = Math.cos(angle) * radius;
  const posY = Math.sin(angle) * radius * (0.5 + Math.random() * 0.5);
  const posZ = (Math.random() - 0.5) * CONFIG.spaceDepth;

  const baseDrift = new THREE.Vector3(
    (Math.random() - 0.5) * 0.04,
    (Math.random() - 0.5) * 0.04,
    (Math.random() - 0.5) * 0.04
  );
  const baseSpin = new THREE.Vector3(
    (Math.random() - 0.5) * 0.002,
    (Math.random() - 0.5) * 0.002,
    (Math.random() - 0.5) * 0.002
  );

  const bodyId = nextBodyId++;
  const floatingBody = {
    id: bodyId,
    group: wrapper,
    fileName: fileName,
    cosmicPos: new THREE.Vector3(posX, posY, posZ),
    baseDrift: baseDrift,
    baseSpin: baseSpin,
    linearVelocity: baseDrift.clone(),
    angularVelocity: baseSpin.clone(),
  };

  floatingBodiesMap.set(bodyId, floatingBody);

  // Register all child meshes for raycasting using bodyId
  wrapper.traverse((child) => {
    if (child.isMesh) {
      child.userData.bodyId = bodyId;
      interactableMeshes.push(child);
    }
  });

  // Random initial rotation
  wrapper.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  );

  scene.add(wrapper);
  floatingObjects.push(floatingBody);
}

// Load all 23 models and populate space
let spawnIndex = 0;
const COPIES_PER_MODEL = 4; // 4x density to fill the deeper field
const totalToSpawn = MODEL_FILENAMES.length * COPIES_PER_MODEL; // 92 objects

MODEL_FILENAMES.forEach((filename) => {
  const modelUrl = `/3d/${encodeURIComponent(filename)}`;
  gltfLoader.load(
    modelUrl,
    (gltf) => {
      // Spawn 4 scattered copies of every model
      for (let c = 0; c < COPIES_PER_MODEL && spawnIndex < totalToSpawn; c++) {
        const instance = c === 0 ? gltf.scene : gltf.scene.clone(true);
        setupFloatingObject(instance, filename, spawnIndex++, totalToSpawn);
      }
    },
    undefined,
    (err) => {
      console.warn(`Could not load model: ${filename}`, err);
    }
  );
});

// --- Raycasting, 3D Drag & Throw Physics ---
const raycaster = new THREE.Raycaster();
const mouseCoords = new THREE.Vector2(-999, -999);

function getIntersects(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseCoords.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouseCoords.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseCoords, camera);
  return raycaster.intersectObjects(interactableMeshes, true);
}

// Active Dragging State
let activeDrag = null;

// Pointer Down: Grab object
window.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // Left click / touch only

  const intersects = getIntersects(e.clientX, e.clientY);
  if (intersects.length > 0) {
    const hit = intersects[0];
    const bodyId = hit.object.userData.bodyId;
    const body = floatingBodiesMap.get(bodyId);
    if (body) {
      // Create a drag plane passing through hit point facing camera
      const planeNormal = new THREE.Vector3();
      camera.getWorldDirection(planeNormal).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, hit.point);

      // Offset from hit point to object's current position
      const objWorldPos = body.group.position.clone();
      const offset = hit.point.clone().sub(objWorldPos);

      activeDrag = {
        body: body,
        plane: plane,
        offset: offset,
        history: [{ pos: objWorldPos.clone(), time: performance.now() }],
        startClient: { x: e.clientX, y: e.clientY },
      };

      // Stop previous velocity while held
      body.linearVelocity.set(0, 0, 0);
      container.style.cursor = "grabbing";
    }
  }
});

// Pointer Move: Drag object & track throw velocity
window.addEventListener("pointermove", (e) => {
  if (activeDrag) {
    container.style.cursor = "grabbing";

    // Update ray from pointer
    const rect = renderer.domElement.getBoundingClientRect();
    mouseCoords.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseCoords.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseCoords, camera);

    const hitPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(activeDrag.plane, hitPoint)) {
      const targetWorldPos = hitPoint.sub(activeDrag.offset);
spa
      // Target cosmic coordinate
      const targetCosmic = new THREE.Vector3(
        targetWorldPos.x,
        targetWorldPos.y,
        targetWorldPos.z - currentScroll
      );

      // Smooth laggy follow while dragging (heavy tactile feel)
      activeDrag.body.cosmicPos.lerp(targetCosmic, 0.45);

      // Record position history for throw velocity calculation
      const now = performance.now();
      activeDrag.history.push({ pos: targetWorldPos.clone(), time: now });
      while (activeDrag.history.length > 1 && now - activeDrag.history[0].time > 90) {
        activeDrag.history.shift();
      }

      // Sluggish rotational tilt in the direction of drag motion
      if (activeDrag.history.length >= 2) {
        const oldest = activeDrag.history[0];
        const newest = activeDrag.history[activeDrag.history.length - 1];
        const dt = Math.max((newest.time - oldest.time) / 1000, 0.001);
        const vx = (newest.pos.x - oldest.pos.x) / dt;
        const vy = (newest.pos.y - oldest.pos.y) / dt;
        activeDrag.body.angularVelocity.x = -vy * 0.00015;
        activeDrag.body.angularVelocity.y = vx * 0.00015;
      }
    }
    return;
  }

  // Not dragging: check hover state
  const intersects = getIntersects(e.clientX, e.clientY);
  if (intersects.length > 0 && intersects[0].object.userData.bodyId) {
    container.style.cursor = "grab";
  } else {
    container.style.cursor = "default";
  }

  // Camera parallax steering
  const normX = (e.clientX / window.innerWidth) * 2 - 1;
  const normY = -(e.clientY / window.innerHeight) * 2 + 1;
  mouse.targetX = normX * 0.28;
  mouse.targetY = normY * 0.18;
});

// Pointer Up: Release or Throw with velocity mechanics
window.addEventListener("pointerup", (e) => {
  if (!activeDrag) return;

  const distMoved = Math.hypot(
    e.clientX - activeDrag.startClient.x,
    e.clientY - activeDrag.startClient.y
  );

  if (distMoved < 7) {
    // Subtle touch nudge (moves a little, no glow)
    const pushDir = raycaster.ray.direction.clone().normalize();
    activeDrag.body.linearVelocity.add(pushDir.multiplyScalar(CONFIG.pushForce));
    activeDrag.body.angularVelocity.add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.004,
        (Math.random() - 0.5) * 0.004,
        (Math.random() - 0.5) * 0.004
      )
    );
  } else {
    // THROWN with velocity mechanics!
    const h = activeDrag.history;
    const throwVel = new THREE.Vector3();

    if (h.length >= 2) {
      const oldest = h[0];
      const newest = h[h.length - 1];
      const dt = Math.max((newest.time - oldest.time) / 1000, 0.016);
      const deltaPos = newest.pos.clone().sub(oldest.pos);
      // Normalized throw speed (units per frame at 60fps)
      throwVel.copy(deltaPos).divideScalar(dt * 60);
    }

    // Clamp throw velocity to maintain zero-g momentum without vanishing
    throwVel.clampLength(0, 8.5);
    activeDrag.body.linearVelocity.copy(throwVel);

    // Dynamic rotational tumble imparted by the throw
    activeDrag.body.angularVelocity.set(
      -throwVel.y * 0.004 + (Math.random() - 0.5) * 0.003,
      throwVel.x * 0.004 + (Math.random() - 0.5) * 0.003,
      (throwVel.x - throwVel.y) * 0.003 + (Math.random() - 0.5) * 0.003
    );
  }

  activeDrag = null;
  container.style.cursor = "default";
});

window.addEventListener("pointercancel", () => {
  if (activeDrag) {
    activeDrag = null;
    container.style.cursor = "default";
  }
});

// --- Scroll & Navigation State ---
let targetScroll = 0.0;
let currentScroll = 0.0;
let spaceScroll = 0.0; // Freezes at PROJECT_SCROLL_START each loop pass
let velocity = 0.0;

// Project showcase skip state: a burst of fast scrolling dismisses the
// showcase and hands control back to the space scroll.
let projectSkipped = false;
let skipOffset = null;       // Keeps spaceScroll continuous at the skip moment
let freezeOffset = 0;        // Carries skip distance back into the freeze math
let lastLoopIdx = 0;         // Detects loop wraps to reset freezeOffset
let loopScrollNow = 0.0;     // Latest loop position (for event handlers)
let wheelEnergy = 0.0;       // Accumulated recent scroll magnitude
let lastWheelTime = 0;
let parallaxScale = 1.0;     // Dampens mouse parallax while space is frozen
let spaceAnimTime = -1;      // Shader clock that halts during the showcase
let stage1TextShift = 0;     // Remembered showcase-1 text scroll (winds both ways)
let stage1Dwell = 0;         // Scroll spent past the text bottom, arms the release
let stage2TextShift = 0;     // Same remembered scroll for showcase 2
let stage2Dwell = 0;
let stage3TextShift = 0;     // Same remembered scroll for showcase 3
let stage3Dwell = 0;
let prevCrawlLoopScroll = null; // Last frame's loopScroll for wrap-safe deltas
let skipStartSpace = null;   // Space position at the moment the skip fired

// Mouse Parallax Steering
const mouse = {
  targetX: 0,
  targetY: 0,
  currentX: 0,
  currentY: 0,
};

// World-space anchor for the starfield center-fade hole
const holeAnchorWorld = new THREE.Vector3();

// Wheel: Scroll Forward / Backward
window.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const delta = e.deltaY;
    targetScroll += delta * CONFIG.scrollSensitivity;

    // A hard flick of fast scrolling while the showcase is up skips it
    const now = performance.now();
    if (now - lastWheelTime > 220) wheelEnergy = 0;
    lastWheelTime = now;
    wheelEnergy += Math.abs(delta);
    if (!projectSkipped && wheelEnergy > 650 && loopScrollNow >= PROJECT_SCROLL_START - 100) {
      projectSkipped = true;
    }
  },
  { passive: false }
);

// Mouse Move Parallax
window.addEventListener("mousemove", (e) => {
  const normX = (e.clientX / window.innerWidth) * 2 - 1;
  const normY = -(e.clientY / window.innerHeight) * 2 + 1;

  mouse.targetX = normX * 0.28;
  mouse.targetY = normY * 0.18;
});

// Touch Navigation for Mobile
let touchStartY = 0;
window.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length > 0) {
      touchStartY = e.touches[0].clientY;
    }
  },
  { passive: true }
);

window.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 0) {
      const currentY = e.touches[0].clientY;
      const deltaY = touchStartY - currentY;
      touchStartY = currentY;
      targetScroll += deltaY * CONFIG.scrollSensitivity * 2.5;

      // Same fast-scroll skip on touch (touch deltas are smaller, scale up)
      const now = performance.now();
      if (now - lastWheelTime > 220) wheelEnergy = 0;
      lastWheelTime = now;
      wheelEnergy += Math.abs(deltaY) * 8;
      if (!projectSkipped && wheelEnergy > 650 && loopScrollNow >= PROJECT_SCROLL_START - 100) {
        projectSkipped = true;
      }
    }
  },
  { passive: true }
);

// Keyboard controls (Arrow keys or W/S)
const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

function handleKeyboard() {
  const speed = keys["shift"] ? 35 : 12;
  if (keys["arrowup"] || keys["w"]) {
    targetScroll += speed;
  }
  if (keys["arrowdown"] || keys["s"]) {
    targetScroll -= speed;
  }
}

// Window Resize
window.addEventListener("resize", () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  uniforms.uResolution.value.set(width, height);
  uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
});

// --- Animation Loop ---
let lastTime = performance.now();

function animate(currentTime) {
  requestAnimationFrame(animate);

  const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;

  handleKeyboard();

  // Subtle natural idle drift forward
  targetScroll += CONFIG.driftSpeed;

  // Damped smooth lerp towards target scroll
  currentScroll += (targetScroll - currentScroll) * CONFIG.lerpFactor;

  // Space scroll freezes at the project showcase (loop position 9400) unless
  // the user fast-scrolled to skip it; skipOffset keeps motion continuous.
  const loopIdx = Math.floor(currentScroll / CONFIG.spaceDepth);
  if (loopIdx !== lastLoopIdx) {
    lastLoopIdx = loopIdx;
    freezeOffset = 0; // New loop pass: clear any carried skip offset
    // New lap: the showcases are fresh again, forget the text scroll state
    stage1TextShift = 0;
    stage1Dwell = 0;
    stage2TextShift = 0;
    stage2Dwell = 0;
    stage3TextShift = 0;
    stage3Dwell = 0;
  }
  const base = loopIdx * CONFIG.spaceDepth;
  // Three freeze stops per loop pass — the project showcases. Bands are
  // defined in space coordinates with +100 hysteresis so scrolling back
  // through a bound cleanly re-selects it.
  const freezeBound =
    base +
    (spaceScroll < base + PROJECT_SCROLL_START + 100
      ? PROJECT_SCROLL_START
      : spaceScroll < base + PROJECT2_SCROLL_START + 100
        ? PROJECT2_SCROLL_START
        : spaceScroll < base + PROJECT3_SCROLL_START + 100
          ? PROJECT3_SCROLL_START
          : Infinity);
  const prevSpaceScroll = spaceScroll;
  if (projectSkipped) {
    if (skipOffset === null) {
      skipOffset = currentScroll - spaceScroll;
      skipStartSpace = spaceScroll;
    }
    spaceScroll = currentScroll - skipOffset;
    // Scrolled back past where space sat when the video was up -> hand
    // control back to the showcase; or arrived at the next showcase while
    // still skipped -> land the freeze there. Both keep space continuous.
    if (
      spaceScroll < skipStartSpace - 20 ||
      (skipStartSpace < base + PROJECT_SCROLL_START + 500 &&
        spaceScroll >= base + PROJECT2_SCROLL_START - 20) ||
      (skipStartSpace < base + PROJECT2_SCROLL_START + 500 &&
        spaceScroll >= base + PROJECT3_SCROLL_START - 20)
    ) {
      projectSkipped = false;
      wheelEnergy = 0;
      freezeOffset = skipOffset;
      skipOffset = null;
      skipStartSpace = null;
    }
  } else {
    // Space is just scroll position clamped at the active freeze bound —
    // forward scrolling parks it, back-scrolling lets it retreat, so the
    // showcases engage purely on where space actually is.
    spaceScroll = Math.min(currentScroll - freezeOffset, freezeBound);
  }
  velocity = (spaceScroll - prevSpaceScroll) / (delta * 60);

  // Debug state for inspection
  window.__state = {
    cur: Math.round(currentScroll),
    loop: Math.round(loopScrollNow),
    space: Math.round(spaceScroll),
    skipped: projectSkipped,
    sss: skipStartSpace === null ? null : Math.round(skipStartSpace),
    fOff: Math.round(freezeOffset),
  };

  // All space motion halts while a showcase bound holds the scroll
  const spaceFrozen = !projectSkipped && spaceScroll >= freezeBound - 20;

  // Frozen shader clock: twinkle and any uTime-driven motion pause
  if (spaceAnimTime < 0) spaceAnimTime = currentTime * 0.001;
  if (!spaceFrozen) spaceAnimTime += delta;

  // Fade mouse parallax out while frozen so the background is truly still
  parallaxScale += ((spaceFrozen ? 0 : 1) - parallaxScale) * Math.min(1, delta * 5);

  // Update Shader Uniforms
  uniforms.uScroll.value = spaceScroll;
  uniforms.uVelocity.value = velocity;
  uniforms.uTime.value = spaceAnimTime;

  // Smooth mouse parallax look-at
  mouse.currentX += (mouse.targetX - mouse.currentX) * 0.06;
  mouse.currentY += (mouse.targetY - mouse.currentY) * 0.06;

  camera.rotation.y = -mouse.currentX * 0.8 * parallaxScale;
  camera.rotation.x = mouse.currentY * 0.8 * parallaxScale;

  // Camera light follows viewer position
  camLight.position.copy(camera.position);

  // Subtle continuous slow rotation of background stars (frozen during showcase)
  if (!spaceFrozen) {
    starField.rotation.z += 0.0001;
    nebulaField.rotation.z -= 0.00006;
  }

  // --- Update Floating 3D Models Physics & Infinite Looping ---
  const halfDepth = CONFIG.spaceDepth / 2;

  for (let i = 0; i < floatingObjects.length; i++) {
    const obj = floatingObjects[i];

    // Don't apply physics drift/tumble if actively held and dragged by user,
    // and freeze all object motion while the showcase video is playing
    if (!spaceFrozen && (!activeDrag || activeDrag.body !== obj)) {
      // 1. Zero-gravity continuous drift
      obj.cosmicPos.add(obj.linearVelocity);

      // 2. Zero-gravity continuous tumble
      obj.group.rotation.x += obj.angularVelocity.x;
      obj.group.rotation.y += obj.angularVelocity.y;
      obj.group.rotation.z += obj.angularVelocity.z;

      // 3. Laggy zero-gravity settling: smoothly decays the throw / touch impulse back to tranquil drift
      obj.linearVelocity.lerp(obj.baseDrift, 0.035);
      obj.angularVelocity.lerp(obj.baseSpin, 0.025);
    }

    // 4. Seamless toroidal looping along Z synchronized with scroll
    let relZ = ((obj.cosmicPos.z + spaceScroll + halfDepth) % CONFIG.spaceDepth);
    if (relZ < 0) relZ += CONFIG.spaceDepth;
    relZ -= halfDepth;

    obj.group.position.set(obj.cosmicPos.x, obj.cosmicPos.y, relZ);

    // 5. Boundary fading (prevent hard popping when looping near far/near planes)
    const dist = -relZ; // Distance in front of camera
    let alpha = 1.0;
    if (dist < 40) {
      alpha = Math.max(0, (dist - 10) / 30);
    } else if (dist > halfDepth * 0.75) {
      alpha = Math.max(0, (halfDepth - dist) / (halfDepth * 0.25));
    }

    obj.group.visible = alpha > 0.01 && dist > 8;
  }

  // --- Update Star Wars Crawl Scroll Progression (Sequential Stages) ---
  if (crawlIntro && crawlStage1 && crawlStage2 && crawlStage3) {
    const loopDepth = CONFIG.spaceDepth;
    let loopScroll = ((currentScroll % loopDepth) + loopDepth) % loopDepth;
    loopScrollNow = loopScroll;

    // Wrap-safe loop delta so the showcase text columns animate forward AND
    // backward with the wheel, persisting their scroll position per visit.
    let loopDelta = 0;
    if (prevCrawlLoopScroll !== null) {
      loopDelta = loopScroll - prevCrawlLoopScroll;
      if (loopDelta > loopDepth / 2) loopDelta -= loopDepth;
      else if (loopDelta < -loopDepth / 2) loopDelta += loopDepth;
    }
    prevCrawlLoopScroll = loopScroll;

    // Camera turns are driven by SPACE position so they always match what
    // the starfield actually shows, regardless of scroll state.
    const spaceLoop = ((spaceScroll % loopDepth) + loopDepth) % loopDepth;
    // Turns 90 degrees left as the crawl exits (space 7400→9400)
    const camPan = THREE.MathUtils.smoothstep(spaceLoop, 7400, 9400);
    camera.rotation.y += camPan * (Math.PI / 2);
    // Sweeps 180° right into cekigrep (space 11300→12500)
    const camPanRight = THREE.MathUtils.smoothstep(spaceLoop, 11300, 12500);
    camera.rotation.y -= camPanRight * Math.PI;
    // Turns 180° back left as cekigrep exits (space 14600→15600)
    const camPanLeft = THREE.MathUtils.smoothstep(spaceLoop, 14600, 15600);
    camera.rotation.y += camPanLeft * Math.PI;
    // Turns 90° right past the last showcase (space 17500→18100)
    const camPanRight2 = THREE.MathUtils.smoothstep(spaceLoop, 17500, 18100);
    camera.rotation.y -= camPanRight2 * (Math.PI / 2);

    // Anchor the center-fade hole to the world tunnel axis so it stays put
    // in the starfield instead of following the camera pan.
    camera.updateMatrixWorld();
    holeAnchorWorld.set(0, 0, -3000).project(camera);
    uniforms.uHoleCenter.value.set(holeAnchorWorld.x, holeAnchorWorld.y);

    // Helper to position and fade each stage independently
    function renderStage(el, scroll, startScroll, endScroll, startY, speed) {
      if (!el) return;
      const duration = endScroll - startScroll;
      const fadeIn = Math.min(220, duration * 0.22);
      const fadeOut = Math.min(320, duration * 0.32);
      // Stage 1 wraps around the loop seam, so it gets a wider lead-in window
      // to fade up smoothly instead of popping into view at the loop boundary.
      const leadIn = startScroll <= 0 ? 300 : 50;
      if (scroll < startScroll - leadIn || scroll > endScroll + 50) {
        el.style.opacity = "0";
        el.style.visibility = "hidden";
        return;
      }

      const stageScroll = scroll - startScroll;
      const currentY = startY - stageScroll * speed;

      let opacity = 1.0;
      if (stageScroll < 0) {
        // Loop-wrap lead-in (Stage 1 only): fade up as it rises into place
        opacity = startScroll <= 0 ? Math.max(0, 1 + stageScroll / leadIn) : 0;
      } else if (startScroll > 0 && stageScroll < fadeIn) {
        opacity = Math.max(0, stageScroll / fadeIn);
      } else if (stageScroll > duration - fadeOut) {
        opacity = Math.max(0, (duration - stageScroll) / fadeOut);
      }

      el.style.transform = `translate3d(0, ${currentY}px, 0)`;
      el.style.opacity = opacity.toFixed(3);
      el.style.visibility = opacity > 0.005 ? "visible" : "hidden";
    }

    // Stage 1: "Hello, I'm Elcan Ismayilov." (Active from 0 to 1300)
    let stage1Scroll = loopScroll;
    if (loopScroll > loopDepth - 500) {
      stage1Scroll = loopScroll - loopDepth;
    }
    renderStage(crawlStage1, stage1Scroll, 0, 1300, window.innerHeight * 0.44, 0.42);

    // Stage 2: "I'm a Systems Architecture & Full Stack Software Engineer." (Active from 1350 to 2800)
    // ONLY appears after Stage 1 has completely disappeared!
    renderStage(crawlStage2, loopScroll, 1350, 2800, window.innerHeight * 0.48, 0.42);

    // Stage 3: Two narrative paragraphs with React (Active from 2850 to 5800)
    // ONLY appears after Stage 2 has completely disappeared!
    renderStage(crawlStage3, loopScroll, 2850, 5800, window.innerHeight * 0.58, 0.46);

    // Stage 4: "Projects" big title (Active from 5900 to 7400)
    // ONLY appears after Stage 3 has completely disappeared!
    renderStage(crawlStage4, loopScroll, 5900, 7400, window.innerHeight * 0.5, 0.42);

    // Dark backdrop behind the text: fades away across the text phase and beyond
    // (fully black at Stage 1, fully gone at scroll 7600 — after Stage 3 ends at 5800),
    // then eases back in over the last stretch of the loop for a soft wrap.
    if (crawlShade) {
      const fadeOut = Math.max(0, Math.min(1, 1 - loopScroll / 7600));
      const wrapFade = 2000;
      const fadeIn = Math.max(0, Math.min(1, (loopScroll - (loopDepth - wrapFade)) / wrapFade));
      const shadeOpacity = Math.min(1, Math.max(fadeOut, fadeIn));
      crawlShade.style.opacity = shadeOpacity.toFixed(3);
    }

    // Readouts: top-left shows the camera's virtual Z coordinate in the
    // tunnel (cumulative travel distance), top-right the loop position.
    if (spaceHud) spaceHud.textContent = `CAM Z ${Math.round(spaceScroll)}`;
    if (scrollHud) {
      scrollHud.textContent = `${Math.round(spaceLoop)} / ${loopDepth}`;
    }

    // --- Project Showcase (scroll 9400+): space frozen, videos looping,
    // left text column slides up with the wheel ---
    if (projectStage) {
      // Videos are gated on SPACE position — they appear exactly where the
      // freeze bounds hold space, fade in on approach and out on departure.
      const show = THREE.MathUtils.clamp((spaceLoop - (PROJECT_SCROLL_START - 600)) / 600, 0, 1);
      // Peak plateau 9400→11000, then fade out 11000→11600.
      const exit1 =
        1 - THREE.MathUtils.smoothstep(spaceLoop, PROJECT_SCROLL_START + 1600, PROJECT_SCROLL_START + 2200);
      // Pure position-driven opacity: identical forwards and backwards —
      // nothing ever suppresses it.
      const stageOpacity = show * exit1;
      projectStage.style.opacity = stageOpacity.toFixed(3);
      projectStage.style.visibility = stageOpacity > 0.005 ? "visible" : "hidden";

      // Videos only run while the showcase is on screen
      const stage1On = stageOpacity > 0.005;
      projectVideos.forEach((v) => {
        if (stage1On && v.paused) v.play().catch(() => {});
        else if (!stage1On && !v.paused) v.pause();
      });

      if (projectTextInner) {
        const parent = projectTextInner.parentElement;
        const maxShift = Math.max(0, projectTextInner.scrollHeight - parent.clientHeight);

        // While the video is on screen the column winds with the wheel in
        // BOTH directions — scrolling back rewinds the text, and the shift
        // persists when the stage is left so re-entry restores it exactly.
        const stage1Engaged =
          spaceLoop > PROJECT_SCROLL_START - 600 &&
          spaceLoop < PROJECT_SCROLL_START + 2200;
        // Fade-in completes exactly at the bound — the column only scrolls
        // down once the video is fully in; rewind works anywhere in-window.
        const stage1Ready = spaceLoop >= PROJECT_SCROLL_START - 2;
        if (stage1Engaged) {
          if (loopDelta < 0 || stage1Ready) {
            stage1TextShift = Math.min(
              Math.max(0, stage1TextShift + loopDelta),
              maxShift
            );
          }
          // Dwell = scroll spent past the text bottom this visit. Rewinding
          // the text or leaving the window re-arms the read.
          if (stage1Ready && stage1TextShift >= maxShift && loopDelta > 0) {
            stage1Dwell += loopDelta;
          }
          if (stage1TextShift < maxShift) stage1Dwell = 0;
        } else {
          stage1Dwell = 0;
        }
        projectTextInner.style.transform = `translate3d(0, ${-Math.min(
          stage1TextShift,
          maxShift
        )}px, 0)`;

        // Release only AT the bound (where space actually parks) after the
        // text is read + 600 dwell. loopDelta>0 keeps backward passes from
        // toggling the skip every frame.
        if (
          !projectSkipped &&
          stage1Ready &&
          stage1Dwell > 600 &&
          loopDelta > 0
        ) {
          projectSkipped = true;
        }
      }
    }

    // --- Project Showcase 2 (parks at 12600): CEKIGREP, centered video ---
    if (project2Stage) {
      // Fade in 12000→12600, peak plateau 12600→14200, fade out 14200→14800.
      const show2 = THREE.MathUtils.clamp((spaceLoop - (PROJECT2_SCROLL_START - 600)) / 600, 0, 1);
      const exit2 =
        1 - THREE.MathUtils.smoothstep(spaceLoop, PROJECT2_SCROLL_START + 1600, PROJECT2_SCROLL_START + 2200);
      const stage2Opacity = show2 * exit2;
      project2Stage.style.opacity = stage2Opacity.toFixed(3);
      project2Stage.style.visibility = stage2Opacity > 0.005 ? "visible" : "hidden";

      // Same for the second showcase video
      const stage2On = stage2Opacity > 0.005;
      project2Videos.forEach((v) => {
        if (stage2On && v.paused) v.play().catch(() => {});
        else if (!stage2On && !v.paused) v.pause();
      });

      if (project2TextInner) {
        const parent2 = project2TextInner.parentElement;
        const maxShift2 = Math.max(0, project2TextInner.scrollHeight - parent2.clientHeight);

        // Same winding + memory as showcase 1: backward scroll rewinds the
        // text, leaving and returning restores the exact scroll position.
        const stage2Engaged =
          spaceLoop > PROJECT2_SCROLL_START - 600 &&
          spaceLoop < PROJECT2_SCROLL_START + 2200;
        const stage2Ready = spaceLoop >= PROJECT2_SCROLL_START - 2;
        if (stage2Engaged) {
          if (loopDelta < 0 || stage2Ready) {
            stage2TextShift = Math.min(
              Math.max(0, stage2TextShift + loopDelta),
              maxShift2
            );
          }
          if (stage2Ready && stage2TextShift >= maxShift2 && loopDelta > 0) {
            stage2Dwell += loopDelta;
          }
          if (stage2TextShift < maxShift2) stage2Dwell = 0;
        } else {
          stage2Dwell = 0;
        }
        project2TextInner.style.transform = `translate3d(0, ${-Math.min(
          stage2TextShift,
          maxShift2
        )}px, 0)`;

        if (
          !projectSkipped &&
          stage2Ready &&
          stage2Dwell > 600 &&
          loopDelta > 0
        ) {
          projectSkipped = true;
        }
      }
    }

    // --- Project Showcase 3 (parks at 15900): GRAILS OF WAR, mobile + PC ---
    if (project3Stage) {
      // Fade in 15300→15900, peak plateau 15900→17100, fade out 17100→17700.
      const show3 = THREE.MathUtils.clamp((spaceLoop - (PROJECT3_SCROLL_START - 600)) / 600, 0, 1);
      const exit3 =
        1 - THREE.MathUtils.smoothstep(spaceLoop, PROJECT3_SCROLL_START + 1200, PROJECT3_SCROLL_START + 1800);
      const stage3Opacity = show3 * exit3;
      project3Stage.style.opacity = stage3Opacity.toFixed(3);
      project3Stage.style.visibility = stage3Opacity > 0.005 ? "visible" : "hidden";

      // Videos only run while the showcase is on screen
      const stage3On = stage3Opacity > 0.005;
      project3Videos.forEach((v) => {
        if (stage3On && v.paused) v.play().catch(() => {});
        else if (!stage3On && !v.paused) v.pause();
      });

      if (project3TextInner) {
        const parent3 = project3TextInner.parentElement;
        const maxShift3 = Math.max(0, project3TextInner.scrollHeight - parent3.clientHeight);

        // Same winding + memory as the other showcases: backward scroll
        // rewinds the text, leaving and returning restores the position.
        const stage3Engaged =
          spaceLoop > PROJECT3_SCROLL_START - 600 &&
          spaceLoop < PROJECT3_SCROLL_START + 1800;
        const stage3Ready = spaceLoop >= PROJECT3_SCROLL_START - 2;
        if (stage3Engaged) {
          if (loopDelta < 0 || stage3Ready) {
            stage3TextShift = Math.min(
              Math.max(0, stage3TextShift + loopDelta),
              maxShift3
            );
          }
          if (stage3Ready && stage3TextShift >= maxShift3 && loopDelta > 0) {
            stage3Dwell += loopDelta;
          }
          if (stage3TextShift < maxShift3) stage3Dwell = 0;
        } else {
          stage3Dwell = 0;
        }
        project3TextInner.style.transform = `translate3d(0, ${-Math.min(
          stage3TextShift,
          maxShift3
        )}px, 0)`;

        if (
          !projectSkipped &&
          stage3Ready &&
          stage3Dwell > 600 &&
          loopDelta > 0
        ) {
          projectSkipped = true;
        }
      }
    }
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

