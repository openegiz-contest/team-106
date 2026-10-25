// OpenEgiz Digital Mine 3D Visualization and Control Center
const SIM_API_BASE = window.location.hostname === "localhost" ? "http://localhost:8000" : `http://${window.location.hostname}:8000`;

// --- Global State ---
let scene, camera, renderer, controls;
let truckMeshes = {};
let excavatorMeshes = {};
let blockMeshes = {};
let roadLines = [];
let trendChart = null;
let selectedEntity = null;
let cachedFleetState = null;

// Scale factors: map lon/lat to 3D scene coordinates
const CENTER_LON = 76.9230;
const CENTER_LAT = 43.2260;
const SCALE_XY = 12000.0;
const SCALE_Z = 0.35;

function lonLatToWorld(lon, lat, elev) {
  const x = (lon - CENTER_LON) * SCALE_XY;
  const z = -(lat - CENTER_LAT) * SCALE_XY;
  const y = (elev - 260.0) * SCALE_Z; // Base level 0 at pit bottom
  return new THREE.Vector3(x, y, z);
}

// --- Initialize 3D Scene ---
function init3D() {
  const container = document.getElementById("scene3d-container");
  const width = container.clientWidth;
  const height = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080c16);
  scene.fog = new THREE.FogExp2(0x080c16, 0.0035);

  camera = new THREE.PerspectiveCamera(45, width / height, 1, 2500);
  camera.position.set(120, 180, 240);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.target.set(0, 30, 0);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xfff3e0, 1.2);
  dirLight.position.set(150, 350, 200);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  scene.add(dirLight);

  const blueLight = new THREE.DirectionalLight(0x00e5ff, 0.4);
  blueLight.position.set(-150, 100, -150);
  scene.add(blueLight);

  // Ground Grid
  const gridHelper = new THREE.GridHelper(600, 40, 0x1e2942, 0x11182c);
  gridHelper.position.y = -0.5;
  scene.add(gridHelper);

  // Build Static Pit Geometry: Benches, Roads, Crusher, Stockpile
  buildPitBenches();
  buildRoadNetwork();
  buildFacilities();

  // Raycasting for object selection
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
    controls.update();

    // Subtle idle animations
    Object.values(excavatorMeshes).forEach(mesh => {
      if (mesh.userData.state === "loading") {
        mesh.rotation.y += 0.015;
      }
    });

    renderer.render(scene, camera);
  }
  animate();
}

// --- Pit Benches Geometry ---
function buildPitBenches() {
  const benchLevels = [
    { elev: 460, rx: 110, rz: 85, color: 0x242e42 },
    { elev: 420, rx: 95, rz: 72, color: 0x2b3852 },
    { elev: 380, rx: 78, rz: 60, color: 0x334466 },
    { elev: 340, rx: 62, rz: 48, color: 0x3c507a },
    { elev: 300, rx: 46, rz: 36, color: 0x465d8e },
    { elev: 260, rx: 30, rz: 24, color: 0x516ca4 }
  ];

  benchLevels.forEach((b, idx) => {
    const y = (b.elev - 260.0) * SCALE_Z;
    const geometry = new THREE.CylinderGeometry(b.rx, b.rx + 6, 12, 48, 1, true);
    const material = new THREE.MeshStandardMaterial({
      color: b.color,
      roughness: 0.85,
      metalness: 0.15,
      side: THREE.DoubleSide
    });
    const bench = new THREE.Mesh(geometry, material);
    bench.position.set(0, y, 0);
    bench.receiveShadow = true;
    scene.add(bench);
  });

  // Geological ore block volumetric markers
  const blockData = [
    { id: "block-01", elev: 420, angle: 0.5, dist: 78, grade: 1.65, color: 0xd500f9 },
    { id: "block-03", elev: 380, angle: 1.8, dist: 60, grade: 1.85, color: 0xe040fb },
    { id: "block-05", elev: 340, angle: 3.2, dist: 46, grade: 1.05, color: 0xff9100 },
    { id: "block-07", elev: 300, angle: 4.6, dist: 32, grade: 1.45, color: 0xab47bc }
  ];

  blockData.forEach(blk => {
    const y = (blk.elev - 260.0) * SCALE_Z;
    const x = Math.cos(blk.angle) * blk.dist;
    const z = Math.sin(blk.angle) * blk.dist;

    const geo = new THREE.BoxGeometry(16, 8, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: blk.color,
      emissive: blk.color,
      emissiveIntensity: 0.2,
      roughness: 0.6,
      transparent: true,
      opacity: 0.75
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + 4, z);
    mesh.userData = { type: "block", id: blk.id, grade: blk.grade };
    scene.add(mesh);
    blockMeshes[blk.id] = mesh;
  });
}

// --- Build Haul Roads in 3D ---
function buildRoadNetwork() {
  const roadSplinePoints = [
    lonLatToWorld(76.9250, 43.2350, 460.0), // Crusher
    lonLatToWorld(76.9230, 43.2320, 455.0), // Surface Junc
    lonLatToWorld(76.9205, 43.2310, 420.0), // 420m Ramp
    lonLatToWorld(76.9215, 43.2270, 380.0), // 380m Ramp
    lonLatToWorld(76.9245, 43.2230, 340.0), // 340m Ramp
    lonLatToWorld(76.9275, 43.2190, 300.0)  // 300m Ramp
  ];

  const curve = new THREE.CatmullRomCurve3(roadSplinePoints);
  const tubeGeo = new THREE.TubeGeometry(curve, 64, 2.2, 8, false);
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0x3d4b66,
    roughness: 0.9,
    metalness: 0.1
  });
  const roadMesh = new THREE.Mesh(tubeGeo, tubeMat);
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  // Glowing center guideline
  const lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(100));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.6 });
  const centerLine = new THREE.Line(lineGeo, lineMat);
  centerLine.position.y += 0.2;
  scene.add(centerLine);
}

// --- Build Facilities (Crusher & Stockpile) ---
function buildFacilities() {
  // Crusher Plant
  const crusherPos = lonLatToWorld(76.9250, 43.2350, 460.0);
  const crusherGroup = new THREE.Group();
  crusherGroup.position.copy(crusherPos);

  const baseGeo = new THREE.BoxGeometry(22, 14, 18);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.5 });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = 7;
  crusherGroup.add(baseMesh);

  // Intake hopper
  const hopperGeo = new THREE.ConeGeometry(8, 6, 4);
  const hopperMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.7 });
  const hopperMesh = new THREE.Mesh(hopperGeo, hopperMat);
  hopperMesh.rotation.x = Math.PI;
  hopperMesh.position.set(0, 15, 0);
  crusherGroup.add(hopperMesh);

  // Animated Beacon
  const beaconGeo = new THREE.SphereGeometry(1.2, 16, 16);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00e676 });
  const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
  beaconMesh.position.set(0, 17, 0);
  crusherGroup.add(beaconMesh);

  crusherGroup.userData = { type: "facility", id: "crusher-01", name: "Приёмный бункер дробилки ДК-01" };
  scene.add(crusherGroup);

  // Stockpile
  const spPos = lonLatToWorld(76.9300, 43.2380, 455.0);
  const spGeo = new THREE.ConeGeometry(24, 12, 16);
  const spMat = new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.95 });
  const spMesh = new THREE.Mesh(spGeo, spMat);
  spMesh.position.set(spPos.x, spPos.y + 6, spPos.z);
  spMesh.userData = { type: "facility", id: "stockpile-01", name: "Склад усреднения руды СУ-01" };
  scene.add(spMesh);
}

// --- Sync Excavators in 3D ---
function updateExcavator3D(excData) {
  excData.forEach(exc => {
    let mesh = excavatorMeshes[exc.id];
    if (!mesh) {
      const group = new THREE.Group();
      // Body
      const bodyGeo = new THREE.BoxGeometry(10, 6, 8);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffd600, roughness: 0.4 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 3;
      group.add(body);

      // Boom & Bucket
      const boomGeo = new THREE.CylinderGeometry(0.8, 0.8, 14, 8);
      const boomMat = new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.6 });
      const boom = new THREE.Mesh(boomGeo, boomMat);
      boom.rotation.z = Math.PI / 4;
      boom.position.set(5, 8, 0);
      group.add(boom);

      const bucketGeo = new THREE.BoxGeometry(4, 3, 4);
      const bucketMat = new THREE.MeshStandardMaterial({ color: 0x424242 });
      const bucket = new THREE.Mesh(bucketGeo, bucketMat);
      bucket.position.set(10, 12, 0);
      group.add(bucket);

      const worldPos = lonLatToWorld(exc.coordinates[0], exc.coordinates[1], exc.coordinates[2]);
      group.position.copy(worldPos);
      group.userData = { type: "excavator", id: exc.id, data: exc };

      scene.add(group);
      excavatorMeshes[exc.id] = group;
      mesh = group;
    }

    mesh.userData.state = exc.state;
    mesh.userData.data = exc;

    // Visual breakdown indicator
    if (exc.state === "breakdown") {
      mesh.children[0].material.color.setHex(0xff1744); // Red
    } else {
      mesh.children[0].material.color.setHex(0xffd600); // Yellow
    }
  });
}

// --- Sync Haul Trucks in 3D ---
function updateTrucks3D(trucksData) {
  trucksData.forEach(t => {
    let mesh = truckMeshes[t.id];
    if (!mesh) {
      const group = new THREE.Group();

      // Chassis & Wheels
      const chassisGeo = new THREE.BoxGeometry(8, 2.5, 4.5);
      const chassisMat = new THREE.MeshStandardMaterial({ color: 0x263238 });
      const chassis = new THREE.Mesh(chassisGeo, chassisMat);
      chassis.position.y = 1.5;
      group.add(chassis);

      // Dump Bed (Payload body)
      const bedGeo = new THREE.BoxGeometry(6.5, 3.2, 4.8);
      const bedMat = new THREE.MeshStandardMaterial({ color: 0xffab00, roughness: 0.35 });
      const bed = new THREE.Mesh(bedGeo, bedMat);
      bed.position.set(-0.6, 3.6, 0);
      group.add(bed);

      // Cabin
      const cabGeo = new THREE.BoxGeometry(2.5, 2.5, 2.2);
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const cab = new THREE.Mesh(cabGeo, cabMat);
      cab.position.set(2.8, 3.2, 1.1);
      group.add(cab);

      // Glowing position beacon
      const beaconGeo = new THREE.SphereGeometry(0.7, 8, 8);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(0, 6, 0);
      group.add(beacon);

      group.userData = { type: "truck", id: t.id, data: t };
      scene.add(group);
      truckMeshes[t.id] = group;
      mesh = group;
    }

    mesh.userData.data = t;

    // Update 3D position
    const targetPos = lonLatToWorld(t.coordinates[0], t.coordinates[1], t.coordinates[2]);
    mesh.position.lerp(targetPos, 0.4);

    // Color code truck beacon by state
    const beacon = mesh.children[3];
    if (t.state === "hauling") {
      beacon.material.color.setHex(0xd500f9); // Loaded purple
    } else if (t.state === "loading" || t.state === "spotting") {
      beacon.material.color.setHex(0x00e676); // Green loading
    } else if (t.state === "queued_at_excavator" || t.state === "queued_at_crusher") {
      beacon.material.color.setHex(0xff9100); // Queued amber
    } else {
      beacon.material.color.setHex(0x00e5ff); // Empty returning cyan
    }
  });
}

// --- Raycasting & Entity Selection ---
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

  inspectorEmpty.classList.add("hidden");
  inspectorContent.classList.remove("hidden");

  if (userData.type === "truck") {
    const t = userData.data;
    inspectorBadge.textContent = "БелАЗ-75131";
    document.getElementById("insp-name").textContent = t.name;
    document.getElementById("insp-status").textContent = translateState(t.state);
    document.getElementById("insp-payload").textContent = `${t.payload_t} т`;
    document.getElementById("insp-grade").textContent = `${t.grade_cu} % Cu`;
    document.getElementById("insp-speed").textContent = `${t.speed_kmh} км/ч`;
    document.getElementById("insp-fuel").textContent = `${t.fuel_pct} %`;
    document.getElementById("insp-elev").textContent = `+${t.coordinates[2].toFixed(1)} м`;
    document.getElementById("insp-trips").textContent = `${t.trips_completed} рейсов`;
    document.getElementById("insp-target-exc").textContent = t.target_excavator;
  } else if (userData.type === "excavator") {
    const e = userData.data;
    inspectorBadge.textContent = "ЭКГ-15";
    document.getElementById("insp-name").textContent = e.name;
    document.getElementById("insp-status").textContent = translateState(e.state);
    document.getElementById("insp-payload").textContent = `${e.tonnes_loaded} т отгружено`;
    document.getElementById("insp-grade").textContent = `${e.grade_cu} % Cu`;
    document.getElementById("insp-speed").textContent = `Очередь: ${e.queue_len} ед.`;
    document.getElementById("insp-fuel").textContent = `Крепость f=${e.hardness_f}`;
    document.getElementById("insp-elev").textContent = `Горизонт +${e.coordinates[2]} м`;
    document.getElementById("insp-trips").textContent = `${e.passes_total} ковшей`;
    document.getElementById("insp-target-exc").textContent = e.block_id;
  }
}

function translateState(state) {
  const map = {
    "queued_at_excavator": "Очередь под погрузку",
    "spotting": "Маневрирование под экскаватором",
    "loading": "Погрузка ковшом",
    "hauling": "Транспортировка руды (Подъём)",
    "queued_at_crusher": "Очередь у приёмного бункера",
    "spotting_at_crusher": "Заезд на разгрузочную площадку",
    "dumping": "Разгрузка в бункер дробилки",
    "returning": "Порожний рейс (Спуск в карьер)",
    "refueling": "Заправка топливом",
    "breakdown": "Аварийная остановка / Ремонт",
    "idle": "В ожидании самосвала"
  };
  return map[state] || state;
}

// --- Live Telemetry Chart ---
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
          backgroundColor: "rgba(0, 229, 255, 0.1)",
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: "Целевой коридор (1.05%)",
          data: [],
          borderColor: "rgba(0, 230, 118, 0.6)",
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
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "index",
          intersect: false
        }
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

// --- Fetch Telemetry & Update UI ---
async function fetchFleetTelemetry() {
  try {
    const res = await fetch(`${SIM_API_BASE}/api/fleet`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    cachedFleetState = data;
    renderTelemetry(data);
  } catch (err) {
    document.getElementById("sim-status-text").textContent = "ПОДКЛЮЧЕНИЕ К СИМУЛЯТОРУ...";
  }
}

function renderTelemetry(data) {
  document.getElementById("sim-status-text").textContent = "СИМУЛЯТОР В ЭФИРЕ";
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
    alertBox.textContent = "Качество шихты в коридоре технологической нормы";
  } else if (cuGrade < 0.95) {
    alertBox.className = "alert-box alert-warning";
    alertBox.textContent = "Внимание: качество руды просело ниже нормы (< 0.95% Cu)";
  } else {
    alertBox.className = "alert-box alert-danger";
    alertBox.textContent = "Переобогащение руды: перенаправьте технику на балансовые забои";
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
  container.innerHTML = "";
  excavators.forEach(e => {
    const item = document.createElement("div");
    item.className = "exc-item";
    item.onclick = () => selectEntity({ type: "excavator", id: e.id, data: e });

    const statusClass = e.state === "loading" ? "status-loading" : (e.state === "breakdown" ? "status-breakdown" : "status-idle");
    const statusText = e.state === "loading" ? "Погрузка" : (e.state === "breakdown" ? "Авария" : "Ожидание");

    item.innerHTML = `
      <div>
        <span class="exc-tag">${e.id.toUpperCase()}</span>
        <span style="color: var(--text-muted); margin-left: 6px;">(${e.grade_cu}% Cu)</span>
      </div>
      <div>
        <span class="exc-status ${statusClass}">${statusText}</span>
      </div>
    `;
    container.appendChild(item);
  });
}

// --- What-If Scenario Button Handlers ---
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

  // Camera toolbar buttons
  document.getElementById("btn-view-3d").addEventListener("click", () => {
    document.getElementById("btn-view-3d").classList.add("active");
    document.getElementById("btn-view-top").classList.remove("active");
    camera.position.set(120, 180, 240);
    controls.target.set(0, 30, 0);
  });

  document.getElementById("btn-view-top").addEventListener("click", () => {
    document.getElementById("btn-view-top").classList.add("active");
    document.getElementById("btn-view-3d").classList.remove("active");
    camera.position.set(0, 380, 0);
    controls.target.set(0, 30, 0);
  });

  document.getElementById("btn-view-reset").addEventListener("click", () => {
    camera.position.set(120, 180, 240);
    controls.target.set(0, 30, 0);
  });
}

// Bootstrap application on load
window.addEventListener("DOMContentLoaded", () => {
  init3D();
  initChart();
  setupScenarioButtons();
  fetchFleetTelemetry();
  setInterval(fetchFleetTelemetry, 1000);
});
