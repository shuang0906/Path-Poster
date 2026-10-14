function setupIdentityControls() {
  const panel=document.createElement("section");
  panel.className="identity-controls";
  panel.innerHTML="<h3>Particle Identity V2</h3><p>Scale & grouping reset the particles; fusion controls update live.</p>";
  const params=[["Particle Scale","size",1,2.4,0.05,true],["Color Grouping","grouping",0,1,0.05,true],["Fusion Reach","reach",0.15,1.2,0.05,false],["Fusion Threshold","threshold",0.28,0.60,0.01,false]];
  for(const [title,key,min,max,step,rebuild] of params) {
    const label=document.createElement("label"),out=document.createElement("output"),input=document.createElement("input");
    input.type="range";input.min=min;input.max=max;input.step=step;input.value=identity[key];out.textContent=identity[key].toFixed(2);
    label.append(title+" ",out,input);panel.append(label);
    input.addEventListener("input",()=>{identity[key]=Number(input.value);out.textContent=identity[key].toFixed(2);});
    input.addEventListener("change",()=>{if(rebuild)rebuildParticles();});
  }
  const guide=document.createElement("p");
  guide.textContent="60% Large / 30% Medium / 10% Small. Only circles and rounded squares.";
  panel.append(guide);
  document.querySelector(".particle-controls").prepend(panel);
}
function rebuildParticles() {
  circleTransition = null;
  vehicles = [];
  spawnConfiguredParticles();
  applyParticleMixes();
  updateParticleTotal();
  saveParticleSnapshot();
}

function updateParticleTotal() {
  document.getElementById("particle-total").textContent = `${particleTypes.length} 类 · ${vehicles.length} 个`;
}

function applyParticleMixes() {
  particleTypes.forEach((type,index) => {
    const group=vehicles.filter(v=>v.typeIndex===index);
    const ratio=type.mix ?? 0.5;
    group.forEach((v,i)=>{
      v.shape=Math.round((i+1)*ratio)>Math.round(i*ratio) ? type.shape : type.shapeB;
      v.color=type.color;
    });
  });
}
function setupParticleControls() {
  particleTypes.forEach(type=>{
    type.color = normalizeParticleColor(type.color);
    type.shapeB ??= type.shape === "circle" ? "square" : "circle";
    type.mix ??= 0.5;
  });
  applyParticleMixes();
  const totalInput = document.getElementById("external-particle-total");
  totalInput.value = totalExternalParticles;
  function setTotal(value) {
    if (Number.isFinite(value)) {
      totalExternalParticles = Math.max(0, Math.min(10000, Math.round(value)));
      rebuildParticles();
      renderParticleControls();
    }
    totalInput.value = totalExternalParticles;
  }
  totalInput.addEventListener("change", () => setTotal(totalInput.valueAsNumber));
  document.getElementById("decrease-particle-total").addEventListener("click", () => setTotal(totalExternalParticles - 1));
  document.getElementById("increase-particle-total").addEventListener("click", () => setTotal(totalExternalParticles + 1));
  document.getElementById("add-particle-type").addEventListener("click", () => {
    const palette = ["#107DFE", "#FD5F00", "#02B553", "#FB8BF7", "#FFCE00", "#14151A"];
    particleTypes.push({ shape: "circle", shapeB: "square", mix: 0.5, color: palette[particleTypes.length % palette.length], count: 20 });
    rebuildParticles();
    renderParticleControls();
  });
  renderParticleControls();
  setupIdentityControls();
  setupInitializationControls();
  saveParticleSnapshot();
}

function renderParticleControls() {
  const container = document.getElementById("particle-types");
  container.replaceChildren();
  particleTypes.forEach((type, index) => {
    const row = document.createElement("div");
    row.className = "particle-row";
    const options='<option value="circle">圆形</option><option value="square">圆角正方形</option>';
    row.innerHTML = `
      <span class="type-number">${index + 1}${type.collisionOnly ? " · 内部 / 吸力＋碰撞" : ""}</span>
      <label>形状 A<select data-shape="a" aria-label="类别 ${index+1} 形状 A">${options}</select></label>
      <label>形状 B<select data-shape="b" aria-label="类别 ${index+1} 形状 B">${options}</select></label>
      <label>A 占比 <output class="mix-value"></output><input class="mix-ratio" type="range" min="0" max="100" step="1" aria-label="类别 ${index+1} 形状 A 占比"></label>
      <label>颜色<input type="color" aria-label="类别 ${index + 1} 颜色"></label>
      <label>数量<span class="count-control"><button type="button" data-step="-1" aria-label="减少类别 ${index + 1} 数量">−</button><input type="number" min="0" max="1000" step="1" aria-label="类别 ${index + 1} 数量"><button type="button" data-step="1" aria-label="增加类别 ${index + 1} 数量">＋</button></span></label>
      <button type="button" class="remove-type" aria-label="删除类别 ${index + 1}">删除</button>`;
    const shape = row.querySelector('[data-shape="a"]');
    const shapeB=row.querySelector('[data-shape="b"]');
    const mix=row.querySelector('.mix-ratio');
    const mixValue=row.querySelector('.mix-value');
    const color = row.querySelector('input[type="color"]');
    const count = row.querySelector('input[type="number"]');
    shape.value = type.shape;
    shapeB.value=type.shapeB;
    mix.value=Math.round(type.mix*100);
    mixValue.textContent=`${mix.value}%`;
    color.value = type.color;
    count.value = type.count;
    count.disabled = !type.collisionOnly;
    row.querySelectorAll("[data-step]").forEach(button => { button.disabled = !type.collisionOnly; });
    function updateAppearance() {
      type.shape = shape.value;
      type.color = color.value;
      type.shapeB=shapeB.value;
      type.mix=Number(mix.value)/100;
      mixValue.textContent=`${mix.value}%`;
      applyParticleMixes();
    }
    shapeB.addEventListener("change",updateAppearance);
    mix.addEventListener("input",updateAppearance);
    shape.addEventListener("change", updateAppearance);
    color.addEventListener("input", updateAppearance);
    function setCount(value) {
      if (!Number.isFinite(value)) { count.value = type.count; return; }
      type.count = Math.max(0, Math.min(1000, Math.round(value)));
      count.value = type.count;
      rebuildParticles();
    }
    count.addEventListener("change", () => setCount(count.valueAsNumber));
    row.querySelectorAll("[data-step]").forEach(button => {
      button.addEventListener("click", () => setCount(type.count + Number(button.dataset.step)));
    });
    row.querySelector(".remove-type").addEventListener("click", () => {
      particleTypes.splice(index, 1);
      rebuildParticles();
      renderParticleControls();
    });
    container.appendChild(row);
  });
  updateParticleTotal();
}

// Detached initialization snapshot: animation never mutates the saved positions.
let particleSnapshot = null;
const particleSnapshotStorageKey = "path-sample-transition-copy.particle-snapshot.v1";

function saveParticleSnapshot() {
  particleSnapshot = {
    version: 1,
    savedAt: new Date().toISOString(),
    text: pathLetters[pathLetterIndex],
    canvas: { width, height, scale: SizeF },
    totalExternalParticles,
    types: particleTypes.map(type => ({ ...type })),
    identity: {...identity},
    particles: vehicles.map((v, index) => ({
      id: index,
      typeIndex: v.typeIndex,
      shape: v.shape,
      diameter: v.r,
      color: v.color,
      collisionOnly: v.collisionOnly,
      x: v.position.x,
      y: v.position.y,
      pathIndex: v.assignedPath ? paths.indexOf(v.assignedPath) : null
    }))
  };
  const status = document.getElementById("snapshot-status");
  try {
    localStorage.setItem(particleSnapshotStorageKey, JSON.stringify(particleSnapshot));
    status.textContent = `已保存 ${particleSnapshot.particles.length} 个粒子的初始化种类和位置`;
  } catch (error) {
    status.textContent = "浏览器存储不可用；快照已保留，可下载 JSON";
  }
}

function setupInitializationControls() {
  const input = document.getElementById("initial-text");
  input.value = pathLetters[pathLetterIndex];
  document.getElementById("initialize-particles").addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      input.setCustomValidity("请输入文字");
      input.reportValidity();
      return;
    }
    const previousText = pathLetters[pathLetterIndex];
    const previousPaths = paths;
    pathLetters[pathLetterIndex] = text;
    newPaths();
    if (!paths.length) {
      pathLetters[pathLetterIndex] = previousText;
      paths = previousPaths;
      refreshInteriorAttractionTargets();
      document.getElementById("snapshot-status").textContent = "输入没有可用轮廓，请换用字体支持的文字";
      return;
    }
    transitionOutwardStart = -Infinity;
    cameraOffset.x = 0;
    cameraOffset.y = 0;
    rebuildParticles();
    renderParticleControls();
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
  document.getElementById("download-particle-snapshot").addEventListener("click", () => {
    if (!particleSnapshot) return;
    const blob = new Blob([JSON.stringify(particleSnapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "particle-initialization.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
