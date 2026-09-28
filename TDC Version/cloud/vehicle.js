// The Nature of Code
// Daniel Shiffman
// http://natureofcode.com

// Path Following
// Vehicle class

class Vehicle {
  // Constructor initialize all values
  constructor(x, y, ms, mf) {
    this.position = createVector(x, y);
    this.r = 40 * SizeF;
    this.maxspeed = ms;
    this.maxforce = mf;
    this.acceleration = createVector(0, 0);
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
    f.mult(1.5);
    s.mult(0.35);
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
    predict.mult(12);
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
        dir.mult(18);
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

      // Draw normal position
      stroke(0);
      fill("#161616");
      ellipse(normal.x, normal.y, 4, 4);
      // Draw actual target (red if steering towards it)
      line(predictpos.x, predictpos.y, target.x, target.y);
      if (worldRecord > path.radius) fill(255, 0, 0);
      noStroke();
      //ellipse(target.x, target.y, 8, 8);
    }

    // Only if the distance is greater than the path's radius do we bother to steer
    if (worldRecord > path.radius) {
      return this.seek(target);
    } else {
      return createVector(0, 0);
    }
  }

  // Separation
  // Method checks for nearby boids and steers away
  separate(boids) {
    let desiredseparation = this.r * 2;
    let steer = createVector(0, 0, 0);
    let count = 0;
    // For every boid in the system, check if it's too close
    for (let i = 0; i < boids.length; i++) {
      let other = boids[i];
      let d = p5.Vector.dist(this.position, other.position);
      // If the distance is greater than 0 and less than an arbitrary amount (0 when you are yourself)
      if (d > 0 && d < desiredseparation) {
        // Calculate vector pointing away from neighbor
        let diff = p5.Vector.sub(this.position, other.position);
        diff.normalize();
        diff.div(d); // Weight by distance
        steer.add(diff);
        count++; // Keep track of how many
      }
    }
    // Average -- divide by how many
    if (count > 0) {
      steer.div(count);
    }

    // As long as the vector is greater than 0
    if (steer.mag() > 0) {
      // Implement Reynolds: Steering = Desired - Velocity
      steer.normalize();
      steer.mult(this.maxspeed);
      steer.sub(this.velocity);
      steer.limit(this.maxforce);
    }
    return steer;
  }

  // Method to update position
  update() {
    // Clamp both steering and speed so path corrections cannot become visible jitter.
    this.acceleration.limit(0.08);
    this.velocity.add(this.acceleration);
    this.velocity.limit(5);
    this.position.add(this.velocity);
    // Reset accelertion to 0 each cycle
    this.acceleration.mult(0);

    if (this.velocity.magSq() > 0.01) {
      let desiredAngle = this.velocity.heading();
      let angleChange = lerpAngle(this.angle, desiredAngle, 0.05) - this.angle;
      angleChange = constrain(angleChange, -0.02, 0.02);
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
    // Simpler boid is just a circle
    noStroke();
    fill("#161616");
    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle + PI / 2);

    beginShape();
    // The two endpoints are shared by separate curves, creating sharp tips.
    vertex(30, 20);
    bezierVertex(90, -10, 90, 90, 30, 80);
    bezierVertex(58, 65, 58, 32, 30, 20);
    endShape(CLOSE);

    pop();
  }
}

// A function to get the normal point from a point (p) to a line segment (a-b)
// This function could be optimized to make fewer new Vector objects
function getNormalPoint(p, a, b) {
  const segment = p5.Vector.sub(b, a);
  const lengthSquared = segment.magSq();

  // Repeated text samples can create zero-length segments.
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
