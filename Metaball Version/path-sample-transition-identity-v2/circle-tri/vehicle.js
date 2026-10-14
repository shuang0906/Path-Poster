// The Nature of Code
// Daniel Shiffman
// http://natureofcode.com

// Path Following
// Vehicle class

class Vehicle {
  // Constructor initialize all values
  constructor(x, y, ms, mf) {
    this.position = createVector(x, y);
    this.r = particleSize * SizeF;
    this.maxspeed = ms;
    this.maxforce = mf;
    this.rotationSpeed = 0.05;
    this.maxRotationStep = 0.02;
    this.acceleration = createVector(0, 0);
    this.smoothedAcceleration = createVector(0, 0);
    this.velocity = p5.Vector.fromAngle(random(TWO_PI)).setMag(this.maxspeed);
    this.angle = this.velocity.heading();
  }

  // A function to deal with path following and separation
  applyBehaviors(vehicles, path) {
    // Follow path force
    let f = this.follow(path);
    // Separate from other boids force
    let s = this.separate(vehicles);
    // Arbitrary weighting
    f.mult(3);
    s.mult(1);
    // Accumulate in acceleration
    this.applyForce(f);
    this.applyForce(s);
  }

  applyForce(force) {
    // We could add mass here if we want A = F / M
    this.acceleration.add(force);
  }

  // Main "run" function
  run() {
    this.update();
    this.render();
  }

  // This function implements Craig Reynolds' path following algorithm
  // http://www.red3d.com/cwr/steer/PathFollow.html
  follow(path) {
    // Predict position 25 (arbitrary choice) frames ahead
    let predict = this.velocity.copy();
    predict.normalize();
    predict.mult(5);
    let predictpos = p5.Vector.add(this.position, predict);

    // Now we must find the normal to the path from the predicted position
    // We look at the normal for each line segment and pick out the closest one
    let normal = null;
    let target = null;
    let worldRecord = 1000000; // Start with a very high worldRecord distance that can easily be beaten

    // Only follow segments that actually exist in the sampled path.
    for (let i = 0; i < path.points.length - 1; i++) {
      // Look at a line segment
      let a = path.points[i];
      let b = path.points[i + 1];

      // Get the normal point to that line
      let normalPoint = getNormalPoint(predictpos, a, b);

      // How far away are we from the path?
      let d = p5.Vector.dist(predictpos, normalPoint);
      // Did we beat the worldRecord and find the closest line segment?
      if (d < worldRecord) {
        worldRecord = d;
        normal = normalPoint;

        // Look at the direction of the line segment so we can seek a little bit ahead of the normal
        let dir = p5.Vector.sub(b, a).normalize();
        // This is an oversimplification
        // Should be based on distance to path & velocity
        dir.mult(10);
        target = normal.copy();
        target.add(dir);
      }
    }

    // Draw the debugging stuff
    if (debug) {
      // Draw predicted future position
      stroke(0);
      fill("#161616");
      line(this.position.x, this.position.y, predictpos.x, predictpos.y);
      ellipse(predictpos.x, predictpos.y, 4, 4);

      // Draw normal position
      stroke(0);
      fill("#161616");
      ellipse(normal.x, normal.y, 4, 4);
      // Draw actual target (red if steering towards it)
      line(predictpos.x, predictpos.y, target.x, target.y);
      if (worldRecord > path.radius) fill(255, 0, 0);
      noStroke();
      ellipse(target.x, target.y, 8, 8);
    }

    if (!target) return createVector(0, 0);
    // Gradually engage steering near the edge instead of switching it on abruptly.
    const blend = constrain((worldRecord - path.radius * 0.65) / Math.max(1, path.radius * 0.7), 0, 1);
    return this.seek(target).mult(blend * blend * (3 - 2 * blend));
  }

  // Separation
  // Method checks for nearby boids and steers away
  separate(boids) {
    let desiredseparation = particleSeparationDistance;
    let steer = createVector(0, 0, 0);
    // For every boid in the system, check if it's too close
    for (let i = 0; i < boids.length; i++) {
      let other = boids[i];
      let d = p5.Vector.dist(this.position, other.position);
      // If the distance is greater than 0 and less than an arbitrary amount (0 when you are yourself)
      if (d > 0 && d < desiredseparation) {
        // Calculate vector pointing away from neighbor
        let diff = p5.Vector.sub(this.position, other.position);
        diff.div(d);
        const proximity = 1 - d / desiredseparation;
        const weight = proximity * proximity * (3 - 2 * proximity);
        const closingSpeed = Math.max(0, -p5.Vector.sub(this.velocity, other.velocity).dot(diff));
        diff.mult(weight * (this.maxforce + closingSpeed * 0.15));
        steer.add(diff);
      }
    }
    // Preserve weak corrections instead of normalizing them to full speed.
    steer.limit(this.maxforce);
    return steer;
  }

  // Method to update position
  update() {
    const gathering = Boolean(circleTransition) && (circleTransition.mode !== "samples"
      || circleTransition.entries.some(entry => entry.vehicle === this && !entry.arrived));
    const speedLimit = gathering ? circleGatherSpeed : this.maxspeed;
    if (this.collisionOnly) {
      // Inward attraction and collision impulses, without contour-following behavior.
      this.acceleration.limit(gathering ? circleGatherForce : interiorAttractionStrength);
      this.velocity.add(this.acceleration);
      this.velocity.mult(0.94);
      this.velocity.limit(speedLimit);
      this.position.add(this.velocity);
      if (this.velocity.magSq() < 0.000001) this.velocity.mult(0);
      this.acceleration.mult(0);
      this.smoothedAcceleration.mult(0);
      return;
    }
    // Update velocity
    this.acceleration.limit(gathering ? circleGatherForce : this.maxforce);
    this.smoothedAcceleration.lerp(this.acceleration, 1);
    this.velocity.add(this.smoothedAcceleration);
    // Limit speed
    this.velocity.limit(speedLimit);
    this.position.add(this.velocity);
    // Reset accelertion to 0 each cycle
    this.acceleration.mult(0);
    
    if (this.velocity.magSq() > 0.01) {
      let desiredAngle = this.velocity.heading();
      let angleChange = lerpAngle(this.angle, desiredAngle, this.rotationSpeed) - this.angle;
      angleChange = constrain(angleChange, -this.maxRotationStep, this.maxRotationStep);
      this.angle += angleChange;
    }
  }

  // A method that calculates and applies a steering force towards a target
  // STEER = DESIRED MINUS VELOCITY
  seek(target) {
    let desired = p5.Vector.sub(target, this.position); // A vector pointing from the position to the target

    // Normalize desired and scale to maximum speed
    desired.normalize();
    desired.mult(this.maxspeed);
    // Steering = Desired minus Vepositionity
    let steer = p5.Vector.sub(desired, this.velocity);
    steer.limit(this.maxforce); // Limit to maximum steering force

    return steer;

  }

  render() {
    push();
    fill(this.color);
    noStroke();
    translate(this.position.x, this.position.y);
    rotate(this.angle);
    const halfSize = particleHalfSize(this);
    if (this.shape === "triangle" || this.shape === "flat-triangle") {
      const h=halfSize*(this.shape === "flat-triangle" ? 0.5 : 1);
      const inradius=2*halfSize*h/(halfSize+Math.hypot(halfSize,2*h));
      const radius=inradius*Math.max(0,Math.min(0.9,triangleRoundness));
      const scale=1-radius/inradius;
      const cy=h-inradius;
      stroke(this.color);
      strokeWeight(radius*2);
      strokeJoin(ROUND);
      if(radius===0) noStroke();
      triangle(0,cy+(-h-cy)*scale,-halfSize*scale,cy+(h-cy)*scale,halfSize*scale,cy+(h-cy)*scale);
    } else if (this.shape === "square") {
      rectMode(CENTER);
      rect(0, 0, this.r, this.r, halfSize * Math.max(0, Math.min(1, squareRoundness)));
    } else {
      ellipse(0, 0, this.r, this.r);
    }

    pop();
  }
}

// A function to get the normal point from a point (p) to a line segment (a-b)
// This function could be optimized to make fewer new Vector objects
function getNormalPoint(p, a, b) {
  const segment = p5.Vector.sub(b, a);
  const lengthSquared = segment.magSq();

  if (lengthSquared === 0) {
    return a.copy();
  }

  const projection = p5.Vector.sub(p, a).dot(segment) / lengthSquared;
  const clampedProjection = constrain(projection, 0, 1);
  return p5.Vector.add(a, segment.mult(clampedProjection));
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > PI) diff -= TWO_PI;
  while (diff < -PI) diff += TWO_PI;
  return a + diff * t;
}

// Conservative circular bounds also cover rotated polygon corners.
const triangleScale = 1.25;
const flatTriangleScale = 2;

function particleHalfSize(vehicle) {
  return vehicle.r / 2 * (vehicle.shape === "flat-triangle" ? flatTriangleScale : vehicle.shape === "triangle" ? triangleScale : 1);
}
function collisionRadius(vehicle) {
  const half = particleHalfSize(vehicle);
  if (vehicle.shape === "circle") return half;
  if (vehicle.shape === "square") {
    const roundness = Math.max(0, Math.min(1, squareRoundness));
    return half * (Math.SQRT2 * (1 - roundness) + roundness);
  }
  return half * (vehicle.shape === "flat-triangle" ? Math.hypot(1,0.5) : Math.SQRT2);
}

function resolveParticleCollisions(particles, iterations = 8) {
  const radii = particles.map(collisionRadius);
  for (let pass = 0; pass < iterations; pass++) {
    let maxOverlap = 0;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distance = Math.hypot(dx, dy);
        const overlap = radii[i] + radii[j] - distance;
        if (overlap <= 0) continue;
        maxOverlap = Math.max(maxOverlap, overlap);
        // Deterministic direction for coincident centers; no random frame-to-frame jitter.
        const angle = (i * 0.754877666 + j * 0.569840296) * Math.PI * 2;
        const nx = distance > 1e-8 ? dx / distance : Math.cos(angle);
        const ny = distance > 1e-8 ? dy / distance : Math.sin(angle);
        const correction = overlap * 0.5;
        a.position.x -= nx * correction;
        a.position.y -= ny * correction;
        b.position.x += nx * correction;
        b.position.y += ny * correction;
        // Equal masses, zero restitution: preserve tangential movement without bouncing.
        const closing = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny;
        if (closing < 0) {
          a.velocity.x += nx * closing * 0.5;
          a.velocity.y += ny * closing * 0.5;
          b.velocity.x -= nx * closing * 0.5;
          b.velocity.y -= ny * closing * 0.5;
        }
        for (const [body, sign] of [[a, 1], [b, -1]]) {
          const acceleration = body.smoothedAcceleration;
          if (!acceleration) continue;
          const inward = (acceleration.x * nx + acceleration.y * ny) * sign;
          if (inward > 0) {
            acceleration.x -= nx * sign * inward;
            acceleration.y -= ny * sign * inward;
          }
        }
      }
    }
    if (maxOverlap < 0.01) break;
  }
}