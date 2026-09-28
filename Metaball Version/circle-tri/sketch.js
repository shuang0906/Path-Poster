let SizeF = 0.4;
const particleSize = 40;
const particleSpacing = particleSize+40;
const particleDistance = Math.max(1, particleSpacing * SizeF); // Shared spawn and separation distance, in pixels.
const pathRadius = 42; // Before scaling; full path width = pathRadius * SizeF * 2.

let paths = [];
let debug = false;
let vehicles = [];
const particleTypes = [
  { shape: "square", color: "#E4572E", count: 30 },
  { shape: "circle", color: "#247BA0", count: 30 },
  { shape: "circle", color: "#6A4C93", count: 30 },
  { shape: "circle", color: "#2A9D8F", count: 30 },
  { shape: "circle", color: "#E9C46A", count: 30 },
  { shape: "circle", color: "#E76FA3", count: 30 },
];
let fontSize = 800*SizeF;
let font;

function preload() {
  font = loadFont("assets/MetaballsTrial-Bold.otf");
}

function setup() {
  createCanvas(1080*SizeF, 1080*SizeF).parent("canvas-container");

  newPaths(); // Generate multiple paths
  
  spawnVehiclesInsidePathBand(particleTypes.reduce((sum, type) => sum + type.count, 0));
  setupMetaballs();
  particleTypes.forEach((type, index) => {
    type.count = vehicles.filter(vehicle => vehicle.typeIndex === index).length;
  });
  setupParticleControls();
}

function spawnVehiclesInsidePathBand(targetCount = null, sampleSpacing = particleDistance) {
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
  const remaining = particleTypes.map(type => type.count);
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

function draw() {
  background("#fff");
  if (document.getElementById("show-path").checked) {
    for (let p of paths) {
      p.display();
    }
  }

  for (let v of vehicles) {
    v.applyBehaviors(vehicles, v.assignedPath);
  }
  // Compute every force before moving any particle.
  for (let v of vehicles) {
    v.update();
  }
  renderMetaballs();
}

function keyPressed() {
  if (document.activeElement.matches("input, select, button, textarea")) return;
  if (key == "d") debug = !debug;
}

function newPaths() {
  let lines = "A";
  let lineSpacing = fontSize * 1.1;
  let letterSpacing = fontSize * 0.2; // You can adjust this!

  let points = collectTextPoints(lines, lineSpacing, letterSpacing);
  let [offsetX, offsetY] = getCenteringOffsets(points);

  createPathsFromPoints(points, offsetX, offsetY);
}

function collectTextPoints(lines, lineSpacing, letterSpacing) {
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
  let maxspeed = 1;//random(8, 12);
  let maxforce = 0.3;
  let v = new Vehicle(x, y, maxspeed, maxforce);
  v.assignedPath = assignedPath;
  v.typeIndex = typeIndex;
  const type = particleTypes[v.typeIndex];
  v.shape = type.shape;
  v.color = type.color;
  vehicles.push(v);
}

