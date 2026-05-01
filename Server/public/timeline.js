/* ========================================
   Timeline / Gauge SVG Component
   ======================================== */

const PARAM_COLORS = {
  'Temperature': { main: '#e85d3a', light: '#fde8e0', lighter: '#fef4f0' },
  'Soil Moisture': { main: '#3a8fd4', light: '#deedf8', lighter: '#eef6fc' },
  'Light': { main: '#e8b63a', light: '#fdf3dd', lighter: '#fef9ee' }
};

const PARAM_UNITS = {
  'Temperature': '°C',
  'Soil Moisture': '%',
  'Light': ' lux'
};

const PARAM_CSS = {
  'Temperature': 'temp',
  'Soil Moisture': 'moisture',
  'Light': 'light'
};

function getParamColor(name) {
  return PARAM_COLORS[name] || { main: '#888', light: '#ddd', lighter: '#eee' };
}

function createSVGEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Renders a read-only timeline gauge into a container.
 * Returns an update(current, target, inner, outer) function.
 */
function renderTimeline(container, paramName, data) {
  const colors = getParamColor(paramName);
  const unit = PARAM_UNITS[paramName] || '';
  container.innerHTML = '';

  const svg = createSVGEl('svg', { class: 'timeline-svg', viewBox: '0 0 340 80', preserveAspectRatio: 'xMidYMid meet' });
  container.appendChild(svg);

  const lineY = 48;
  const padL = 30, padR = 30, w = 340 - padL - padR;

  // Arrow tips
  svg.appendChild(createSVGEl('line', { x1: 8, y1: lineY, x2: 332, y2: lineY, stroke: '#181818', 'stroke-width': 1.5 }));
  // Left arrow
  svg.appendChild(createSVGEl('polygon', { points: `8,${lineY} 16,${lineY-4} 16,${lineY+4}`, fill: '#181818' }));
  // Right arrow
  svg.appendChild(createSVGEl('polygon', { points: `332,${lineY} 324,${lineY-4} 324,${lineY+4}`, fill: '#181818' }));

  // Rects and markers will be updated
  const outerRect = createSVGEl('rect', { y: lineY - 14, height: 28, rx: 4, fill: '#e0e0e0', opacity: 0.5 });
  const innerRect = createSVGEl('rect', { y: lineY - 14, height: 28, rx: 4, fill: colors.main, opacity: 0.35 });
  const targetLine = createSVGEl('line', { 'stroke-dasharray': '4,3', stroke: '#181818', 'stroke-width': 1.5 });
  const currentArrow = createSVGEl('polygon', { fill: '#181818' });
  const currentLabel = createSVGEl('text', { 'text-anchor': 'middle', 'font-family': 'Kanit', 'font-size': '12', 'font-weight': '600', fill: '#181818' });
  const targetLabel = createSVGEl('text', { 'text-anchor': 'middle', 'font-family': 'Kanit', 'font-size': '14', 'font-weight': '700', fill: '#181818' });

  // Tick labels
  const ticks = [];
  for (let i = 0; i < 5; i++) {
    const t = createSVGEl('text', { 'text-anchor': 'middle', 'font-family': 'Kanit', 'font-size': '10', fill: '#8a8a8a', y: lineY + 24 });
    ticks.push(t);
    svg.appendChild(t);
  }

  svg.appendChild(outerRect);
  svg.appendChild(innerRect);
  svg.appendChild(targetLine);
  svg.appendChild(currentArrow);
  svg.appendChild(currentLabel);
  svg.appendChild(targetLabel);

  function update(current, target, inner, outer) {
    const minVal = target - outer - (outer * 0.3);
    const maxVal = target + outer + (outer * 0.3);
    const range = maxVal - minVal;
    const toX = v => padL + ((v - minVal) / range) * w;

    const oL = toX(target - outer), oR = toX(target + outer);
    const iL = toX(target - inner), iR = toX(target + inner);
    const tX = toX(target);
    const cX = Math.max(padL, Math.min(padL + w, toX(current)));

    outerRect.setAttribute('x', oL);
    outerRect.setAttribute('width', Math.max(0, oR - oL));
    innerRect.setAttribute('x', iL);
    innerRect.setAttribute('width', Math.max(0, iR - iL));
    targetLine.setAttribute('x1', tX); targetLine.setAttribute('x2', tX);
    targetLine.setAttribute('y1', lineY - 16); targetLine.setAttribute('y2', lineY + 16);

    // Current value arrow pointing down
    const ay = lineY - 18;
    currentArrow.setAttribute('points', `${cX},${ay} ${cX-5},${ay-8} ${cX+5},${ay-8}`);
    currentLabel.setAttribute('x', cX);
    currentLabel.setAttribute('y', ay - 12);
    currentLabel.textContent = (Math.round(current * 10) / 10) + unit;

    // Target label below line
    targetLabel.setAttribute('x', tX);
    targetLabel.setAttribute('y', lineY + 40);
    targetLabel.textContent = target + unit;

    // Tick values
    const tickVals = [target - outer, target - inner, target, target + inner, target + outer];
    const tickXs = tickVals.map(toX);
    ticks.forEach((t, i) => {
      t.setAttribute('x', tickXs[i]);
      if (i === 2) { t.textContent = ''; } // center is shown by targetLabel
      else { t.textContent = tickVals[i]; }
    });
  }

  if (data) update(data.current, data.target, data.inner, data.outer);
  return update;
}

/**
 * Renders an editable timeline with drag handles.
 * Returns { update(target, inner, outer), getValues() }
 */
function renderEditTimeline(container, paramName, data, onChange) {
  const colors = getParamColor(paramName);
  const unit = PARAM_UNITS[paramName] || '';
  container.innerHTML = '';

  const svg = createSVGEl('svg', { class: 'edit-timeline-svg', viewBox: '0 0 340 120', preserveAspectRatio: 'xMidYMid meet' });
  container.appendChild(svg);
  svg.style.touchAction = 'none';

  const lineY = 65;
  const padL = 30, padR = 30, w = 340 - padL - padR;

  let target = data.target, inner = data.inner, outer = data.outer;
  // Compute a reasonable visible range based on outer tolerance
  const computeRange = () => {
    const margin = outer * 0.4;
    return { min: target - outer - margin, max: target + outer + margin };
  };
  let visRange = computeRange();
  const toX = v => padL + ((v - visRange.min) / (visRange.max - visRange.min)) * w;
  const toVal = x => visRange.min + ((x - padL) / w) * (visRange.max - visRange.min);

  // Base line + arrows
  svg.appendChild(createSVGEl('line', { x1: 8, y1: lineY, x2: 332, y2: lineY, stroke: '#181818', 'stroke-width': 1.5 }));
  svg.appendChild(createSVGEl('polygon', { points: `8,${lineY} 16,${lineY-4} 16,${lineY+4}`, fill: '#181818' }));
  svg.appendChild(createSVGEl('polygon', { points: `332,${lineY} 324,${lineY-4} 324,${lineY+4}`, fill: '#181818' }));

  const outerRect = createSVGEl('rect', { y: lineY - 14, height: 28, rx: 4, fill: '#e0e0e0', opacity: 0.5 });
  const innerRect = createSVGEl('rect', { y: lineY - 14, height: 28, rx: 4, fill: colors.main, opacity: 0.35 });
  const targetLine = createSVGEl('line', { 'stroke-dasharray': '4,3', stroke: '#181818', 'stroke-width': 1.5 });

  svg.appendChild(outerRect);
  svg.appendChild(innerRect);
  svg.appendChild(targetLine);

  // Tick labels
  const tickTexts = [];
  for (let i = 0; i < 5; i++) {
    const t = createSVGEl('text', { 'text-anchor': 'middle', 'font-family': 'Kanit', 'font-size': '10', fill: '#8a8a8a', y: lineY + 24 });
    tickTexts.push(t);
    svg.appendChild(t);
  }

  // Target label
  const targetLabel = createSVGEl('text', { 'text-anchor': 'middle', 'font-family': 'Kanit', 'font-size': '13', 'font-weight': '700', fill: '#181818', y: lineY + 38 });
  svg.appendChild(targetLabel);

  // Handle labels (above handles)
  function makeHandleLabel() {
    return createSVGEl('text', { 'text-anchor': 'middle', 'font-family': 'Kanit', 'font-size': '9', fill: '#8a8a8a', y: lineY - 24 });
  }

  // Create drag handles: [outerLeft, innerLeft, target, innerRight, outerRight]
  const handleDefs = [
    { id: 'ol', color: '#c4c4c4', r: 7 },
    { id: 'il', color: colors.light, r: 7, stroke: colors.main },
    { id: 'tg', color: colors.main, r: 9 },
    { id: 'ir', color: colors.light, r: 7, stroke: colors.main },
    { id: 'or', color: '#c4c4c4', r: 7 },
  ];

  const handles = [];
  const handleLabels = [];

  handleDefs.forEach((hd) => {
    const label = makeHandleLabel();
    svg.appendChild(label);
    handleLabels.push(label);

    const g = createSVGEl('g', { class: 'drag-handle', 'data-id': hd.id });
    const c = createSVGEl('circle', { cy: lineY, r: hd.r, fill: hd.color, stroke: hd.stroke || 'none', 'stroke-width': hd.stroke ? 2 : 0 });
    g.appendChild(c);
    svg.appendChild(g);
    handles.push(g);
  });

  function draw() {
    // Only recompute if handles push against the edges of the visible range
    const margin = (visRange.max - visRange.min) * 0.05;
    if (target - outer < visRange.min + margin || target + outer > visRange.max - margin) {
      visRange = computeRange();
    }
    const oL = toX(target - outer), oR = toX(target + outer);
    const iL = toX(target - inner), iR = toX(target + inner);
    const tX = toX(target);

    outerRect.setAttribute('x', oL);
    outerRect.setAttribute('width', Math.max(0, oR - oL));
    innerRect.setAttribute('x', iL);
    innerRect.setAttribute('width', Math.max(0, iR - iL));
    targetLine.setAttribute('x1', tX); targetLine.setAttribute('x2', tX);
    targetLine.setAttribute('y1', lineY - 16); targetLine.setAttribute('y2', lineY + 16);

    // Handle positions
    const positions = [target - outer, target - inner, target, target + inner, target + outer];
    const labels = [
      Math.round((target - outer) * 10) / 10,
      Math.round((target - inner) * 10) / 10,
      '',
      Math.round((target + inner) * 10) / 10,
      Math.round((target + outer) * 10) / 10
    ];

    positions.forEach((v, i) => {
      const x = toX(v);
      handles[i].querySelector('circle').setAttribute('cx', x);
      handleLabels[i].setAttribute('x', x);
      handleLabels[i].textContent = labels[i];
    });

    targetLabel.setAttribute('x', toX(target));
    targetLabel.textContent = Math.round(target * 10) / 10 + unit;

    // Ticks
    positions.forEach((v, i) => {
      tickTexts[i].setAttribute('x', toX(v));
      tickTexts[i].textContent = i === 2 ? '' : Math.round(v * 10) / 10;
    });
  }

  draw();

  // Drag logic
  let activeHandle = null;
  let svgPt = null;

  function getSVGX(e) {
    const touch = e.touches ? e.touches[0] : e;
    const rect = svg.getBoundingClientRect();
    const scaleX = 340 / rect.width;
    return (touch.clientX - rect.left) * scaleX;
  }

  function onStart(e) {
    e.preventDefault();
    const g = e.target.closest('.drag-handle');
    if (!g) return;
    activeHandle = g.getAttribute('data-id');
    g.classList.add('dragging');
  }

  function onMove(e) {
    if (!activeHandle) return;
    e.preventDefault();
    const x = getSVGX(e);
    const val = toVal(x);
    const step = paramName === 'Light' ? 1 : 0.1;
    const snap = v => Math.round(v / step) * step;

    switch (activeHandle) {
      case 'tg': {
        const diff = snap(val) - target;
        target = snap(val);
        break;
      }
      case 'il': {
        const newInner = Math.max(step, snap(target - val));
        if (newInner < outer) inner = newInner;
        break;
      }
      case 'ir': {
        const newInner = Math.max(step, snap(val - target));
        if (newInner < outer) inner = newInner;
        break;
      }
      case 'ol': {
        const newOuter = Math.max(inner + step, snap(target - val));
        outer = newOuter;
        break;
      }
      case 'or': {
        const newOuter = Math.max(inner + step, snap(val - target));
        outer = newOuter;
        break;
      }
    }

    draw();
    if (onChange) onChange({ target, inner, outer });
  }

  function onEnd() {
    if (activeHandle) {
      handles.forEach(h => h.classList.remove('dragging'));
      activeHandle = null;
      // Re-center after drag finishes
      visRange = computeRange();
      draw();
    }
  }

  svg.addEventListener('mousedown', onStart);
  svg.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);

  return {
    update(t, i, o) { target = t; inner = i; outer = o; visRange = computeRange(); draw(); },
    getValues() { return { target: Math.round(target * 10) / 10, inner: Math.round(inner * 10) / 10, outer: Math.round(outer * 10) / 10 }; },
    destroy() {
      svg.removeEventListener('mousedown', onStart);
      svg.removeEventListener('touchstart', onStart);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchend', onEnd);
    }
  };
}
