// OpenEgiz Digital Mine - High-Fidelity 3D Visualizer & Control Center
// Real-time geospatial digital twin for open-pit mining operations

const SIM_API_BASE = window.location.hostname === "localhost" ? "http://localhost:8000" : `http://${window.location.hostname}:8000`;

// --- Coordinate Systems & Scales ---
const CENTER_LON = 76.9230;
const CENTER_LAT = 43.2260;
const SX = 1.15;
const SY = 0.90;
const SCALE_HORIZ = 0.28;
const SCALE_VERT = 0.35;

function localToWorld(x, y, elev) {
  return new THREE.Vector3(x * SCALE_HORIZ, (elev - 260.0) * SCALE_VERT, -y * SCALE_HORIZ);
}

function lonLatToWorld(lon, lat, elev) {
  const x = (lon - CENTER_LON) * 80940.0;
  const y = (lat - CENTER_LAT) * 111132.0;
  return localToWorld(x, y, elev);
}

// Shortest-arc angle interpolation (prevents 360-degree flip spins)
function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

// Pit Benches Profile (meters)
const BENCHES = [
  { elev: 460, toe: 620, crest: 580, name: "Поверхность (+460м)", rockColor: 0x6e685c },
  { elev: 420, toe: 540, crest: 470, name: "Горизонт +420м", rockColor: 0x5a5448 },
  { elev: 380, toe: 430, crest: 360, name: "Горизонт +380м", rockColor: 0x4a4f58 },
  { elev: 340, toe: 320, crest: 250, name: "Горизонт +340м", rockColor: 0x3d4754 },
  { elev: 300, toe: 210, crest: 140, name: "Горизонт +300м", rockColor: 0x344050 },
  { elev: 260, toe: 100, crest: 0,   name: "Дно карьера (+260м)", rockColor: 0x2b3848 }
];

// Geological Ore Blocks (8 blocks)
const ORE_BLOCKS_DEF = {
  "block-01": { id: "block-01", name: "Б-420-1 (Богатая)", elev: 420, grade: 1.65, color: 0xd500f9, offset: 0.95, width: 0.55 },
  "block-02": { id: "block-02", name: "Б-420-2 (Рядовая)", elev: 420, grade: 1.10, color: 0xff9100, offset: 3.60, width: 1.10 },
  "block-03": { id: "block-03", name: "Б-380-1 (Высокосортная)", elev: 380, grade: 1.85, color: 0xe040fb, offset: 1.25, width: 0.60 },
  "block-04": { id: "block-04", name: "Б-380-2 (Бедная)", elev: 380, grade: 0.65, color: 0x5c6bc0, offset: 3.90, width: 1.30 },
  "block-05": { id: "block-05", name: "Б-340-1 (Целевая)", elev: 340, grade: 1.05, color: 0x00e676, offset: 1.55, width: 0.80 },
  "block-06": { id: "block-06", name: "Б-340-2 (Низкосортная)", elev: 340, grade: 0.50, color: 0x3949ab, offset: 4.10, width: 1.40 },
  "block-07": { id: "block-07", name: "Б-300-1 (Глубокая)", elev: 300, grade: 1.45, color: 0xab47bc, offset: 1.90, width: 1.00 },
  "block-08": { id: "block-08", name: "Б-260 (Вскрыша)", elev: 260, grade: 0.12, color: 0x78909c, offset: 0.00, width: 6.28 }
};

// --- Global Three.js State ---
let scene, camera, renderer, controls;
let truckMeshes = {};
let excavatorMeshes = {};
let blockMeshes = {};
let facilityMeshes = {};
let labelSprites = [];
let roadGroup = new THREE.Group();
let blocksGroup = new THREE.Group();
let labelsGroup = new THREE.Group();
let trendChart = null;
let selectedEntity = null;
let cachedFleetState = null;
let followTarget = null;
let cameraTargetPos = null;
let cameraTargetLook = null;

// Layer visibility flags
let showLabels = true;
let showBlocks = true;
let showRoads = true;

// Procedural texture cache
let textures = {};

// --- Procedural Canvas Textures ---
function createStratifiedRockTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // Base rock gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, "#605646");
  grad.addColorStop(0.2, "#4a443a");
  grad.addColorStop(0.4, "#5d5446");
  grad.addColorStop(0.6, "#3c3832");
  grad.addColorStop(0.8, "#4f4940");
  grad.addColorStop(1.0, "#36332d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Horizontal geological rock strata bands
  for (let y = 0; y < 512; y += 4) {
    const n = Math.sin(y * 0.1) * 0.5 + Math.cos(y * 0.04) * 0.5;
    ctx.fillStyle = n > 0.2 ? "rgba(160, 140, 110, 0.18)" : "rgba(30, 25, 20, 0.22)";
    ctx.fillRect(0, y, 512, 2 + Math.abs(n) * 3);
  }

  // Vertical blasting fracture lines
  ctx.strokeStyle = "rgba(20, 18, 15, 0.25)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 512;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 40, 512);
    ctx.stroke();
  }

  // Noise specks
  const imgData = ctx.getImageData(0, 0, 512, 512);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const grain = (Math.random() - 0.5) * 26;
    d[i] = Math.max(0, Math.min(255, d[i] + grain));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + grain));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + grain));
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 4);
  return tex;
}

function createBermFloorTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#3e3a34";
  ctx.fillRect(0, 0, 256, 256);

  // Compacted gravel speckles
  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = Math.random() * 2 + 0.8;
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(180, 170, 150, 0.25)" : "rgba(20, 18, 16, 0.35)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 4);
  return tex;
}

function createHaulRoadTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  // Dark compacted asphalt / gravel road base
  ctx.fillStyle = "#272a30";
  ctx.fillRect(0, 0, 128, 256);

  // Tire wear tracks (dual wheel paths)
  ctx.fillStyle = "#1e2024";
  ctx.fillRect(18, 0, 32, 256);
  ctx.fillRect(78, 0, 32, 256);

  // Yellow dashed centerline
  ctx.fillStyle = "#ffb300";
  for (let y = 0; y < 256; y += 40) {
    ctx.fillRect(62, y, 4, 22);
  }

  // Safety road edge markers
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillRect(4, 0, 2, 256);
  ctx.fillRect(122, 0, 2, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 32);
  return tex;
}

function createSurfaceGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#48433b";
  ctx.fillRect(0, 0, 512, 512);

  // Soil & steppe vegetation noise
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = Math.random() * 4 + 1;
    ctx.fillStyle = Math.random() > 0.6 ? "rgba(90, 100, 75, 0.25)" : "rgba(35, 30, 25, 0.35)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  return tex;
}

// 3D Billboard Sprite Badge (High-DPI Canvas)
function createLabelSprite(title, subtitle, badgeColor, isWarning = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 140;
  const ctx = canvas.getContext("2d");

  // Rounded pill background
  ctx.fillStyle = "rgba(10, 15, 29, 0.88)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 124, 24);
  ctx.fill();

  // Border glow
  ctx.strokeStyle = badgeColor;
  ctx.lineWidth = isWarning ? 6 : 4;
  ctx.stroke();

  // Badge status dot
  ctx.fillStyle = badgeColor;
  ctx.beginPath();
  ctx.arc(42, 70, 16, 0, Math.PI * 2);
  ctx.fill();

  // Title
  ctx.font = "bold 34px 'Inter', sans-serif";
  ctx.fillStyle = "#f0f4fc";
  ctx.fillText(title, 76, 58);

  // Subtitle
  ctx.font = "bold 26px 'JetBrains Mono', monospace";
  ctx.fillStyle = badgeColor;
  ctx.fillText(subtitle, 76, 102);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(22, 6.0, 1);
  return sprite;
}

// --- Initialize 3D Engine ---
function init3D() {
  const container = document.getElementById("scene3d-container");
  const width = container.clientWidth;
  const height = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a101d);
  scene.fog = new THREE.FogExp2(0x0a101d, 0.0016);

  camera = new THREE.PerspectiveCamera(45, width / height, 2, 4000);
  camera.position.set(160, 200, 280);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.target.set(0, 30, 0);
  controls.minDistance = 30;
  controls.maxDistance = 1200;

  // Add layer groups
  scene.add(roadGroup);
  scene.add(blocksGroup);
  scene.add(labelsGroup);

  // Industrial Lighting
  setupLighting();

  // Textures
  textures.rock = createStratifiedRockTexture();
  textures.berm = createBermFloorTexture();
  textures.road = createHaulRoadTexture();
  textures.surface = createSurfaceGroundTexture();

  // Build Complete 3D Mine
  buildRealisticPit();
  buildHaulRoadRibbon();
  buildFacilities();
  buildOreBlocks();
  buildDepthRuler();

  // Raycaster for entity selection
  setupRaycaster(renderer.domElement);

  // Window resize listener
  window.addEventListener("resize", () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  // Render loop
  function animate() {
    requestAnimationFrame(animate);

    // Smooth camera tween
    if (cameraTargetPos && cameraTargetLook) {
      camera.position.lerp(cameraTargetPos, 0.08);
      controls.target.lerp(cameraTargetLook, 0.08);
      if (camera.position.distanceTo(cameraTargetPos) < 1.0) {
        cameraTargetPos = null;
        cameraTargetLook = null;
      }
    } else if (followTarget && truckMeshes[followTarget]) {
      const truck = truckMeshes[followTarget];
      const offset = new THREE.Vector3(-18, 14, 18);
      camera.position.lerp(truck.position.clone().add(offset), 0.1);
      controls.target.lerp(truck.position, 0.1);
    }

    controls.update();

    // 60 FPS Smooth Truck Interpolation & Wheel Spin
    const now = performance.now();
    Object.values(truckMeshes).forEach(mesh => {
      if (!mesh.userData.targetPosition) return;
      const elapsed = now - (mesh.userData.telemetryTime || now);
      // Normalized time over 1000ms polling cycle
      const progress = Math.min(1.0, Math.max(0.0, elapsed / 1000.0));
      // Hermite smoothstep for natural acceleration/deceleration
      const alpha = progress * progress * (3.0 - 2.0 * progress);

      if (mesh.userData.prevPosition) {
        mesh.position.lerpVectors(mesh.userData.prevPosition, mesh.userData.targetPosition, alpha);
      } else {
        mesh.position.copy(mesh.userData.targetPosition);
      }

      // Smooth heading rotation along shortest arc
      if (mesh.userData.targetHeading !== undefined) {
        mesh.rotation.y = lerpAngle(mesh.rotation.y, mesh.userData.targetHeading, 0.14);
      }

      // Wheel spinning proportional to truck speed
      if (mesh.userData.wheels && (mesh.userData.speedKmh || 0) > 0.5) {
        const speedMs = mesh.userData.speedKmh / 3.6;
        const wheelRotDelta = (speedMs * 0.016) / 1.6;
        mesh.userData.wheels.forEach(w => w.rotateY(wheelRotDelta));
      }
    });

    // Idle excavator shoveling animation
    Object.values(excavatorMeshes).forEach(group => {
      if (group.userData.state === "loading" && group.userData.deck) {
        group.userData.swingTime = (group.userData.swingTime || 0) + 0.02;
        group.userData.deck.rotation.y = Math.sin(group.userData.swingTime) * 0.45;
      }
    });

    // Update compass arrow UI
    const compass = document.getElementById("compass-arrow");
    if (compass) {
      const azimuth = controls.getAzimuthalAngle();
      compass.style.transform = `rotate(${azimuth * (180 / Math.PI)}deg)`;
    }

    renderer.render(scene, camera);
  }
  animate();
}

function setupLighting() {
  // Ambient Sky Fill
  const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x1a202c, 0.75);
  scene.add(hemiLight);

  // Sunlight (Directional with soft shadows)
  const sunLight = new THREE.DirectionalLight(0xfff3db, 1.4);
  sunLight.position.set(280, 420, 220);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 50;
  sunLight.shadow.camera.far = 1000;
  sunLight.shadow.camera.left = -260;
  sunLight.shadow.camera.right = 260;
  sunLight.shadow.camera.top = 260;
  sunLight.shadow.camera.bottom = -260;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);

  // Blue Rim Light (industrial edge contrast)
  const rimLight = new THREE.DirectionalLight(0x00e5ff, 0.35);
  rimLight.position.set(-260, 180, -220);
  scene.add(rimLight);
}

// --- 1. Realistic Terraced Open-Pit Geometry ---
function buildRealisticPit() {
  const pitGroup = new THREE.Group();

  const rockMat = new THREE.MeshStandardMaterial({
    map: textures.rock,
    roughness: 0.88,
    metalness: 0.12,
    side: THREE.DoubleSide
  });

  const bermMat = new THREE.MeshStandardMaterial({
    map: textures.berm,
    roughness: 0.92,
    metalness: 0.08,
    side: THREE.DoubleSide
  });

  const surfaceMat = new THREE.MeshStandardMaterial({
    map: textures.surface,
    roughness: 0.95,
    metalness: 0.05
  });

  const steps = 72;

  // A. Outer Ground Surface Plateau (+460m) surrounding the pit rim
  const surfGeo = new THREE.BufferGeometry();
  const surfPositions = [];
  const surfUVs = [];
  const rRim = 580;
  const rOuter = 2200;
  const y460 = (460 - 260) * SCALE_VERT;

  for (let i = 0; i < steps; i++) {
    const th1 = (i / steps) * Math.PI * 2;
    const th2 = ((i + 1) / steps) * Math.PI * 2;

    const x1_in = rRim * SX * Math.cos(th1) * SCALE_HORIZ;
    const z1_in = -rRim * SY * Math.sin(th1) * SCALE_HORIZ;
    const x2_in = rRim * SX * Math.cos(th2) * SCALE_HORIZ;
    const z2_in = -rRim * SY * Math.sin(th2) * SCALE_HORIZ;

    const x1_out = rOuter * SX * Math.cos(th1) * SCALE_HORIZ;
    const z1_out = -rOuter * SY * Math.sin(th1) * SCALE_HORIZ;
    const x2_out = rOuter * SX * Math.cos(th2) * SCALE_HORIZ;
    const z2_out = -rOuter * SY * Math.sin(th2) * SCALE_HORIZ;

    // Two triangles for the outer quad
    surfPositions.push(x1_in, y460, z1_in, x2_in, y460, z2_in, x1_out, y460, z1_out);
    surfPositions.push(x2_in, y460, z2_in, x2_out, y460, z2_out, x1_out, y460, z1_out);

    surfUVs.push(0, 0, 1, 0, 0, 1);
    surfUVs.push(1, 0, 1, 1, 0, 1);
  }
  surfGeo.setAttribute("position", new THREE.Float32BufferAttribute(surfPositions, 3));
  surfGeo.setAttribute("uv", new THREE.Float32BufferAttribute(surfUVs, 2));
  surfGeo.computeVertexNormals();
  const surfaceMesh = new THREE.Mesh(surfGeo, surfaceMat);
  surfaceMesh.receiveShadow = true;
  pitGroup.add(surfaceMesh);

  // B. Stepped Terraces (Benches): Slopes + Horizontal Berms
  for (let k = 0; k < BENCHES.length - 1; k++) {
    const upper = BENCHES[k];
    const lower = BENCHES[k + 1];

    const yUpper = (upper.elev - 260) * SCALE_VERT;
    const yLower = (lower.elev - 260) * SCALE_VERT;

    const rCrestUpper = upper.crest;
    const rToeLower = lower.toe;
    const rCrestLower = lower.crest;

    // 1. Bench Slope (Conical Rock Face)
    const slopeGeo = new THREE.BufferGeometry();
    const slopePos = [];
    const slopeUVs = [];

    for (let i = 0; i < steps; i++) {
      const th1 = (i / steps) * Math.PI * 2;
      const th2 = ((i + 1) / steps) * Math.PI * 2;

      const x1_up = rCrestUpper * SX * Math.cos(th1) * SCALE_HORIZ;
      const z1_up = -rCrestUpper * SY * Math.sin(th1) * SCALE_HORIZ;
      const x2_up = rCrestUpper * SX * Math.cos(th2) * SCALE_HORIZ;
      const z2_up = -rCrestUpper * SY * Math.sin(th2) * SCALE_HORIZ;

      const x1_dn = rToeLower * SX * Math.cos(th1) * SCALE_HORIZ;
      const z1_dn = -rToeLower * SY * Math.sin(th1) * SCALE_HORIZ;
      const x2_dn = rToeLower * SX * Math.cos(th2) * SCALE_HORIZ;
      const z2_dn = -rToeLower * SY * Math.sin(th2) * SCALE_HORIZ;

      slopePos.push(x1_up, yUpper, z1_up, x1_dn, yLower, z1_dn, x2_up, yUpper, z2_up);
      slopePos.push(x2_up, yUpper, z2_up, x1_dn, yLower, z1_dn, x2_dn, yLower, z2_dn);

      const u1 = i / steps;
      const u2 = (i + 1) / steps;
      slopeUVs.push(u1, 1, u1, 0, u2, 1);
      slopeUVs.push(u2, 1, u1, 0, u2, 0);
    }
    slopeGeo.setAttribute("position", new THREE.Float32BufferAttribute(slopePos, 3));
    slopeGeo.setAttribute("uv", new THREE.Float32BufferAttribute(slopeUVs, 2));
    slopeGeo.computeVertexNormals();
    const slopeMesh = new THREE.Mesh(slopeGeo, rockMat);
    slopeMesh.receiveShadow = true;
    slopeMesh.castShadow = true;
    pitGroup.add(slopeMesh);

    // 2. Horizontal Bench Berm (Working floor of horizon)
    if (rCrestLower > 0) {
      const bermGeo = new THREE.BufferGeometry();
      const bermPos = [];
      const bermUVs = [];

      for (let i = 0; i < steps; i++) {
        const th1 = (i / steps) * Math.PI * 2;
        const th2 = ((i + 1) / steps) * Math.PI * 2;

        const x1_out = rToeLower * SX * Math.cos(th1) * SCALE_HORIZ;
        const z1_out = -rToeLower * SY * Math.sin(th1) * SCALE_HORIZ;
        const x2_out = rToeLower * SX * Math.cos(th2) * SCALE_HORIZ;
        const z2_out = -rToeLower * SY * Math.sin(th2) * SCALE_HORIZ;

        const x1_in = rCrestLower * SX * Math.cos(th1) * SCALE_HORIZ;
        const z1_in = -rCrestLower * SY * Math.sin(th1) * SCALE_HORIZ;
        const x2_in = rCrestLower * SX * Math.cos(th2) * SCALE_HORIZ;
        const z2_in = -rCrestLower * SY * Math.sin(th2) * SCALE_HORIZ;

        bermPos.push(x1_out, yLower, z1_out, x2_out, yLower, z2_out, x1_in, yLower, z1_in);
        bermPos.push(x2_out, yLower, z2_out, x2_in, yLower, z2_in, x1_in, yLower, z1_in);

        bermUVs.push(0, 0, 1, 0, 0, 1);
        bermUVs.push(1, 0, 1, 1, 0, 1);
      }
      bermGeo.setAttribute("position", new THREE.Float32BufferAttribute(bermPos, 3));
      bermGeo.setAttribute("uv", new THREE.Float32BufferAttribute(bermUVs, 2));
      bermGeo.computeVertexNormals();
      const bermMesh = new THREE.Mesh(bermGeo, bermMat);
      bermMesh.receiveShadow = true;
      pitGroup.add(bermMesh);
    }
  }

  // C. Pit Floor (+260m) with Drainage Sump Pond
  const floorGeo = new THREE.BufferGeometry();
  const floorPos = [];
  const rFloor = 100;
  for (let i = 0; i < steps; i++) {
    const th1 = (i / steps) * Math.PI * 2;
    const th2 = ((i + 1) / steps) * Math.PI * 2;

    const x1 = rFloor * SX * Math.cos(th1) * SCALE_HORIZ;
    const z1 = -rFloor * SY * Math.sin(th1) * SCALE_HORIZ;
    const x2 = rFloor * SX * Math.cos(th2) * SCALE_HORIZ;
    const z2 = -rFloor * SY * Math.sin(th2) * SCALE_HORIZ;

    floorPos.push(0, 0, 0, x1, 0, z1, x2, 0, z2);
  }
  floorGeo.setAttribute("position", new THREE.Float32BufferAttribute(floorPos, 3));
  floorGeo.computeVertexNormals();
  const floorMesh = new THREE.Mesh(floorGeo, bermMat);
  floorMesh.receiveShadow = true;
  pitGroup.add(floorMesh);

  // Sump water pool at pit bottom
  const poolGeo = new THREE.CircleGeometry(14, 32);
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x005977, roughness: 0.15, metalness: 0.85 });
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.rotation.x = -Math.PI / 2;
  poolMesh.position.set(0, 0.1, 0);
  pitGroup.add(poolMesh);

  // Bench horizon depth lines (subtle glowing contour ridges)
  BENCHES.forEach(b => {
    const y = (b.elev - 260) * SCALE_VERT;
    const r = b.crest > 0 ? b.crest : b.toe;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      pts.push(new THREE.Vector3(r * SX * Math.cos(th) * SCALE_HORIZ, y + 0.15, -r * SY * Math.sin(th) * SCALE_HORIZ));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x5a7099, transparent: true, opacity: 0.45 });
    const contour = new THREE.Line(lineGeo, lineMat);
    pitGroup.add(contour);
  });

  scene.add(pitGroup);
}

// --- 2. Monolithic Cut-and-Fill Haul Road Shelf (Литой карьерный серпантин) ---
function buildHaulRoadRibbon() {
  roadGroup.clear();

  // Spiral Haul Road Curve Points (from Crusher 460m down to Pit Floor 260m)
  const roadCurvePoints = [];
  const RAMP_DEF = [
    { elev: 460, r: 760, th: Math.PI / 2 },
    { elev: 460, r: 580, th: Math.PI / 2 },
    { elev: 420, r: 505, th: 0.69 },
    { elev: 380, r: 395, th: -0.50 },
    { elev: 340, r: 285, th: -1.99 },
    { elev: 300, r: 175, th: -4.10 },
    { elev: 260, r: 90,  th: -7.61 }
  ];

  // Interpolate smooth road spline
  for (let k = 0; k < RAMP_DEF.length - 1; k++) {
    const p0 = RAMP_DEF[k];
    const p1 = RAMP_DEF[k + 1];
    const n = 32;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const elev = p0.elev + (p1.elev - p0.elev) * t;
      const r = p0.r + (p1.r - p0.r) * t;
      const th = p0.th + (p1.th - p0.th) * t;
      const x = r * SX * Math.cos(th);
      const y = r * SY * Math.sin(th);
      roadCurvePoints.push(localToWorld(x, y, elev));
    }
  }

  const halfWidth = 11.0 * SCALE_HORIZ; // 22m total driving surface
  const deckPositions = [];
  const deckUVs = [];
  const rockPositions = [];
  const rockUVs = [];
  const guidePostPositions = [];

  for (let i = 0; i < roadCurvePoints.length - 1; i++) {
    const pA = roadCurvePoints[i];
    const pB = roadCurvePoints[i + 1];

    const dir = new THREE.Vector3().subVectors(pB, pA).normalize();
    const up = new THREE.Vector3(0, 1, 0);

    // Side normal: ensure vector points towards pit interior (berm / plunge slope)
    let nBerm = new THREE.Vector3().crossVectors(dir, up).normalize();
    const toCenterA = new THREE.Vector3(-pA.x, 0, -pA.z).normalize();
    if (nBerm.dot(toCenterA) < 0) {
      nBerm.negate();
    }
    const nWall = nBerm.clone().negate();

    // Cross-section vertices for slice A
    // 1. Cut into mountain wall (+3.6m elevation into rock slope)
    const vCutA = pA.clone().add(nWall.clone().multiplyScalar(halfWidth + 4.6)).add(new THREE.Vector3(0, 3.6, 0));
    // 2. Inner road gutter
    const vInnerA = pA.clone().add(nWall.clone().multiplyScalar(halfWidth)).add(new THREE.Vector3(0, 0.08, 0));
    // 3. Centerline slightly cambered
    const vCentA = pA.clone().add(new THREE.Vector3(0, 0.16, 0));
    // 4. Outer road edge
    const vOuterA = pA.clone().add(nBerm.clone().multiplyScalar(halfWidth)).add(new THREE.Vector3(0, 0.08, 0));
    // 5. Safety rock berm crest (+1.4m height barrier)
    const vBermA = pA.clone().add(nBerm.clone().multiplyScalar(halfWidth + 1.8)).add(new THREE.Vector3(0, 1.4, 0));
    // 6. Rock toe plunging into lower terrace (-4.2m)
    const vToeA = pA.clone().add(nBerm.clone().multiplyScalar(halfWidth + 5.8)).sub(new THREE.Vector3(0, 4.2, 0));

    // Next slice B
    const dirB = (i + 2 < roadCurvePoints.length) ? new THREE.Vector3().subVectors(roadCurvePoints[i + 2], pB).normalize() : dir;
    let nBermB = new THREE.Vector3().crossVectors(dirB, up).normalize();
    const toCenterB = new THREE.Vector3(-pB.x, 0, -pB.z).normalize();
    if (nBermB.dot(toCenterB) < 0) {
      nBermB.negate();
    }
    const nWallB = nBermB.clone().negate();

    const vCutB = pB.clone().add(nWallB.clone().multiplyScalar(halfWidth + 4.6)).add(new THREE.Vector3(0, 3.6, 0));
    const vInnerB = pB.clone().add(nWallB.clone().multiplyScalar(halfWidth)).add(new THREE.Vector3(0, 0.08, 0));
    const vCentB = pB.clone().add(new THREE.Vector3(0, 0.16, 0));
    const vOuterB = pB.clone().add(nBermB.clone().multiplyScalar(halfWidth)).add(new THREE.Vector3(0, 0.08, 0));
    const vBermB = pB.clone().add(nBermB.clone().multiplyScalar(halfWidth + 1.8)).add(new THREE.Vector3(0, 1.4, 0));
    const vToeB = pB.clone().add(nBermB.clone().multiplyScalar(halfWidth + 5.8)).sub(new THREE.Vector3(0, 4.2, 0));

    // A. Road Deck (2 quads: inner-to-center and center-to-outer for natural camber)
    // Quad 1: vInner -> vCent
    deckPositions.push(
      vInnerA.x, vInnerA.y, vInnerA.z,   vCentA.x, vCentA.y, vCentA.z,   vInnerB.x, vInnerB.y, vInnerB.z,
      vCentA.x, vCentA.y, vCentA.z,     vCentB.x, vCentB.y, vCentB.z,   vInnerB.x, vInnerB.y, vInnerB.z
    );
    // Quad 2: vCent -> vOuter
    deckPositions.push(
      vCentA.x, vCentA.y, vCentA.z,     vOuterA.x, vOuterA.y, vOuterA.z, vCentB.x, vCentB.y, vCentB.z,
      vOuterA.x, vOuterA.y, vOuterA.z,   vOuterB.x, vOuterB.y, vOuterB.z, vCentB.x, vCentB.y, vCentB.z
    );

    const uvV1 = (i / roadCurvePoints.length) * 48;
    const uvV2 = ((i + 1) / roadCurvePoints.length) * 48;
    deckUVs.push(
      0.0, uvV1,  0.5, uvV1,  0.0, uvV2,
      0.5, uvV1,  0.5, uvV2,  0.0, uvV2,
      0.5, uvV1,  1.0, uvV1,  0.5, uvV2,
      1.0, uvV1,  1.0, uvV2,  0.5, uvV2
    );

    // B. Monolithic Rock Structure:
    // 1. Mountain wall cut slope (vCut -> vInner)
    rockPositions.push(
      vCutA.x, vCutA.y, vCutA.z,       vInnerA.x, vInnerA.y, vInnerA.z, vCutB.x, vCutB.y, vCutB.z,
      vInnerA.x, vInnerA.y, vInnerA.z, vInnerB.x, vInnerB.y, vInnerB.z, vCutB.x, vCutB.y, vCutB.z
    );
    // 2. Safety berm inner slope (vOuter -> vBerm)
    rockPositions.push(
      vOuterA.x, vOuterA.y, vOuterA.z, vBermA.x, vBermA.y, vBermA.z,   vOuterB.x, vOuterB.y, vOuterB.z,
      vBermA.x, vBermA.y, vBermA.z,   vBermB.x, vBermB.y, vBermB.z,   vOuterB.x, vOuterB.y, vOuterB.z
    );
    // 3. Safety berm outer plunge slope into pit (vBerm -> vToe)
    rockPositions.push(
      vBermA.x, vBermA.y, vBermA.z,   vToeA.x, vToeA.y, vToeA.z,       vBermB.x, vBermB.y, vBermB.z,
      vToeA.x, vToeA.y, vToeA.z,       vToeB.x, vToeB.y, vToeB.z,       vBermB.x, vBermB.y, vBermB.z
    );

    rockUVs.push(
      0, uvV1, 1, uvV1, 0, uvV2,  1, uvV1, 1, uvV2, 0, uvV2,
      0, uvV1, 1, uvV1, 0, uvV2,  1, uvV1, 1, uvV2, 0, uvV2,
      0, uvV1, 1, uvV1, 0, uvV2,  1, uvV1, 1, uvV2, 0, uvV2
    );

    if (i % 6 === 0) {
      guidePostPositions.push({ pos: vBermA.clone().add(new THREE.Vector3(0, 0.4, 0)), isAmber: (i % 12 === 0) });
    }
  }

  // 1. Road Surface Deck Mesh
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute("position", new THREE.Float32BufferAttribute(deckPositions, 3));
  deckGeo.setAttribute("uv", new THREE.Float32BufferAttribute(deckUVs, 2));
  deckGeo.computeVertexNormals();

  const roadMat = new THREE.MeshStandardMaterial({
    map: textures.road,
    roughness: 0.88,
    metalness: 0.08,
    side: THREE.DoubleSide
  });
  const deckMesh = new THREE.Mesh(deckGeo, roadMat);
  deckMesh.receiveShadow = true;
  roadGroup.add(deckMesh);

  // 2. Monolithic Bedrock Cut & Safety Berm Mesh
  const rockGeo = new THREE.BufferGeometry();
  rockGeo.setAttribute("position", new THREE.Float32BufferAttribute(rockPositions, 3));
  rockGeo.setAttribute("uv", new THREE.Float32BufferAttribute(rockUVs, 2));
  rockGeo.computeVertexNormals();

  const rockMat = new THREE.MeshStandardMaterial({
    map: textures.rock,
    roughness: 0.92,
    metalness: 0.12,
    side: THREE.DoubleSide
  });
  const rockMesh = new THREE.Mesh(rockGeo, rockMat);
  rockMesh.receiveShadow = true;
  rockMesh.castShadow = true;
  roadGroup.add(rockMesh);

  // 3. Glowing Center Guideline
  const centerGeo = new THREE.BufferGeometry().setFromPoints(roadCurvePoints.map(p => p.clone().add(new THREE.Vector3(0, 0.32, 0))));
  const centerMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.75 });
  const centerLine = new THREE.Line(centerGeo, centerMat);
  roadGroup.add(centerLine);

  // 4. Heavy Mining Hazard Reflectors along Berm Ridge
  guidePostPositions.forEach(gp => {
    const postGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.4, 6);
    const postMat = new THREE.MeshBasicMaterial({ color: gp.isAmber ? 0xffd600 : 0xff1744 });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.copy(gp.pos);
    roadGroup.add(post);
  });
}

// --- 3. Industrial Facilities (Crusher, Stockpile, Waste Dump) ---
function buildFacilities() {
  // A. Primary Crusher Complex (ДК-01) at North Surface (+460m)
  const crusherPos = localToWorld(0, 684, 460);
  const crusherGroup = new THREE.Group();
  crusherGroup.position.copy(crusherPos);

  // Reinforced Concrete Dump Pocket Platform
  const platformGeo = new THREE.BoxGeometry(32, 10, 26);
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x3d424d, roughness: 0.7 });
  const platform = new THREE.Mesh(platformGeo, platformMat);
  platform.position.y = 5;
  platform.receiveShadow = true;
  crusherGroup.add(platform);

  // Yellow Safety Timber Stop Curb (отбойный брус)
  const curbGeo = new THREE.BoxGeometry(22, 1.8, 2.2);
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xffd600, roughness: 0.4 });
  const curb = new THREE.Mesh(curbGeo, curbMat);
  curb.position.set(0, 10.9, -10);
  crusherGroup.add(curb);

  // Steel Gyratory Crusher Tower Building
  const towerGeo = new THREE.BoxGeometry(18, 20, 18);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x2a313d, roughness: 0.5 });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.set(0, 15, -16);
  tower.castShadow = true;
  crusherGroup.add(tower);

  // Crusher Intake Hopper Throat
  const hopperGeo = new THREE.ConeGeometry(7, 5, 4);
  const hopperMat = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.8 });
  const hopper = new THREE.Mesh(hopperGeo, hopperMat);
  hopper.rotation.x = Math.PI;
  hopper.position.set(0, 18, -10);
  crusherGroup.add(hopper);

  // High Inclined Conveyor Gallery (Конвейерная галерея ДК-01 -> Склад)
  const galleryGeo = new THREE.BoxGeometry(50, 4, 4);
  const galleryMat = new THREE.MeshStandardMaterial({ color: 0x546e7a, roughness: 0.6 });
  const gallery = new THREE.Mesh(galleryGeo, galleryMat);
  gallery.position.set(24, 18, -12);
  gallery.rotation.z = -0.15;
  gallery.rotation.y = -0.4;
  gallery.castShadow = true;
  crusherGroup.add(gallery);

  // Traffic Signal Beacon (Green/Red)
  const beaconGeo = new THREE.SphereGeometry(1.2, 16, 16);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00e676 });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.set(10, 16, -2);
  crusherGroup.add(beacon);

  // 3D Billboard Sprite
  const crusherSprite = createLabelSprite("ДК-01: ДРОБИЛЬНЫЙ КОМПЛЕКС", "Приёмный бункер | 1200 т/ч", "#00e676");
  crusherSprite.position.set(0, 32, -10);
  crusherGroup.add(crusherSprite);
  labelSprites.push(crusherSprite);

  crusherGroup.userData = { type: "facility", id: "crusher-01", name: "Приёмный бункер дробилки ДК-01" };
  scene.add(crusherGroup);
  facilityMeshes["crusher-01"] = crusherGroup;

  // B. Blending Stockpile (Склад усреднения руды СУ-01)
  const spPos = localToWorld(312, 624, 458);
  const spGroup = new THREE.Group();
  spGroup.position.copy(spPos);

  const pileGeo1 = new THREE.ConeGeometry(28, 14, 24);
  const pileMat = new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 0.95 });
  const pile1 = new THREE.Mesh(pileGeo1, pileMat);
  pile1.position.y = 7;
  pile1.castShadow = true;
  pile1.receiveShadow = true;
  spGroup.add(pile1);

  const pileGeo2 = new THREE.ConeGeometry(22, 11, 20);
  const pile2 = new THREE.Mesh(pileGeo2, pileMat);
  pile2.position.set(22, 5.5, -4);
  pile2.castShadow = true;
  spGroup.add(pile2);

  const spSprite = createLabelSprite("СУ-01: СКЛАД УСРЕДНЕНИЯ", "Запас: 50 000 т | 1.30% Cu", "#ff9100");
  spSprite.position.set(10, 24, 0);
  spGroup.add(spSprite);
  labelSprites.push(spSprite);

  spGroup.userData = { type: "facility", id: "stockpile-01", name: "Склад усреднения руды СУ-01" };
  scene.add(spGroup);
  facilityMeshes["stockpile-01"] = spGroup;

  // C. North Waste Dump (Северный отвал вскрышных пород ОВ-01)
  const wdPos = localToWorld(-585, 590, 470);
  const wdGroup = new THREE.Group();
  wdGroup.position.copy(wdPos);

  const dumpGeo = new THREE.CylinderGeometry(36, 44, 16, 16);
  const dumpMat = new THREE.MeshStandardMaterial({ color: 0x546e7a, roughness: 0.95 });
  const dumpMesh = new THREE.Mesh(dumpGeo, dumpMat);
  dumpMesh.position.y = 8;
  dumpMesh.castShadow = true;
  dumpMesh.receiveShadow = true;
  wdGroup.add(dumpMesh);

  const wdSprite = createLabelSprite("ОВ-01: СЕВЕРНЫЙ ОТВАЛ", "Вскрышные породы | +470м", "#78909c");
  wdSprite.position.set(0, 24, 0);
  wdGroup.add(wdSprite);
  labelSprites.push(wdSprite);

  wdGroup.userData = { type: "facility", id: "waste-dump-01", name: "Северный отвал вскрышных пород ОВ-01" };
  scene.add(wdGroup);
  facilityMeshes["waste-dump-01"] = wdGroup;
}

// --- 4. Geological Ore Blocks in Face ---
function buildOreBlocks() {
  blocksGroup.clear();

  Object.values(ORE_BLOCKS_DEF).forEach(b => {
    const bench = BENCHES.find(bn => bn.elev === b.elev);
    if (!bench || b.crest === 0) return;

    const rMid = (bench.toe + bench.crest) * 0.5;
    const y = (b.elev - 260) * SCALE_VERT;
    const x = rMid * SX * Math.cos(b.offset);
    const z = rMid * SY * Math.sin(b.offset);
    const worldPos = localToWorld(x, z, b.elev);

    // 3D Volumetric Face Cut
    const blockGeo = new THREE.BoxGeometry(18 * SCALE_HORIZ * 2.2, 8, 14 * SCALE_HORIZ * 2.2);
    const blockMat = new THREE.MeshStandardMaterial({
      color: b.color,
      emissive: b.color,
      emissiveIntensity: 0.25,
      roughness: 0.5,
      transparent: true,
      opacity: 0.82
    });
    const mesh = new THREE.Mesh(blockGeo, blockMat);
    mesh.position.set(worldPos.x, worldPos.y + 4, worldPos.z);
    mesh.castShadow = true;

    // Glowing border wireframe
    const wireGeo = new THREE.EdgesGeometry(blockGeo);
    const wireMat = new THREE.LineBasicMaterial({ color: b.color, linewidth: 2 });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    mesh.add(wire);

    // 3D Billboard Tag
    const tagSprite = createLabelSprite(b.name, `${b.grade}% Cu | Забой`, `#${b.color.toString(16).padStart(6, '0')}`);
    tagSprite.position.set(0, 9, 0);
    tagSprite.scale.set(14, 3.8, 1);
    mesh.add(tagSprite);
    labelSprites.push(tagSprite);

    mesh.userData = { type: "block", id: b.id, name: b.name, grade: b.grade, elev: b.elev };
    blocksGroup.add(mesh);
    blockMeshes[b.id] = mesh;
  });
}

// --- 5. 3D Elevation Depth Ruler & Pit Signs ---
function buildDepthRuler() {
  const rulerGroup = new THREE.Group();
  const southX = 0;
  const southY = -620;

  // Steel lattice tower post at the pit rim
  const towerPos = localToWorld(southX, southY, 460);
  const mastGeo = new THREE.CylinderGeometry(0.6, 0.8, 76, 8);
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.6, roughness: 0.3 });
  const mast = new THREE.Mesh(mastGeo, mastMat);
  mast.position.set(towerPos.x - 25, 38, towerPos.z);
  rulerGroup.add(mast);

  // Elevation milestone plates
  BENCHES.forEach(b => {
    const y = (b.elev - 260) * SCALE_VERT;
    const plateGeo = new THREE.BoxGeometry(12, 2.2, 0.8);
    const plateMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(towerPos.x - 25, y, towerPos.z);
    rulerGroup.add(plate);

    // Billboard sign
    const sprite = createLabelSprite(`+${b.elev} м`, b.name, "#00e5ff");
    sprite.scale.set(16, 4.4, 1);
    sprite.position.set(towerPos.x - 38, y + 1.5, towerPos.z);
    rulerGroup.add(sprite);
    labelSprites.push(sprite);
  });

  scene.add(rulerGroup);
}

// --- 6. Detailed BelAZ-75131 Mining Dump Trucks ---
function createTruckMesh(truckData) {
  const group = new THREE.Group();

  // Heavy steel chassis
  const chassisGeo = new THREE.BoxGeometry(8.5, 2.2, 4.4);
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x21252b, roughness: 0.7, metalness: 0.3 });
  const chassis = new THREE.Mesh(chassisGeo, chassisMat);
  chassis.position.y = 1.6;
  group.add(chassis);

  // 6 Massive Mining Tires (Black rubber with yellow hubs)
  const wheelGeo = new THREE.CylinderGeometry(1.6, 1.6, 1.1, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141619, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xffd600, roughness: 0.4 });

  const wheelPositions = [
    [2.8, 1.6, 2.2],   // Front Right
    [2.8, 1.6, -2.2],  // Front Left
    [-2.2, 1.6, 2.4],  // Rear Right Outer
    [-2.2, 1.6, 1.5],  // Rear Right Inner
    [-2.2, 1.6, -2.4], // Rear Left Outer
    [-2.2, 1.6, -1.5]  // Rear Left Inner
  ];

  const wheels = [];
  wheelPositions.forEach(pos => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(...pos);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.15, 8), hubMat);
    wheel.add(hub);
    group.add(wheel);
    wheels.push(wheel);
  });
  group.userData.wheels = wheels;

  // BelAZ Slanted Dump Body (Кузов ковшового типа)
  const bodyGeo = new THREE.BoxGeometry(7.2, 3.4, 4.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffa000, roughness: 0.4, metalness: 0.2 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(-0.8, 4.0, 0);
  body.castShadow = true;
  group.add(body);

  // Protective Cab Canopy (Козырёк над кабиной)
  const canopyGeo = new THREE.BoxGeometry(3.6, 0.6, 4.8);
  const canopy = new THREE.Mesh(canopyGeo, bodyMat);
  canopy.position.set(2.4, 5.5, 0);
  group.add(canopy);

  // Driver Cabin on left side
  const cabGeo = new THREE.BoxGeometry(2.4, 2.4, 2.0);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 });
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(2.4, 3.4, 1.2);
  group.add(cab);

  // Cabin windshield glass
  const glassGeo = new THREE.BoxGeometry(0.2, 1.4, 1.6);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.1, metalness: 0.9 });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(3.55, 3.6, 1.2);
  group.add(glass);

  // Front radiator grille & boarding stairway
  const grilleGeo = new THREE.BoxGeometry(0.5, 2.2, 2.2);
  const grilleMat = new THREE.MeshStandardMaterial({ color: 0x424242 });
  const grille = new THREE.Mesh(grilleGeo, grilleMat);
  grille.position.set(4.3, 2.4, -0.6);
  group.add(grille);

  // Ore Payload Mound in Bed (appears when loaded)
  const oreGeo = new THREE.DodecahedronGeometry(2.2, 1);
  const oreMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9 });
  const ore = new THREE.Mesh(oreGeo, oreMat);
  ore.scale.set(1.5, 0.7, 1.0);
  ore.position.set(-0.8, 5.2, 0);
  ore.visible = false;
  group.add(ore);
  group.userData.oreMesh = ore;

  // Strobe beacon light on top
  const beaconGeo = new THREE.SphereGeometry(0.65, 8, 8);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.set(2.2, 6.2, 1.2);
  group.add(beacon);
  group.userData.beacon = beacon;

  // 3D Billboard Sprite Label
  const sprite = createLabelSprite(truckData.id.toUpperCase(), `${truckData.payload_t} т | ${truckData.speed_kmh} км/ч`, "#00e5ff");
  sprite.position.set(0, 8.2, 0);
  sprite.scale.set(12, 3.4, 1);
  group.add(sprite);
  group.userData.sprite = sprite;
  labelSprites.push(sprite);

  group.userData.type = "truck";
  group.userData.id = truckData.id;
  group.userData.data = truckData;

  scene.add(group);
  truckMeshes[truckData.id] = group;
  return group;
}

function updateTrucks3D(trucksData) {
  const now = performance.now();
  trucksData.forEach(t => {
    let mesh = truckMeshes[t.id];
    if (!mesh) {
      mesh = createTruckMesh(t);
    }
    mesh.userData.data = t;

    // Determine target world position
    let targetPos;
    if (t.local_position && t.local_position.length >= 3) {
      targetPos = localToWorld(t.local_position[0], t.local_position[1], t.local_position[2]);
    } else {
      targetPos = lonLatToWorld(t.coordinates[0], t.coordinates[1], t.coordinates[2]);
    }

    if (!mesh.userData.prevPosition) {
      mesh.position.copy(targetPos);
      mesh.userData.prevPosition = targetPos.clone();
    } else {
      mesh.userData.prevPosition = mesh.position.clone();
    }

    mesh.userData.targetPosition = targetPos.clone();
    mesh.userData.telemetryTime = now;
    mesh.userData.speedKmh = t.speed_kmh || 0;

    if (t.heading !== undefined) {
      mesh.userData.targetHeading = t.heading + Math.PI / 2;
    }

    // Ore payload in body
    const ore = mesh.userData.oreMesh;
    if (ore) {
      ore.visible = t.payload_t > 10;
      if (t.grade_cu > 1.5) {
        ore.material.color.setHex(0xd500f9); // Rich purple
      } else if (t.grade_cu >= 1.0) {
        ore.material.color.setHex(0xff9100); // Standard amber
      } else {
        ore.material.color.setHex(0x5c6bc0); // Lean slate
      }
    }

    // State beacon color
    const beacon = mesh.userData.beacon;
    if (beacon) {
      if (t.state === "hauling") beacon.material.color.setHex(0xd500f9);
      else if (t.state === "loading" || t.state === "spotting") beacon.material.color.setHex(0x00e676);
      else if (t.state.includes("queued")) beacon.material.color.setHex(0xff9100);
      else beacon.material.color.setHex(0x00e5ff);
    }
  });
}

// --- 7. Detailed EKG-15 Electric Rope Shovels ---
function createExcavatorMesh(excData) {
  const group = new THREE.Group();

  // Twin Crawler Tracks
  const trackGeo = new THREE.BoxGeometry(14, 3.2, 3.6);
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9 });
  const trackL = new THREE.Mesh(trackGeo, trackMat);
  trackL.position.set(0, 1.6, 4.2);
  const trackR = new THREE.Mesh(trackGeo, trackMat);
  trackR.position.set(0, 1.6, -4.2);
  group.add(trackL);
  group.add(trackR);

  // Central Carbody Base
  const baseGeo = new THREE.CylinderGeometry(5.2, 5.2, 2.0, 16);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.7 });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = 3.6;
  group.add(baseMesh);

  // Revolving Machinery Deck (swivels during digging)
  const deck = new THREE.Group();
  deck.position.y = 4.6;
  group.add(deck);
  group.userData.deck = deck;

  // Machinery House (Yellow heavy cab enclosure)
  const houseGeo = new THREE.BoxGeometry(12, 7.5, 9.5);
  const houseMat = new THREE.MeshStandardMaterial({ color: 0xffc107, roughness: 0.45, metalness: 0.2 });
  const house = new THREE.Mesh(houseGeo, houseMat);
  house.position.set(-1.5, 3.75, 0);
  house.castShadow = true;
  deck.add(house);
  group.userData.houseMesh = house;

  // Elevated Operator Cab on left corner
  const cabGeo = new THREE.BoxGeometry(4.0, 4.2, 3.0);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 });
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(3.2, 6.0, 3.2);
  deck.add(cab);

  const glassGeo = new THREE.BoxGeometry(0.2, 2.2, 2.4);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, metalness: 0.9, roughness: 0.1 });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(5.25, 6.2, 3.2);
  deck.add(glass);

  // Heavy Lattice Boom (Двухбалочная стрела)
  const boomGeo = new THREE.BoxGeometry(1.6, 22, 1.6);
  const boomMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6 });
  const boomL = new THREE.Mesh(boomGeo, boomMat);
  boomL.rotation.z = -Math.PI / 4.2;
  boomL.position.set(8.5, 9.5, 1.8);
  boomL.castShadow = true;
  deck.add(boomL);

  const boomR = new THREE.Mesh(boomGeo, boomMat);
  boomR.rotation.z = -Math.PI / 4.2;
  boomR.position.set(8.5, 9.5, -1.8);
  boomR.castShadow = true;
  deck.add(boomR);

  // 15 m³ Dipper Bucket & Teeth (Ковш с режущими зубьями)
  const bucketGeo = new THREE.BoxGeometry(5.2, 4.2, 5.0);
  const bucketMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6, metalness: 0.4 });
  const bucket = new THREE.Mesh(bucketGeo, bucketMat);
  bucket.position.set(15, 6.0, 0);
  bucket.castShadow = true;
  deck.add(bucket);

  // Bucket Teeth
  for (let z = -2.0; z <= 2.0; z += 1.0) {
    const toothGeo = new THREE.ConeGeometry(0.35, 1.4, 4);
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.8 });
    const tooth = new THREE.Mesh(toothGeo, toothMat);
    tooth.rotation.z = -Math.PI / 2;
    tooth.position.set(17.8, 4.8, z);
    deck.add(tooth);
  }

  // Flashing Strobe Beacon for Breakdown state
  const strobeGeo = new THREE.SphereGeometry(0.9, 16, 16);
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0x00e676 });
  const strobe = new THREE.Mesh(strobeGeo, strobeMat);
  strobe.position.set(-1.5, 8.2, 0);
  deck.add(strobe);
  group.userData.strobe = strobe;

  // 3D Billboard Sprite Label
  const sprite = createLabelSprite(excData.id.toUpperCase(), `${excData.grade_cu}% Cu | Забой`, "#ffd600");
  sprite.position.set(0, 22, 0);
  sprite.scale.set(22, 6.2, 1);
  group.add(sprite);
  group.userData.sprite = sprite;
  labelSprites.push(sprite);

  // Positioning
  const worldPos = lonLatToWorld(excData.coordinates[0], excData.coordinates[1], excData.coordinates[2]);
  group.position.copy(worldPos);

  group.userData.type = "excavator";
  group.userData.id = excData.id;
  group.userData.data = excData;

  scene.add(group);
  excavatorMeshes[excData.id] = group;
  return group;
}

function updateExcavator3D(excData) {
  excData.forEach(exc => {
    let mesh = excavatorMeshes[exc.id];
    if (!mesh) {
      mesh = createExcavatorMesh(exc);
    }
    mesh.userData.state = exc.state;
    mesh.userData.data = exc;

    const strobe = mesh.userData.strobe;
    const house = mesh.userData.houseMesh;

    if (exc.state === "breakdown") {
      if (strobe) strobe.material.color.setHex(0xff1744); // Flashing Red
      if (house) house.material.color.setHex(0xd32f2f);
    } else if (exc.state === "loading") {
      if (strobe) strobe.material.color.setHex(0x00e676); // Green loading
      if (house) house.material.color.setHex(0xffc107);
    } else {
      if (strobe) strobe.material.color.setHex(0xff9100); // Amber idle
      if (house) house.material.color.setHex(0xffc107);
    }
  });
}

// --- 8. Raycasting & Object Inspector ---
function setupRaycaster(canvas) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  canvas.addEventListener("click", event => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      let topObj = intersects[0].object;
      while (topObj.parent && topObj.parent !== scene && !topObj.userData.type) {
        topObj = topObj.parent;
      }
      if (topObj && topObj.userData.type) {
        selectEntity(topObj.userData);
      }
    }
  });
}

function selectEntity(userData) {
  selectedEntity = userData;
  const inspectorEmpty = document.getElementById("inspector-empty");
  const inspectorContent = document.getElementById("inspector-content");
  const inspectorBadge = document.getElementById("inspector-badge");

  if (inspectorEmpty) inspectorEmpty.classList.add("hidden");
  if (inspectorContent) inspectorContent.classList.remove("hidden");

  if (userData.type === "truck") {
    const t = userData.data;
    if (inspectorBadge) inspectorBadge.textContent = "БелАЗ-75131";
    document.getElementById("insp-name").textContent = t.name;
    document.getElementById("insp-status").textContent = translateState(t.state);
    document.getElementById("insp-payload").textContent = `${t.payload_t} т`;
    document.getElementById("insp-grade").textContent = `${t.grade_cu} % Cu`;
    document.getElementById("insp-speed").textContent = `${t.speed_kmh} км/ч (Уклон: ${t.grade_pct || 0}%)`;
    document.getElementById("insp-fuel").textContent = `${t.fuel_pct} %`;
    document.getElementById("insp-elev").textContent = `+${(t.coordinates[2] || 0).toFixed(1)} м`;
    document.getElementById("insp-trips").textContent = `${t.trips_completed} рейсов (${t.total_tonnes_hauled || 0} т)`;
    document.getElementById("insp-target-exc").textContent = t.target_excavator;
  } else if (userData.type === "excavator") {
    const e = userData.data;
    if (inspectorBadge) inspectorBadge.textContent = "ЭКГ-15";
    document.getElementById("insp-name").textContent = e.name;
    document.getElementById("insp-status").textContent = translateState(e.state);
    document.getElementById("insp-payload").textContent = `${e.tonnes_loaded} т отгружено`;
    document.getElementById("insp-grade").textContent = `${e.grade_cu} % Cu`;
    document.getElementById("insp-speed").textContent = `Очередь: ${e.queue_len} ед.`;
    document.getElementById("insp-fuel").textContent = `Крепость f=${e.hardness_f}`;
    document.getElementById("insp-elev").textContent = `Горизонт +${e.coordinates[2]} м`;
    document.getElementById("insp-trips").textContent = `${e.passes_total} ковшей`;
    document.getElementById("insp-target-exc").textContent = e.block_id;
  } else if (userData.type === "block") {
    if (inspectorBadge) inspectorBadge.textContent = "Рудный блок";
    document.getElementById("insp-name").textContent = userData.name;
    document.getElementById("insp-status").textContent = `Горизонт +${userData.elev} м`;
    document.getElementById("insp-payload").textContent = `Балансовые запасы`;
    document.getElementById("insp-grade").textContent = `${userData.grade} % Cu`;
    document.getElementById("insp-speed").textContent = `Категория: Руда`;
    document.getElementById("insp-fuel").textContent = `Крепость: f=10-12`;
    document.getElementById("insp-elev").textContent = `+${userData.elev} м`;
    document.getElementById("insp-trips").textContent = `Открытый забой`;
    document.getElementById("insp-target-exc").textContent = userData.id;
  }
}

function translateState(state) {
  const map = {
    "queued_at_excavator": "Очередь под погрузку в забое",
    "spotting": "Маневрирование под ковшом",
    "loading": "Идёт погрузка руды",
    "hauling": "Подъём по съезду с грузом на ДК-01",
    "queued_at_crusher": "Очередь у бункера дробилки",
    "spotting_at_crusher": "Заезд на разгрузочную площадку",
    "dumping": "Разгрузка руды в бункер",
    "returning": "Спуск в карьер (порожний рейс)",
    "refueling": "Заправка топливом",
    "breakdown": "АВАРИЯ / РЕМОНТ",
    "idle": "В ожидании самосвала"
  };
  return map[state] || state;
}

// --- 9. Live Telemetry Trend Chart ---
function initChart() {
  const ctx = document.getElementById("blendTrendChart").getContext("2d");
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Качество шихты (% Cu)",
          data: [],
          borderColor: "#00e5ff",
          backgroundColor: "rgba(0, 229, 255, 0.12)",
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: "Целевая уставка (1.05%)",
          data: [],
          borderColor: "#00e676",
          borderDash: [5, 5],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: "#9aa8c7", font: { size: 10 } } }
      },
      scales: {
        x: { display: false },
        y: {
          min: 0.4,
          max: 1.8,
          ticks: { color: "#5e6e8e", font: { size: 10 } },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        }
      }
    }
  });
}

function updateChart(gradeCu) {
  if (!trendChart) return;
  const now = new Date().toLocaleTimeString();
  trendChart.data.labels.push(now);
  trendChart.data.datasets[0].data.push(gradeCu);
  trendChart.data.datasets[1].data.push(1.05);

  if (trendChart.data.labels.length > 35) {
    trendChart.data.labels.shift();
    trendChart.data.datasets[0].data.shift();
    trendChart.data.datasets[1].data.shift();
  }
  trendChart.update("none");
}

// --- 10. Fetch Telemetry Loop & UI Sync ---
async function fetchFleetTelemetry() {
  try {
    const res = await fetch(`${SIM_API_BASE}/api/fleet`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    cachedFleetState = data;
    renderTelemetry(data);
  } catch (err) {
    const st = document.getElementById("sim-status-text");
    if (st) st.textContent = "ПОДКЛЮЧЕНИЕ К СИМУЛЯТОРУ...";
  }
}

function renderTelemetry(data) {
  const st = document.getElementById("sim-status-text");
  if (st) st.textContent = "СИМУЛЯТОР В ЭФИРЕ";
  const kpi = data.kpi;

  // Grade value and pin position
  const cuGrade = kpi.crusher_grade_cu;
  document.getElementById("metric-cu-grade").textContent = cuGrade.toFixed(2);

  // Pin: 0.5% = 0%, 1.05% = 50%, 2.0% = 100%
  const pinPct = Math.max(0, Math.min(100, ((cuGrade - 0.5) / 1.5) * 100));
  document.getElementById("grade-indicator-pin").style.left = `${pinPct}%`;

  const alertBox = document.getElementById("grade-alert");
  if (Math.abs(cuGrade - 1.05) <= 0.08) {
    alertBox.className = "alert-box alert-normal";
    alertBox.textContent = "Качество шихты в коридоре технологической нормы (1.05 ± 0.05% Cu)";
  } else if (cuGrade < 0.95) {
    alertBox.className = "alert-box alert-warning";
    alertBox.textContent = "Внимание: качество руды просело ниже нормы (< 0.95% Cu)";
  } else {
    alertBox.className = "alert-box alert-danger";
    alertBox.textContent = "Переобогащение руды: направьте технику на балансовые забои";
  }

  document.getElementById("metric-total-tonnes").textContent = kpi.crusher_total_tonnes.toLocaleString();
  document.getElementById("metric-hourly-tph").textContent = kpi.crusher_rolling_tph.toFixed(0);
  document.getElementById("metric-active-trucks").textContent = kpi.active_trucks;
  document.getElementById("metric-queue-trucks").textContent = kpi.queued_trucks;

  // Time format
  const totalMins = data.sim_time_minutes;
  const hrs = Math.floor(totalMins / 60);
  const mins = Math.floor(totalMins % 60);
  const secs = Math.floor((totalMins * 60) % 60);
  document.getElementById("sim-time").textContent =
    `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  // Mode badge
  document.getElementById("header-mode-badge").textContent =
    data.scenarios.dispatch_mode === "QUALITY_BLEND" ? "ШИХТОВКА (QUALITY_BLEND)" : "МАКСИМУМ ТОННАЖА";

  // Update Mini Excavators List
  renderExcavatorsList(data.excavators);

  // Update 3D scene
  updateExcavator3D(data.excavators);
  updateTrucks3D(data.trucks);

  // Update chart
  updateChart(cuGrade);

  // Re-render selected entity if open
  if (selectedEntity) {
    if (selectedEntity.type === "truck") {
      const updatedTruck = data.trucks.find(t => t.id === selectedEntity.id);
      if (updatedTruck) selectEntity({ type: "truck", id: updatedTruck.id, data: updatedTruck });
    } else if (selectedEntity.type === "excavator") {
      const updatedExc = data.excavators.find(e => e.id === selectedEntity.id);
      if (updatedExc) selectEntity({ type: "excavator", id: updatedExc.id, data: updatedExc });
    }
  }
}

function renderExcavatorsList(excavators) {
  const container = document.getElementById("excavators-list");
  if (!container) return;
  container.innerHTML = "";
  excavators.forEach(e => {
    const item = document.createElement("div");
    item.className = "exc-item";
    item.onclick = () => selectEntity({ type: "excavator", id: e.id, data: e });

    const isBroken = e.state === "breakdown";
    const statusClass = e.state === "loading" ? "status-loading" : (isBroken ? "status-breakdown" : "status-idle");
    const statusText = e.state === "loading" ? "Погрузка" : (isBroken ? "Авария" : "Ожидание");

    const btnHtml = isBroken
      ? `<button class="btn-exc-action btn-exc-repair" title="Вернуть экскаватор в работу" onclick="handleExcavatorAction('${e.id}', 'repair', event)">🔧 В строй</button>`
      : `<button class="btn-exc-action btn-exc-break" title="Смоделировать аварию экскаватора" onclick="handleExcavatorAction('${e.id}', 'breakdown', event)">⚠️ Авария</button>`;

    item.innerHTML = `
      <div class="exc-info">
        <span class="exc-tag">${e.id.replace("excavator-", "ЭКГ-")}</span>
        <span class="exc-grade">(${e.grade_cu}% Cu)</span>
        <span class="exc-status ${statusClass}">${statusText}</span>
      </div>
      <div class="exc-btn-box">
        ${btnHtml}
      </div>
    `;
    container.appendChild(item);
  });
}

// Action handler for per-excavator failure and repair
async function handleExcavatorAction(excId, action, event) {
  if (event) {
    event.stopPropagation(); // Avoid triggering selectEntity row click
  }
  const endpoint = action === "repair" ? "/api/scenario/excavator-repair" : "/api/scenario/excavator-failure";
  try {
    await fetch(`${SIM_API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excavator_id: excId })
    });
    fetchFleetTelemetry();
  } catch (err) {
    console.error(`Failed to execute ${action} for ${excId}:`, err);
  }
}

// --- 11. Viewport Toolbar & Camera Handlers ---
function setupToolbarHandlers() {
  function setActiveBtn(btnId) {
    ["btn-view-3d", "btn-view-top", "btn-view-crusher", "btn-view-pit", "btn-view-follow"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("active");
    });
    const el = document.getElementById(btnId);
    if (el) el.classList.add("active");
  }

  // Camera preset 1: 3D Isometric Overview
  document.getElementById("btn-view-3d").addEventListener("click", () => {
    setActiveBtn("btn-view-3d");
    followTarget = null;
    cameraTargetPos = new THREE.Vector3(160, 200, 280);
    cameraTargetLook = new THREE.Vector3(0, 30, 0);
  });

  // Camera preset 2: Top-down 2D GIS Plan
  document.getElementById("btn-view-top").addEventListener("click", () => {
    setActiveBtn("btn-view-top");
    followTarget = null;
    cameraTargetPos = new THREE.Vector3(0, 420, 0.1);
    cameraTargetLook = new THREE.Vector3(0, 0, 0);
  });

  // Camera preset 3: Crusher Complex DK-01
  document.getElementById("btn-view-crusher").addEventListener("click", () => {
    setActiveBtn("btn-view-crusher");
    followTarget = null;
    cameraTargetPos = new THREE.Vector3(45, 120, -130);
    cameraTargetLook = localToWorld(0, 684, 460);
  });

  // Camera preset 4: Active Mining Faces
  document.getElementById("btn-view-pit").addEventListener("click", () => {
    setActiveBtn("btn-view-pit");
    followTarget = null;
    cameraTargetPos = new THREE.Vector3(70, 95, 60);
    cameraTargetLook = new THREE.Vector3(0, 25, 0);
  });

  // Camera preset 5: Follow Truck
  document.getElementById("btn-view-follow").addEventListener("click", () => {
    setActiveBtn("btn-view-follow");
    if (selectedEntity && selectedEntity.type === "truck") {
      followTarget = selectedEntity.id;
    } else {
      followTarget = "truck-01";
    }
  });

  // Camera preset 6: Reset
  document.getElementById("btn-view-reset").addEventListener("click", () => {
    setActiveBtn("btn-view-3d");
    followTarget = null;
    cameraTargetPos = new THREE.Vector3(160, 200, 280);
    cameraTargetLook = new THREE.Vector3(0, 30, 0);
  });

  // Layer Toggles
  document.getElementById("btn-toggle-labels").addEventListener("click", function() {
    showLabels = !showLabels;
    this.classList.toggle("active", showLabels);
    labelsGroup.visible = showLabels;
    labelSprites.forEach(s => s.visible = showLabels);
  });

  document.getElementById("btn-toggle-blocks").addEventListener("click", function() {
    showBlocks = !showBlocks;
    this.classList.toggle("active", showBlocks);
    blocksGroup.visible = showBlocks;
  });

  document.getElementById("btn-toggle-roads").addEventListener("click", function() {
    showRoads = !showRoads;
    this.classList.toggle("active", showRoads);
    roadGroup.visible = showRoads;
  });
}

// --- 12. What-If Scenario Button Handlers ---
function setupScenarioButtons() {
  // Scenario 1: Breakdown
  document.getElementById("btn-scenario-failure").addEventListener("click", async () => {
    try {
      await fetch(`${SIM_API_BASE}/api/scenario/excavator-failure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excavator_id: "excavator-01" })
      });
      fetchFleetTelemetry();
    } catch (e) { console.error(e); }
  });

  // Scenario 2: Toggle Dispatch Mode
  document.getElementById("btn-scenario-dispatch").addEventListener("click", async () => {
    const nextMode = cachedFleetState?.scenarios?.dispatch_mode === "QUALITY_BLEND" ? "MAX_TONNAGE" : "QUALITY_BLEND";
    try {
      await fetch(`${SIM_API_BASE}/api/scenario/dispatch-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode })
      });
      fetchFleetTelemetry();
    } catch (e) { console.error(e); }
  });

  // Scenario 3: Road Condition
  document.getElementById("btn-scenario-road").addEventListener("click", async () => {
    const isIce = cachedFleetState?.scenarios?.road_condition === "slippery_ice";
    const nextCond = isIce ? "normal" : "slippery_ice";
    try {
      await fetch(`${SIM_API_BASE}/api/scenario/road-condition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition: nextCond, speed_factor: isIce ? 1.0 : 0.55 })
      });
      fetchFleetTelemetry();
    } catch (e) { console.error(e); }
  });

  // Scenario 4: Reset
  document.getElementById("btn-scenario-reset").addEventListener("click", async () => {
    try {
      await fetch(`${SIM_API_BASE}/api/scenario/reset`, { method: "POST" });
      fetchFleetTelemetry();
    } catch (e) { console.error(e); }
  });
}

// Bootstrap Application
window.addEventListener("DOMContentLoaded", () => {
  init3D();
  initChart();
  setupToolbarHandlers();
  setupScenarioButtons();
  fetchFleetTelemetry();
  setInterval(fetchFleetTelemetry, 1000);
});
