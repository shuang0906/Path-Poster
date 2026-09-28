// GPU field accumulation inspired by https://shaders.paper.design/metaballs.
// Instanced local quads keep the cost proportional to each particle's footprint.
const metaballSoftness = 0.5;
const squareRoundness = 0.35; // 0 = sharp square, 1 = circle.
let metaballGPU;

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
        vec2 a=vec2(0.,-halfSize), b=vec2(-halfSize,halfSize), c=vec2(halfSize,halfSize);
        d = min(edgeDistance(p,a,b),min(edgeDistance(p,b,c),edgeDistance(p,c,a)));
        bool inside = p.y <= halfSize && p.y >= 2.*abs(p.x)-halfSize;
        if (inside) d = -d;
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
    out vec4 outputColor;
    void main() {
      float value=texture(field,gl_FragCoord.xy/resolution).r;
      float edge=max(fwidth(value),1./255.);
      float alpha=smoothstep(0.4-edge*0.5,0.4+edge*0.5,value);
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
    fieldUniforms:uniforms(fieldProgram,['resolution','reachScale','shape','roundness']),
    compositeUniforms:uniforms(compositeProgram,['resolution','field','color'])};
}

function renderMetaballs() {
  if(!metaballGPU) { for(const vehicle of vehicles) vehicle.render(); return; }
  const {canvas,gl,fieldProgram,compositeProgram,texture,framebuffer,vao,compositeVAO,buffer,fieldUniforms:f,compositeUniforms:c}=metaballGPU;
  gl.viewport(0,0,width,height);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  for(let typeIndex=0;typeIndex<particleTypes.length;typeIndex++) {
    const type=particleTypes[typeIndex];
    const group=vehicles.filter(vehicle=>vehicle.typeIndex===typeIndex);
    const data=new Float32Array(group.length*4);
    group.forEach((v,i)=>data.set([v.position.x,v.position.y,v.r/2,v.angle],i*4));
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.bindTexture(gl.TEXTURE_2D,null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(fieldProgram);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    gl.uniform2f(f.resolution,width,height);
    gl.uniform1f(f.reachScale,Math.max(0.1,metaballSoftness*12));
    gl.uniform1f(f.roundness,squareRoundness);
    gl.uniform1i(f.shape,['circle','triangle','square'].indexOf(type.shape));
    gl.blendFunc(gl.ONE,gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,group.length);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.useProgram(compositeProgram);
    gl.bindVertexArray(compositeVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.uniform1i(c.field,0);
    gl.uniform2f(c.resolution,width,height);
    gl.uniform3fv(c.color,type.color.match(/\w\w/g).map(value=>parseInt(value,16)/255));
    gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  drawingContext.drawImage(canvas,0,0,width,height);
}
