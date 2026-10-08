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
const warpFlash = document.getElementById("warp-flash");
const cockpitMenu = document.querySelector(".cockpit-menu");
const project3Stage = document.getElementById("project3-stage");
const project3TextInner = document.getElementById("project3-text-inner");
const project3Videos = project3Stage ? [...project3Stage.querySelectorAll("video")] : [];

// Loop positions where space movement freezes and each showcase takes over.
// Stage 2 parks at 11100 — the start of its peak plateau, right where the
// 10500→11100 fade-in completes. Stage 3 parks at 14400 the same way.
const PROJECT_SCROLL_START = 7900;
const PROJECT2_SCROLL_START = 11100;
const PROJECT3_SCROLL_START = 14400;

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

// --- ASCII Post-Processing Pass (glsl-ascii-filter) ---
// The whole screen renders into postTarget first, then a fullscreen quad
// converts it to colored ASCII glyphs. uAscii toggles the effect every 3s.
const postBufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
const postTarget = new THREE.WebGLRenderTarget(postBufferSize.x, postBufferSize.y, {
  samples: 4, // keep MSAA on the offscreen pass
});
const ASCII_CELL = 4; // character cell size in CSS pixels

const postVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const postFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uCell;
  uniform float uAscii;
  uniform float uExposure;
  varying vec2 vUv;

  // ACES filmic (three.js chunk verbatim, renamed to dodge the
  // injected prefix functions with the same names)
  vec3 acesRRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 acesToneMap(vec3 color) {
    const mat3 ACESInput = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777)
    );
    const mat3 ACESOutput = mat3(
      vec3(1.60475, -0.10208, -0.00327),
      vec3(-0.53108, 1.10813, -0.07276),
      vec3(-0.07367, -0.00605, 1.07602)
    );
    color = ACESInput * color;
    color = acesRRTAndODTFit(color);
    color = ACESOutput * color;
    return clamp(color, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
               step(0.0031308, c));
  }

  // glsl-ascii-filter (mattdesl): 5x5 bitmap glyph lookup
  float asciiCharacter(float n, vec2 p) {
    p = floor(p * vec2(4.0, -4.0) + 2.5);
    if (clamp(p.x, 0.0, 4.0) == p.x && clamp(p.y, 0.0, 4.0) == p.y) {
      if (int(mod(n / exp2(p.x + 5.0 * p.y), 2.0)) == 1) return 1.0;
    }
    return 0.0;
  }

  void main() {
    vec3 linear = texture2D(tDiffuse, vUv).rgb;
    vec3 color = toSRGB(acesToneMap(linear * uExposure));

    // One scene sample per character cell so each glyph has a flat color
    vec2 cell = floor(gl_FragCoord.xy / uCell);
    vec2 cellCenterUv = (cell * uCell + uCell * 0.5) / uResolution;
    vec3 cellLinear = texture2D(tDiffuse, cellCenterUv).rgb;
    vec3 cellColor = toSRGB(acesToneMap(cellLinear * uExposure));

    float threshold = dot(cellColor, vec3(0.299, 0.587, 0.114));
    float n = 65536.0;                   // .
    if (threshold > 0.2) n = 65600.0;    // :
    if (threshold > 0.3) n = 332772.0;   // *
    if (threshold > 0.4) n = 15255086.0; // o
    if (threshold > 0.5) n = 23385164.0; // &
    if (threshold > 0.6) n = 15252014.0; // 8
    if (threshold > 0.7) n = 13199452.0; // @
    if (threshold > 0.8) n = 11512810.0; // #

    vec2 local = fract(gl_FragCoord.xy / uCell); // 0..1 within the cell
    vec2 p = local * 1.24 - 0.62; // map cell onto the 5x5 glyph
    float glyph = asciiCharacter(n, p);

    gl_FragColor = vec4(mix(color, cellColor * glyph, uAscii), 1.0);
  }
`;

const postUniforms = {
  tDiffuse: { value: postTarget.texture },
  uResolution: { value: postBufferSize.clone() },
  uCell: { value: ASCII_CELL * renderer.getPixelRatio() },
  uAscii: { value: 0.0 },
  uExposure: { value: renderer.toneMappingExposure },
};

window.__post = postUniforms; // debug handle
window.__renderer = renderer;

// --- Cockpit POV Quad ---
// The cockpit PNG is drawn as ONE textured quad in its own scene, rendered
// as the last pass on top of everything (no DOM overlay = no compositing
// cost). PNG alpha reveals the frame behind it; mouse parallax rotates the
// quad like a real 3D plane for the look-around FOV feel.
const COCKPIT_FOV = 50; // cockpit camera base focal angle
const cockpitScene = new THREE.Scene();
const cockpitCamera = new THREE.PerspectiveCamera(
  COCKPIT_FOV,
  window.innerWidth / window.innerHeight,
  0.01,
  10
);
const cockpitTexture = new THREE.TextureLoader().load(
  "/cockpit/cockpit.webp",
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
);
// Dense grid so the quad can bend into a dish for the warp fisheye
const cockpitPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1, 64, 64),
  new THREE.MeshBasicMaterial({
    map: cockpitTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
);
cockpitScene.add(cockpitPlane);

const COCKPIT_IMG_ASPECT = 1920 / 1071;
const COCKPIT_OVERSIZE = 1.18;
const COCKPIT_DIST = 1;
const cockpitBaseScale = new THREE.Vector3(); // home scale, for warp stretch

// Cover-fit the quad to the view frustum (like object-fit: cover), oversized
// so rotation never exposes edges.
function layoutCockpit() {
  const viewH =
    2 *
    Math.tan(THREE.MathUtils.degToRad(COCKPIT_FOV / 2)) *
    COCKPIT_DIST;
  const viewW = viewH * cockpitCamera.aspect;
  let w = viewW;
  let h = w / COCKPIT_IMG_ASPECT;
  if (h < viewH) {
    h = viewH;
    w = h * COCKPIT_IMG_ASPECT;
  }
  cockpitPlane.scale.set(w * COCKPIT_OVERSIZE, h * COCKPIT_OVERSIZE, 1);
  cockpitPlane.position.z = -COCKPIT_DIST;
  cockpitBaseScale.copy(cockpitPlane.scale);
}
layoutCockpit();

// --- Cockpit Cutout Anchors ---
// Rects in normalized cockpit-image space (u,v = 0..1, v measured from the
// TOP of the 1920x1071 art). Measure in an image editor: u = px/1920,
// v = py/1071. Any DOM element tagged data-cockpit="<name>" gets glued onto
// the matching cutout every frame — it tracks cover-fit, the 1.18 oversize
// AND the mouse-parallax rotation, so it can never drift or overflow at any
// viewport size. mainScreen is measured exactly from cockpit/menuscreen.png
// (black-mask bounds x879..1873, y724..1091 on its 2752x1536 canvas):
const COCKPIT_CUTOUTS = {
  // inset shrinks DOM anchors inside the bezel lip — DOM elements can never
  // be occluded by the canvas, so the box must stop short of the frame
  // edges it would otherwise overflow. screenFill keeps the full rect.
  mainScreen: { u0: 0.3194, v0: 0.4714, u1: 0.681, v1: 0.7109, inset: 0.05 },
  // windowmenu.png windshield trapezoid — alpha bbox x803..1952 / y146..692
  // on its 2752x1536 canvas (cockpit layout x1.4333). No inset: the text
  // column and clip-path in CSS keep content inside the sloped frame.
  windowMenu: { u0: 803 / 2752, v0: 146 / 1536, u1: 1952 / 2752, v1: 692 / 1536 },
};
const _cutoutCorner = new THREE.Vector3();

// Digital screen texture for the menu panel — deep-blue gradient with
// scanlines and edge vignette, baked once into a CanvasTexture.
function createScreenTexture() {
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 512;
  const g = c.getContext("2d");

  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, "#0a2a8f");
  grad.addColorStop(0.5, "#061b63");
  grad.addColorStop(1, "#020b33");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);

  // scanlines
  g.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 1);

  // edge vignettes (left/right then top/bottom)
  const vg = g.createLinearGradient(0, 0, c.width, 0);
  vg.addColorStop(0, "rgba(0,0,20,0.55)");
  vg.addColorStop(0.08, "rgba(0,0,0,0)");
  vg.addColorStop(0.92, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,20,0.55)");
  g.fillStyle = vg;
  g.fillRect(0, 0, c.width, c.height);
  const hg = g.createLinearGradient(0, 0, 0, c.height);
  hg.addColorStop(0, "rgba(0,0,20,0.5)");
  hg.addColorStop(0.1, "rgba(0,0,0,0)");
  hg.addColorStop(0.9, "rgba(0,0,0,0)");
  hg.addColorStop(1, "rgba(0,0,20,0.5)");
  g.fillStyle = hg;
  g.fillRect(0, 0, c.width, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Menu screen fill: an opaque quad UNDER the cockpit PNG — opaque geometry
// draws before the transparent cockpit plane, so the bezel/frame edges
// occlude it like real glass. Parented to cockpitPlane so it inherits
// cover-fit, oversize and parallax with zero extra math.
const _screenCut = COCKPIT_CUTOUTS.mainScreen;
const screenFill = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1, 32, 32),
  new THREE.MeshBasicMaterial({
    map: createScreenTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
);
screenFill.scale.set(
  _screenCut.u1 - _screenCut.u0,
  _screenCut.v1 - _screenCut.v0,
  1
);
screenFill.position.set(
  (_screenCut.u0 + _screenCut.u1) / 2 - 0.5,
  0.5 - (_screenCut.v0 + _screenCut.v1) / 2,
  -0.001
);
cockpitPlane.add(screenFill);

// Window menu overlay: another textured quad like the cockpit PNG. Its
// 2752x1536 canvas is the same cockpit art family as menuscreen.png
// (layout x1.4333), so a unit quad parented to cockpitPlane lands the
// trapezoid exactly where it was drawn — inheriting cover-fit, oversize,
// parallax and the cockpit fade. Drawn IN FRONT of the cockpit PNG.
const windowmenuTexture = new THREE.TextureLoader().load(
  "/cockpit/windowmenu.png",
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
);
const windowmenuPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1, 32, 32),
  new THREE.MeshBasicMaterial({
    map: windowmenuTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
);
windowmenuPlane.renderOrder = 1; // after cockpitPlane + screenFill
// Tilt the whole overlay back so it reads as a hologram screen you look
// down at. The pivot is the trapezoid's own bottom edge (v=692/1536 of the
// texture → local y ≈ +0.05), matching the DOM layer's rotateX origin.
windowmenuPlane.geometry.translate(0, -0.0495, 0);
windowmenuPlane.position.set(0, 0.0495, 0.001);
windowmenuPlane.rotation.x = -0.16; // top edge leans away ≈ CSS rotateX(9deg)
cockpitPlane.add(windowmenuPlane);
// Translucent glass backdrop: the PNG is a flat black silhouette, so at
// partial alpha it reads as smoked glass behind the text — the glowing
// trapezoid border itself is drawn by .wm-frame (SVG) in the DOM layer.
const WINDOWMENU_ALPHA = 0.45;

// --- Cockpit Pinch ---
// Photoshop-style pinch: vertices are pulled radially toward the quad
// center (r' = r^1+3p in normalized units). Edges stay pinned, the whole
// interior gets sucked toward a vanishing point — reads as the cockpit
// being yanked through the screen instead of a flat zoom or bend.
let cockpitPinchNow = 0; // current pinch, reused by DOM anchor projection
const PINCH_RMAX = Math.SQRT1_2; // corner radius of the 1x1 unit quad
function _pinchXY(x, y, pinch) {
  const rn = Math.hypot(x, y) / PINCH_RMAX;
  const f = rn > 1e-6 ? Math.pow(rn, 3 * pinch) : 0;
  return [x * f, y * f];
}
function setCockpitPinch(pinch) {
  cockpitPinchNow = pinch;
  const geo = cockpitPlane.geometry;
  if (!geo.userData.base) geo.userData.base = geo.attributes.position.array.slice();
  const base = geo.userData.base;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const y = base[i * 3 + 1];
    const [px, py] = _pinchXY(x, y, pinch);
    pos.setXY(i, px, py);
  }
  pos.needsUpdate = true;
  // Child quads ride the same surface — pinch them in cockpit-plane space
  for (const child of cockpitPlane.children) _pinchChildMesh(child, pinch);
}

// Warp a quad parented to cockpitPlane so it follows the parent's pinch
// field: world-space pinch applied via the child's local scale/offset.
function _pinchChildMesh(mesh, pinch) {
  const geo = mesh.geometry;
  if (!geo.userData.base) geo.userData.base = geo.attributes.position.array.slice();
  const base = geo.userData.base;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const wx = mesh.position.x + base[i * 3] * mesh.scale.x;
    const wy = mesh.position.y + base[i * 3 + 1] * mesh.scale.y;
    const [wx2, wy2] = _pinchXY(wx, wy, pinch);
    pos.setXY(
      i,
      (wx2 - mesh.position.x) / mesh.scale.x,
      (wy2 - mesh.position.y) / mesh.scale.y
    );
  }
  pos.needsUpdate = true;
}

window.__cockpit = { setCockpitPinch, cockpitCamera, cockpitPlane, cockpitBaseScale, windowmenuPlane }; // debug handle

function updateCockpitAnchors() {
  const anchors = document.querySelectorAll("[data-cockpit]");
  if (anchors.length === 0) return;
  cockpitPlane.updateMatrixWorld();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const el of anchors) {
    const c = COCKPIT_CUTOUTS[el.dataset.cockpit];
    if (!c) continue;
    const ins = c.inset || 0;
    const iu0 = c.u0 + (c.u1 - c.u0) * ins;
    const iu1 = c.u1 - (c.u1 - c.u0) * ins;
    const iv0 = c.v0 + (c.v1 - c.v0) * ins;
    const iv1 = c.v1 - (c.v1 - c.v0) * ins;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const u of [iu0, iu1]) {
      for (const v of [iv0, iv1]) {
        const px = u - 0.5;
        const py = 0.5 - v;
        const [bx, by] = _pinchXY(px, py, cockpitPinchNow);
        _cutoutCorner
          // plane local: x,y in [-0.5,0.5], warped by the pinch
          .set(bx, by, 0)
          .applyMatrix4(cockpitPlane.matrixWorld)
          .project(cockpitCamera);
        const sx = (_cutoutCorner.x * 0.5 + 0.5) * vw;
        const sy = (-_cutoutCorner.y * 0.5 + 0.5) * vh;
        if (sx < x0) x0 = sx;
        if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy;
        if (sy > y1) y1 = sy;
      }
    }
    el.style.left = `${x0}px`;
    el.style.top = `${y0}px`;
    el.style.width = `${x1 - x0}px`;
    el.style.height = `${y1 - y0}px`;
  }
}

const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: postVertexShader,
      fragmentShader: postFragmentShader,
      uniforms: postUniforms,
      depthTest: false,
      depthWrite: false,
    })
  )
);

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
  uniform float uWarpGlow;
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
    vAlpha *= 1.0 + uWarpGlow * 1.4; // hyperspace glow-up with speed

    float speedBoost = 1.0 + min(abs(uVelocity) * 0.03, 1.4) + uWarpGlow * 2.2;
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
  uWarpGlow: { value: 0.0 },
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uHoleCenter: { value: new THREE.Vector2(0, 0) },
  uTexture: { value: starTexture },
};

// ASCII filter state — off by default, toggled with the A key
let asciiOn = false;

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
const MODELS_ENABLED = false; // props off for now — flip to true to re-enable
let spawnIndex = 0;
const COPIES_PER_MODEL = 4; // 4x density to fill the deeper field
const totalToSpawn = MODEL_FILENAMES.length * COPIES_PER_MODEL; // 92 objects

if (MODELS_ENABLED) MODEL_FILENAMES.forEach((filename) => {
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
  if (e.target !== renderer.domElement) return; // clicks on DOM UI (menu) don't grab props

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

// --- Warp Transition (menu launch) ---
// Pressing a menu button doesn't teleport — it spools FOV + travel speed,
// fades the cockpit out, then lands in the sequence and eases back.
const CAM_FOV = 65;
const WARP_FOV = 145;        // extreme widen — reads as a hyperdrive spool
const COCKPIT_WARP_FOV = 120; // extreme wide-angle during warp — fisheye feel
const WARP_BOOST = 240;      // peak extra scroll speed (units/frame @60fps)
const WARP_IN_S = 1.5;
const WARP_OUT_S = 0.8;
let warp = null;             // { phase: "in"|"out", t, land }
let cockpitAlpha = 1;
let cockpitAlphaTarget = 1;

// --- View Mode ---
// 'cockpit'  = free flight: stars + cockpit POV only. Scroll still travels
//              through the starfield, but there are no crawl stages, no
//              freeze parks, and no scripted camera turns.
// 'sequence' = the full 36000-loop crawl + project showcases.
// The cockpit menu switches with window.setSpaceMode('cockpit'|'sequence').
let appMode = null;

function setSpaceMode(mode, startScroll = 0) {
  if (mode !== "cockpit" && mode !== "sequence") return;
  if (mode === appMode) {
    // Same-mode re-jump: the menu can bounce straight to another section
    if (mode === "sequence") {
      targetScroll = startScroll;
      currentScroll = startScroll;
      spaceScroll = startScroll;
      freezeOffset = 0;
      lastLoopIdx = Math.floor(currentScroll / CONFIG.spaceDepth);
      projectSkipped = false;
      skipOffset = null;
      skipStartSpace = null;
      wheelEnergy = 0;
      prevCrawlLoopScroll = null;
      stage1TextShift = 0; stage1Dwell = 0;
      stage2TextShift = 0; stage2Dwell = 0;
      stage3TextShift = 0; stage3Dwell = 0;
    }
    return;
  }
  appMode = mode;
  document.body.dataset.mode = mode;

  // Skip/freeze leftovers are meaningless across a mode switch
  projectSkipped = false;
  skipOffset = null;
  skipStartSpace = null;
  wheelEnergy = 0;
  prevCrawlLoopScroll = null;

  const allShowcaseVideos = [
    ...projectVideos,
    ...project2Videos,
    ...project3Videos,
  ];

  if (mode === "cockpit") {
    // Carry the scroll gap so space picks up exactly where it was parked —
    // no star jump when leaving a freeze bound mid-showcase.
    freezeOffset = currentScroll - spaceScroll;
    // Kill any in-flight warp and restore the cockpit view state
    warp = null;
    cockpitAlphaTarget = 1;
    camera.fov = CAM_FOV;
    camera.updateProjectionMatrix();
    cockpitCamera.fov = COCKPIT_FOV;
    cockpitCamera.updateProjectionMatrix();
    layoutCockpit(); // restore base scale after any warp stretch
    setCockpitPinch(0); // flatten the pinch
    document.body.classList.remove("warping");
    if (cockpitMenu) {
      cockpitMenu.style.transition = "";
      cockpitMenu.style.opacity = "";
    }
    if (crawlIntro) crawlIntro.style.display = "none";
    if (scrollHud) scrollHud.style.display = "none";
    allShowcaseVideos.forEach((v) => v.pause());
  } else {
    cockpitAlphaTarget = 0;
    // Land the sequence at the requested position (0 = fresh run from top)
    targetScroll = startScroll;
    currentScroll = startScroll;
    spaceScroll = startScroll;
    freezeOffset = 0;
    lastLoopIdx = Math.floor(currentScroll / CONFIG.spaceDepth);
    stage1TextShift = 0; stage1Dwell = 0;
    stage2TextShift = 0; stage2Dwell = 0;
    stage3TextShift = 0; stage3Dwell = 0;
    if (crawlIntro) crawlIntro.style.display = "";
    if (scrollHud) scrollHud.style.display = "";
  }

  window.dispatchEvent(new CustomEvent("space:modechange", { detail: mode }));
}

// Menu-facing API
window.setSpaceMode = setSpaceMode;
window.getSpaceMode = () => appMode;

// Scene shortcuts used by the cockpit menu buttons
window.gotoScene = (sceneName) => {
  if (sceneName === "crawl") setSpaceMode("sequence", 0);
  else if (sceneName === "projects") setSpaceMode("sequence", 6600);
};

// Warp launch: spool FOV + travel speed, fade the cockpit, land in sequence
function startWarp(sceneName) {
  if (warp || appMode !== "cockpit") return;
  warp = {
    phase: "in",
    t: 0,
    // 6600 = peak of the "Projects" title crawl (full-opacity plateau
    // 6120-7080 inside the 5900-7400 stage-4 window)
    land: sceneName === "projects" ? 6600 : 0,
  };
  cockpitAlphaTarget = 0;
  document.body.classList.add("warping");
  // Opacity is driven per-frame in the warp block — an active CSS
  // transition would lag behind those values, so cut it here
  if (cockpitMenu) cockpitMenu.style.transition = "none";
}

document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => startWarp(btn.dataset.goto));
});

// --- Window Menu Panels ---
// Hovering a console button projects the matching data panel into the
// windshield trapezoid (windowmenu.png). Each [data-scramble] line
// "decrypts" left-to-right — adapted from 21st.dev dqnamo/scramble-text
// to this vanilla stack.
const windowMenuEl = document.querySelector(".window-menu");
const WM_SCRAMBLE_CHARS = "-_~`!@#$%^&*()+=[]{}|;:,.<>?/\\";
const WM_REDUCE_MOTION = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;
let wmRunId = 0; // generation counter — bumping cancels in-flight decodes

function wmScrambleEl(el, delayMs) {
  const text = el.dataset.text ?? (el.dataset.text = el.textContent);
  if (WM_REDUCE_MOTION) {
    el.textContent = text;
    return;
  }
  const chars = [...text];
  const run = wmRunId;
  const perTick = Math.max(1, Math.ceil(chars.length / 34));
  const t0 = performance.now() + delayMs;
  let revealed = 0;
  const tick = (now) => {
    if (run !== wmRunId) return; // stale — another panel took over
    if (now < t0) {
      requestAnimationFrame(tick);
      return;
    }
    revealed = Math.min(chars.length, revealed + perTick);
    let out = "";
    for (let i = 0; i < chars.length; i++) {
      out +=
        i < revealed || chars[i] === " "
          ? chars[i]
          : WM_SCRAMBLE_CHARS[
              (Math.random() * WM_SCRAMBLE_CHARS.length) | 0
            ];
    }
    el.textContent = out;
    if (revealed < chars.length) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showWindowPanel(name) {
  if (!windowMenuEl || windowMenuEl.dataset.active === name) return;
  wmRunId++;
  windowMenuEl.dataset.active = name;
  windowMenuEl
    .querySelectorAll(".wm-panel.active")
    .forEach((p) => p.classList.remove("active"));
  const panel = windowMenuEl.querySelector(
    `.wm-panel[data-panel="${name}"]`
  );
  if (!panel) return;
  panel.classList.add("active");
  panel
    .querySelectorAll("[data-scramble]")
    .forEach((el, i) => wmScrambleEl(el, 70 + i * 95));
}

function hideWindowPanel() {
  if (!windowMenuEl || !windowMenuEl.dataset.active) return;
  wmRunId++;
  delete windowMenuEl.dataset.active;
}

document.querySelectorAll(".menu-btn[data-panel]").forEach((btn) => {
  const name = btn.dataset.panel;
  btn.addEventListener("mouseenter", () => showWindowPanel(name));
  btn.addEventListener("focus", () => showWindowPanel(name));
  btn.addEventListener("mouseleave", hideWindowPanel);
  btn.addEventListener("blur", hideWindowPanel);
  // Touch has no hover — tapping a non-navigating button (CONTACT)
  // toggles its panel instead.
  btn.addEventListener("click", () => {
    if (btn.dataset.goto) return;
    if (windowMenuEl?.dataset.active === name) hideWindowPanel();
    else showWindowPanel(name);
  });
});
const cockpitBackBtn = document.getElementById("cockpit-back");
if (cockpitBackBtn) {
  cockpitBackBtn.addEventListener("click", () => setSpaceMode("cockpit"));
}

// Boot into the cockpit-only view
setSpaceMode("cockpit");

// Cockpit POV overlay element
const cockpitImg = document.getElementById("cockpit-img");
let lastCockpitPx = 0,
  lastCockpitPy = 0,
  lastCockpitRotY = 0,
  lastCockpitRotX = 0;

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
    if (appMode === "sequence" && !projectSkipped && wheelEnergy > 650 && loopScrollNow >= PROJECT_SCROLL_START - 100) {
      projectSkipped = true;
    }
  },
  { passive: false }
);

// Manual ASCII on/off — pressing A flips the filter
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "a") {
    asciiOn = !asciiOn;
    postUniforms.uAscii.value = asciiOn ? 1.0 : 0.0;
  }
});

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
      if (appMode === "sequence" && !projectSkipped && wheelEnergy > 650 && loopScrollNow >= PROJECT_SCROLL_START - 100) {
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

  cockpitCamera.aspect = width / height;
  cockpitCamera.updateProjectionMatrix();
  layoutCockpit();

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  renderer.getDrawingBufferSize(postUniforms.uResolution.value);
  postTarget.setSize(postUniforms.uResolution.value.x, postUniforms.uResolution.value.y);
  postUniforms.uCell.value = ASCII_CELL * renderer.getPixelRatio();

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

  // Cockpit mode: gentle idle cruise so the starfield always breathes
  if (appMode === "cockpit") targetScroll += 0.4;

  // Warp launch, staged like a hyperspace jump:
  //  1) cockpit fades away first
  //  2) FOV spools + travel speed ramps (stars glow up as velocity builds)
  //  3) white flash swallows the cut to the target scene
  //  4) 'out' phase: flash + FOV ease back — soft land into the content
  if (warp) {
    warp.t += delta;
    if (warp.phase === "in") {
      const k = Math.min(1, warp.t / WARP_IN_S);
      // Hold opacity through the pinch — fade only in the last
      // stretch of warp-in so the flash hides the cut
      cockpitAlpha = 1 - THREE.MathUtils.smoothstep(k, 0.75, 1.0);
      cockpitAlphaTarget = cockpitAlpha;
      // DOM menu fades on its own earlier curve — gone by mid warp-in
      if (cockpitMenu)
        cockpitMenu.style.opacity = String(
          1 - THREE.MathUtils.smoothstep(k, 0.0, 0.5)
        );
      const spoolK = THREE.MathUtils.smoothstep(k, 0.1, 1.0);
      const e = spoolK * spoolK; // ease-in: acceleration feels like a spool
      camera.fov = CAM_FOV + (WARP_FOV - CAM_FOV) * e;
      camera.updateProjectionMatrix();
      // The cockpit stretches like a fisheye lens: widen the focal
      // angle AND scale the quad up to compensate so the frame edges
      // stay pinned — then the pinch sucks the image toward a
      // vanishing point, like the Photoshop pinch filter
      const ckFov = COCKPIT_FOV + (COCKPIT_WARP_FOV - COCKPIT_FOV) * e;
      cockpitCamera.fov = ckFov;
      cockpitCamera.updateProjectionMatrix();
      const fovScale =
        Math.tan(THREE.MathUtils.degToRad(ckFov / 2)) /
        Math.tan(THREE.MathUtils.degToRad(COCKPIT_FOV / 2));
      cockpitPlane.scale.set(
        cockpitBaseScale.x * fovScale,
        cockpitBaseScale.y * fovScale,
        1
      );
      setCockpitPinch(e * 0.08); // suck the image toward a vanishing point
      targetScroll += WARP_BOOST * e * (delta * 60);
      uniforms.uWarpGlow.value = spoolK * 2.0;
      if (warpFlash)
        warpFlash.style.opacity = THREE.MathUtils.smoothstep(k, 0.8, 1.0);
      if (k >= 1) {
        const land = warp.land;
        warp = { phase: "out", t: 0, land };
        setSpaceMode("sequence", land);
        document.body.classList.remove("warping");
      }
    } else {
      const k = Math.min(1, warp.t / WARP_OUT_S);
      const e = 1 - Math.pow(1 - k, 3); // ease-out
      camera.fov = WARP_FOV - (WARP_FOV - CAM_FOV) * e;
      camera.updateProjectionMatrix();
      uniforms.uWarpGlow.value = (1 - e) * 2.0;
      if (warpFlash) warpFlash.style.opacity = 1 - e;
      if (k >= 1) {
        camera.fov = CAM_FOV;
        camera.updateProjectionMatrix();
        uniforms.uWarpGlow.value = 0;
        if (warpFlash) warpFlash.style.opacity = 0;
        warp = null;
      }
    }
  }

  // Damped smooth lerp towards target scroll
  currentScroll += (targetScroll - currentScroll) * CONFIG.lerpFactor;

  // Space scroll freezes at the project showcase (loop position 7900) unless
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

  // Loop position is tracked in both modes (HUD + wheel skip read it)
  loopScrollNow =
    ((currentScroll % CONFIG.spaceDepth) + CONFIG.spaceDepth) %
    CONFIG.spaceDepth;

  // Three freeze stops per loop pass — the project showcases. Bands are
  // defined in space coordinates with +100 hysteresis so scrolling back
  // through a bound cleanly re-selects it. Cockpit mode has no stops.
  const freezeBound =
    appMode === "sequence"
      ? base +
        (spaceScroll < base + PROJECT_SCROLL_START + 100
          ? PROJECT_SCROLL_START
          : spaceScroll < base + PROJECT2_SCROLL_START + 100
            ? PROJECT2_SCROLL_START
            : spaceScroll < base + PROJECT3_SCROLL_START + 100
              ? PROJECT3_SCROLL_START
              : Infinity)
      : Infinity;
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
    mode: appMode,
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

  // Cockpit POV quad: counter-rotates against the look direction so it
  // reads as turning your head inside the cockpit (wider apparent FOV).
  cockpitPlane.rotation.y = mouse.currentX * parallaxScale * 0.45;
  cockpitPlane.rotation.x = -mouse.currentY * parallaxScale * 0.3;
  cockpitPlane.position.x = -mouse.currentX * parallaxScale * 0.05;
  cockpitPlane.position.y = -mouse.currentY * parallaxScale * 0.04;

  // Glue any [data-cockpit] DOM elements onto the quad's cutouts
  updateCockpitAnchors();

  // Cockpit fade: driven by mode/warp, applied to both layers
  cockpitAlpha +=
    (cockpitAlphaTarget - cockpitAlpha) * Math.min(1, delta * 3.5);
  cockpitPlane.material.opacity = cockpitAlpha;
  screenFill.material.opacity = cockpitAlpha;
  windowmenuPlane.material.opacity = cockpitAlpha * WINDOWMENU_ALPHA;

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

  // Cockpit mode: no stages — just keep the center-fade anchor + HUD alive
  if (appMode === "cockpit") {
    camera.updateMatrixWorld();
    holeAnchorWorld.set(0, 0, -3000).project(camera);
    uniforms.uHoleCenter.value.set(holeAnchorWorld.x, holeAnchorWorld.y);
    if (spaceHud) spaceHud.textContent = `CAM Z ${Math.round(spaceScroll)}`;
  }

  // --- Update Star Wars Crawl Scroll Progression (Sequential Stages) ---
  if (appMode === "sequence" && crawlIntro && crawlStage1 && crawlStage2 && crawlStage3) {
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
    // Turns 90 degrees left as the crawl exits (space 5900→7900)
    const camPan = THREE.MathUtils.smoothstep(spaceLoop, 5900, 7900);
    camera.rotation.y += camPan * (Math.PI / 2);
    // Sweeps 180° right into cekigrep (space 9800→11000)
    const camPanRight = THREE.MathUtils.smoothstep(spaceLoop, 9800, 11000);
    camera.rotation.y -= camPanRight * Math.PI;
    // Turns 180° back left as cekigrep exits (space 13100→14100)
    const camPanLeft = THREE.MathUtils.smoothstep(spaceLoop, 13100, 14100);
    camera.rotation.y += camPanLeft * Math.PI;
    // Turns 90° right past the last showcase (space 16000→16600)
    const camPanRight2 = THREE.MathUtils.smoothstep(spaceLoop, 16000, 16600);
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

    // --- Project Showcase (scroll 7900+): space frozen, videos looping,
    // left text column slides up with the wheel ---
    if (projectStage) {
      // Videos are gated on SPACE position — they appear exactly where the
      // freeze bounds hold space, fade in on approach and out on departure.
      const show = THREE.MathUtils.clamp((spaceLoop - (PROJECT_SCROLL_START - 600)) / 600, 0, 1);
      // Peak plateau 7900→9500, then fade out 9500→10100.
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

    // --- Project Showcase 2 (parks at 11100): CEKIGREP, centered video ---
    if (project2Stage) {
      // Fade in 10500→11100, peak plateau 11100→12700, fade out 12700→13300.
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

    // --- Project Showcase 3 (parks at 14400): GRAILS OF WAR, mobile + PC ---
    if (project3Stage) {
      // Fade in 13800→14400, peak plateau 14400→15600, fade out 15600→16200.
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

  // Scene renders offscreen, then the post pass draws it (ASCII or clean)
  renderer.setRenderTarget(postTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCamera);

  // Cockpit quad last, straight on top — only exists in cockpit mode
  // (plus the warp-out tail while it fades)
  if (
    cockpitAlpha > 0.005 &&
    (appMode === "cockpit" || (warp && warp.phase === "in"))
  ) {
    renderer.autoClear = false;
    renderer.render(cockpitScene, cockpitCamera);
    renderer.autoClear = true;
  }
}

requestAnimationFrame(animate);


