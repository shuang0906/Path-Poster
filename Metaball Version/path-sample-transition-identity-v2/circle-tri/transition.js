// Force-driven transition: filled inner disk, surrounding outer annulus.
const circleGatherDuration = 400; // Milliseconds to gather.
const circleHoldDuration = 0; // Keep attracting before switching paths.
const innerCircleRadiusRatio = 0.3;
const outerRingInnerRatio = 0.3;
const outerRingOuterRatio = 0.5;
const circleGatherForce = 0.6; // Maximum attraction acceleration.
const circleGatherSpeed = 10; // Temporary speed limit during gathering.
let circleTransition = null;

function switchPathLetter() {
  if (circleTransition) return;
  if (!vehicles.length) {
    advancePathLetter(true);
    return;
  }
  const center = { x: cameraOffset.x + width / 2, y: cameraOffset.y + height / 2 };
  const size = Math.min(width, height);
  const entries = [];
  for (const interior of [true, false]) {
    const group = vehicles.filter(v => Boolean(v.collisionOnly) === interior);
    const targets = group.map((v,i) => {
      const fraction = (i + 0.5) / group.length;
      const minRadius = interior ? 0 : size * outerRingInnerRatio;
      const maxRadius = size * (interior ? innerCircleRadiusRatio : outerRingOuterRatio);
      const radius = Math.sqrt(minRadius * minRadius + fraction * (maxRadius * maxRadius - minRadius * minRadius));
      const angle = i * 2.3999632297;
      return { x: center.x + Math.cos(angle)*radius, y: center.y + Math.sin(angle)*radius, angle: Math.atan2(Math.sin(angle),Math.cos(angle)) };
    });
    // Polar ordering reduces crossings while retaining every particle's identity.
    group.sort((a,b) => Math.atan2(a.position.y-center.y,a.position.x-center.x)-Math.atan2(b.position.y-center.y,b.position.x-center.x));
    targets.sort((a,b) => a.angle-b.angle);
    group.forEach((v,i) => entries.push({ vehicle:v, from:{x:v.position.x,y:v.position.y}, to:targets[i] }));
  }
  transitionOutwardStart = -Infinity;
  circleTransition = { start:simulationTime, entries };
}

function updateCircleTransition() {
  if (!circleTransition) return false;
  const elapsed = simulationTime - circleTransition.start;
  if (circleTransition.mode === "samples") {
    const arrivalRadius = Math.max(4, particleSize * SizeF * 0.75);
    for (const entry of circleTransition.entries) {
      if (entry.arrived) continue;
      const {vehicle, to} = entry;
      const desired = createVector(to.x - vehicle.position.x, to.y - vehicle.position.y);
      const distance = desired.mag();
      if (distance <= arrivalRadius || elapsed >= 2200) {
        entry.arrived = true;
        continue;
      }
      desired.setMag(Math.min(circleGatherSpeed, Math.max(vehicle.maxspeed, distance * 0.12)));
      const force = desired.sub(vehicle.velocity).mult(0.2);
      force.limit(circleGatherForce);
      vehicle.applyForce(force);
    }
    if (circleTransition.entries.every(entry => entry.arrived)) circleTransition = null;
    return Boolean(circleTransition);
  }
  if (elapsed >= circleGatherDuration + circleHoldDuration) {
    circleTransition = null;
    startPathSampleTransition();
    return Boolean(circleTransition);
  }
  // Ramp attraction in; keep live momentum, integration and collisions throughout.
  const ramp = Math.max(0, Math.min(1, elapsed / 150));
  const strength = ramp * ramp * (3 - 2 * ramp);
  for (const {vehicle,to} of circleTransition.entries) {
    const desired = createVector(to.x-vehicle.position.x,to.y-vehicle.position.y);
    const distance = desired.mag();
    if (distance > 0) desired.setMag(Math.min(circleGatherSpeed, distance * 0.12));
    const force = desired.sub(vehicle.velocity).mult(0.2);
    force.limit(circleGatherForce);
    vehicle.applyForce(force.mult(strength));
  }
  return true;
}

// Sample existing contour segments by arc length, without bridging separate paths.
function samplePathTargets(count) {
  const segments = [];
  let length = 0;
  for (const path of paths) {
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      const size = Math.hypot(b.x - a.x, b.y - a.y);
      if (!size) continue;
      segments.push({a, b, size, start: length, path});
      length += size;
    }
  }
  if (!length || !count) return [];
  let cursor = 0;
  return Array.from({length: count}, (_, i) => {
    const distance = (i + 0.5) * length / count;
    while (cursor < segments.length - 1 && distance > segments[cursor].start + segments[cursor].size) cursor++;
    const segment = segments[cursor];
    const t = (distance - segment.start) / segment.size;
    return {x: segment.a.x + (segment.b.x - segment.a.x) * t,
      y: segment.a.y + (segment.b.y - segment.a.y) * t, path: segment.path};
  });
}

function startPathSampleTransition() {
  advancePathLetter(false);
  transitionOutwardStart = -Infinity;
  const group = vehicles.filter(v => !v.collisionOnly);
  const targets = samplePathTargets(group.length);
  if (!targets.length) return;
  const entries = assignColorSampleTargets(group, targets);
  entries.forEach(({vehicle, to}) => { vehicle.assignedPath = to.path; });
  circleTransition = {mode: "samples", start: simulationTime, entries};
}

// Identity setting shared between initialization and transitions.

function assignColorSampleTargets(group, targets) {
  const colors = new Map();
  for (const vehicle of group) {
    const key = normalizeParticleColor(vehicle.color).toLowerCase();
    if (!colors.has(key)) colors.set(key, []);
    colors.get(key).push(vehicle);
  }
  const entries = [], mixedVehicles = [], mixedTargets = [];
  let cursor = 0;
  const assignNearest = (vehicle, available) => {
    let nearest = 0, best = Infinity;
    available.forEach((target, index) => {
      const distance = (vehicle.position.x - target.x) ** 2 + (vehicle.position.y - target.y) ** 2;
      if (distance < best) { best = distance; nearest = index; }
    });
    const to = available.splice(nearest, 1)[0];
    entries.push({vehicle, from: {x: vehicle.position.x, y: vehicle.position.y}, to});
  };
  for (const members of colors.values()) {
    const shuffled = members.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random(i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Reserve a continuous arc for the grouped portion of this color.
    const block = targets.slice(cursor, cursor + members.length);
    cursor += members.length;
    const count = Math.round(members.length * identity.grouping);
    const reserved = block.slice(0, count);
    shuffled.slice(0, count).forEach(vehicle => assignNearest(vehicle, reserved));
    mixedVehicles.push(...shuffled.slice(count));
    mixedTargets.push(...block.slice(count));
  }
  // The remaining particles may mix across all unreserved arcs.
  mixedVehicles.forEach(vehicle => assignNearest(vehicle, mixedTargets));
  return entries;
}
