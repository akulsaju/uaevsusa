(() => {
  'use strict';

  const canvas = document.querySelector('#simulation-canvas');
  const ctx = canvas.getContext('2d');
  const chart = document.querySelector('#telemetry-chart');
  const chartCtx = chart.getContext('2d');
  const canvasWrap = document.querySelector('#canvas-wrap');
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('vector-lab-collaboration-v1') : null;
  const peerId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const colors = ['#52d3cb', '#ffb971', '#a28fff', '#f080ac', '#8dcfff', '#d2e979', '#e9a1ff'];
  const vectorScale = 1.35;
  const maxForce = 100;
  const maxFrameTime = 0.035;
  const history = [];
  const trails = new Map();
  const peers = new Map();
  const status = {
    mode: 'forces',
    gravity: 56,
    damping: 0.08,
    running: true,
    vectors: true,
    showTrails: true,
    timeScale: 1,
    projectileSpeed: 190,
    projectileAngle: 52,
    pendulumReleaseAngle: 46 * Math.PI / 180,
    pendulumAngle: 46 * Math.PI / 180,
    pendulumOmega: 0,
    bodies: [
      { id: 'body-1', name: 'Orbiter 01', mass: 2.4, x: 0.34, y: 0.44, vx: 13, vy: 5, fx: 12, fy: -20, color: colors[0] },
      { id: 'body-2', name: 'Satellite 02', mass: 4.1, x: 0.68, y: 0.36, vx: -9, vy: 7, fx: -8, fy: -3, color: colors[1] }
    ]
  };

  let selectedId = status.bodies[0].id;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let lastFrame = 0;
  let elapsed = 0;
  let lastUiUpdate = 0;
  let lastBroadcast = 0;
  let broadcastPending = false;
  let interaction = null;
  let toastTimer = 0;
  let previousEnergy = 0;

  const $ = (selector) => document.querySelector(selector);
  const selectedBody = () => status.bodies.find((body) => body.id === selectedId) || status.bodies[0] || null;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const bodyRadius = (body) => 12 + Math.sqrt(body.mass) * 4.4;
  const displayName = (index) => `Orbiter ${String(index + 1).padStart(2, '0')}`;
  const modeNames = { forces: 'Force lab', orbit: 'Orbit', projectile: 'Projectile motion', pendulum: 'Pendulum', collision: 'Collision lab' };
  const modeDescriptions = {
    forces: 'Experiment with applied forces, gravity, and air resistance.',
    orbit: 'Watch bodies attract one another and trace orbital paths.',
    projectile: 'Tune launch speed and angle, then follow the flight path.',
    pendulum: 'Release a pendulum and explore its repeating motion.',
    collision: 'Explore momentum transfer between colliding bodies.'
  };
  const forceModes = new Set(['forces', 'collision']);

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const chartRect = chart.getBoundingClientRect();
    chart.width = Math.round(chartRect.width * pixelRatio);
    chart.height = Math.round(chartRect.height * pixelRatio);
    chartCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawChart();
  }

  function worldPoint(body) {
    return { x: body.x * width, y: body.y * height };
  }

  function createModeBodies(mode) {
    if (mode === 'orbit') {
      status.gravity = 56;
      status.damping = 0;
      const centralMass = 12;
      const innerRadius = width * .19 || 150;
      const outerRadius = height * .32 || 140;
      return [
        { id: 'star', name: 'Central star', mass: centralMass, x: .5, y: .5, vx: 0, vy: 0, fx: 0, fy: 0, color: '#ffc16f' },
        { id: 'planet-a', name: 'Inner planet', mass: 1.2, x: .69, y: .5, vx: 0, vy: Math.sqrt(status.gravity * 100 * centralMass / innerRadius), fx: 0, fy: 0, color: '#52d3cb' },
        { id: 'planet-b', name: 'Outer planet', mass: .8, x: .5, y: .18, vx: Math.sqrt(status.gravity * 100 * centralMass / outerRadius), vy: 0, fx: 0, fy: 0, color: '#a28fff' }
      ];
    }

    if (mode === 'projectile') {
      status.gravity = 150;
      status.damping = .015;
      const angle = status.projectileAngle * Math.PI / 180;
      return [
        { id: 'projectile', name: 'Projectile', mass: 1.5, x: .12, y: .82, vx: Math.cos(angle) * status.projectileSpeed, vy: -Math.sin(angle) * status.projectileSpeed, fx: 0, fy: 0, color: '#58e0d9' }
      ];
    }

    if (mode === 'pendulum') {
      status.gravity = 150;
      status.damping = .015;
      status.pendulumOmega = 0;
      status.pendulumAngle = status.pendulumReleaseAngle;
      const angle = status.pendulumAngle;
      const length = Math.min(height * .42, 190);
      return [
        { id: 'pendulum-bob', name: 'Pendulum bob', mass: 2, x: .5 + Math.sin(angle) * length / width, y: .18 + Math.cos(angle) * length / height, vx: 0, vy: 0, fx: 0, fy: 0, color: '#ffb971' }
      ];
    }

    if (mode === 'collision') {
      status.gravity = 18;
      status.damping = 0;
      return [
        { id: 'block-a', name: 'Block 01', mass: 2, x: .27, y: .5, vx: 74, vy: 0, fx: 0, fy: 0, color: '#52d3cb' },
        { id: 'block-b', name: 'Block 02', mass: 4, x: .53, y: .5, vx: 0, vy: 0, fx: 0, fy: 0, color: '#a28fff' },
        { id: 'block-c', name: 'Block 03', mass: 1.5, x: .77, y: .5, vx: -38, vy: 0, fx: 0, fy: 0, color: '#ffb971' }
      ];
    }

    status.gravity = 56;
    status.damping = .08;
    return [
      { id: 'body-1', name: 'Orbiter 01', mass: 2.4, x: .34, y: .44, vx: 13, vy: 5, fx: 12, fy: -20, color: colors[0] },
      { id: 'body-2', name: 'Satellite 02', mass: 4.1, x: .68, y: .36, vx: -9, vy: 7, fx: -8, fy: -3, color: colors[1] }
    ];
  }

  function resetTrailHistory() {
    trails.clear();
    for (const body of status.bodies) trails.set(body.id, []);
  }

  function pendulumLength() {
    return Math.min(height * .42, 190);
  }

  function placePendulumBob() {
    const body = selectedBody();
    if (!body) return;
    const length = pendulumLength();
    body.x = .5 + Math.sin(status.pendulumAngle) * length / width;
    body.y = .18 + Math.cos(status.pendulumAngle) * length / height;
    body.vx = status.pendulumOmega * length * Math.cos(status.pendulumAngle);
    body.vy = -status.pendulumOmega * length * Math.sin(status.pendulumAngle);
  }

  function effectiveForces(body) {
    const dragX = -body.vx * status.damping * body.mass;
    const dragY = -body.vy * status.damping * body.mass;
    const gravity = status.mode === 'orbit'
      ? (() => {
          const acceleration = orbitalAcceleration(body);
          return { x: acceleration.x * body.mass, y: acceleration.y * body.mass };
        })()
      : { x: 0, y: status.gravity * body.mass };
    return {
      gravity,
      applied: { x: body.fx, y: body.fy },
      drag: { x: dragX, y: dragY },
      netX: body.fx + dragX,
      netY: body.fy + dragY + status.gravity * body.mass
    };
  }

  function drawGrid() {
    ctx.save();
    ctx.fillStyle = '#141821';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;

    const gap = 32;
    const xStart = width % gap;
    const yStart = height % gap;
    for (let x = xStart; x <= width; x += gap) {
      ctx.strokeStyle = Math.round(x / gap) % 4 === 0 ? 'rgba(147,157,179,.055)' : 'rgba(147,157,179,.025)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = yStart; y <= height; y += gap) {
      ctx.strokeStyle = Math.round(y / gap) % 4 === 0 ? 'rgba(147,157,179,.055)' : 'rgba(147,157,179,.025)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const axisX = width / 2;
    const axisY = height * 0.57;
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(188,197,215,.12)';
    ctx.beginPath();
    ctx.moveTo(axisX, 0);
    ctx.lineTo(axisX, height);
    ctx.moveTo(0, axisY);
    ctx.lineTo(width, axisY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function arrow(startX, startY, vectorX, vectorY, color, options = {}) {
    const scale = options.scale || vectorScale;
    const rawLength = Math.hypot(vectorX, vectorY) * scale;
    if (rawLength < 1) return null;

    const length = Math.min(rawLength, options.maxLength || 100);
    const unitX = vectorX / Math.hypot(vectorX, vectorY);
    const unitY = vectorY / Math.hypot(vectorX, vectorY);
    const endX = startX + unitX * length;
    const endY = startY + unitY * length;
    const headSize = options.headSize || 7;

    ctx.save();
    ctx.globalAlpha = rawLength > length ? 0.82 : 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = options.lineWidth || 1.7;
    ctx.lineCap = 'round';
    if (options.dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    const angle = Math.atan2(endY - startY, endX - startX);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headSize * Math.cos(angle - Math.PI / 6), endY - headSize * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(endX - headSize * Math.cos(angle + Math.PI / 6), endY - headSize * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return { x: endX, y: endY, length };
  }

  function appliedHandle(body) {
    const point = worldPoint(body);
    const length = Math.hypot(body.fx, body.fy) * vectorScale;
    if (length < 1) return { x: point.x, y: point.y - 23 };
    const displayedLength = Math.min(length, 100);
    return {
      x: point.x + (body.fx / Math.hypot(body.fx, body.fy)) * displayedLength,
      y: point.y - (body.fy / Math.hypot(body.fx, body.fy)) * displayedLength
    };
  }

  function drawBody(body) {
    const { x, y } = worldPoint(body);
    const radius = bodyRadius(body);
    const selected = body.id === selectedId;
    const color = body.color;

    ctx.save();
    ctx.shadowColor = `${color}66`;
    ctx.shadowBlur = selected ? 25 : 15;
    const gradient = ctx.createRadialGradient(x - radius * .3, y - radius * .35, 1, x, y, radius);
    gradient.addColorStop(0, selected ? '#edfdf7' : '#f5eadc');
    gradient.addColorStop(.12, color);
    gradient.addColorStop(1, `${color}b5`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = selected ? '#dffcf4' : `${color}80`;
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = `${color}55`;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = selected ? '#f2f4f1' : '#d9dce4';
    ctx.font = '10px "DM Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(body.name.replace('Orbiter ', '').replace('Satellite ', '#'), x, y + radius + 20);
    ctx.restore();

    if (status.vectors) {
      const forces = effectiveForces(body);
      const offset = radius + 8;
      if (status.mode === 'orbit') {
        const acceleration = orbitalAcceleration(body);
        arrow(x, y, acceleration.x, -acceleration.y, '#a08cff', { scale: 7, maxLength: 72, lineWidth: 1.6 });
      } else if (status.mode === 'projectile') {
        arrow(x, y, 0, status.gravity, '#a08cff', { scale: .32, maxLength: 55, lineWidth: 1.6 });
        arrow(x, y, body.vx, -body.vy, '#58e0d9', { scale: .22, maxLength: 75, lineWidth: 1.8 });
      } else if (status.mode === 'pendulum') {
        arrow(x, y, 0, status.gravity, '#a08cff', { scale: .25, maxLength: 48, lineWidth: 1.5 });
      } else {
        arrow(x + 2, y + 3, forces.gravity.x, forces.gravity.y, '#a08cff', { maxLength: 85, lineWidth: 1.5 });
        if (forceModes.has(status.mode)) {
          arrow(x + 1, y - 2, forces.applied.x, -forces.applied.y, '#58e0d9', { maxLength: 100, lineWidth: 1.9 });
        }
        if (Math.hypot(forces.drag.x, forces.drag.y) > 3) {
          arrow(x - 2, y + offset * .45, forces.drag.x, -forces.drag.y, '#ffb45e', { maxLength: 56, lineWidth: 1.35 });
        }
      }

      if (selected && forceModes.has(status.mode)) {
        const handle = appliedHandle(body);
        ctx.save();
        ctx.fillStyle = '#131920';
        ctx.strokeStyle = '#89f5ec';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(88,224,217,.2)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function orbitalAcceleration(body) {
    let ax = 0;
    let ay = 0;
    const point = worldPoint(body);
    for (const other of status.bodies) {
      if (other === body) continue;
      const target = worldPoint(other);
      const dx = target.x - point.x;
      const dy = target.y - point.y;
      const distanceSquared = Math.max(dx * dx + dy * dy, 625);
      const distance = Math.sqrt(distanceSquared);
      const acceleration = (status.gravity * 100 * other.mass) / distanceSquared;
      ax += acceleration * dx / distance;
      ay += acceleration * dy / distance;
    }
    return { x: ax, y: ay };
  }

  function drawModeOverlays() {
    ctx.save();
    if (status.mode === 'pendulum') {
      const pivotX = width * .5;
      const pivotY = height * .18;
      const bob = selectedBody();
      const point = bob ? worldPoint(bob) : { x: pivotX, y: pivotY + pendulumLength() };
      ctx.strokeStyle = 'rgba(190,198,215,.48)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.fillStyle = '#d7dbe3';
      ctx.beginPath();
      ctx.arc(pivotX, pivotY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,198,215,.12)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(pivotX, pivotY, pendulumLength(), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (status.mode === 'projectile') {
      const groundY = height * .9;
      ctx.strokeStyle = 'rgba(183,238,118,.35)';
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawTrails() {
    if (!status.showTrails) return;
    for (const body of status.bodies) {
      const points = trails.get(body.id);
      if (!points || points.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = `${body.color}75`;
      ctx.lineWidth = status.mode === 'orbit' ? 1.4 : 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  function render() {
    if (!width || !height) return;
    drawGrid();
    drawModeOverlays();
    drawTrails();
    for (const body of status.bodies) drawBody(body);
  }

  function resolveBoundaries(body) {
    const radius = bodyRadius(body);
    const bounce = 0.72;
    const minX = radius / width;
    const maxX = 1 - minX;
    const minY = radius / height;
    const maxY = 1 - minY;

    if (body.x < minX) { body.x = minX; body.vx = Math.abs(body.vx) * bounce; }
    if (body.x > maxX) { body.x = maxX; body.vx = -Math.abs(body.vx) * bounce; }
    if (body.y < minY) { body.y = minY; body.vy = Math.abs(body.vy) * bounce; }
    if (body.y > maxY) { body.y = maxY; body.vy = -Math.abs(body.vy) * bounce; }
  }

  function resolveBodyCollisions() {
    for (let i = 0; i < status.bodies.length; i++) {
      for (let j = i + 1; j < status.bodies.length; j++) {
        const first = status.bodies[i];
        const second = status.bodies[j];
        const p1 = worldPoint(first);
        const p2 = worldPoint(second);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const minimumDistance = bodyRadius(first) + bodyRadius(second);
        if (distance >= minimumDistance) continue;

        const normalX = dx / distance;
        const normalY = dy / distance;
        const overlap = minimumDistance - distance;
        const inverseFirst = 1 / first.mass;
        const inverseSecond = 1 / second.mass;
        const inverseSum = inverseFirst + inverseSecond;
        first.x -= (normalX * overlap * inverseFirst / inverseSum) / width;
        first.y -= (normalY * overlap * inverseFirst / inverseSum) / height;
        second.x += (normalX * overlap * inverseSecond / inverseSum) / width;
        second.y += (normalY * overlap * inverseSecond / inverseSum) / height;

        const relativeVelocity = (second.vx - first.vx) * normalX + (second.vy - first.vy) * normalY;
        if (relativeVelocity < 0) {
          const impulse = -(1 + .68) * relativeVelocity / inverseSum;
          first.vx -= impulse * inverseFirst * normalX;
          first.vy -= impulse * inverseFirst * normalY;
          second.vx += impulse * inverseSecond * normalX;
          second.vy += impulse * inverseSecond * normalY;
        }
      }
    }
  }

  function recordTrailPoints() {
    if (!status.showTrails) return;
    for (const body of status.bodies) {
      const point = { x: body.x, y: body.y };
      const history = trails.get(body.id) || [];
      const previous = history[history.length - 1];
      if (!previous || Math.hypot((point.x - previous.x) * width, (point.y - previous.y) * height) > 1.5) {
        history.push(point);
        if (history.length > 240) history.shift();
        trails.set(body.id, history);
      }
    }
  }

  function step(dt) {
    if (!status.running || interaction?.type === 'body') return;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const stepDuration = dt / steps;
    for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
      if (status.mode === 'pendulum') {
        const length = Math.max(1, pendulumLength());
        status.pendulumOmega += (-status.gravity / length * Math.sin(status.pendulumAngle) - status.damping * status.pendulumOmega) * stepDuration;
        status.pendulumAngle += status.pendulumOmega * stepDuration;
        placePendulumBob();
      } else {
        const orbitalAccelerations = status.mode === 'orbit'
          ? status.bodies.map((body) => orbitalAcceleration(body))
          : null;
        for (const [index, body] of status.bodies.entries()) {
          const acceleration = orbitalAccelerations?.[index];
          const dragScale = status.damping * stepDuration;
          if (acceleration) {
            body.vx += acceleration.x * stepDuration;
            body.vy += acceleration.y * stepDuration;
          } else {
            body.vx += (body.fx / body.mass) * stepDuration;
            body.vy += (-body.fy / body.mass + status.gravity) * stepDuration;
          }
          body.vx *= Math.max(0, 1 - dragScale);
          body.vy *= Math.max(0, 1 - dragScale);
          body.x += (body.vx * stepDuration) / width;
          body.y += (body.vy * stepDuration) / height;
          if (status.mode === 'projectile') {
            const ground = .9 - bodyRadius(body) / height;
            if (body.y >= ground) {
              body.y = ground;
              body.vy = 0;
              body.vx *= Math.max(0, 1 - status.damping * stepDuration * 8);
            }
            if (body.x < bodyRadius(body) / width || body.x > 1 - bodyRadius(body) / width) {
              body.x = clamp(body.x, bodyRadius(body) / width, 1 - bodyRadius(body) / width);
              body.vx *= -.55;
            }
          } else {
            resolveBoundaries(body);
          }
        }
        resolveBodyCollisions();
      }
      recordTrailPoints();
    }
    elapsed += dt;
  }

  function systemEnergy() {
    let kinetic = 0;
    let potential = 0;
    for (const body of status.bodies) {
      kinetic += .5 * body.mass * (body.vx ** 2 + body.vy ** 2);
      if (status.mode === 'pendulum') {
        potential += body.mass * status.gravity * (height * (.18 + pendulumLength() / height - body.y));
      } else if (status.mode !== 'orbit') {
        potential += body.mass * status.gravity * (height * (1 - body.y));
      }
    }
    if (status.mode === 'orbit') {
      for (let i = 0; i < status.bodies.length; i++) {
        for (let j = i + 1; j < status.bodies.length; j++) {
          const first = worldPoint(status.bodies[i]);
          const second = worldPoint(status.bodies[j]);
          const distance = Math.max(25, Math.hypot(second.x - first.x, second.y - first.y));
          potential += status.gravity * 100 * status.bodies[i].mass * status.bodies[j].mass * (1 / 25 - 1 / distance);
        }
      }
    }
    return { kinetic, potential, total: kinetic + potential };
  }

  function sampleHistory() {
    const energy = systemEnergy();
    previousEnergy = history.length ? history[history.length - 1].total : energy.total;
    history.push(energy);
    while (history.length > 100) history.shift();
    drawChart();
  }

  function drawChart() {
    if (!chartCtx || !chart.width) return;
    const rect = chart.getBoundingClientRect();
    const chartWidth = rect.width;
    const chartHeight = rect.height;
    if (!chartWidth || !chartHeight) return;

    chartCtx.clearRect(0, 0, chartWidth, chartHeight);
    const padTop = 15;
    const padBottom = 5;
    const usableHeight = chartHeight - padTop - padBottom;
    const values = history.length ? history : [{ kinetic: 5, potential: 18, total: 23 }];
    const maxEnergy = Math.max(40, ...values.map((entry) => Math.max(entry.kinetic, entry.potential, entry.total * .7))) * 1.18;

    for (let line = 0; line < 3; line++) {
      const y = padTop + usableHeight * line / 2;
      chartCtx.strokeStyle = 'rgba(153,161,182,.09)';
      chartCtx.lineWidth = 1;
      chartCtx.beginPath();
      chartCtx.moveTo(0, y);
      chartCtx.lineTo(chartWidth, y);
      chartCtx.stroke();
    }

    const drawSeries = (key, color) => {
      chartCtx.beginPath();
      values.forEach((value, index) => {
        const x = values.length < 2 ? chartWidth : (index / (values.length - 1)) * chartWidth;
        const y = padTop + usableHeight - (value[key] / maxEnergy) * usableHeight;
        if (index === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
      });
      chartCtx.strokeStyle = color;
      chartCtx.lineWidth = 1.6;
      chartCtx.lineJoin = 'round';
      chartCtx.stroke();
    };

    drawSeries('potential', '#9c8bff');
    drawSeries('kinetic', '#5de3dc');

    const latest = values[values.length - 1];
    $('#energy-value').textContent = Math.round(latest.total).toLocaleString();
    const delta = previousEnergy > 0 ? ((latest.total - previousEnergy) / previousEnergy) * 100 : 0;
    $('#energy-change').textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  }

  function updateRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    input.style.setProperty('--progress', `${((value - min) / (max - min)) * 100}%`);
  }

  function updateInspector() {
    const body = selectedBody();
    const selectedElements = ['#mass-slider', '#force-x', '#force-y', '#selected-name', '#selected-index', '#mass-value', '#speed-value', '#net-force-value', '#selected-swatch'];
    const empty = !body;
    for (const selector of selectedElements) $(selector).closest('.inspector-section, .selected-object, .body-stats')?.classList.toggle('is-empty', empty);
    $('#add-body-cta').disabled = false;
    if (!body) {
      $('#selected-name').textContent = 'No bodies';
      $('#selected-index').textContent = '--';
      $('#mass-value').textContent = '—';
      $('#force-x').value = '0';
      $('#force-y').value = '0';
      $('#speed-value').textContent = '0.0';
      $('#net-force-value').textContent = '0.0';
      return;
    }

    const index = status.bodies.indexOf(body);
    const forces = effectiveForces(body);
    $('#selected-name').textContent = body.name;
    $('#selected-index').textContent = String(index + 1).padStart(2, '0');
    $('#selected-swatch').style.borderColor = `${body.color}55`;
    $('#selected-swatch').style.background = `${body.color}12`;
    $('#selected-swatch span').style.background = body.color;
    $('#selected-swatch span').style.borderColor = `${body.color}cc`;
    $('#mass-slider').value = String(body.mass);
    $('#mass-value').textContent = body.mass.toFixed(1);
    if (document.activeElement !== $('#force-x')) $('#force-x').value = String(Math.round(body.fx));
    if (document.activeElement !== $('#force-y')) $('#force-y').value = String(Math.round(body.fy));
    $('#speed-value').textContent = Math.hypot(body.vx, body.vy).toFixed(1);
    $('#net-force-value').textContent = Math.hypot(forces.netX, forces.netY).toFixed(1);
    updateRangeFill($('#mass-slider'));
    $('#launch-speed').value = String(status.projectileSpeed);
    $('#launch-speed-value').textContent = String(status.projectileSpeed);
    $('#launch-angle').value = String(status.projectileAngle);
    $('#launch-angle-value').textContent = String(status.projectileAngle);
    $('#pendulum-angle').value = String(Math.round(Math.abs(status.pendulumReleaseAngle) * 180 / Math.PI));
    $('#pendulum-angle-value').textContent = String(Math.round(Math.abs(status.pendulumReleaseAngle) * 180 / Math.PI));
  }

  function updateStaticControls() {
    $('#gravity-slider').value = String(status.gravity);
    $('#gravity-value').textContent = String(Math.round(status.gravity));
    $('#damping-slider').value = String(status.damping);
    $('#damping-value').textContent = status.damping.toFixed(2);
    $('#vectors-toggle').checked = status.vectors;
    $('#trails-toggle').checked = status.showTrails;
    updateRangeFill($('#gravity-slider'));
    updateRangeFill($('#damping-slider'));
    $('#speed-select').value = String(status.timeScale);
    $('#scene-name').textContent = modeNames[status.mode];
    $('#simulation-description').textContent = modeDescriptions[status.mode];
    $('#gravity-label').textContent = status.mode === 'orbit' ? 'Gravity strength' : 'Gravity';
    $('#gravity-unit').textContent = status.mode === 'orbit' ? 'G SCALE' : 'px/s²';
    $('#gravity-max-label').textContent = status.mode === 'orbit' ? '180 G scale' : '180 px/s²';
    $('#projectile-controls').hidden = status.mode !== 'projectile';
    $('#pendulum-controls').hidden = status.mode !== 'pendulum';
    $('.force-section').hidden = !forceModes.has(status.mode);
    $('#add-body-button').hidden = ['projectile', 'pendulum'].includes(status.mode);
    $('#add-body-cta').hidden = ['projectile', 'pendulum'].includes(status.mode);
    $('#legend-gravity-label').textContent = status.mode === 'orbit' ? 'Attraction' : 'Gravity';
    $('#legend-applied-label').textContent = status.mode === 'projectile' ? 'Velocity' : 'Applied';
    $('#legend-applied-item').hidden = ['orbit', 'pendulum'].includes(status.mode);
    $('#legend-drag-label').textContent = status.mode === 'pendulum' ? 'Swing path' : 'Drag';
    $('#legend-drag-item').hidden = status.mode === 'pendulum';
    $('#canvas-help').innerHTML = status.mode === 'forces'
      ? '<kbd>DRAG</kbd> move body <span class="help-divider">·</span> <kbd>DRAG</kbd> force handle'
      : status.mode === 'pendulum'
        ? '<kbd>DRAG</kbd> move the bob <span class="help-divider">·</span> Set angle, then release'
        : status.mode === 'projectile'
          ? '<kbd>ENTER</kbd> launch <span class="help-divider">·</span> Adjust speed and angle'
          : '<kbd>DRAG</kbd> move bodies <span class="help-divider">·</span> Toggle trails to compare paths';
    document.querySelectorAll('.simulation-option').forEach((button) => {
      const active = button.dataset.mode === status.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('#simulation-status').textContent = status.running ? 'SIMULATION RUNNING' : 'SIMULATION PAUSED';
    $('#play-button').setAttribute('aria-label', status.running ? 'Pause simulation' : 'Play simulation');
    $('#play-button').title = status.running ? 'Pause (Space)' : 'Play (Space)';
    $('#play-icon').innerHTML = status.running ? '<path d="M6.5 4.5v11m7-11v11"/>' : '<path d="m7 4.5 9 5.5-9 5.5z"/>';
    $('.canvas-status .live-dot').style.background = status.running ? 'var(--lime)' : '#858a98';
    $('.canvas-status .live-dot').style.boxShadow = status.running ? '0 0 8px rgba(183,238,118,.4)' : 'none';
    $('#body-count').textContent = `${status.bodies.length} ${status.bodies.length === 1 ? 'body' : 'bodies'}`;
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2300);
  }

  function snapshot() {
    return {
      mode: status.mode,
      gravity: status.gravity,
      damping: status.damping,
      running: status.running,
      vectors: status.vectors,
      showTrails: status.showTrails,
      timeScale: status.timeScale,
      projectileSpeed: status.projectileSpeed,
      projectileAngle: status.projectileAngle,
      pendulumReleaseAngle: status.pendulumReleaseAngle,
      pendulumAngle: status.pendulumAngle,
      pendulumOmega: status.pendulumOmega,
      selectedId,
      elapsed,
      bodies: status.bodies.map((body) => ({ ...body }))
    };
  }

  function applySnapshot(data) {
    if (!data || !Array.isArray(data.bodies) || data.bodies.length > 100) return;
    if (!Object.hasOwn(modeNames, data.mode)) return;
    if (['projectile', 'pendulum'].includes(data.mode) && data.bodies.length !== 1) return;
    const validBodies = data.bodies.filter((body) =>
      body && typeof body.id === 'string' &&
      [body.mass, body.x, body.y, body.vx, body.vy, body.fx, body.fy].every(Number.isFinite)
    );
    if (validBodies.length !== data.bodies.length) return;
    const previousTrails = new Map(trails);
    status.mode = data.mode;
    status.gravity = clamp(Number(data.gravity) || 0, 0, 180);
    status.damping = clamp(Number(data.damping) || 0, 0, .5);
    status.running = Boolean(data.running);
    status.vectors = Boolean(data.vectors);
    status.showTrails = Boolean(data.showTrails);
    status.timeScale = [0.5, 1, 2].includes(data.timeScale) ? data.timeScale : 1;
    status.projectileSpeed = clamp(Number(data.projectileSpeed) || 190, 60, 300);
    status.projectileAngle = clamp(Number(data.projectileAngle) || 52, 10, 85);
    status.pendulumReleaseAngle = clamp(Number(data.pendulumReleaseAngle) || 46 * Math.PI / 180, 5 * Math.PI / 180, 85 * Math.PI / 180);
    status.pendulumAngle = Number.isFinite(data.pendulumAngle) ? clamp(data.pendulumAngle, -Math.PI, Math.PI) : 46 * Math.PI / 180;
    status.pendulumOmega = Number.isFinite(data.pendulumOmega) ? data.pendulumOmega : 0;
    status.bodies = validBodies.map((body, index) => ({
      ...body,
      mass: clamp(body.mass, .5, 12),
      x: clamp(body.x, 0, 1),
      y: clamp(body.y, 0, 1),
      fx: clamp(body.fx, -maxForce, maxForce),
      fy: clamp(body.fy, -maxForce, maxForce),
      color: typeof body.color === 'string' && /^#[\da-f]{6}$/i.test(body.color) ? body.color : colors[index % colors.length],
      name: typeof body.name === 'string' ? body.name.slice(0, 32) : displayName(index)
    }));
    trails.clear();
    for (const body of status.bodies) trails.set(body.id, previousTrails.get(body.id) || []);
    selectedId = status.bodies.some((body) => body.id === data.selectedId) ? data.selectedId : status.bodies[0]?.id || null;
    elapsed = Number.isFinite(data.elapsed) ? Math.max(0, data.elapsed) : elapsed;
    updateStaticControls();
    updateInspector();
    render();
  }

  function broadcastState(immediate = false) {
    if (!channel || interaction?.type === 'body' && !immediate) return;
    const now = performance.now();
    if (!immediate && now - lastBroadcast < 65) {
      if (broadcastPending) return;
      broadcastPending = true;
      setTimeout(() => {
        broadcastPending = false;
        broadcastState(true);
      }, 70 - (now - lastBroadcast));
      return;
    }
    lastBroadcast = now;
    channel.postMessage({ type: 'state', sender: peerId, data: snapshot() });
  }

  function updatePeerUi() {
    const now = Date.now();
    for (const [id, peer] of peers) {
      if (now - peer.seenAt > 6000) peers.delete(id);
    }
    const active = [...peers.values()];
    $('#peer-count').textContent = active.length ? `${active.length + 1} here` : 'Just you';
    $('#peer-avatars').replaceChildren(...active.slice(0, 4).map((peer) => {
      const avatar = document.createElement('span');
      avatar.className = 'peer-avatar';
      avatar.textContent = peer.name;
      avatar.title = 'Another collaborator in this browser';
      return avatar;
    }));
  }

  function announcePresence() {
    if (channel) channel.postMessage({ type: 'presence', sender: peerId, name: 'A' });
  }

  function handleChannelMessage(event) {
    const message = event.data;
    if (!message || message.sender === peerId) return;
    if (message.type === 'presence') {
      peers.set(message.sender, { name: String(message.name || 'C').slice(0, 1), seenAt: Date.now() });
      updatePeerUi();
      channel.postMessage({ type: 'presence-ack', sender: peerId, name: 'A' });
      return;
    }
    if (message.type === 'presence-ack') {
      peers.set(message.sender, { name: String(message.name || 'C').slice(0, 1), seenAt: Date.now() });
      updatePeerUi();
      return;
    }
    if (message.type === 'state' && message.data) {
      peers.set(message.sender, { name: 'C', seenAt: Date.now() });
      updatePeerUi();
      if (interaction) return;
      applySnapshot(message.data);
    }
  }

  function addBody() {
    if (['projectile', 'pendulum'].includes(status.mode)) return;
    const index = status.bodies.length;
    const color = colors[index % colors.length];
    let body;
    if (status.mode === 'orbit') {
      const planets = status.bodies.filter((candidate) => candidate.id !== 'star');
      const angle = (planets.length * 2.4) + .7;
      const radius = Math.min(width, height) * (.2 + (planets.length % 3) * .075);
      const centralMass = status.bodies.find((candidate) => candidate.id === 'star')?.mass || 12;
      const speed = Math.sqrt(status.gravity * 100 * centralMass / radius);
      body = {
        id: `body-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
        name: `Planet ${String(planets.length + 3).padStart(2, '0')}`,
        mass: .7,
        x: .5 + Math.cos(angle) * radius / width,
        y: .5 + Math.sin(angle) * radius / height,
        vx: -Math.sin(angle) * speed,
        vy: Math.cos(angle) * speed,
        fx: 0,
        fy: 0,
        color
      };
    } else if (status.mode === 'collision') {
      body = {
        id: `body-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
        name: `Block ${String(index + 1).padStart(2, '0')}`,
        mass: 1.8,
        x: clamp(.2 + Math.random() * .6, .12, .88),
        y: .42 + Math.random() * .16,
        vx: (Math.random() - .5) * 90,
        vy: (Math.random() - .5) * 30,
        fx: 0,
        fy: 0,
        color
      };
    } else {
      body = {
        id: `body-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
        name: displayName(index),
        mass: 1.8,
        x: clamp(.46 + (index % 4) * .035, .12, .88),
        y: clamp(.26 + (index % 3) * .045, .12, .82),
        vx: (Math.random() - .5) * 26,
        vy: (Math.random() - .5) * 22,
        fx: 0,
        fy: 0,
        color
      };
    }
    status.bodies.push(body);
    selectedId = body.id;
    trails.set(body.id, []);
    updateInspector();
    updateStaticControls();
    render();
    broadcastState(true);
    showToast(`${body.name} added to the canvas`);
  }

  function resetScene() {
    status.running = true;
    status.vectors = true;
    status.showTrails = true;
    status.timeScale = 1;
    status.bodies = createModeBodies(status.mode);
    selectedId = status.bodies[0].id;
    elapsed = 0;
    resetTrailHistory();
    history.length = 0;
    sampleHistory();
    updateStaticControls();
    updateInspector();
    render();
    broadcastState(true);
    showToast(`${modeNames[status.mode]} reset`);
  }

  function selectSimulation(mode) {
    if (!Object.hasOwn(modeNames, mode) || status.mode === mode) return;
    status.mode = mode;
    resetScene();
  }

  function launchProjectile() {
    if (status.mode !== 'projectile') return;
    const body = selectedBody();
    if (!body) return;
    const angle = status.projectileAngle * Math.PI / 180;
    body.x = .12;
    body.y = .82;
    body.vx = Math.cos(angle) * status.projectileSpeed;
    body.vy = -Math.sin(angle) * status.projectileSpeed;
    elapsed = 0;
    status.running = true;
    resetTrailHistory();
    updateStaticControls();
    render();
    broadcastState(true);
    showToast('Projectile launched');
  }

  function releasePendulum() {
    if (status.mode !== 'pendulum') return;
    status.pendulumOmega = 0;
    placePendulumBob();
    elapsed = 0;
    status.running = true;
    resetTrailHistory();
    updateStaticControls();
    render();
    broadcastState(true);
    showToast('Pendulum released');
  }

  function getPointer(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function hitBody(point) {
    for (let i = status.bodies.length - 1; i >= 0; i--) {
      const body = status.bodies[i];
      const center = worldPoint(body);
      if (Math.hypot(point.x - center.x, point.y - center.y) <= bodyRadius(body) + 7) return body;
    }
    return null;
  }

  function hitHandle(point) {
    const body = selectedBody();
    if (!body || !status.vectors || !forceModes.has(status.mode)) return null;
    const handle = appliedHandle(body);
    return Math.hypot(point.x - handle.x, point.y - handle.y) <= 16 ? body : null;
  }

  function onPointerDown(event) {
    const point = getPointer(event);
    const handleBody = hitHandle(point);
    if (handleBody) {
      interaction = { type: 'force', body: handleBody };
    } else {
      const body = hitBody(point);
      if (!body) return;
      selectedId = body.id;
      const center = worldPoint(body);
      interaction = { type: 'body', body, offsetX: point.x - center.x, offsetY: point.y - center.y };
      updateInspector();
      render();
    }
    canvas.classList.add('grabbing');
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    const point = getPointer(event);
    $('#coordinate-readout').innerHTML = `x ${String(Math.round(point.x)).padStart(3, '0')} &nbsp; y ${String(Math.round(point.y)).padStart(3, '0')}`;
    if (!interaction) {
      canvas.style.cursor = hitHandle(point) ? 'grab' : hitBody(point) ? 'grab' : 'crosshair';
      return;
    }

    const body = interaction.body;
    if (interaction.type === 'force') {
      const center = worldPoint(body);
      body.fx = clamp((point.x - center.x) / vectorScale, -maxForce, maxForce);
      body.fy = clamp((center.y - point.y) / vectorScale, -maxForce, maxForce);
      $('#force-x').value = String(Math.round(body.fx));
      $('#force-y').value = String(Math.round(body.fy));
      updateInspector();
    } else {
      body.x = clamp((point.x - interaction.offsetX) / width, bodyRadius(body) / width, 1 - bodyRadius(body) / width);
      body.y = clamp((point.y - interaction.offsetY) / height, bodyRadius(body) / height, 1 - bodyRadius(body) / height);
      body.vx = 0;
      body.vy = 0;
      if (status.mode === 'pendulum') {
        const pivotX = width * .5;
        const pivotY = height * .18;
        status.pendulumAngle = Math.atan2(point.x - interaction.offsetX - pivotX, point.y - interaction.offsetY - pivotY);
        status.pendulumReleaseAngle = clamp(Math.abs(status.pendulumAngle), 5 * Math.PI / 180, 85 * Math.PI / 180);
        status.pendulumOmega = 0;
      }
    }
    render();
  }

  function onPointerUp() {
    if (!interaction) return;
    interaction = null;
    canvas.classList.remove('grabbing');
    canvas.style.cursor = 'crosshair';
    updateInspector();
    broadcastState(true);
  }

  function onBodyMassInput(event) {
    const body = selectedBody();
    if (!body) return;
    body.mass = Number(event.target.value);
    $('#mass-value').textContent = body.mass.toFixed(1);
    updateRangeFill(event.target);
    updateInspector();
    render();
    broadcastState();
  }

  function onForceInput(axis, event) {
    const body = selectedBody();
    if (!body || event.target.value.trim() === '') return;
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    body[axis] = clamp(value, -maxForce, maxForce);
    if (document.activeElement !== event.target) event.target.value = String(Math.round(body[axis]));
    updateInspector();
    render();
    broadcastState();
  }

  function sceneConfig() {
    return {
      version: 1,
      mode: status.mode,
      gravity: status.gravity,
      airResistance: status.damping,
      running: status.running,
      showTrails: status.showTrails,
      timeScale: status.timeScale,
      parameters: {
        projectileSpeed: status.projectileSpeed,
        projectileAngle: status.projectileAngle,
        pendulumAngleDegrees: Number((status.pendulumReleaseAngle * 180 / Math.PI).toFixed(2))
      },
      bodies: status.bodies.map((body) => ({
        name: body.name,
        massKg: Number(body.mass.toFixed(2)),
        position: { x: Number(body.x.toFixed(4)), y: Number(body.y.toFixed(4)) },
        velocity: { x: Number(body.vx.toFixed(2)), y: Number(body.vy.toFixed(2)) },
        appliedForceN: { x: Number(body.fx.toFixed(2)), y: Number(body.fy.toFixed(2)) },
        color: body.color
      }))
    };
  }

  function importSceneConfig(data) {
    if (!data || data.version !== 1 || !Object.hasOwn(modeNames, data.mode) || !Array.isArray(data.bodies) || data.bodies.length < 1 || data.bodies.length > 100) {
      throw new Error('This file is not a supported Vector Lab scene.');
    }
    if (['projectile', 'pendulum'].includes(data.mode) && data.bodies.length !== 1) {
      throw new Error('This simulation requires exactly one body.');
    }

    const bodies = data.bodies.map((body, index) => {
      if (!body || typeof body !== 'object') throw new Error('One or more bodies have invalid physical values.');
      const values = [body.massKg, body.position?.x, body.position?.y, body.velocity?.x, body.velocity?.y, body.appliedForceN?.x, body.appliedForceN?.y];
      if (!values.every(Number.isFinite) || body.massKg <= 0) throw new Error('One or more bodies have invalid physical values.');
      return {
        id: `imported-${index + 1}`,
        name: typeof body.name === 'string' ? body.name.slice(0, 32) : displayName(index),
        mass: clamp(body.massKg, .5, 12),
        x: clamp(body.position.x, 0, 1),
        y: clamp(body.position.y, 0, 1),
        vx: body.velocity.x,
        vy: body.velocity.y,
        fx: clamp(body.appliedForceN.x, -maxForce, maxForce),
        fy: clamp(body.appliedForceN.y, -maxForce, maxForce),
        color: typeof body.color === 'string' && /^#[\da-f]{6}$/i.test(body.color) ? body.color : colors[index % colors.length]
      };
    });

    status.mode = data.mode;
    status.gravity = clamp(Number(data.gravity) || 0, 0, 180);
    status.damping = clamp(Number(data.airResistance) || 0, 0, .5);
    status.running = Boolean(data.running);
    status.showTrails = Boolean(data.showTrails);
    status.timeScale = [0.5, 1, 2].includes(data.timeScale) ? data.timeScale : 1;
    const parameters = data.parameters || {};
    status.projectileSpeed = clamp(Number(parameters.projectileSpeed) || 190, 60, 300);
    status.projectileAngle = clamp(Number(parameters.projectileAngle) || 52, 10, 85);
    status.pendulumReleaseAngle = clamp(Number(parameters.pendulumAngleDegrees) || 46, 5, 85) * Math.PI / 180;
    if (status.mode === 'pendulum') {
      const bob = bodies[0];
      status.pendulumAngle = Math.atan2((bob.x - .5) * width, (bob.y - .18) * height);
      const length = Math.max(1, pendulumLength());
      status.pendulumOmega = clamp((bob.vx * Math.cos(status.pendulumAngle) - bob.vy * Math.sin(status.pendulumAngle)) / length, -10, 10);
    } else {
      status.pendulumAngle = status.pendulumReleaseAngle;
      status.pendulumOmega = 0;
    }
    status.bodies = bodies;
    selectedId = bodies[0].id;
    elapsed = 0;
    history.length = 0;
    resetTrailHistory();
    updateStaticControls();
    updateInspector();
    sampleHistory();
    render();
    broadcastState(true);
    showToast(`${modeNames[status.mode]} scene imported`);
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function generatedCode() {
    const config = JSON.stringify(sceneConfig(), null, 2);
    return `// Vector Lab scene — dependency-free 2D physics loop
const scene = ${config};

function step(dt, width, height) {
  for (const body of scene.bodies) {
    body.velocity.x += body.appliedForceN.x / body.massKg * dt;
    body.velocity.y += (-body.appliedForceN.y / body.massKg + scene.gravity) * dt;
    const drag = Math.max(0, 1 - scene.airResistance * dt);
    body.velocity.x *= drag;
    body.velocity.y *= drag;
    body.position.x += body.velocity.x * dt / width;
    body.position.y += body.velocity.y * dt / height;
    body.position.x = Math.max(0, Math.min(1, body.position.x));
    body.position.y = Math.max(0, Math.min(1, body.position.y));
  }
}

// Call step(1 / 60, canvas.width, canvas.height) from requestAnimationFrame.
`;
  }

  function toggleExportMenu(force) {
    const menu = $('#export-menu');
    const open = typeof force === 'boolean' ? force : menu.hidden;
    menu.hidden = !open;
    $('#export-button').setAttribute('aria-expanded', String(open));
  }

  function animate(now) {
    if (!lastFrame) lastFrame = now;
    const dt = clamp((now - lastFrame) / 1000, 0, maxFrameTime) * status.timeScale;
    lastFrame = now;
    step(dt);
    render();

    if (now - lastUiUpdate > 120) {
      updateInspector();
      $('#clock-readout').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}.${Math.floor((elapsed % 1) * 10)}`;
      if (status.running) sampleHistory();
      else drawChart();
      updateUiPeerClock();
      lastUiUpdate = now;
    }
    if (status.running && now - lastBroadcast > 240) broadcastState();
    requestAnimationFrame(animate);
  }

  let lastPeerUi = 0;
  function updateUiPeerClock() {
    if (Date.now() - lastPeerUi > 2000) {
      updatePeerUi();
      lastPeerUi = Date.now();
    }
  }

  $('#mass-slider').addEventListener('input', onBodyMassInput);
  $('#force-x').addEventListener('input', (event) => onForceInput('fx', event));
  $('#force-x').addEventListener('change', (event) => onForceInput('fx', event));
  $('#force-y').addEventListener('input', (event) => onForceInput('fy', event));
  $('#force-y').addEventListener('change', (event) => onForceInput('fy', event));
  $('#gravity-slider').addEventListener('input', (event) => {
    status.gravity = Number(event.target.value);
    $('#gravity-value').textContent = String(Math.round(status.gravity));
    updateRangeFill(event.target);
    render();
    broadcastState();
  });
  $('#damping-slider').addEventListener('input', (event) => {
    status.damping = Number(event.target.value);
    $('#damping-value').textContent = status.damping.toFixed(2);
    updateRangeFill(event.target);
    render();
    broadcastState();
  });
  $('#vectors-toggle').addEventListener('change', (event) => {
    status.vectors = event.target.checked;
    render();
    broadcastState(true);
  });
  $('#trails-toggle').addEventListener('change', (event) => {
    status.showTrails = event.target.checked;
    render();
    broadcastState(true);
  });
  $('#speed-select').addEventListener('change', (event) => {
    status.timeScale = Number(event.target.value);
    broadcastState(true);
    showToast(`Simulation speed set to ${status.timeScale}×`);
  });
  document.querySelectorAll('.simulation-option').forEach((button) => {
    button.addEventListener('click', () => selectSimulation(button.dataset.mode));
  });
  $('#launch-speed').addEventListener('input', (event) => {
    status.projectileSpeed = Number(event.target.value);
    $('#launch-speed-value').textContent = String(status.projectileSpeed);
    broadcastState();
  });
  $('#launch-angle').addEventListener('input', (event) => {
    status.projectileAngle = Number(event.target.value);
    $('#launch-angle-value').textContent = String(status.projectileAngle);
    broadcastState();
  });
  $('#pendulum-angle').addEventListener('input', (event) => {
    status.pendulumReleaseAngle = Number(event.target.value) * Math.PI / 180;
    status.pendulumAngle = status.pendulumReleaseAngle;
    status.pendulumOmega = 0;
    placePendulumBob();
    resetTrailHistory();
    render();
    broadcastState();
  });
  $('#launch-button').addEventListener('click', launchProjectile);
  $('#release-button').addEventListener('click', releasePendulum);
  $('#play-button').addEventListener('click', () => {
    status.running = !status.running;
    updateStaticControls();
    render();
    broadcastState(true);
  });
  $('#add-body-button').addEventListener('click', addBody);
  $('#add-body-cta').addEventListener('click', addBody);
  $('#reset-button').addEventListener('click', resetScene);
  $('#settings-button').addEventListener('click', resetScene);
  $('#export-button').addEventListener('click', () => toggleExportMenu());
  $('#export-json').addEventListener('click', () => {
    downloadFile('vector-lab-scene.json', JSON.stringify(sceneConfig(), null, 2), 'application/json');
    toggleExportMenu(false);
    showToast('Scene downloaded as JSON');
  });
  $('#export-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(generatedCode());
      showToast('JavaScript simulation code copied');
    } catch (error) {
      downloadFile('vector-lab-simulation.js', generatedCode(), 'text/javascript');
      showToast('Clipboard unavailable — JavaScript downloaded instead');
    }
    toggleExportMenu(false);
  });
  $('#import-scene').addEventListener('click', () => {
    toggleExportMenu(false);
    $('#import-file').click();
  });
  $('#import-file').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      importSceneConfig(JSON.parse(await file.text()));
    } catch (error) {
      showToast(error instanceof SyntaxError ? 'The selected file is not valid JSON' : error.message);
    } finally {
      event.target.value = '';
    }
  });
  $('#help-button').addEventListener('click', () => showToast('Space: play or pause · A: add a body · Esc: close menus'));
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    if (!interaction) $('#coordinate-readout').innerHTML = 'x 000 &nbsp; y 000';
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.export-wrap')) toggleExportMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !['INPUT', 'BUTTON'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      $('#play-button').click();
    }
    if (event.key.toLowerCase() === 'a' && !['INPUT', 'BUTTON'].includes(document.activeElement.tagName)) addBody();
    if (event.key === 'Enter' && !['INPUT', 'BUTTON'].includes(document.activeElement.tagName)) {
      if (status.mode === 'projectile') launchProjectile();
      if (status.mode === 'pendulum') releasePendulum();
    }
    if (event.key === 'Escape') toggleExportMenu(false);
  });
  window.addEventListener('resize', resizeCanvas);
  if (channel) {
    channel.addEventListener('message', handleChannelMessage);
    announcePresence();
    setTimeout(announcePresence, 300);
  } else {
    $('.collab-status').title = 'Live sync requires a browser with BroadcastChannel support';
  }
  setInterval(updatePeerUi, 2200);

  updateStaticControls();
  updateInspector();
  resizeCanvas();
  resetTrailHistory();
  sampleHistory();
  render();
  requestAnimationFrame(animate);
})();
