// Interior particles share the collision solver but never steer toward a path.
function isInsideOutline(x, y) {
  let inside = false;
  for (const path of interiorBoundaryPaths) {
    const points = path.points;
    for (let i=0,j=points.length-1;i<points.length;j=i++) {
      const a=points[i],b=points[j];
      if ((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside=!inside;
    }
  }
  return inside;
}

function spawnConfiguredParticles() {
  const externalTypes = particleTypes.filter(type => !type.collisionOnly);
  externalTypes.forEach((type, index) => {
    type.count = Math.floor(totalExternalParticles / externalTypes.length)
      + (index < totalExternalParticles % externalTypes.length ? 1 : 0);
  });
  const followerCount = externalTypes.length ? totalExternalParticles : 0;
  spawnVehiclesInsidePathBand(followerCount);
  const interiorTypes=particleTypes.map((type,index)=>({type,index})).filter(({type})=>type.collisionOnly && type.count>0);
  const total=interiorTypes.reduce((sum,{type})=>sum+type.count,0);
  if (!total) return;
  const points=interiorBoundaryPaths.flatMap(path=>path.points);
  if (!points.length) return;
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
  const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  let spacing=Math.max(1,particleSize*SizeF);
  let samples=[];
  // Bounded refinement avoids an endless search for empty/degenerate outlines.
  for (let attempt=0;attempt<9;attempt++) {
    samples=[];
    const columns=Math.max(1,Math.ceil((maxX-minX)/spacing));
    const rows=Math.max(1,Math.ceil((maxY-minY)/spacing));
    if (columns*rows>2000000) break;
    for (let row=0;row<rows;row++) {
      for (let column=0;column<columns;column++) {
        const x=minX+(column+0.5)*(maxX-minX)/columns;
        const y=minY+(row+0.5)*(maxY-minY)/rows;
        if (isInsideOutline(x,y)) samples.push({x,y});
      }
    }
    if (samples.length>=total) break;
    spacing*=0.5;
  }
  if (!samples.length) return;
  let cursor=0;
  for (const {type,index} of interiorTypes) {
    for (let i=0;i<type.count;i++) {
      const point=samples[Math.min(samples.length-1,Math.floor((cursor+0.5)*samples.length/total))];
      newVehicle(point.x,point.y,null,index);
      cursor++;
    }
  }
}


const interiorReturnStrength = 1; // Strong recovery outside the letter.
const interiorReturnSpeed = 2; // Slower inward recovery speed.
const interiorAttractionStrength = 0.2; // Maximum inward acceleration.
const interiorAttractionGain = 0.015; // Attraction grows with distance.
let interiorAttractionTargets = [];

function refreshInteriorAttractionTargets() {
  interiorAttractionTargets = [];
  const points = interiorBoundaryPaths.flatMap(path => path.points);
  if (!points.length) return;
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const spacing = Math.max(3, particleSize * SizeF * 0.5);
  const fallback = [];
  const safeClearance = Math.max(...interiorBoundaryPaths.map(path => path.radius)) + particleSize * SizeF * 0.8;
  let deepestClearance = 0;
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    for (let x = minX + spacing / 2; x < maxX; x += spacing) {
      if (!isInsideOutline(x, y)) continue;
      const point = createVector(x, y);

      let clearance = Infinity;
      for (const path of interiorBoundaryPaths) {
        for (let i = 0; i < path.points.length; i++) {
          const a = path.points[i], b = path.points[(i + 1) % path.points.length];
          clearance = Math.min(clearance, p5.Vector.dist(point, getNormalPoint(point, a, b)));
        }
      }
      fallback.push({point, clearance});
      deepestClearance = Math.max(deepestClearance, clearance);
      if (clearance >= safeClearance) interiorAttractionTargets.push(point);
    }
  }
  if (!interiorAttractionTargets.length) {
    interiorAttractionTargets = fallback.filter(entry => entry.clearance >= deepestClearance * 0.75).map(entry => entry.point);
  }
}

function applyInteriorAttraction(vehicle) {
  const inside = isInsideOutline(vehicle.position.x, vehicle.position.y);
  const crowded = vehicles.some(other => !other.collisionOnly
    && p5.Vector.dist(vehicle.position, other.position)
      < collisionRadius(vehicle) + collisionRadius(other) + 3);
  vehicle.returningInside = !inside || crowded;
  let safeTarget = null, distanceSquared = Infinity;
  for (const point of interiorAttractionTargets) {
    const d = (point.x - vehicle.position.x) ** 2 + (point.y - vehicle.position.y) ** 2;
    if (d < distanceSquared) { distanceSquared = d; safeTarget = point; }
  }
  if (!safeTarget) return;
  if (vehicle.returningInside) {
    const desired = p5.Vector.sub(safeTarget, vehicle.position);
    desired.setMag(Math.min(interiorReturnSpeed, Math.sqrt(distanceSquared) * 0.3));
    const force = desired.sub(vehicle.velocity);
    force.limit(interiorReturnStrength);
    vehicle.applyForce(force);
    return;
  }
  // Drift throughout the interior rather than following its contour.
  vehicle.interiorWanderSeed ??= random(10000);
  const angle = noise(vehicle.interiorWanderSeed, simulationTime * 0.00025) * TWO_PI * 2;
  const desired = p5.Vector.fromAngle(angle).mult(vehicle.maxspeed * 0.1);
  const wanderForce = desired.sub(vehicle.velocity).mult(0.15);
  wanderForce.limit(interiorAttractionStrength);
  vehicle.applyForce(wanderForce);

  // Boundary avoidance acts only nearby; it does not attract toward the edge.
  let nearestNormal = null, clearance = Infinity;
  for (const path of interiorBoundaryPaths) {
    for (let i = 0; i < path.points.length; i++) {
      const a = path.points[i], b = path.points[(i + 1) % path.points.length];
      const normal = getNormalPoint(vehicle.position, a, b);
      const distance = p5.Vector.dist(vehicle.position, normal);
      if (distance < clearance) { clearance = distance; nearestNormal = normal; }
    }
  }
  const margin = Math.max(...interiorBoundaryPaths.map(path => path.radius))
    + particleSize * SizeF * 0.5 + collisionRadius(vehicle) + vehicle.maxspeed * 3;
  if (nearestNormal && clearance < margin) {
    const inward = p5.Vector.sub(vehicle.position, nearestNormal);
    if (inward.magSq() > 0.000001) {
      inward.setMag(interiorAttractionStrength * (1 - clearance / margin));
      vehicle.applyForce(inward);
    } else {
      vehicle.applyForce(p5.Vector.sub(safeTarget, vehicle.position).limit(interiorAttractionStrength));
    }
  }
}

function applyInteriorInitialVelocity(vehicle) {
  if (document.getElementById("interior-initial-speed").value === "moving") {
    vehicle.velocity = p5.Vector.fromAngle(random(TWO_PI)).setMag(random(0.3, vehicle.maxspeed));
    vehicle.angle = vehicle.velocity.heading();
  } else {
    vehicle.velocity.mult(0);
  }
  vehicle.acceleration.mult(0);
  vehicle.smoothedAcceleration.mult(0);
}
