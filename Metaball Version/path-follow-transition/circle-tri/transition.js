// Force-driven transition: filled inner disk, surrounding outer annulus.
const circleGatherDuration = 450; // Milliseconds to gather.
const innerCircleRadiusRatio = 0.3;
const outerRingInnerRatio = 0.25;
const outerRingOuterRatio = 0.45;
const circleGatherForce = 1.4; // Maximum attraction acceleration.
const circleGatherSpeed = 14; // Temporary speed limit during gathering.
const outerRingReturnSpeed = 9; // Temporary speed while returning to the glyph.
const outerRingReturnForce = 2; // Temporary steering acceleration.
const outerRingReturnDuration = 1100; // Maximum boost duration, in milliseconds.
let circleTransition = null;
let jsonReturnTransition = null;
let initialLayoutPending = false;
let physicsResumeStart = -Infinity;
const physicsResumeDuration = 400;

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
    vehicle.jsonTarget = null;
    assignSnapshotPath(vehicle, point);
    vehicle.velocity.mult(0);
    vehicle.angle = 0;
  }
  restoreSnapshotAppearance(snapshot);
  initialLayoutPending = true;
}

function switchPathLetter() {
  if (circleTransition || jsonReturnTransition || initialLayoutPending) return;
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
    // Spread radial strata through the full band, retaining the exact target angle.
    const fraction = ((record.id + 0.5) * 0.618033988749895) % 1;
    const minRadius = Math.min(width, height) * (record.collisionOnly ? 0 : outerRingInnerRatio);
    const maxRadius = Math.min(width, height) * (record.collisionOnly ? innerCircleRadiusRatio : outerRingOuterRatio);
    const radius = Math.sqrt(minRadius*minRadius + fraction*(maxRadius*maxRadius-minRadius*minRadius));
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

function steerToPoint(vehicle, target, speed, acceleration, slowOnArrival = true) {
  const desired = createVector(target.x-vehicle.position.x, target.y-vehicle.position.y);
  const distance = desired.mag();
  if (distance > 0) desired.setMag(slowOnArrival ? Math.min(speed, distance * 0.22) : speed);
  const force = desired.sub(vehicle.velocity).mult(0.35);
  force.limit(acceleration);
  vehicle.applyForce(force);
}

function assignSnapshotPath(vehicle, anchor) {
  anchor = createVector(anchor.x, anchor.y);
  let nearestPath = null, best = Infinity;
  for (const path of paths) {
    for (let i = 1; i < path.points.length; i++) {
      const normal = getNormalPoint(anchor, path.points[i-1], path.points[i]);
      const distance = Math.hypot(anchor.x-normal.x, anchor.y-normal.y);
      if (distance < best) { best = distance; nearestPath = path; }
    }
  }
  vehicle.setAssignedPath(nearestPath, anchor);

}

function contourExitVelocity(vehicle) {
  const path = vehicle.assignedPath;
  if (!path || path.points.length < 2) return { x: vehicle.maxspeed, y: 0 };
  const i = Math.min(vehicle.segmentIndex, path.points.length - 2);
  const a = path.points[i], b = path.points[i+1];
  const dx = b.x-a.x, dy = b.y-a.y;
  const length = Math.hypot(dx,dy) || 1;
  return { x: dx/length*vehicle.maxspeed, y: dy/length*vehicle.maxspeed };
}

// Position and derivative use the same cubic, with velocities in pixels/frame.
function sampleHermite(entry, t, frames) {
  const t2=t*t, t3=t2*t;
  const h00=2*t3-3*t2+1, h10=t3-2*t2+t;
  const h01=-2*t3+3*t2, h11=t3-t2;
  const d00=6*t2-6*t, d10=3*t2-4*t+1;
  const d01=-6*t2+6*t, d11=3*t2-2*t;
  const result = {};
  for (const axis of ["x", "y"]) {
    result[axis] = h00*entry.from[axis] + h10*frames*entry.startVelocity[axis]
      + h01*entry.target[axis] + h11*frames*entry.endVelocity[axis];
    result["v"+axis] = (d00*entry.from[axis] + d10*frames*entry.startVelocity[axis]
      + d01*entry.target[axis] + d11*frames*entry.endVelocity[axis])/frames;
  }
  return result;
}

function updateJsonReturn() {
  // Show the initial JSON positions once without first advancing simulation.
  if (initialLayoutPending) {
    initialLayoutPending = false;
    physicsResumeStart = simulationTime;
    return true;
  }
  if (!jsonReturnTransition) return false;
  const transition = jsonReturnTransition;
  const t = Math.min(1, Math.max(0, (simulationTime-transition.start)/transition.duration));
  for (const entry of transition.entries) {
    const v = entry.vehicle;
    const sample = sampleHermite(entry, t, transition.frames);
    v.position.set(sample.x, sample.y);
    v.velocity.set(sample.vx, sample.vy);
    v.acceleration.mult(0);
    v.smoothedAcceleration.mult(0);
    if (Math.hypot(sample.vx,sample.vy) > 0.001) {
      v.angle = lerpAngle(v.angle, Math.atan2(sample.vy,sample.vx), 0.15);
    }
  }
  if (t === 1) {
    jsonReturnTransition = null;
    physicsResumeStart = simulationTime;
  }
  // At t=1 the curve itself reaches the exact endpoint with nonzero velocity.
  // Live integration resumes next frame without an additional position update here.
  return true;
}

function updateCircleTransition() {
  if (!circleTransition) return false;
  const elapsed = simulationTime - circleTransition.start;
  // A timed handoff preserves momentum; no wait for the slowest particle.
  if (elapsed >= circleGatherDuration) {
    const transition = circleTransition;
    circleTransition = null;
    pathLetterIndex = transition.nextIndex;
    newPaths();
    for (const {vehicle,target} of transition.entries) {
      assignSnapshotPath(vehicle, target);
      vehicle.jsonTarget = null;
    }
    const frames = Math.round(outerRingReturnDuration / SIMULATION_STEP_MS);
    jsonReturnTransition = {
      start: simulationTime, frames, duration: frames * SIMULATION_STEP_MS,
      entries: transition.entries.map(({vehicle,target}) => ({
        vehicle, target,
        from: { x: vehicle.position.x, y: vehicle.position.y },
        startVelocity: { x: vehicle.velocity.x, y: vehicle.velocity.y },
        endVelocity: contourExitVelocity(vehicle)
      }))
    };
    return false;
  }
  for (const {vehicle,to} of circleTransition.entries) {
    steerToPoint(vehicle, to, circleGatherSpeed, circleGatherForce, false);
  }
  return true;
}

function physicsResumeWeight() {
  if (circleTransition) return 1;
  const t = Math.max(0, Math.min(1, (simulationTime-physicsResumeStart)/physicsResumeDuration));
  return t*t*(3-2*t);
}

// The solver may separate overlapping JSON samples by several pixels in one
// frame. Apply its result gradually, limiting visible displacement per frame.
function resolveContinuousCollisions() {
  const before = vehicles.map(v => ({x:v.position.x, y:v.position.y,
    vx:v.velocity.x, vy:v.velocity.y}));
  resolveParticleCollisions(vehicles);
  const weight = physicsResumeWeight();
  vehicles.forEach((v,i) => {
    const old = before[i];
    const dx=v.position.x-old.x, dy=v.position.y-old.y;
    const distance = Math.hypot(dx,dy);
    const blend = distance > 0 ? Math.min(weight, 0.6/distance) : weight;
    v.position.set(old.x+dx*blend, old.y+dy*blend);
    v.velocity.set(old.vx+(v.velocity.x-old.vx)*weight,
      old.vy+(v.velocity.y-old.vy)*weight);
  });
}
