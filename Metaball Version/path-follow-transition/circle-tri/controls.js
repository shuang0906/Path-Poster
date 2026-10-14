const externalPalettes = {
  original: ["#107DFE", "#FD5F00", "#02B553", "#FB8BF7", "#cbd4d8"],
  hexo: ["#d9d9d9", "#ceff68", "#01b3f8", "#074e69", "#141d1f"]
};

function selectedExternalPalette() {
  return externalPalettes[document.getElementById("external-palette").value];
}

function applyExternalPalette() {
  const palette = selectedExternalPalette();
  let index = 0;
  particleTypes.forEach(type => {
    if (!type.collisionOnly) type.color = palette[index++ % palette.length];
  });
  applyParticleMixes();
}

function rebuildParticles() {
  circleTransition = null;
  vehicles = [];
  spawnConfiguredParticles();
  applyParticleMixes();
  updateParticleTotal();
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
  document.getElementById("external-palette").addEventListener("change", () => {
    applyExternalPalette();
    renderParticleControls();
  });
  document.getElementById("interior-initial-speed").addEventListener("change", () => {
    for (const vehicle of vehicles) {
      if (vehicle.collisionOnly) applyInteriorInitialVelocity(vehicle);
    }
  });
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
    const palette = selectedExternalPalette();
    particleTypes.push({ shape: "circle", shapeB: "square", mix: 0.5, color: palette[particleTypes.filter(type => !type.collisionOnly).length % palette.length], count: 20 });
    rebuildParticles();
    renderParticleControls();
  });
  renderParticleControls();
}

function renderParticleControls() {
  const container = document.getElementById("particle-types");
  container.replaceChildren();
  particleTypes.forEach((type, index) => {
    const row = document.createElement("div");
    row.className = "particle-row";
    const options='<option value="circle">圆形</option><option value="square">圆角正方形</option><option value="triangle">圆角三角形</option><option value="flat-triangle">圆角扁三角形</option>';
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
