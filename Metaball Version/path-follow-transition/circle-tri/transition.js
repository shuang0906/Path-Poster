// Force-driven transition: filled inner disk, surrounding outer annulus.
const circleGatherDuration = 450; // Milliseconds to gather.
const circleHoldDuration = -10; // Keep attracting before switching paths.
const innerCircleRadiusRatio = 0.3;
const outerRingInnerRatio = 0.25;
const outerRingOuterRatio = 0.45;
const circleGatherForce = 0.6; // Maximum attraction acceleration.
const circleGatherSpeed = 10; // Temporary speed limit during gathering.
const outerRingReturnSpeed = 2.5; // Temporary speed while returning to the glyph.
const outerRingReturnForce = 1.2; // Temporary steering acceleration.
const outerRingReturnDuration = 2200; // Maximum boost duration, in milliseconds.
let circleTransition = null;

function snapshotColor(value) {
  return normalizeParticleColor(value === "#00000" ? "#000000" : value);
}

function snapshotKey(particle) {
  return `${particle.typeIndex}:${particle.shape}:${Boolean(particle.collisionOnly)}`;
}

function snapshotPoint(snapshot, particle) {
  return { x: particle.x * width / snapshot.canvas.width,
    y: particle.y * height / snapshot.canvas.height };
}

function restoreSnapshotAppearance(snapshot) {
  const records = new Map(snapshot.particles.map(p => [p.id, p]));
  for (const vehicle of vehicles) {
    const record = records.get(vehicle.snapshotId);
    if (!record) continue;
    vehicle.shape = record.shape;
    vehicle.color = snapshotColor(record.color);
  }
}

function initializeSnapshotParticles(snapshot) {
  particleTypes.splice(0, particleTypes.length, ...snapshot.types.map(type => ({ ...type, color: snapshotColor(type.color) })));
  totalExternalParticles = snapshot.totalExternalParticles;
  vehicles = [];
  for (const record of snapshot.particles) {
    const point = snapshotPoint(snapshot, record);
    newVehicle(point.x, point.y, null, record.typeIndex);
    const vehicle = vehicles[vehicles.length - 1];
    vehicle.snapshotId = record.id;
    vehicle.jsonTarget = point;
    vehicle.velocity.mult(0);
  }
  restoreSnapshotAppearance(snapshot);
}

function switchPathLetter() {
  if (circleTransition) return;
  const nextIndex = (pathLetterIndex + 1) % pathLetters.length;
  const snapshot = letterSnapshots[pathLetters[nextIndex]];
  particleTypes.splice(0, particleTypes.length, ...snapshot.types.map(type => ({ ...type, color: snapshotColor(type.color) })));
  const pools = new Map();
  for (const vehicle of vehicles) {
    const key = snapshotKey(vehicle);
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(vehicle);
  }
  const center = { x: width / 2, y: height / 2 };
  const entries = [];
  // Match within each type AND actual shape, using nearest destination.
  for (const record of snapshot.particles) {
    const target = snapshotPoint(snapshot, record);
    const pool = pools.get(snapshotKey(record)) || [];
    pool.sort((a,b) => Math.hypot(a.position.x-target.x,a.position.y-target.y)
      - Math.hypot(b.position.x-target.x,b.position.y-target.y));
    let vehicle = pool.shift();
    if (!vehicle) {
      newVehicle(center.x, center.y, null, record.typeIndex);
      vehicle = vehicles[vehicles.length - 1];
    }
    vehicle.jsonTarget = null;
    vehicle.outerRingReturnUntil = 0;
    const angle = Math.atan2(target.y-center.y, target.x-center.x);
    const radius = Math.min(width, height) * (record.collisionOnly ? innerCircleRadiusRatio : outerRingOuterRatio);
    entries.push({ vehicle, record, target,
      to: { x: center.x + Math.cos(angle)*radius, y: center.y + Math.sin(angle)*radius } });
  }
  vehicles = entries.map(entry => entry.vehicle);
  particleTypes.splice(0, particleTypes.length, ...snapshot.types.map(type => ({ ...type, color: snapshotColor(type.color) })));
  totalExternalParticles = snapshot.totalExternalParticles;
  for (const {vehicle, record} of entries) {
    vehicle.typeIndex = record.typeIndex;
    vehicle.shape = record.shape;
    vehicle.color = snapshotColor(record.color);
    vehicle.collisionOnly = Boolean(record.collisionOnly);
    vehicle.snapshotId = record.id;
  }
  transitionOutwardStart = -Infinity;
  circleTransition = { start: simulationTime, entries, nextIndex };
  document.getElementById("external-particle-total").value = totalExternalParticles;
  renderParticleControls();
  updateParticleTotal();
}

function steerToPoint(vehicle, target, speed, acceleration) {
  const desired = createVector(target.x-vehicle.position.x, target.y-vehicle.position.y);
  const distance = desired.mag();
  if (distance > 0) desired.setMag(Math.min(speed, distance * 0.12));
  const force = desired.sub(vehicle.velocity).mult(0.2);
  force.limit(acceleration);
  vehicle.applyForce(force);
}

function steerToJsonTarget(vehicle) {
  steerToPoint(vehicle, vehicle.jsonTarget, outerRingReturnSpeed, outerRingReturnForce);
}

function updateCircleTransition() {
  if (!circleTransition) return false;
  const elapsed = simulationTime - circleTransition.start;
  // Wait for angular gathering as well as the minimum duration. A bounded
  // timeout allows crowded rings to continue despite collision constraints.
  const arrived = circleTransition.entries.every(({vehicle,to}) =>
    Math.hypot(vehicle.position.x-to.x, vehicle.position.y-to.y) < 8);
  if ((elapsed >= circleGatherDuration && arrived) || elapsed >= 2200) {
    const transition = circleTransition;
    circleTransition = null;
    pathLetterIndex = transition.nextIndex;
    newPaths();
    for (const {vehicle,target} of transition.entries) {
      vehicle.setAssignedPath(null);
      vehicle.jsonTarget = target;
    }
    return false;
  }
  for (const {vehicle,to} of circleTransition.entries) {
    steerToPoint(vehicle, to, circleGatherSpeed, circleGatherForce);
  }
  return true;
}

// Start from a randomized inner disk / outer annulus, then follow the first glyph.
function placeInitialCircleParticles() {
  const center = {x: cameraOffset.x + width / 2, y: cameraOffset.y + height / 2};
  const size = Math.min(width, height);
  for (const interior of [true, false]) {
    const group = vehicles.filter(v => Boolean(v.collisionOnly) === interior);
    const minRadius = interior ? 0 : size * outerRingInnerRatio;
    const maxRadius = size * (interior ? innerCircleRadiusRatio : outerRingOuterRatio);
    // Jitter radial strata and randomize their assignment to avoid rigid spacing.
    const order = group.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random(i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((vehicle, i) => {
      const fraction = (i + random()) / order.length;
      const radius = Math.sqrt(minRadius * minRadius + fraction * (maxRadius * maxRadius - minRadius * minRadius));
      const angle = random(TWO_PI);
      vehicle.position.set(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
      vehicle.velocity = p5.Vector.fromAngle(random(TWO_PI)).setMag(random(0.3, vehicle.maxspeed));
      vehicle.angle = vehicle.velocity.heading();
      vehicle.acceleration.mult(0);
      vehicle.smoothedAcceleration.mult(0);
      if (interior) {
        applyInteriorInitialVelocity(vehicle);
        return;
      }
      let nearestPath = null, best = Infinity;
      for (const path of paths) {
        for (let segment = 1; segment < path.points.length; segment++) {
          const normal = getNormalPoint(vehicle.position, path.points[segment - 1], path.points[segment]);
          const distance = p5.Vector.dist(vehicle.position, normal);
          if (distance < best) { best = distance; nearestPath = path; }
        }
      }
      vehicle.setAssignedPath(nearestPath);
    });
  }
}
