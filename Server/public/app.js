/* ========================================
   FAWAWWA — Main Application Logic
   ======================================== */

// === State ===
const state = {
  connected: false,
  ws: null,
  password: '',
  esps: new Map(),
  manualEspId: null,
  espData: new Map(), // espId -> { parameters: [...] }
  editValues: {},     // paramName -> { target, inner, outer }
  appliedValues: {},  // paramName -> { target, inner, outer }
  editTimelines: {},  // paramName -> timeline controller
  monitorTimelines: new Map(), // `${espId}-${paramName}` -> update fn
  presets: [],
  activeTab: 0,
  hasEdits: false
};

// Default param values from ESP code
const DEFAULT_PARAMS = {
  'Temperature': { target: 17, inner: 1, outer: 3 },
  'Soil Moisture': { target: 50, inner: 5, outer: 20 },
  'Light': { target: 300, inner: 50, outer: 150 }
};

// === DOM Refs ===
const $ = id => document.getElementById(id);
const tabPanes = document.querySelectorAll('.tab-pane');
const navItems = document.querySelectorAll('.nav-item');
const navIndicator = $('nav-indicator');

// === Navigation ===
function switchTab(index) {
  state.activeTab = index;
  tabPanes.forEach((p, i) => p.classList.toggle('active', i === index));
  navItems.forEach((n, i) => n.classList.toggle('active', i === index));
  updateIndicator(index);
}

function updateIndicator(index) {
  const navBtn = navItems[index];
  if (!navBtn) return;
  const nav = $('bottom-nav');
  const navRect = nav.getBoundingClientRect();
  const btnRect = navBtn.getBoundingClientRect();
  const indicatorSize = 56;
  const left = btnRect.left - navRect.left + (btnRect.width - indicatorSize) / 2;
  navIndicator.style.left = left + 'px';
}

navItems.forEach(btn => {
  btn.addEventListener('click', () => switchTab(parseInt(btn.dataset.tab)));
});

// Set initial indicator position after layout
requestAnimationFrame(() => updateIndicator(0));
window.addEventListener('resize', () => updateIndicator(state.activeTab));

// === WebSocket Connection ===
let reconnectTimer = null;
let reconnectDelay = 1000;

function connect(password) {
  state.password = password;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/connect-app?password=${encodeURIComponent(password)}`;

  try {
    const ws = new WebSocket(url);
    state.ws = ws;

    ws.onopen = () => {
      state.connected = true;
      reconnectDelay = 1000;
      sessionStorage.setItem('fawawwa_pass', password);
      renderConnectTab();
    };

    ws.onmessage = (e) => {
      try { handleMessage(JSON.parse(e.data)); } catch (err) { console.error('WS parse error:', err); }
    };

    ws.onclose = (e) => {
      state.connected = false;
      state.ws = null;
      if (e.code === 1008) {
        // Auth failure
        $('connect-error').textContent = 'Invalid password';
        renderConnectTab();
        return;
      }
      renderConnectTab();
      // Auto reconnect
      if (state.password) {
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect(state.password);
        }, reconnectDelay);
      }
    };

    ws.onerror = () => {};
  } catch (err) {
    $('connect-error').textContent = 'Connection failed';
  }
}

function disconnect() {
  state.password = '';
  sessionStorage.removeItem('fawawwa_pass');
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (state.ws) state.ws.close(1000);
  state.connected = false;
  state.esps.clear();
  state.espData.clear();
  state.manualEspId = null;
  renderConnectTab();
  renderControlTab();
  renderMonitorTab();
}

function sendMsg(data) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(data));
}

// === Message Handler ===
function handleMessage(msg) {
  switch (msg.type) {
    case 'esp-list':
      state.esps.clear();
      msg.esps.forEach(e => state.esps.set(e.id, e));
      state.manualEspId = msg.manualEspId || null;
      renderConnectTab();
      renderControlTab();
      renderMonitorTab();
      break;

    case 'esp-data':
      state.espData.set(msg.espId, { parameters: msg.parameters });
      // Update edit applied values from first data we get
      if (Object.keys(state.appliedValues).length === 0) {
        msg.parameters.forEach(p => {
          state.appliedValues[p.name] = { target: p.target, inner: p.inner, outer: p.outer };
          if (!state.editValues[p.name]) {
            state.editValues[p.name] = { target: p.target, inner: p.inner, outer: p.outer };
          }
        });
        renderEditTab();
      }
      updateMonitorData(msg.espId, msg.parameters);
      updateControlReadings(msg.espId, msg.parameters);
      break;

    case 'manual-mode-changed':
      state.manualEspId = msg.manualEspId;
      // Update the ESP's automatic field
      if (state.esps.has(msg.espId)) {
        state.esps.get(msg.espId).automatic = msg.automatic;
      }
      renderConnectTab();
      renderControlTab();
      renderMonitorTab();
      break;

    case 'actuator-toggled':
      // Will be reflected in next esp-data update
      break;
  }
}

// === Connect Tab ===
function renderConnectTab() {
  const login = $('connect-login');
  const connected = $('connect-connected');

  if (!state.connected) {
    login.classList.remove('hidden');
    connected.classList.add('hidden');
    return;
  }

  login.classList.add('hidden');
  connected.classList.remove('hidden');

  const espList = $('esp-list');
  const noEsp = $('no-esp-msg');

  if (state.esps.size === 0) {
    espList.classList.add('hidden');
    noEsp.classList.remove('hidden');
    return;
  }

  noEsp.classList.add('hidden');
  espList.classList.remove('hidden');
  espList.innerHTML = '';

  state.esps.forEach((esp, id) => {
    const isManual = state.manualEspId === id;
    const shortId = 'ESP-' + id.split(':').slice(-3).join(':');

    const card = document.createElement('div');
    card.className = 'esp-card' + (isManual ? ' manual' : '');
    card.innerHTML = `
      <div class="esp-info">
        <div class="esp-name">${shortId}</div>
        <div class="esp-status">
          <div class="status-dot ${esp.online ? 'online' : ''}"></div>
          <span>${esp.online ? 'Online' : 'Offline'}</span>
          ${isManual ? '<span style="color:var(--strawberry);margin-left:8px;">Manual</span>' : ''}
        </div>
      </div>
      <div class="esp-actions" style="display: flex; gap: var(--space-md); align-items: center;">
        <div class="toggle-wrap">
          <span class="toggle-label">Auto</span>
          <label class="toggle">
            <input type="checkbox" ${esp.automatic ? 'checked' : ''} data-esp-id="${id}">
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
        <button class="btn-ghost disconnect-esp-btn" data-esp-id="${id}" style="padding: 4px; border: none; color: var(--danger);" title="Disconnect ESP">
          <span class="material-symbols-outlined" style="font-size: 20px; pointer-events: none;">link_off</span>
        </button>
      </div>
    `;

    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
      sendMsg({ type: 'set-automatic', espId: id, automatic: e.target.checked });
    });

    const disconnectBtn = card.querySelector('.disconnect-esp-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', (e) => {
        sendMsg({ type: 'disconnect-esp', espId: e.target.closest('button').dataset.espId });
      });
    }

    espList.appendChild(card);
  });
}

$('connect-btn').addEventListener('click', () => {
  const pass = $('password-input').value.trim();
  if (pass) { $('connect-error').textContent = ''; connect(pass); }
});

$('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('connect-btn').click();
});

$('disconnect-btn').addEventListener('click', disconnect);

$('add-virtual-esp-btn').addEventListener('click', () => {
  sendMsg({ type: 'start-virtual-esp' });
});

// === Control Tab ===
function renderControlTab() {
  const content = $('control-content');
  const subtitle = $('control-subtitle');
  const fields = $('control-fields');

  const manualEsp = state.manualEspId;
  if (!manualEsp || !state.esps.has(manualEsp)) {
    content.classList.add('disabled-overlay');
    subtitle.textContent = 'No ESP in manual mode';
    fields.innerHTML = buildControlFields(null);
    return;
  }

  content.classList.remove('disabled-overlay');
  const shortId = 'ESP-' + manualEsp.split(':').slice(-3).join(':');
  subtitle.textContent = 'Controlling: ' + shortId;
  fields.innerHTML = buildControlFields(manualEsp);
}

function buildControlFields(espId) {
  const data = espId ? state.espData.get(espId) : null;
  const params = data ? data.parameters : Object.keys(DEFAULT_PARAMS).map(name => ({
    name, current: 0, target: DEFAULT_PARAMS[name].target,
    inner: DEFAULT_PARAMS[name].inner, outer: DEFAULT_PARAMS[name].outer,
    actuators: getDefaultActuators(name)
  }));

  let html = '';
  const groups = {};

  params.forEach(p => {
    if (!groups[p.name]) groups[p.name] = [];
    (p.actuators || []).forEach(a => {
      groups[p.name].push({ ...a, paramName: p.name, current: p.current });
    });
  });

  for (const [paramName, actuators] of Object.entries(groups)) {
    const css = PARAM_CSS[paramName] || '';
    const unit = PARAM_UNITS[paramName] || '';
    html += `<div class="param-group">`;
    html += `<div class="param-group-header ${css}">${paramName}</div>`;

    actuators.forEach(a => {
      html += `
        <div class="actuator-field ${css}" data-esp="${espId || ''}" data-param="${paramName}" data-actuator="${a.role}">
          <div class="actuator-info">
            <div class="actuator-name">${a.name}</div>
            <div class="actuator-reading" data-reading="${paramName}">${Math.round(a.current * 10) / 10}${unit}</div>
          </div>
          <div class="actuator-toggle">
            <div class="mini-status ${a.active ? 'on' : ''}" data-status="${paramName}-${a.role}"></div>
            <label class="toggle" onclick="event.stopPropagation()">
              <input type="checkbox" ${a.active ? 'checked' : ''}>
              <span class="toggle-track"></span>
              <span class="toggle-thumb"></span>
            </label>
          </div>
        </div>`;
    });

    html += `</div>`;
  }

  return html;
}

function getDefaultActuators(name) {
  switch (name) {
    case 'Temperature': return [{ role: 'increase', name: 'Heat Lamp', active: false }, { role: 'decrease', name: 'DC Fan', active: false }];
    case 'Soil Moisture': return [{ role: 'increase', name: 'Water Pump', active: false }];
    case 'Light': return [{ role: 'increase', name: 'White Lamp', active: false }];
    default: return [];
  }
}

// Delegate click on actuator fields
$('control-fields').addEventListener('click', (e) => {
  const field = e.target.closest('.actuator-field');
  if (!field || !state.manualEspId) return;

  const espId = field.dataset.esp;
  const param = field.dataset.param;
  const actuator = field.dataset.actuator;
  const toggle = field.querySelector('input[type="checkbox"]');
  const newState = !toggle.checked;
  toggle.checked = newState;

  sendMsg({ type: 'toggle-actuator', espId, parameter: param, actuator, active: newState });
});

function updateControlReadings(espId, parameters) {
  if (espId !== state.manualEspId) return;
  parameters.forEach(p => {
    const unit = PARAM_UNITS[p.name] || '';
    const readings = document.querySelectorAll(`[data-reading="${p.name}"]`);
    readings.forEach(el => { el.textContent = Math.round(p.current * 10) / 10 + unit; });

    (p.actuators || []).forEach(a => {
      const dot = document.querySelector(`[data-status="${p.name}-${a.role}"]`);
      if (dot) dot.classList.toggle('on', a.active);
      // Also update toggle
      const field = document.querySelector(`.actuator-field[data-param="${p.name}"][data-actuator="${a.role}"]`);
      if (field) {
        const toggle = field.querySelector('input[type="checkbox"]');
        if (toggle) toggle.checked = a.active;
      }
    });
  });
}

// === Monitor Tab ===
function renderMonitorTab() {
  const sections = $('monitor-sections');
  const empty = $('monitor-empty');
  state.monitorTimelines.clear();

  // Show only ESPs in automatic mode
  const autoEsps = [];
  state.esps.forEach((esp, id) => {
    if (esp.automatic && esp.online) autoEsps.push({ id, esp });
  });

  if (autoEsps.length === 0 && state.espData.size === 0) {
    sections.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  sections.innerHTML = '';

  // If we have data, render for each ESP with data
  const espIds = autoEsps.length > 0 ? autoEsps.map(e => e.id) : [...state.espData.keys()];

  espIds.forEach(espId => {
    const data = state.espData.get(espId);
    if (!data) return;

    const shortId = 'ESP-' + espId.split(':').slice(-3).join(':');
    const section = document.createElement('div');
    section.className = 'monitor-esp-section';
    section.dataset.espId = espId;

    let headerHtml = `<div class="monitor-esp-header"><div class="status-dot online"></div>${shortId}</div>`;
    section.innerHTML = headerHtml;

    data.parameters.forEach(p => {
      const block = document.createElement('div');
      block.className = 'monitor-param-block';

      const css = PARAM_CSS[p.name] || '';
      const actuatorHtml = (p.actuators || []).map(a => `
        <div class="actuator-status-item">
          <div class="actuator-status-dot ${a.active ? 'active' : ''}" data-monitor-status="${espId}-${p.name}-${a.role}"></div>
          <span>${a.name}</span>
        </div>
      `).join('');

      block.innerHTML = `
        <div class="monitor-param-top">
          <div class="monitor-param-name ${css}">${p.name}</div>
          <div class="actuator-statuses">${actuatorHtml}</div>
        </div>
        <div class="timeline-container" data-timeline="${espId}-${p.name}"></div>
      `;

      section.appendChild(block);

      // Render timeline after adding to DOM
      requestAnimationFrame(() => {
        const container = block.querySelector('.timeline-container');
        if (container) {
          const updateFn = renderTimeline(container, p.name, {
            current: parseFloat(p.current), target: p.target, inner: p.inner, outer: p.outer
          });
          state.monitorTimelines.set(`${espId}-${p.name}`, updateFn);
        }
      });
    });

    sections.appendChild(section);
  });
}

function updateMonitorData(espId, parameters) {
  parameters.forEach(p => {
    const key = `${espId}-${p.name}`;
    const updateFn = state.monitorTimelines.get(key);
    if (updateFn) {
      updateFn(parseFloat(p.current), p.target, p.inner, p.outer);
    }

    // Update actuator status dots
    (p.actuators || []).forEach(a => {
      const dot = document.querySelector(`[data-monitor-status="${espId}-${p.name}-${a.role}"]`);
      if (dot) dot.classList.toggle('active', a.active);
    });
  });

  // If monitor tab hasn't been rendered yet, render it
  if (state.monitorTimelines.size === 0 && state.activeTab === 2) {
    renderMonitorTab();
  }
}

// === Edit Tab ===
function renderEditTab() {
  const container = $('edit-parameters');
  container.innerHTML = '';
  state.editTimelines = {};

  const paramNames = Object.keys(state.editValues);
  if (paramNames.length === 0) {
    // Use defaults
    for (const [name, vals] of Object.entries(DEFAULT_PARAMS)) {
      state.editValues[name] = { ...vals };
      state.appliedValues[name] = { ...vals };
    }
  }

  for (const [name, vals] of Object.entries(state.editValues)) {
    const css = PARAM_CSS[name] || '';
    const section = document.createElement('div');
    section.className = 'edit-param-section';

    section.innerHTML = `
      <div class="edit-param-header ${css}">${name}</div>
      <div class="edit-values-row">
        <div class="edit-value-item"><div class="val" data-edit-val="${name}-outer-low">${Math.round((vals.target - vals.outer) * 10) / 10}</div><div>Outer Low</div></div>
        <div class="edit-value-item"><div class="val" data-edit-val="${name}-inner-low">${Math.round((vals.target - vals.inner) * 10) / 10}</div><div>Inner Low</div></div>
        <div class="edit-value-item"><div class="val" data-edit-val="${name}-target">${vals.target}</div><div>Target</div></div>
        <div class="edit-value-item"><div class="val" data-edit-val="${name}-inner-high">${Math.round((vals.target + vals.inner) * 10) / 10}</div><div>Inner High</div></div>
        <div class="edit-value-item"><div class="val" data-edit-val="${name}-outer-high">${Math.round((vals.target + vals.outer) * 10) / 10}</div><div>Outer High</div></div>
      </div>
      <div class="edit-timeline-container" data-edit-timeline="${name}"></div>
    `;

    container.appendChild(section);

    requestAnimationFrame(() => {
      const tlContainer = section.querySelector('.edit-timeline-container');
      if (tlContainer) {
        const tl = renderEditTimeline(tlContainer, name, { ...vals }, (newVals) => {
          state.editValues[name] = { ...newVals };
          updateEditValueLabels(name, newVals);
          checkEditChanges();
        });
        state.editTimelines[name] = tl;
      }
    });
  }

  checkEditChanges();
}

function updateEditValueLabels(name, vals) {
  const set = (key, val) => {
    const el = document.querySelector(`[data-edit-val="${name}-${key}"]`);
    if (el) el.textContent = Math.round(val * 10) / 10;
  };
  set('target', vals.target);
  set('inner-low', vals.target - vals.inner);
  set('inner-high', vals.target + vals.inner);
  set('outer-low', vals.target - vals.outer);
  set('outer-high', vals.target + vals.outer);
}

function checkEditChanges() {
  let changed = false;
  for (const [name, vals] of Object.entries(state.editValues)) {
    const applied = state.appliedValues[name];
    if (!applied || vals.target !== applied.target || vals.inner !== applied.inner || vals.outer !== applied.outer) {
      changed = true;
      break;
    }
  }
  state.hasEdits = changed;
  $('apply-btn').disabled = !changed;
  $('revert-btn').disabled = !changed;
}

$('apply-btn').addEventListener('click', () => {
  for (const [name, vals] of Object.entries(state.editValues)) {
    sendMsg({ type: 'update-values', parameter: name, target: vals.target, inner: vals.inner, outer: vals.outer });
    state.appliedValues[name] = { ...vals };
  }
  checkEditChanges();
});

$('revert-btn').addEventListener('click', () => {
  for (const [name, vals] of Object.entries(state.appliedValues)) {
    state.editValues[name] = { ...vals };
    if (state.editTimelines[name]) {
      state.editTimelines[name].update(vals.target, vals.inner, vals.outer);
    }
    updateEditValueLabels(name, vals);
  }
  checkEditChanges();
});

// === Presets ===
async function loadPresets() {
  try {
    const res = await fetch('/presets.json');
    const data = await res.json();
    state.presets = data.presets || [];
    const select = $('preset-select');
    state.presets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load presets:', e);
  }
}

$('preset-select').addEventListener('change', (e) => {
  const presetName = e.target.value;
  if (!presetName) return;
  const preset = state.presets.find(p => p.name === presetName);
  if (!preset) return;

  for (const [name, vals] of Object.entries(preset.parameters)) {
    state.editValues[name] = { ...vals };
    if (state.editTimelines[name]) {
      state.editTimelines[name].update(vals.target, vals.inner, vals.outer);
    }
    updateEditValueLabels(name, vals);
  }
  checkEditChanges();
});

// === Init ===
function init() {
  renderEditTab();
  loadPresets();

  // Auto-reconnect from saved session
  const savedPass = sessionStorage.getItem('fawawwa_pass');
  if (savedPass) connect(savedPass);
}

init();
