const SIMULATION_FPS = 60;
const SIMULATION_STEP_MS = 1000 / SIMULATION_FPS;
let simulationFrame = 0;
let simulationTime = 0;

let SizeF = 0.4;
const particleSize = 36;
const identity = { size:1.65, grouping:0.55, reach:0.5, threshold:0.4 };
function identitySizeTier(i) {const p=(i*0.61803398875)%1;return p<0.6?1:p<0.9?0.75:0.5;}
const particleSpawnDistance = Math.max(1, particleSize); // Initial spawn spacing, in pixels.
const particleSeparationDistance = Math.max(1, particleSize/1.5); // Movement separation distance, in pixels.
const pathRadius = 40; // Before scazling; full path width = pathRadius * SizeF * 2.

const pathLetters = ["R", "O", "A","M"];
let pathLetterIndex = 0;
let pathStep = 0;
const cameraOffset = { x: 0, y: 0 };
const cameraFollowSpeed = 0.1;
let paths = [];
let debug = false;
let vehicles = [];
const transitionOutwardStrength = 10; // Multiplier of each particle's maxforce.
const transitionOutwardDuration = 700; // Milliseconds.
let transitionOutwardStart = -Infinity;

function startOutwardTransition() {
  const active = vehicles.filter(v => !v.collisionOnly);
  if (!active.length) return;
  const centerX = active.reduce((sum,v) => sum+v.position.x,0)/active.length;
  const centerY = active.reduce((sum,v) => sum+v.position.y,0)/active.length;
  active.forEach((v,i) => {
    const dx=v.position.x-centerX, dy=v.position.y-centerY;
    const length=Math.hypot(dx,dy);
    const angle=i*2.3999632297;
    v.transitionDirection=createVector(length>0.001 ? dx/length : Math.cos(angle), length>0.001 ? dy/length : Math.sin(angle));
  });
  transitionOutwardStart=simulationTime;
}

function applyOutwardTransition() {
  const progress=(simulationTime-transitionOutwardStart)/transitionOutwardDuration;
  if (progress<0 || progress>=1) return;
  const strength=transitionOutwardStrength*(1-progress)*(1-progress);
  for (const v of vehicles) {
    if (!v.collisionOnly && v.transitionDirection) v.applyForce(v.transitionDirection.copy().mult(v.maxforce*strength));
  }
}
let totalExternalParticles = 95;
const particleTypes = [
  { shape: "square", color: "#107DFE", count: 20 },
  { shape: "circle", color: "#FD5F00", count: 20 },
  { shape: "circle", color: "#02B553", count: 20 },
    { shape: "circle", color: "#14151A", count: 20 },
  { shape: "circle", shapeB: "circle", color: "#FB8BF7", count: 20 },
  // { shape: "circle", color: "#fff", count: 10 },
  { shape: "circle", shapeB: "circle", color: "#cbd4d8", count: 20 },
  { shape: "circle", shapeB: "circle", color: "#14151A", count: 0, collisionOnly: true },
];
let fontSize = 800*SizeF;
let font;

function preload() {
  font = loadFont("../path-sample-transition copy/assets/GT-Maru-Mono-Black-Trial.otf");
}

function setup() {
  frameRate(SIMULATION_FPS);
  const canvas = createCanvas(1080*SizeF, 1080*SizeF).parent("canvas-container");
  canvas.elt.addEventListener("click", switchPathLetter);
  canvas.elt.style.cursor = "pointer";
  canvas.elt.title = "点击切换下一个字母路径";

  newPaths(); // Generate multiple paths
  
  spawnConfiguredParticles();
  setupMetaballs();
  particleTypes.forEach((type, index) => {
    type.count = vehicles.filter(vehicle => vehicle.typeIndex === index).length;
  });
  setupParticleControls();
}

function spawnVehiclesInsidePathBand(targetCount = null, sampleSpacing = particleSpawnDistance) {
  if (targetCount === 0) return;
  const samples = [];
  const points = paths.flatMap(path => path.points);
  if (points.length === 0) return;

  const padding = Math.max(...paths.map(path => path.radius));
  const minX = Math.min(...points.map(point => point.x)) - padding;
  const maxX = Math.max(...points.map(point => point.x)) + padding;
  const minY = Math.min(...points.map(point => point.y)) - padding;
  const maxY = Math.max(...points.map(point => point.y)) + padding;
  const spacing = sampleSpacing;
  const columns = Math.max(1, Math.floor((maxX - minX) / spacing));
  const rows = Math.max(1, Math.floor((maxY - minY) / spacing));
  const startX = (minX + maxX - (columns - 1) * spacing) / 2;
  const startY = (minY + maxY - (rows - 1) * spacing) / 2;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = startX + column * spacing;
      const y = startY + row * spacing;

      // Keep the existing motion by assigning the nearest contour.
      const position = createVector(x, y);
      let nearestPath = null;
      let nearestDistance = Infinity;
      for (const path of paths) {
        for (let i = 1; i < path.points.length; i++) {
          const normal = getNormalPoint(position, path.points[i - 1], path.points[i]);
          const distance = p5.Vector.dist(position, normal);
          if (distance <= path.radius && distance < nearestDistance) {
            nearestDistance = distance;
            nearestPath = path;
          }
        }
      }
      if (nearestPath) samples.push({ x, y, path: nearestPath });
    }
  }
  if (targetCount !== null && samples.length < targetCount) {
    return spawnVehiclesInsidePathBand(targetCount, sampleSpacing / 2);
  }
  const count = targetCount === null ? samples.length : targetCount;
  const selected=Array.from({length:count},(_,i)=>samples[Math.floor((i+0.5)*samples.length/count)]);
  const quota=particleTypes.map(type=>type.collisionOnly?0:type.count);
  const byPosition=selected.map((p,i)=>({p,i})).sort((a,b)=>a.p.x-b.p.x||a.p.y-b.p.y);
  const allocations=Array(count).fill(-1);
  const groupedColors=[];quota.forEach((qty,type)=>{for(let n=0;n<qty;n++)groupedColors.push(type);});
  const remaining=quota.slice();
  const groupedCount=Math.round(count*identity.grouping);
  for(let i=0;i<groupedCount;i++){
    const type=groupedColors[i];
    allocations[byPosition[i].i]=type;
    remaining[type]--;
  }
  let type=0;
  for(let i=0;i<count;i++){
    if(allocations[i]!==-1)continue;
    while(remaining[type]===0)type=(type+1)%remaining.length;
    allocations[i]=type;
    remaining[type]--;
    type=(type+1)%remaining.length;
  }
  selected.forEach((p,i)=>newVehicle(p.x,p.y,p.path,allocations[i]));
}

function updatePathCamera() {
  // Camera targets the new path center independently of particle movement.
  const targetX = 0;
  const targetY = pathStep * height * 0;
  const speed = Math.max(0, Math.min(1, cameraFollowSpeed));
  cameraOffset.x += (targetX - cameraOffset.x) * speed;
  cameraOffset.y += (targetY - cameraOffset.y) * speed;
  if (Math.abs(targetX - cameraOffset.x) < 0.01) cameraOffset.x = targetX;
  if (Math.abs(targetY - cameraOffset.y) < 0.01) cameraOffset.y = targetY;
}
function draw() {
  simulationFrame++;
  simulationTime = simulationFrame * SIMULATION_STEP_MS;
  background("#fff");
  const gathering = updateCircleTransition();
  const sampling = circleTransition?.mode === "samples";
  const seekingSamples = new Set(sampling ? circleTransition.entries.filter(entry => !entry.arrived).map(entry => entry.vehicle) : []);
  if (!gathering || sampling) {
  // Debug drawing and contours use world coordinates; the GPU receives camera-relative positions.
  push();
  translate(-cameraOffset.x, -cameraOffset.y);
  for (const v of vehicles) {
    if (v.collisionOnly) applyInteriorAttraction(v);
    else if (!seekingSamples.has(v)) v.applyBehaviors(vehicles, v.assignedPath);
  }
  applyOutwardTransition();
  pop();
  }
  // Integration and collisions stay active during both gathering and holding.
  for (const v of vehicles) v.update();
  if (document.getElementById("collision-enabled").checked) resolveParticleCollisions(vehicles);
  updatePathCamera();
  push();
  translate(-cameraOffset.x, -cameraOffset.y);
  if ((!gathering || sampling) && document.getElementById("show-path").checked) {
    for (const p of paths) p.display();
  }
  pop();
  renderMetaballs();
}

function keyPressed() {
  if (document.activeElement.matches("input, select, button, textarea")) return;
  if (key == "d") debug = !debug;
}

function advancePathLetter(withOutwardForce = true) {
  const previousPaths = paths;
  const previousIndex = pathLetterIndex;
  pathStep++;
  pathLetterIndex = (pathLetterIndex + 1) % pathLetters.length;
  newPaths();
  if (!paths.length) {
    paths = previousPaths;
    pathLetterIndex = previousIndex;
    pathStep--;
    return;
  }
  if (withOutwardForce) startOutwardTransition();
  // Preserve particles and their motion; only replace their target contours.
  for (const vehicle of vehicles) {
    if (vehicle.collisionOnly) continue;
    let nearestPath = paths[0];
    let nearestDistance = Infinity;
    // Compare in the new tile to retain each particle's relative contour assignment.
    const projectedPosition = createVector(vehicle.position.x, vehicle.position.y + height * 0);
    for (const path of paths) {
      for (let i = 1; i < path.points.length; i++) {
        const normal = getNormalPoint(projectedPosition, path.points[i - 1], path.points[i]);
        const distance = p5.Vector.dist(projectedPosition, normal);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPath = path;
        }
      }
    }
    vehicle.assignedPath = nearestPath;
  }
}
function newPaths() {
  paths = [];
  const lines = pathLetters[pathLetterIndex];
  let lineSpacing = fontSize * 1.1;
  let letterSpacing = fontSize * 0.2; // You can adjust this!

  let points = collectTextPoints(lines, lineSpacing, letterSpacing);
  let [offsetX, offsetY] = getCenteringOffsets(points);

  createPathsFromPoints(points, offsetX, offsetY + pathStep * height * 0);
  refreshInteriorAttractionTargets();
}

function collectTextPoints(text, lineSpacing, letterSpacing) {
  const lines = text.split(/\r?\n/);
  let allPoints = [];
  
  for (let i = 0; i < lines.length; i++) {
    let xCursor = 0;
    for (let char of lines[i]) {
      if (char === " ") {
        xCursor += fontSize * 0.3; // Skip space
        continue;
      }

      let charPoints = font.textToPoints(char, xCursor, i * lineSpacing, fontSize, {
        sampleFactor: 0.1
      });

      allPoints = allPoints.concat(charPoints);

      // Estimate character width for spacing (advance width)
      let bounds = font.textBounds(char, xCursor, 0, fontSize);
      xCursor += bounds.w + letterSpacing;
    }
  }

  return allPoints;
}

function getCenteringOffsets(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let p of points) {
    minX = min(minX, p.x);
    maxX = max(maxX, p.x);
    minY = min(minY, p.y);
    maxY = max(maxY, p.y);
  }

  let offsetX = width / 2 - (minX + (maxX - minX) / 2);
  let offsetY = height / 2 - (minY + (maxY - minY) / 2);
  return [offsetX, offsetY];
}

function createPathsFromPoints(points, offsetX, offsetY) {
  let currentPath = new Path();
  let threshold = 20;

  for (let i = 0; i < points.length; i++) {
    let pt = points[i];
    let x = pt.x + offsetX;
    let y = pt.y + offsetY;

    if (i > 0) {
      let prev = points[i - 1];
      if (dist(pt.x, pt.y, prev.x, prev.y) > threshold) {
        if (currentPath.points.length > 1) {
          paths.push(currentPath);
        }
        currentPath = new Path();
      }
    }

    currentPath.addPoint(x, y);
    currentPath.color = color(random(360), random(360), 100); // HSB

    if (debug) {
      textSize(5);
      text(i, x, y);
    }
  }

  if (currentPath.points.length > 1) {
    paths.push(currentPath);
  }
}

function newVehicle(x, y, assignedPath, typeIndex = vehicles.length % particleTypes.length) {
  let maxspeed = 0.5;//random(8, 12);
  let maxforce = 0.1;
  let v = new Vehicle(x, y, maxspeed, maxforce);
  v.assignedPath = assignedPath;
  v.typeIndex = typeIndex;
  const type = particleTypes[v.typeIndex];
  v.collisionOnly = Boolean(type.collisionOnly);
  if (v.collisionOnly) v.velocity.mult(0);
  v.shape = type.shape;
  v.color = type.color;
  v.sizeTier=identitySizeTier(vehicles.length);
  v.r=particleSize*SizeF*identity.size*v.sizeTier;
  vehicles.push(v);
}

