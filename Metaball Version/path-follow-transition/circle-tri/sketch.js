const SIMULATION_FPS = 60;
const SIMULATION_STEP_MS = 1000 / SIMULATION_FPS;
let simulationFrame = 0;
let simulationTime = 0;

let SizeF = 0.4;
const particleSize = 36;
const particleSpawnDistance = Math.max(1, particleSize); // Initial spawn spacing, in pixels.
const particleSeparationDistance = Math.max(1, particleSize/1.5); // Movement separation distance, in pixels.
const pathRadius = 40; // Before scazling; full path width = pathRadius * SizeF * 2.

const pathLetters = ["R", "O", "A", "M"];
const letterSnapshots = {};
let pathLetterIndex = 0;
let pathStep = 0;
const cameraOffset = { x: 0, y: 0 };
const cameraFollowSpeed = 0.1;
const pathOutsideRatio = 0.6; // Fraction of the path band outside the letter.
let paths = [];
let letterOutlinePaths = [];
const interiorBoundaryScale = 1; // Inset the interior activity boundary by scaling around the glyph center.
let interiorBoundaryPaths = [];
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
let totalExternalParticles = 120;
const particleTypes = [
  { shape: "circle", color: "#d9d9d9", count: 20 },
  { shape: "circle", color: "#ceff68", count: 20 },
  { shape: "circle", color: "#00d0ff", count: 20 },
  { shape: "circle", shapeB: "circle", color: "#074e69", count: 20 },
  { shape: "circle", shapeB: "circle", color: "#00d0ff", count: 20 },
  { shape: "circle", shapeB: "circle", color: "#141d1f", count: 100, collisionOnly: true },
];
let fontSize = 800*SizeF;
let font;

function preload() {
  for (const letter of pathLetters) {
    letterSnapshots[letter] = loadJSON(`../path-sample-transition/data/particle-initialization-${letter}.json`);
  }
  font = loadFont("assets/GT-Maru-Mono-Black-Trial.otf");
}

function setup() {
  frameRate(SIMULATION_FPS);
  const canvas = createCanvas(1080*SizeF, 1080*SizeF).parent("canvas-container");
  canvas.elt.addEventListener("click", switchPathLetter);
  canvas.elt.style.cursor = "pointer";
  canvas.elt.title = "点击切换下一个字母路径";

  newPaths(); // Generate multiple paths
  
  initializeSnapshotParticles(letterSnapshots[pathLetters[pathLetterIndex]]);
  setupMetaballs();
  particleTypes.forEach((type, index) => {
    type.count = vehicles.filter(vehicle => vehicle.typeIndex === index).length;
  });
  setupParticleControls();
  restoreSnapshotAppearance(letterSnapshots[pathLetters[pathLetterIndex]]);
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
  const remaining = particleTypes.map(type => type.collisionOnly ? 0 : type.count);
  let typeIndex = 0;
  for (let i = 0; i < count; i++) {
    const sample = samples[Math.floor((i + 0.5) * samples.length / count)];
    if (targetCount !== null) {
      while (remaining[typeIndex] === 0) typeIndex = (typeIndex + 1) % particleTypes.length;
      newVehicle(sample.x, sample.y, sample.path, typeIndex);
      remaining[typeIndex]--;
      typeIndex = (typeIndex + 1) % particleTypes.length;
    } else {
      newVehicle(sample.x, sample.y, sample.path);
    }
  }
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
  const returning = !gathering && updateJsonReturn();
  if (!gathering && !returning) {
  // Debug drawing and contours use world coordinates; the GPU receives camera-relative positions.
  push();
  translate(-cameraOffset.x, -cameraOffset.y);
  for (const v of vehicles) {
    if (v.collisionOnly) applyInteriorAttraction(v);
    else v.applyBehaviors(vehicles, v.assignedPath);
  }
  applyOutwardTransition();
  const resumeWeight = physicsResumeWeight();
  for (const v of vehicles) v.acceleration.mult(resumeWeight);
  pop();
  }
  // The return curve controls position and velocity; live physics resumes at its endpoint.
  if (!returning) {
    for (const v of vehicles) v.update();
    if (document.getElementById("collision-enabled").checked) resolveContinuousCollisions();
  }
  updatePathCamera();
  push();
  translate(-cameraOffset.x, -cameraOffset.y);
  if (!gathering && document.getElementById("show-path").checked) {
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
  const previousOutlinePaths = letterOutlinePaths;
  const previousInteriorPaths = interiorBoundaryPaths;
  const previousIndex = pathLetterIndex;
  pathStep++;
  pathLetterIndex = (pathLetterIndex + 1) % pathLetters.length;
  newPaths();
  if (!paths.length) {
    paths = previousPaths;
    letterOutlinePaths = previousOutlinePaths;
    interiorBoundaryPaths = previousInteriorPaths;
    refreshInteriorAttractionTargets();
    pathLetterIndex = previousIndex;
    pathStep--;
    return;
  }
  if (withOutwardForce) startOutwardTransition();
  // Preserve particles and their motion; only replace their target contours.
  for (const vehicle of vehicles) {
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
    vehicle.setAssignedPath(nearestPath);
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
  letterOutlinePaths = paths;
  const outlinePoints = letterOutlinePaths.flatMap(path => path.points);
  if (outlinePoints.length) {
    const cx = (Math.min(...outlinePoints.map(point => point.x)) + Math.max(...outlinePoints.map(point => point.x))) / 2;
    const cy = (Math.min(...outlinePoints.map(point => point.y)) + Math.max(...outlinePoints.map(point => point.y))) / 2;
    interiorBoundaryPaths = letterOutlinePaths.map(source => {
      const boundary = new Path();
      boundary.radius = source.radius;
      source.points.forEach(point => boundary.addPoint(
        cx + (point.x - cx) * interiorBoundaryScale,
        cy + (point.y - cy) * interiorBoundaryScale));
      return boundary;
    });
  } else interiorBoundaryPaths = [];
  const outwardOffset = pathRadius * SizeF * (2 * pathOutsideRatio - 1);
  paths = letterOutlinePaths.map(path => {
    // Hole boundaries offset toward the hole, outer boundaries away from the glyph.
    const depth = letterOutlinePaths.filter(other => other !== path
      && path.points.length > 0
      && path.points.every(point => pointInsideContour(point, other))).length;
    return offsetContourPath(path, depth % 2 ? -outwardOffset : outwardOffset);
  });
  refreshInteriorAttractionTargets();
}

// Remove contours enclosed by another contour (letter counters / holes).
function pointInsideContour(point, contour) {
  let inside = false;
  const points = contour.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function removeInteriorPaths() {
  paths = paths.filter(contour => !paths.some(other =>
    other !== contour && contour.points.length > 0
      && contour.points.every(point => pointInsideContour(point, other))));
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

      const charFontSize = fontSize * ((char === "O" || char === "D") ? 0.9 : 1);
      let charPoints = font.textToPoints(char, xCursor, i * lineSpacing, charFontSize, {
        sampleFactor: 0.1
      });

      allPoints = allPoints.concat(charPoints);

      // Estimate character width for spacing (advance width)
      let bounds = font.textBounds(char, xCursor, 0, charFontSize);
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
  let maxspeed = 2;//random(8, 12);
  let maxforce = 0.5;
  let v = new Vehicle(x, y, maxspeed, maxforce);
  v.setAssignedPath(assignedPath);
  v.typeIndex = typeIndex;
  const type = particleTypes[v.typeIndex];
  v.collisionOnly = Boolean(type.collisionOnly);
  if (v.collisionOnly) v.r *= 0.5;
  if (v.collisionOnly) applyInteriorInitialVelocity(v);
  v.shape = type.shape;
  v.color = type.color;
  vehicles.push(v);
}

