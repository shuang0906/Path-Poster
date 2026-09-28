// The Nature of Code
// Daniel Shiffman
// http://natureofcode.com

// Path Following


class Path {
  
  constructor() {
    // Arbitrary radius of 20
    // A path has a radius, i.e how far is it ok for the boid to wander off
    this.radius = 36 * SizeF;
    // A Path is an arraylist of points (PVector objects)
    this.points = [];
  }

  // Add a point to the path
  addPoint(x, y) {
    let point = createVector(x, y);
    this.points.push(point);
  }

  // Draw the path
  display(color) {
    strokeJoin(ROUND);

    // Draw thick line for radius
    stroke(color, 20, 80)
    strokeWeight((this.radius - 5) * 2 * SizeF);
    noFill();
    beginShape();
    for (let v of this.points) {
      vertex(v.x, v.y);
    }
    endShape(CLOSE);
  }

  getLength() {
    let len = 0;
    for (let i = 1; i < this.points.length; i++) {
      len += p5.Vector.dist(this.points[i - 1], this.points[i]);
    }
    return len;
  }
}
