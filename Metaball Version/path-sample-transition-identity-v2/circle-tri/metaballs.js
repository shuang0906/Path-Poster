// GPU field accumulation inspired by https://shaders.paper.design/metaballs.
// Instanced local quads keep the cost proportional to each particle's footprint.
// Visual fusion parameters are controlled from sketch.js identity settings.
const squareRoundness = 0.45; // 0 = sharp square, 1 = circle.
const triangleRoundness = 0.45; // Fraction of triangle inradius.
let metaballGPU;

function normalizeParticleColor(value) {
  return value.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i,
    (_, r, g, b) => `#${r}${r}${g}${g}${b}${b}`);
}

function particleColorRGB(value) {
  const hex = normalizeParticleColor(value);
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function setupMetaballs() {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
  if (!gl) {
    console.warn('WebGL2 unavailable; rendering ordinary particles.');
    return;
  }
  function program(vertex, fragment) {
    const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]].map(([type, source]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, '#version 300 es\nprecision highp float;\n' + source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      return shader;
    });
    const result = gl.createProgram();
    shaders.forEach(shader => gl.attachShader(result, shader));
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(result));
    shaders.forEach(shader => gl.deleteShader(shader));
    return result;
  }
  const fieldProgram = program(`
    layout(location=0) in vec4 particle;
    layout(location=1) in vec2 corner;
    uniform vec2 resolution;
    uniform float reachScale;
    out vec2 localPoint;
    out float halfSize;
    void main() {
      halfSize = particle.z;
      vec2 delta = corner * halfSize * (reachScale + 1.5);
      float c = cos(particle.w), s = sin(particle.w);
      localPoint = vec2(c*delta.x+s*delta.y, -s*delta.x+c*delta.y);
      vec2 point = (particle.xy + delta) / resolution;
      gl_Position = vec4(point.x*2.-1., 1.-point.y*2., 0., 1.);
    }`, `
    in vec2 localPoint;
    in float halfSize;
    uniform int shape;
    uniform float roundness;
    uniform float triangleRounding;
    uniform float reachScale;
    out vec4 outputColor;
    float edgeDistance(vec2 p, vec2 a, vec2 b) {
      vec2 edge = b-a;
      return length(p-a-edge*clamp(dot(p-a,edge)/dot(edge,edge),0.,1.));
    }
    void main() {
      vec2 p = localPoint;
      float d;
      if (shape == 0) d = length(p)-halfSize;
      else if (shape == 2) {
        float radius = halfSize * clamp(roundness,0.,1.);
        vec2 q = abs(p)-(halfSize-radius);
        d = length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
      } else {
        float h=halfSize*(shape==3 ? 0.5 : 1.);
        float inradius=2.*halfSize*h/(halfSize+sqrt(halfSize*halfSize+4.*h*h));
        float radius=inradius*clamp(triangleRounding,0.,0.9);
        float scale=1.-radius/inradius;
        vec2 center=vec2(0.,h-inradius);
        vec2 a=center+(vec2(0.,-h)-center)*scale;
        vec2 b=center+(vec2(-halfSize,h)-center)*scale;
        vec2 c=center+(vec2(halfSize,h)-center)*scale;
        d=min(edgeDistance(p,a,b),min(edgeDistance(p,b,c),edgeDistance(p,c,a)));
        vec2 original=center+(p-center)/scale;
        bool inside=original.y<=h && original.y>=2.*h*abs(original.x)/halfSize-h;
        if(inside) d=-d;
        d-=radius;
      }
      // At d=0 the field is 0.4, preserving each isolated shape's size.
      float root = 0.8114;
      float influence = pow(clamp(root-d/(halfSize*reachScale),0.,1.),4.);
      influence = smoothstep(0.,1.,influence);
      outputColor = vec4(influence);
    }`);
  const compositeProgram = program(`
    const vec2 corners[3] = vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
    void main() { gl_Position=vec4(corners[gl_VertexID],0.,1.); }
  `, `
    uniform sampler2D field;
    uniform vec2 resolution;
    uniform vec3 color;
    uniform float threshold;
    out vec4 outputColor;
    void main() {
      float value=texture(field,gl_FragCoord.xy/resolution).r;
      float edge=max(fwidth(value),1./255.);
      float alpha=smoothstep(threshold-edge*0.5,threshold+edge*0.5,value);
      outputColor=vec4(color*alpha,alpha);
    }
  `);
  const texture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const framebuffer=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error('Metaball framebuffer incomplete');
  const vao=gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,4,gl.FLOAT,false,16,0);
  gl.vertexAttribDivisor(0,1);
  const cornersBuffer=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,cornersBuffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1,2,gl.FLOAT,false,0,0);
  const compositeVAO=gl.createVertexArray();
  const uniforms = (p,names) => Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(p,name)]));
  metaballGPU={canvas,gl,fieldProgram,compositeProgram,texture,framebuffer,vao,compositeVAO,buffer,
    fieldUniforms:uniforms(fieldProgram,['resolution','reachScale','shape','roundness','triangleRounding']),
    compositeUniforms:uniforms(compositeProgram,['resolution','field','color','threshold'])};
}

function renderMetaballs() {
  if(!metaballGPU) {
    push();
    translate(-cameraOffset.x, -cameraOffset.y);
    for(const vehicle of vehicles) vehicle.render();
    pop();
    return;
  }
  const {canvas,gl,fieldProgram,compositeProgram,texture,framebuffer,vao,compositeVAO,buffer,fieldUniforms:f,compositeUniforms:c}=metaballGPU;
  gl.viewport(0,0,width,height);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  for(let typeIndex=0;typeIndex<particleTypes.length;typeIndex++) {
    const type=particleTypes[typeIndex];
    if (type.collisionOnly) continue;
    const group=vehicles.filter(vehicle=>vehicle.typeIndex===typeIndex);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.bindTexture(gl.TEXTURE_2D,null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(fieldProgram);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.uniform2f(f.resolution,width,height);
    gl.uniform1f(f.reachScale,Math.max(0.1,identity.reach*12));
    gl.uniform1f(f.roundness,squareRoundness);
    gl.uniform1f(f.triangleRounding,triangleRoundness);
    gl.blendFunc(gl.ONE,gl.ONE);
    // Both shapes share a field and fuse before this category is composited.
    ['circle','triangle','square','flat-triangle'].forEach((shape,shapeIndex)=>{
      const subgroup=group.filter(v=>v.shape===shape);
      if(!subgroup.length) return;
      const data=new Float32Array(subgroup.length*4);
      subgroup.forEach((v,i)=>data.set([v.position.x-cameraOffset.x,v.position.y-cameraOffset.y,particleHalfSize(v),v.angle],i*4));
      gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
      gl.uniform1i(f.shape,shapeIndex);
      gl.drawArraysInstanced(gl.TRIANGLES,0,6,subgroup.length);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.useProgram(compositeProgram);
    gl.bindVertexArray(compositeVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.uniform1i(c.field,0);
    gl.uniform2f(c.resolution,width,height);
    gl.uniform3fv(c.color,particleColorRGB(type.color));
    gl.uniform1f(c.threshold,identity.threshold);
    gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  drawingContext.drawImage(canvas,0,0,width,height);
  push();
  translate(-cameraOffset.x, -cameraOffset.y);
  for (const vehicle of vehicles) {
    if (vehicle.collisionOnly) vehicle.render();
  }
  pop();
}
