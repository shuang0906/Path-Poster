// Interior particles share the collision solver but never steer toward a path.
function isInsideOutline(x, y) {
  let inside = false;
  for (const path of paths) {
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
  const points=paths.flatMap(path=>path.points);
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


const interiorAttractionStrength = 0.2; // Maximum inward acceleration.
const interiorAttractionGain = 0.015; // Attraction grows with distance.
let interiorAttractionTargets = [];

function refreshInteriorAttractionTargets() {
  interiorAttractionTargets = [];
  const points = paths.flatMap(path => path.points);
  if (!points.length) return;
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const spacing = Math.max(3, particleSize * SizeF * 0.5);
  const fallback = [];
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    for (let x = minX + spacing / 2; x < maxX; x += spacing) {
      if (!isInsideOutline(x, y)) continue;
      const point = createVector(x, y);
      fallback.push(point);
      let clearance = Infinity;
      for (const path of paths) {
        for (let i = 0; i < path.points.length; i++) {
          const a = path.points[i], b = path.points[(i + 1) % path.points.length];
          clearance = Math.min(clearance, p5.Vector.dist(point, getNormalPoint(point, a, b)));
        }
      }
      if (clearance >= particleSize * SizeF * 0.6) interiorAttractionTargets.push(point);
    }
  }
  if (!interiorAttractionTargets.length) interiorAttractionTargets = fallback;
}

function applyInteriorAttraction(vehicle) {
  let target = null, distanceSquared = Infinity;
  for (const point of interiorAttractionTargets) {
    const d = (point.x - vehicle.position.x) ** 2 + (point.y - vehicle.position.y) ** 2;
    if (d < distanceSquared) { distanceSquared = d; target = point; }
  }
  if (!target) return;
  const force = p5.Vector.sub(target, vehicle.position).mult(interiorAttractionGain);
  force.limit(interiorAttractionStrength);
  vehicle.applyForce(force);
}
