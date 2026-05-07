const canvas = wx.createCanvas();
const ctx = canvas.getContext("2d");

const ROUND_TIME = 45;
const BASE_WIDTH = 390;
const lines = [
  { id: "sun", label: "金", color: "#f5bb33", dark: "#50360e", shape: "circle" },
  { id: "sea", label: "蓝", color: "#20d6e6", dark: "#0b3e47", shape: "triangle" },
  { id: "rose", label: "红", color: "#ef476f", dark: "#4d1425", shape: "diamond" }
];

const state = {
  time: ROUND_TIME,
  score: 0,
  combo: 0,
  bestCombo: 0,
  passengers: [],
  effects: [],
  spawnTimer: 0,
  spawnEvery: 1.15,
  trainTimer: 2.4,
  trainEvery: 3.8,
  nextId: 1
};

let system = wx.getSystemInfoSync();
let dpr = system.pixelRatio || 1;
let W = system.windowWidth;
let H = system.windowHeight;
let unit = W / BASE_WIDTH;
let last = Date.now();
let started = false;
let running = false;
let finished = false;
let dragging = null;
let activeTouchId = null;
let toast = null;

let layout = {
  header: { h: 0 },
  entrance: { x: 0, y: 0, w: 0, h: 0 },
  platforms: [],
  buttons: {
    restart: { x: 0, y: 0, w: 0, h: 0 },
    pause: { x: 0, y: 0, w: 0, h: 0 },
    primary: { x: 0, y: 0, w: 0, h: 0 }
  }
};

function setupCanvas() {
  system = wx.getSystemInfoSync();
  dpr = system.pixelRatio || 1;
  W = system.windowWidth;
  H = system.windowHeight;
  unit = W / BASE_WIDTH;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeLayout();
}

function computeLayout() {
  const safeTop = system.safeArea ? system.safeArea.top : 0;
  const safeBottom = system.safeArea ? Math.max(0, H - system.safeArea.bottom) : 0;
  const pad = clamp(W * 0.045, 14, 22);
  const headerH = safeTop + 104;
  const playTop = headerH + 12;
  const entranceH = clamp(H * 0.2, 116, 158);
  const entranceBottom = Math.max(pad + safeBottom, 16);
  const available = H - playTop - entranceH - entranceBottom - 18;
  const laneGap = clamp(H * 0.018, 10, 16);
  const laneH = clamp((available - laneGap * 2) / 3, 68, 94);

  layout.header = { h: headerH, safeTop };
  layout.buttons.restart = { x: W - pad - 92, y: safeTop + 10, w: 42, h: 42 };
  layout.buttons.pause = { x: W - pad - 42, y: safeTop + 10, w: 42, h: 42 };
  layout.platforms = lines.map((line, i) => ({
    ...line,
    x: pad,
    y: playTop + i * (laneH + laneGap),
    w: W - pad * 2,
    h: laneH,
    progress: rand(0.05, 0.88),
    trainX: W + 90
  }));
  layout.entrance = {
    x: pad,
    y: H - entranceBottom - entranceH,
    w: W - pad * 2,
    h: entranceH
  };
  layout.buttons.primary = {
    x: W * 0.5 - 125,
    y: H * 0.5 + 54,
    w: 250,
    h: 48
  };
}

function resetGame() {
  Object.assign(state, {
    time: ROUND_TIME,
    score: 0,
    combo: 0,
    bestCombo: 0,
    passengers: [],
    effects: [],
    spawnTimer: 0,
    spawnEvery: 1.15,
    trainTimer: 2.2,
    trainEvery: 3.8,
    nextId: 1
  });
  started = true;
  running = true;
  finished = false;
  dragging = null;
  activeTouchId = null;
  for (let i = 0; i < 6; i += 1) spawnPassenger(true);
}

function spawnPassenger(initial) {
  const line = lines[Math.floor(Math.random() * lines.length)];
  const e = layout.entrance;
  const r = clamp(W * 0.045, 17, 22);
  state.passengers.push({
    id: state.nextId++,
    line: line.id,
    color: line.color,
    shape: line.shape,
    x: clamp(e.x + rand(30, e.w - 30), e.x + r, e.x + e.w - r),
    y: clamp(e.y + rand(38, e.h - 32), e.y + r, e.y + e.h - r),
    r,
    vx: initial ? rand(-10, 10) : rand(-18, 18),
    vy: initial ? rand(-8, 8) : rand(-16, 16),
    zone: null,
    age: rand(0, 5)
  });
}

function tick(dt) {
  if (!running) return;

  state.time -= dt;
  if (state.time <= 0) {
    state.time = 0;
    finishGame();
    return;
  }

  const rush = 1 - state.time / ROUND_TIME;
  state.spawnEvery = clamp(1.08 - rush * 0.52, 0.48, 1.08);
  state.trainEvery = clamp(3.8 - rush * 1.05, 2.35, 3.8);
  state.spawnTimer -= dt;
  state.trainTimer -= dt;

  if (state.spawnTimer <= 0 && state.passengers.length < 24) {
    spawnPassenger(false);
    state.spawnTimer = state.spawnEvery;
  }

  if (state.trainTimer <= 0) {
    trainArrives();
    state.trainTimer = state.trainEvery;
  }

  movePassengers(dt);
  movePlatforms(dt);
  moveEffects(dt);
  if (toast) {
    toast.life -= dt;
    if (toast.life <= 0) toast = null;
  }
}

function movePassengers(dt) {
  for (const p of state.passengers) {
    p.age += dt;
    if (dragging && dragging.id === p.id) continue;

    if (p.zone) {
      const platform = layout.platforms.find(item => item.id === p.zone);
      if (!platform) continue;
      const group = state.passengers.filter(item => item.zone === p.zone);
      const index = group.findIndex(item => item.id === p.id);
      const cols = Math.max(4, Math.floor((platform.w - 86) / 42));
      const x = platform.x + 56 + (index % cols) * 38;
      const y = platform.y + 38 + Math.floor(index / cols) * 28;
      p.x += (x - p.x) * Math.min(1, dt * 9);
      p.y += (y - p.y) * Math.min(1, dt * 9);
    } else {
      const e = layout.entrance;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < e.x + p.r || p.x > e.x + e.w - p.r) p.vx *= -1;
      if (p.y < e.y + p.r || p.y > e.y + e.h - p.r) p.vy *= -1;
      p.x = clamp(p.x, e.x + p.r, e.x + e.w - p.r);
      p.y = clamp(p.y, e.y + p.r, e.y + e.h - p.r);
    }
  }
}

function movePlatforms(dt) {
  for (const platform of layout.platforms) {
    platform.progress += dt / state.trainEvery;
    if (platform.progress > 1) platform.progress -= 1;
    const arriving = platform.progress > 0.82 || platform.progress < 0.08;
    const target = arriving ? platform.x + platform.w - 110 : W + 90;
    platform.trainX += (target - platform.trainX) * Math.min(1, dt * 5.5);
  }
}

function moveEffects(dt) {
  state.effects = state.effects
    .map(effect => ({ ...effect, life: effect.life - dt }))
    .filter(effect => effect.life > 0);
}

function trainArrives() {
  const platform = layout.platforms.reduce((chosen, item) =>
    item.progress > chosen.progress ? item : chosen, layout.platforms[0]);
  platform.progress = 0;
  platform.trainX = platform.x + platform.w - 110;

  const keep = [];
  let boarded = 0;
  let wrong = 0;
  for (const p of state.passengers) {
    if (p.zone !== platform.id) {
      keep.push(p);
      continue;
    }

    if (p.line === platform.id) {
      boarded += 1;
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      const points = 90 + Math.min(12, state.combo) * 10;
      state.score += points;
      addEffect(p.x, p.y, `+${points}`, p.color);
    } else {
      wrong += 1;
      state.combo = 0;
      state.score = Math.max(0, state.score - 80);
      addEffect(p.x, p.y, "-80", "#ef476f");
    }
  }

  state.passengers = keep;
  const crowd = boarded + wrong;
  if (crowd > 4) {
    const penalty = (crowd - 4) * 30;
    state.combo = 0;
    state.score = Math.max(0, state.score - penalty);
    addEffect(platform.x + platform.w * 0.5, platform.y + 22, `-${penalty}`, "#ef476f");
  }
  if (boarded > 0) showToast(`发车 +${boarded}`);
  if (wrong > 0) showToast("送错车");
}

function finishGame() {
  finished = true;
  running = false;
}

function addEffect(x, y, text, color) {
  state.effects.push({ x, y, text, color, life: 0.8, max: 0.8 });
}

function showToast(text) {
  toast = { text, life: 0.7, max: 0.7 };
}

function dropPassenger(p, x, y) {
  const platform = layout.platforms.find(item =>
    x >= item.x - 14 &&
    x <= item.x + item.w + 14 &&
    y >= item.y - 14 &&
    y <= item.y + item.h + 14
  );

  if (platform) {
    p.zone = platform.id;
    p.x = clamp(x, platform.x + p.r, platform.x + platform.w - p.r);
    p.y = clamp(y, platform.y + p.r, platform.y + platform.h - p.r);
    if (p.line === platform.id) {
      state.score += 10;
      addEffect(p.x, p.y - 12, "+10", p.color);
    } else {
      state.combo = 0;
      state.score = Math.max(0, state.score - 15);
      addEffect(p.x, p.y - 12, "-15", "#ef476f");
    }
  } else {
    const e = layout.entrance;
    p.zone = null;
    p.x = clamp(x, e.x + p.r, e.x + e.w - p.r);
    p.y = clamp(y, e.y + p.r, e.y + e.h - p.r);
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawBack();
  drawHeader();
  for (const platform of layout.platforms) drawPlatform(platform);
  drawEntrance();
  for (const p of state.passengers) {
    if (!dragging || dragging.id !== p.id) drawPassenger(p, false);
  }
  if (dragging) drawPassenger(dragging, true);
  drawEffects();
  if (toast) drawToast();
  if (!started) drawDialog("发车", "把乘客拖到同色月台，列车进站时结算。", "开始");
  if (started && !running && !finished) drawDialog("暂停", `${state.score} 分`, "继续");
  if (finished) drawDialog("到站", `${state.score} 分 · 最高连击 ${state.bestCombo}`, "再来一局");
}

function drawBack() {
  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, "#061012");
  gradient.addColorStop(0.55, "#10121c");
  gradient.addColorStop(1, "#1a1116");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,247,223,0.06)";
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let x = -H; x < W + H; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + H * 0.34, H);
    ctx.stroke();
  }
}

function drawHeader() {
  const h = layout.header.h;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(5,9,14,0.95)");
  g.addColorStop(1, "rgba(5,9,14,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, h);
  ctx.strokeStyle = "rgba(255,247,223,0.16)";
  ctx.beginPath();
  ctx.moveTo(0, h - 1);
  ctx.lineTo(W, h - 1);
  ctx.stroke();

  const y = layout.header.safeTop + 10;
  roundRect(14, y, 34, 34, 8);
  ctx.fillStyle = "#101925";
  ctx.fill();
  ctx.strokeStyle = "#fff7df";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#f5bb33";
  ctx.fillRect(22, y + 25, 18, 4);
  ctx.fillStyle = "#20d6e6";
  ctx.fillRect(29, y + 18, 4, 18);

  ctx.fillStyle = "#fff7df";
  ctx.font = `${Math.round(20 * unit)}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("一分钟月台", 58, y + 18);

  drawIconButton(layout.buttons.restart, "restart");
  drawIconButton(layout.buttons.pause, running ? "pause" : "play");

  const meterY = layout.header.safeTop + 60;
  const gap = 8;
  const meterW = (W - 28 - gap * 2) / 3;
  drawMeter(14, meterY, meterW, "剩余", Math.ceil(state.time).toString());
  drawMeter(14 + meterW + gap, meterY, meterW, "得分", state.score.toString());
  drawMeter(14 + (meterW + gap) * 2, meterY, meterW, "连击", state.combo.toString());
}

function drawIconButton(box, type) {
  roundRect(box.x, box.y, box.w, box.h, 8);
  ctx.fillStyle = "rgba(12,20,30,0.84)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,247,223,0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = "#fff7df";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (type === "restart") {
    ctx.beginPath();
    ctx.arc(cx, cy, 10, -0.2, Math.PI * 1.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy - 5);
    ctx.lineTo(cx - 11, cy + 4);
    ctx.lineTo(cx - 3, cy + 4);
    ctx.stroke();
  } else if (type === "pause") {
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 10);
    ctx.lineTo(cx - 5, cy + 10);
    ctx.moveTo(cx + 5, cy - 10);
    ctx.lineTo(cx + 5, cy + 10);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 11);
    ctx.lineTo(cx - 5, cy + 11);
    ctx.lineTo(cx + 11, cy);
    ctx.closePath();
    ctx.stroke();
  }
}

function drawMeter(x, y, w, label, value) {
  roundRect(x, y, w, 42, 8);
  ctx.fillStyle = "rgba(10,17,25,0.86)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,247,223,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,247,223,0.68)";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, x + 9, y + 7);
  ctx.fillStyle = "#fff7df";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(value, x + 9, y + 21);
}

function drawPlatform(platform) {
  const crowd = state.passengers.filter(p => p.zone === platform.id).length;
  const alert = crowd > 4 ? 0.24 + Math.sin(Date.now() / 120) * 0.12 : 0;

  roundRect(platform.x, platform.y, platform.w, platform.h, 8);
  ctx.fillStyle = platform.dark;
  ctx.fill();
  ctx.strokeStyle = alert ? `rgba(239,71,111,${0.35 + alert})` : "rgba(255,247,223,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = platform.color;
  ctx.fillRect(platform.x + 10, platform.y + 10, platform.w - 20, 7);
  drawShape(platform.shape, platform.x + 26, platform.y + 34, 11, platform.color);

  ctx.fillStyle = "rgba(255,247,223,0.78)";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`${platform.label}线`, platform.x + 44, platform.y + 35);
  ctx.textAlign = "right";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(`${crowd}/4`, platform.x + platform.w - 14, platform.y + 35);

  const barX = platform.x + 20;
  const barY = platform.y + platform.h - 17;
  const barW = platform.w - 40;
  ctx.fillStyle = "rgba(255,247,223,0.18)";
  ctx.fillRect(barX, barY, barW, 4);
  ctx.fillStyle = platform.color;
  ctx.fillRect(barX, barY, barW * platform.progress, 4);

  const trainW = clamp(platform.w * 0.34, 104, 142);
  const trainH = platform.h - 30;
  roundRect(platform.trainX, platform.y + 15, trainW, trainH, 7);
  ctx.fillStyle = "#172334";
  ctx.fill();
  ctx.fillStyle = platform.color;
  ctx.fillRect(platform.trainX + 10, platform.y + 24, trainW - 20, 5);
  ctx.fillStyle = "#050b11";
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(platform.trainX + 17 + i * 34, platform.y + 40, 22, 16);
  }
}

function drawEntrance() {
  const e = layout.entrance;
  roundRect(e.x, e.y, e.w, e.h, 8);
  ctx.fillStyle = "rgba(255,247,223,0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,247,223,0.2)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "rgba(32,214,230,0.5)";
  ctx.fillRect(e.x + 14, e.y + 13, e.w - 28, 5);
  ctx.fillStyle = "rgba(255,247,223,0.66)";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("候车厅", e.x + 16, e.y + 26);

  ctx.fillStyle = "rgba(5,9,14,0.55)";
  for (let i = 0; i < 5; i += 1) {
    const gx = e.x + e.w - 132 + i * 24;
    ctx.fillRect(gx, e.y + e.h - 28, 15, 11);
  }
}

function drawPassenger(p, held) {
  const bob = held ? 0 : Math.sin((p.age + p.id) * 5.5) * 1.5;
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  if (held) {
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 22;
  }

  ctx.fillStyle = "#111b29";
  ctx.strokeStyle = "rgba(255,247,223,0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, p.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255,247,223,0.88)";
  ctx.fillRect(-8, 1, 5, 5);
  ctx.fillRect(3, 1, 5, 5);
  ctx.fillStyle = p.color;
  ctx.fillRect(-6, 10, 12, 3);

  ctx.beginPath();
  ctx.fillStyle = p.color;
  ctx.arc(0, -p.r - 11, 10, 0, Math.PI * 2);
  ctx.fill();
  drawShape(p.shape, 0, -p.r - 11, 6, "#071013");
  ctx.restore();
}

function drawShape(shape, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(0, 0, size, 0, Math.PI * 2);
  } else if (shape === "triangle") {
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.95, size * 0.75);
    ctx.lineTo(-size * 0.95, size * 0.75);
    ctx.closePath();
  } else {
    ctx.moveTo(0, -size);
    ctx.lineTo(size, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size, 0);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

function drawEffects() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 18px sans-serif";
  for (const item of state.effects) {
    const t = item.life / item.max;
    ctx.globalAlpha = clamp(t, 0, 1);
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, item.x, item.y - (1 - t) * 34);
  }
  ctx.globalAlpha = 1;
}

function drawToast() {
  const alpha = clamp(toast.life / toast.max, 0, 1);
  const textW = Math.min(W - 32, 120 + toast.text.length * 8);
  const x = W / 2 - textW / 2;
  const y = H - 46 - (system.safeArea ? Math.max(0, H - system.safeArea.bottom) : 0);
  ctx.globalAlpha = alpha;
  roundRect(x, y, textW, 34, 8);
  ctx.fillStyle = "rgba(7,12,18,0.88)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,247,223,0.18)";
  ctx.stroke();
  ctx.fillStyle = "#fff7df";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(toast.text, W / 2, y + 17);
  ctx.globalAlpha = 1;
}

function drawDialog(title, text, action) {
  ctx.fillStyle = "rgba(5,9,14,0.72)";
  ctx.fillRect(0, 0, W, H);

  const boxW = Math.min(312, W - 44);
  const boxH = 190;
  const x = W / 2 - boxW / 2;
  const y = H / 2 - boxH / 2;
  roundRect(x, y, boxW, boxH, 8);
  ctx.fillStyle = "rgba(10,17,25,0.96)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,247,223,0.24)";
  ctx.stroke();

  ctx.fillStyle = "#fff7df";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, W / 2, y + 42);

  ctx.fillStyle = "rgba(255,247,223,0.7)";
  ctx.font = "14px sans-serif";
  wrapText(text, W / 2, y + 78, boxW - 40, 20);

  layout.buttons.primary = { x: x + 18, y: y + boxH - 62, w: boxW - 36, h: 46 };
  roundRect(layout.buttons.primary.x, layout.buttons.primary.y, layout.buttons.primary.w, layout.buttons.primary.h, 8);
  ctx.fillStyle = "#12303a";
  ctx.fill();
  ctx.strokeStyle = "rgba(32,214,230,0.52)";
  ctx.stroke();
  ctx.fillStyle = "#fff7df";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText(action, W / 2, layout.buttons.primary.y + 23);
}

function wrapText(text, x, y, maxWidth, lineHeight) {
  const chars = text.split("");
  let line = "";
  let lineY = y;
  for (const char of chars) {
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = char;
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
}

function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function inBox(pos, box) {
  return pos.x >= box.x && pos.x <= box.x + box.w && pos.y >= box.y && pos.y <= box.y + box.h;
}

function getTouch(evt) {
  const touches = evt.changedTouches || [];
  if (!touches.length) return null;
  const t = touches[0];
  return {
    id: t.identifier == null ? 0 : t.identifier,
    x: t.clientX,
    y: t.clientY
  };
}

function handleTap(pos) {
  if (inBox(pos, layout.buttons.restart)) {
    resetGame();
    return true;
  }
  if (inBox(pos, layout.buttons.pause) && started && !finished) {
    running = !running;
    return true;
  }
  if ((!started || !running || finished) && inBox(pos, layout.buttons.primary)) {
    if (!started || finished) resetGame();
    else running = true;
    return true;
  }
  return false;
}

wx.onTouchStart(evt => {
  const pos = getTouch(evt);
  if (!pos) return;
  if (handleTap(pos)) return;
  if (!started || finished || !running) return;

  const target = [...state.passengers].reverse()
    .find(p => distance(pos.x, pos.y, p.x, p.y) <= p.r + 18);
  if (!target) return;

  activeTouchId = pos.id;
  dragging = target;
  target.x = pos.x;
  target.y = pos.y;
  state.passengers = state.passengers.filter(p => p.id !== target.id);
  state.passengers.push(target);
});

wx.onTouchMove(evt => {
  const pos = getTouch(evt);
  if (!pos || activeTouchId !== pos.id || !dragging) return;
  dragging.x = pos.x;
  dragging.y = pos.y;
});

wx.onTouchEnd(evt => {
  const pos = getTouch(evt);
  if (!pos || activeTouchId !== pos.id || !dragging) return;
  dropPassenger(dragging, pos.x, pos.y);
  dragging = null;
  activeTouchId = null;
});

wx.onTouchCancel(evt => {
  const pos = getTouch(evt);
  if (!pos || activeTouchId !== pos.id) return;
  dragging = null;
  activeTouchId = null;
});

wx.onShow(() => {
  if (started && !finished) running = true;
  last = Date.now();
});

wx.onHide(() => {
  if (started && !finished) running = false;
});

function loop() {
  const now = Date.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  draw();
  requestAnimationFrame(loop);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b, c, d) {
  return Math.hypot(a - c, b - d);
}

setupCanvas();
requestAnimationFrame(loop);
