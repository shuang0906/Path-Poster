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

// Offset each contour outward regardless of winding; cap miters at sharp corners.
function offsetContourPath(source, distance) {
  const result = new Path();
  result.radius = source.radius;
  result.color = source.color;
  let points = source.points;
  if (points.length < 3) { result.points = points.map(point => point.copy()); return result; }
  const repeatedEnd = Math.hypot(points[0].x - points[points.length - 1].x,
    points[0].y - points[points.length - 1].y) < 0.001;
  if (repeatedEnd) points = points.slice(0, -1);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  const winding = area >= 0 ? 1 : -1;
  const outwardNormal = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return {x: winding * dy / length, y: -winding * dx / length};
  };
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const before = outwardNormal(points[(i + points.length - 1) % points.length], point);
    const after = outwardNormal(point, points[(i + 1) % points.length]);
    let nx = before.x + after.x, ny = before.y + after.y;
    const length = Math.hypot(nx, ny);
    if (length < 0.000001) { nx = after.x; ny = after.y; }
    else { nx /= length; ny /= length; }
    const projection = Math.max(0.5, nx * after.x + ny * after.y);
    result.addPoint(point.x + nx * distance / projection, point.y + ny * distance / projection);
  }
  if (repeatedEnd) result.addPoint(result.points[0].x, result.points[0].y);
  return result;
}
