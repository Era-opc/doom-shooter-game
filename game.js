const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const hpEl = document.getElementById('hp');
const levelEl = document.getElementById('level');
const killsEl = document.getElementById('kills');
const diffEl = document.getElementById('diff');
const bannerEl = document.getElementById('banner');

const W = canvas.width;
const H = canvas.height;
const FOV = Math.PI / 2.8;
const MAX_DEPTH = 24;
const PLAYER_RADIUS = 0.22;

const keys = {};
let lastTime = 0;
let level = 1;
let kills = 0;
let gateTimer = 0;
let levelTransitionFlag = false;

const state = {
  player: {
    x: 2.5,
    y: 2.5,
    angle: 0,
    radius: PLAYER_RADIUS,
    health: 100,
    maxHealth: 100,
    speed: 2.6,
    turnSpeed: 2.2,
    fireCooldown: 0,
    damage: 42,
    lastHit: 0,
    loot: 0
  },
  map: [],
  mapSize: 16,
  enemies: [],
  message: '',
  gameOver: false,
  levelCleared: false,
  difficulty: 1
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeAngle(angle) {
  while (angle < -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function wallAt(x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);

  if (ty < 0 || tx < 0 || ty >= state.map.length || tx >= state.map[0].length) {
    return 1;
  }

  return state.map[ty][tx] === 1 ? 1 : 0;
}

function isWalkable(x, y) {
  const checks = [
    [x - state.player.radius, y - state.player.radius],
    [x + state.player.radius, y - state.player.radius],
    [x - state.player.radius, y + state.player.radius],
    [x + state.player.radius, y + state.player.radius]
  ];

  return checks.every(([cx, cy]) => wallAt(cx, cy) === 0);
}

function generateMap(size, levelNumber) {
  const grid = Array.from({ length: size }, () => Array(size).fill(1));

  const roomCount = 6 + Math.min(levelNumber, 10);
  const rooms = [];

  function carveRect(x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (yy >= 0 && yy < size && xx >= 0 && xx < size) {
          grid[yy][xx] = 0;
        }
      }
    }
  }

  for (let i = 0; i < roomCount; i++) {
    const w = 2 + Math.floor(Math.random() * 4);
    const h = 2 + Math.floor(Math.random() * 4);
    const x = 1 + Math.floor(Math.random() * (size - w - 2));
    const y = 1 + Math.floor(Math.random() * (size - h - 2));
    carveRect(x, y, w, h);
    rooms.push({ x, y, w, h });
  }

  for (let i = 1; i < rooms.length; i++) {
    const prev = rooms[i - 1];
    const curr = rooms[i];
    const x1 = Math.floor(prev.x + prev.w / 2);
    const y1 = Math.floor(prev.y + prev.h / 2);
    const x2 = Math.floor(curr.x + curr.w / 2);
    const y2 = Math.floor(curr.y + curr.h / 2);

    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) grid[y1][x] = 0;
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) grid[y][x2] = 0;
  }

  const startRoom = rooms[0];
  const startX = startRoom.x + Math.floor(startRoom.w / 2) + 0.5;
  const startY = startRoom.y + Math.floor(startRoom.h / 2) + 0.5;

  state.player.x = startX;
  state.player.y = startY;
  state.player.angle = randBetween(-Math.PI, Math.PI);

  const openCells = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (grid[y][x] === 0) openCells.push({ x: x + 0.5, y: y + 0.5 });
    }
  }

  state.enemies = [];
  const enemyCount = Math.min(2 + levelNumber * 2, 18);
  for (let i = 0; i < enemyCount; i++) {
    const cell = openCells[Math.floor(Math.random() * openCells.length)];
    if (!cell) continue;
    const spawnX = cell.x;
    const spawnY = cell.y;
    const distToPlayer = Math.hypot(spawnX - state.player.x, spawnY - state.player.y);

    if (distToPlayer < 2.4) continue;

    state.enemies.push({
      x: spawnX,
      y: spawnY,
      health: 45 + levelNumber * 18,
      speed: 0.8 + levelNumber * 0.12,
      damage: 12 + levelNumber * 2.5,
      radius: 0.25,
      color: `hsl(${(i * 41) % 360}, 70%, 58%)`,
      hitFlash: 0,
      attackCooldown: 0,
      wander: randBetween(0, Math.PI * 2)
    });
  }

  return grid;
}

function updateHud() {
  hpEl.textContent = Math.max(0, Math.round(state.player.health));
  levelEl.textContent = level;
  killsEl.textContent = kills;
  diffEl.textContent = `${(1 + (level - 1) * 0.18).toFixed(1)}x`;
}

function setBanner(text, duration = 900) {
  bannerEl.textContent = text;
  bannerEl.classList.remove('hidden');
  clearTimeout(setBanner.timeoutId);
  setBanner.timeoutId = setTimeout(() => {
    bannerEl.classList.add('hidden');
  }, duration);
}

function castRay(angle) {
  let dist = 0.0;
  while (dist < MAX_DEPTH) {
    const x = state.player.x + Math.cos(angle) * dist;
    const y = state.player.y + Math.sin(angle) * dist;

    if (wallAt(x, y)) {
      return dist;
    }
    dist += 0.025;
  }
  return MAX_DEPTH;
}

function renderSkyAndFloor() {
  const sky = ctx.createLinearGradient(0, 0, 0, H / 2);
  sky.addColorStop(0, '#1e293b');
  sky.addColorStop(0.5, '#111827');
  sky.addColorStop(1, '#070d18');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H / 2);

  const floor = ctx.createLinearGradient(0, H / 2, 0, H);
  floor.addColorStop(0, '#3f3f46');
  floor.addColorStop(1, '#111827');
  ctx.fillStyle = floor;
  ctx.fillRect(0, H / 2, W, H);
}

function renderWalls() {
  for (let x = 0; x < W; x++) {
    const rayAngle = state.player.angle - FOV / 2 + (x / W) * FOV;
    const dist = castRay(rayAngle);
    const corrected = Math.max(dist * Math.cos(rayAngle - state.player.angle), 0.0001);
    const wallHeight = clamp((H / corrected) * 0.8, 12, H * 2.5);
    const y = (H - wallHeight) / 2;

    const brightness = clamp(1 - corrected / MAX_DEPTH, 0.16, 1);
    const shade = Math.round(170 * brightness);
    ctx.fillStyle = `rgb(${shade}, ${Math.max(20, shade - 35)}, ${Math.max(10, shade - 55)})`;
    ctx.fillRect(x, y, 2, wallHeight);
  }
}

function renderEnemies() {
  const enemies = [...state.enemies].filter((enemy) => enemy.health > 0);

  enemies.forEach((enemy) => {
    const dx = enemy.x - state.player.x;
    const dy = enemy.y - state.player.y;
    const dist = Math.hypot(dx, dy);
    const angleToEnemy = Math.atan2(dy, dx);
    const relative = normalizeAngle(angleToEnemy - state.player.angle);

    if (Math.abs(relative) > FOV / 2 + 0.3 || dist > MAX_DEPTH) return;

    const wallDist = castRay(angleToEnemy);
    if (wallDist < dist - 0.15) return;

    const screenX = W / 2 + (relative / FOV) * W;
    const spriteSize = clamp((H / dist) * 0.8, 25, 275);
    const x = screenX - spriteSize / 2;
    const y = H / 2 - spriteSize / 2 + 10;

    ctx.fillStyle = enemy.hitFlash > 0 ? '#fff' : enemy.color;
    ctx.fillRect(x, y, spriteSize * 0.7, spriteSize);

    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(x, y - 10, spriteSize * 0.7, 7);
    ctx.fillStyle = '#34d399';
    ctx.fillRect(x, y - 10, (spriteSize * 0.7) * (enemy.health / (45 + level * 18)), 7);

    ctx.fillStyle = '#111827';
    ctx.fillRect(x + spriteSize * 0.15, y + spriteSize * 0.18, spriteSize * 0.14, spriteSize * 0.14);
    ctx.fillRect(x + spriteSize * 0.48, y + spriteSize * 0.18, spriteSize * 0.14, spriteSize * 0.14);
  });
}

function drawCrosshair() {
  const cx = W / 2;
  const cy = H / 2;
  const r = 12;

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx - 5, cy);
  ctx.moveTo(cx + 5, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy - 5);
  ctx.moveTo(cx, cy + 5);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
}

function shoot() {
  if (state.player.fireCooldown > 0 || state.gameOver) return;
  state.player.fireCooldown = 0.2;

  let bestEnemy = null;
  let bestValue = -Infinity;

  state.enemies.forEach((enemy) => {
    if (enemy.health <= 0) return;

    const dx = enemy.x - state.player.x;
    const dy = enemy.y - state.player.y;
    const dist = Math.hypot(dx, dy);
    const angleToEnemy = Math.atan2(dy, dx);
    const relative = Math.abs(normalizeAngle(angleToEnemy - state.player.angle));

    if (dist < 7 && relative < 0.22) {
      const value = (1 / (dist + 0.1)) * (1 - relative / 0.22);
      if (value > bestValue) {
        bestValue = value;
        bestEnemy = enemy;
      }
    }
  });

  if (bestEnemy) {
    bestEnemy.health -= state.player.damage;
    bestEnemy.hitFlash = 0.12;
    if (bestEnemy.health <= 0) {
      kills += 1;
      setBanner('monster down', 600);
    } else {
      setBanner('hit!', 180);
    }
  } else {
    setBanner('miss!', 180);
  }

  updateHud();
}

function updatePlayer(dt) {
  const turnDir = (keys['q'] ? -1 : 0) + (keys['e'] ? 1 : 0);
  state.player.angle += turnDir * state.player.turnSpeed * dt;

  const forward = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
  const strafe = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);

  const magnitude = Math.hypot(forward, strafe) || 1;
  const fx = (forward / magnitude) * Math.cos(state.player.angle);
  const fy = (forward / magnitude) * Math.sin(state.player.angle);
  const sx = (strafe / magnitude) * Math.cos(state.player.angle + Math.PI / 2);
  const sy = (strafe / magnitude) * Math.sin(state.player.angle + Math.PI / 2);

  const dx = (fx + sx) * state.player.speed * dt;
  const dy = (fy + sy) * state.player.speed * dt;

  const nx = state.player.x + dx;
  const ny = state.player.y + dy;

  if (isWalkable(nx, state.player.y)) state.player.x = nx;
  if (isWalkable(state.player.x, ny)) state.player.y = ny;

  state.player.fireCooldown = Math.max(0, state.player.fireCooldown - dt);
}

function updateEnemies(dt) {
  state.enemies.forEach((enemy) => {
    if (enemy.health <= 0) return;

    const dx = state.player.x - enemy.x;
    const dy = state.player.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const nx = dx / dist;
    const ny = dy / dist;

    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);

    if (dist > 0.7) {
      const moveX = nx * enemy.speed * dt;
      const moveY = ny * enemy.speed * dt;

      const testX = enemy.x + moveX;
      const testY = enemy.y + moveY;

      if (wallAt(testX, enemy.y) === 0) enemy.x = testX;
      if (wallAt(enemy.x, testY) === 0) enemy.y = testY;
    }

    if (dist < 0.9 && enemy.attackCooldown <= 0) {
      state.player.health -= enemy.damage;
      state.player.lastHit = 0.35;
      enemy.attackCooldown = 0.9;
      setBanner('you are hit', 220);
      if (state.player.health <= 0) {
        state.player.health = 0;
        state.gameOver = true;
      }
    }
  });
}

function finishLevel() {
  level += 1;
  const nextSize = 14 + Math.min(level + 2, 18);
  state.map = generateMap(nextSize, level);
  state.difficulty = 1 + (level - 1) * 0.18;
  state.player.health = Math.min(state.player.maxHealth, state.player.health + 16);
  state.player.speed = 2.6 + (level - 1) * 0.07;
  setBanner(`level ${level}`, 1000);
  updateHud();
}

function update(dt) {
  if (state.gameOver) {
    if (keys['r']) {
      state.gameOver = false;
      level = 1;
      kills = 0;
      state.player.health = state.player.maxHealth;
      state.map = generateMap(16, level);
      state.player.fireCooldown = 0;
      setBanner('new run', 800);
      updateHud();
    }
    return;
  }

  updatePlayer(dt);
  updateEnemies(dt);

  if (state.enemies.every((enemy) => enemy.health <= 0)) {
    finishLevel();
  }

  updateHud();
}

function render() {
  renderSkyAndFloor();
  renderWalls();
  renderEnemies();
  drawCrosshair();
}

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000 || 0.016, 0.033);
  lastTime = timestamp;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  keys[key] = true;

  if (key === ' ') {
    event.preventDefault();
    shoot();
  }

  if (key === 'r' && state.gameOver) {
    state.gameOver = false;
    level = 1;
    kills = 0;
    state.player.health = state.player.maxHealth;
    state.map = generateMap(16, level);
    state.player.fireCooldown = 0;
    setBanner('new run', 800);
    updateHud();
  }
});

document.addEventListener('keyup', (event) => {
  keys[event.key.toLowerCase()] = false;
});

canvas.addEventListener('click', shoot);

state.map = generateMap(16, level);
updateHud();
setBanner('level 1', 900);
requestAnimationFrame(loop);
