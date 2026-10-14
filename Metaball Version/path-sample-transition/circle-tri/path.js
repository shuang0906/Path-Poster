// The Nature of Code
// Daniel Shiffman
// http://natureofcode.com

// Path Following


class Path {
  
  constructor() {
    // A path has a radius, i.e how far is it ok for the boid to wander off
    this.radius = pathRadius * SizeF;
    // A Path is an arraylist of points (PVector objects)
    this.points = [];
  }

  // Add a point to the path
  addPoint(x, y) {
    let point = createVector(x, y);
    this.points.push(point);
  }

  // Draw the path
  display() {
    push();
    strokeJoin(ROUND);
    strokeCap(ROUND);

    // Draw thick line for radius
    stroke(40, 50, 60, 45);
    strokeWeight(this.radius * 2);
    noFill();
    beginShape();
    for (let v of this.points) {
      vertex(v.x, v.y);
    }
    endShape();
    pop();
  }

  getLength() {
    let len = 0;
    for (let i = 1; i < this.points.length; i++) {
      len += p5.Vector.dist(this.points[i - 1], this.points[i]);
    }
    return len;
  }
}
