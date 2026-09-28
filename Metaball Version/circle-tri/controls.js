function rebuildParticles() {
  vehicles = [];
  spawnVehiclesInsidePathBand(particleTypes.reduce((sum, type) => sum + type.count, 0));
  updateParticleTotal();
}

function updateParticleTotal() {
  document.getElementById("particle-total").textContent = `${particleTypes.length} 类 · ${vehicles.length} 个`;
}

function setupParticleControls() {
  document.getElementById("add-particle-type").addEventListener("click", () => {
    const palette = ["#E4572E", "#247BA0", "#6A4C93", "#2A9D8F", "#E9C46A"];
    particleTypes.push({ shape: "circle", color: palette[particleTypes.length % palette.length], count: 20 });
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
    row.innerHTML = `
      <span class="type-number">${index + 1}</span>
      <label>形状<select aria-label="类别 ${index + 1} 形状">
        <option value="circle">圆形</option><option value="triangle">三角形</option><option value="square">圆角正方形</option>
      </select></label>
      <label>颜色<input type="color" aria-label="类别 ${index + 1} 颜色"></label>
      <label>数量<span class="count-control"><button type="button" data-step="-1" aria-label="减少类别 ${index + 1} 数量">−</button><input type="number" min="0" max="1000" step="1" aria-label="类别 ${index + 1} 数量"><button type="button" data-step="1" aria-label="增加类别 ${index + 1} 数量">＋</button></span></label>
      <button type="button" class="remove-type" aria-label="删除类别 ${index + 1}">删除</button>`;
    const shape = row.querySelector("select");
    const color = row.querySelector('input[type="color"]');
    const count = row.querySelector('input[type="number"]');
    shape.value = type.shape;
    color.value = type.color;
    count.value = type.count;
    function updateAppearance() {
      type.shape = shape.value;
      type.color = color.value;
      for (const vehicle of vehicles) {
        if (vehicle.typeIndex === index) {
          vehicle.shape = type.shape;
          vehicle.color = type.color;
        }
      }
    }
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
