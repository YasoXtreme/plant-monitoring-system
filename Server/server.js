const express = require("express");
const path = require("path");
require("dotenv").config({ quiet: true });
const os = require("os");

const app = express();
require("express-ws")(app);
const PORT = process.env.PORT || 3000;

const espConnections = new Map();
const espLatestData = new Map();
let appConnection = null;
let manualEspId = null;
let lastManualEspId = null;
const virtualEsps = new Map();
const activeTestPlans = new Map(); // key: "espId:parameterName"

function startVirtualEsp() {
  const id = "VIRTUAL:" + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  const mockWs = {
    readyState: 1,
    send: (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === "set-automatic") {
          const v = virtualEsps.get(id);
          v.automatic = data.automatic;
          v.parameters.forEach(p => {
            p.actuators.forEach(a => a.active = false);
          });
        } else if (data.type === "toggle-actuator") {
          const v = virtualEsps.get(id);
          const param = v.parameters.find(p => p.name === data.parameter);
          if (param) {
            const act = param.actuators.find(a => a.role === data.actuator);
            if (act) act.active = data.active;
          }
        } else if (data.type === "update-values") {
          const v = virtualEsps.get(id);
          const param = v.parameters.find(p => p.name === data.parameter);
          if (param) {
            param.target = data.target;
            param.inner = data.inner;
            param.outer = data.outer;
          }
        }
      } catch (e) {}
    },
    close: (code, reason) => {
      clearInterval(virtualEsps.get(id).interval);
      virtualEsps.delete(id);
      espConnections.delete(id);
      if (manualEspId === id) manualEspId = null;
      broadcastEspListToApp();
    },
    terminate: () => mockWs.close()
  };

  const vEsp = {
    automatic: true,
    parameters: [
      {
        name: "Temperature", current: 15.0, target: 17, inner: 1, outer: 3,
        actuators: [
          { role: "increase", name: "Heat Lamp", active: false },
          { role: "decrease", name: "DC Fan", active: false }
        ]
      },
      {
        name: "Soil Moisture", current: 40.0, target: 50, inner: 5, outer: 20,
        actuators: [
          { role: "increase", name: "Water Pump", active: false }
        ]
      },
      {
        name: "Light", current: 200.0, target: 300, inner: 50, outer: 150,
        actuators: [
          { role: "increase", name: "White Lamp", active: false }
        ]
      }
    ]
  };

  vEsp.interval = setInterval(() => {
    vEsp.parameters.forEach(p => {
      if (vEsp.automatic) {
        if (p.current < p.target - p.inner) {
          if (p.actuators.find(a => a.role === "increase")) p.actuators.find(a => a.role === "increase").active = true;
          if (p.actuators.find(a => a.role === "decrease")) p.actuators.find(a => a.role === "decrease").active = false;
        } else if (p.current > p.target + p.inner) {
          if (p.actuators.find(a => a.role === "increase")) p.actuators.find(a => a.role === "increase").active = false;
          if (p.actuators.find(a => a.role === "decrease")) p.actuators.find(a => a.role === "decrease").active = true;
        } else {
          p.actuators.forEach(a => a.active = false);
        }
      }

      let delta = (Math.random() - 0.5) * 0.5;
      const increaseActive = p.actuators.find(a => a.role === "increase")?.active;
      const decreaseActive = p.actuators.find(a => a.role === "decrease")?.active;

      if (increaseActive) delta += 1.0;
      else if (decreaseActive) delta -= 1.0;
      else {
        const ambient = { "Temperature": 12, "Soil Moisture": 10, "Light": 50 }[p.name];
        delta += (ambient - p.current) * 0.05;
      }

      p.current += delta;
      
      if (p.name === "Soil Moisture") p.current = Math.max(0, Math.min(100, p.current));
      if (p.name === "Light") p.current = Math.max(0, p.current);
    });

    const dataMsg = { type: "sensor-data", parameters: vEsp.parameters };
    espLatestData.set(id, dataMsg);

    evaluateTestPlans(id, vEsp.parameters);

    if (appConnection && appConnection.readyState === 1) {
      appConnection.send(JSON.stringify({
        type: "esp-data",
        espId: id,
        parameters: dataMsg.parameters
      }));
    }
  }, 1000);

  virtualEsps.set(id, vEsp);
  espConnections.set(id, mockWs);
  broadcastEspListToApp();
}

app.use(express.json());

// Serve static files for the web app
app.use(express.static(path.join(__dirname, "public")));

// Serve media files (fonts, images)
app.use("/media", express.static(path.join(__dirname, "Media")));

app.use((req, res, next) => {
  console.log(
    `[TRAFFIC] ${req.method} request to "${req.url}" from ${req.socket.remoteAddress}`,
  );
  next();
});

// === ESP WebSocket Endpoint ===
app.use("/connect-esp", authenticatePassword);

app.ws("/connect-esp", (ws, req) => {
  const deviceId = req.headers["x-device-id"];

  if (!deviceId) {
    console.log("-> ❌ Connection rejected: No x-device-id header provided.");
    ws.close(1008, "Device ID required");
    return;
  }

  // Clean up ghost connections
  if (espConnections.has(deviceId)) {
    console.log(`-> 🧹 Cleaning up old connection for ESP: ${deviceId}`);
    espConnections.get(deviceId).terminate();
  }

  ws.connectionId = deviceId;
  espConnections.set(deviceId, ws);

  console.log(`-> ✅ Connection established with ESP ID: ${deviceId}`);

  // Notify app of updated ESP list
  broadcastEspListToApp();

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "sensor-data") {
        // Store latest data for this ESP
        espLatestData.set(deviceId, data);

        evaluateTestPlans(deviceId, data.parameters);

        // Forward to app if connected
        if (appConnection && appConnection.readyState === 1) {
          appConnection.send(JSON.stringify({
            type: "esp-data",
            espId: deviceId,
            parameters: data.parameters
          }));
        }
      }
    } catch (e) {
      console.log(`[ESP] Failed to parse message from ${deviceId}:`, e.message);
    }
  });

  ws.on("close", () => {
    console.log(`-> 🔌 WebSocket connection closed for ESP: ${deviceId}`);
    if (espConnections.get(deviceId) === ws) {
      espConnections.delete(deviceId);
      espLatestData.delete(deviceId);

      // If this was the manual ESP, clear it
      if (manualEspId === deviceId) {
        manualEspId = null;
      }

      // Notify app of updated ESP list
      broadcastEspListToApp();
    }
  });
});

// === App WebSocket Endpoint ===
app.ws("/connect-app", (ws, req) => {
  const password = req.query.password || req.headers["x-password"];
  const expectedPassword = process.env.PASSWORD;

  if (password !== expectedPassword) {
    console.log("[APP] Auth failed: Rejecting app connection.");
    ws.close(1008, "Unauthorized");
    return;
  }

  // Close any existing app connection
  if (appConnection && appConnection.readyState === 1) {
    console.log("[APP] Closing previous app connection.");
    appConnection.close(1000, "New app connection");
  }

  appConnection = ws;
  console.log("[APP] ✅ App connected.");

  // Send current ESP list
  broadcastEspListToApp();

  // Restore last manual ESP if it's still connected
  if (lastManualEspId && espConnections.has(lastManualEspId)) {
    manualEspId = lastManualEspId;
    const espWs = espConnections.get(manualEspId);
    if (espWs && espWs.readyState === 1) {
      espWs.send(JSON.stringify({ type: "set-automatic", automatic: false }));
    }
    // Notify app
    if (appConnection && appConnection.readyState === 1) {
      appConnection.send(JSON.stringify({
        type: "manual-mode-changed",
        espId: manualEspId,
        automatic: false,
        manualEspId: manualEspId
      }));
    }
  }

  // Send latest data for all ESPs
  espLatestData.forEach((data, espId) => {
    if (appConnection && appConnection.readyState === 1) {
      appConnection.send(JSON.stringify({
        type: "esp-data",
        espId: espId,
        parameters: data.parameters
      }));
    }
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      handleAppMessage(data);
    } catch (e) {
      console.log("[APP] Failed to parse message:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("[APP] 🔌 App disconnected.");
    if (appConnection === ws) {
      appConnection = null;
    }

    // When app disconnects, set all ESPs back to automatic
    if (manualEspId) {
      lastManualEspId = manualEspId;
      const espWs = espConnections.get(manualEspId);
      if (espWs && espWs.readyState === 1) {
        espWs.send(JSON.stringify({ type: "set-automatic", automatic: true }));
      }
      manualEspId = null;
    }
  });
});

function handleAppMessage(data) {
  switch (data.type) {
    case "set-automatic": {
      const { espId, automatic } = data;

      if (!automatic) {
        // Setting an ESP to manual mode
        // First, revert any existing manual ESP
        if (manualEspId && manualEspId !== espId) {
          const oldEspWs = espConnections.get(manualEspId);
          if (oldEspWs && oldEspWs.readyState === 1) {
            oldEspWs.send(JSON.stringify({ type: "set-automatic", automatic: true }));
          }
          // Notify app that old ESP is back to automatic
          if (appConnection && appConnection.readyState === 1) {
            appConnection.send(JSON.stringify({
              type: "manual-mode-changed",
              espId: manualEspId,
              automatic: true,
              manualEspId: null
            }));
          }
        }

        // Set new ESP to manual
        manualEspId = espId;
        lastManualEspId = espId;
        const espWs = espConnections.get(espId);
        if (espWs && espWs.readyState === 1) {
          espWs.send(JSON.stringify({ type: "set-automatic", automatic: false }));
        }
      } else {
        // Setting ESP back to automatic
        if (manualEspId === espId) {
          manualEspId = null;
        }
        const espWs = espConnections.get(espId);
        if (espWs && espWs.readyState === 1) {
          espWs.send(JSON.stringify({ type: "set-automatic", automatic: true }));
        }
      }

      // Notify app
      if (appConnection && appConnection.readyState === 1) {
        appConnection.send(JSON.stringify({
          type: "manual-mode-changed",
          espId,
          automatic,
          manualEspId
        }));
      }
      break;
    }

    case "toggle-actuator": {
      const { espId, parameter, actuator, active } = data;
      // Only allow if this ESP is in manual mode
      if (manualEspId !== espId) {
        console.log(`[APP] Rejected actuator toggle: ESP ${espId} is not in manual mode.`);
        return;
      }
      const espWs = espConnections.get(espId);
      if (espWs && espWs.readyState === 1) {
        espWs.send(JSON.stringify({
          type: "toggle-actuator",
          parameter,
          actuator,
          active
        }));
      }
      // Confirm to app
      if (appConnection && appConnection.readyState === 1) {
        appConnection.send(JSON.stringify({
          type: "actuator-toggled",
          espId,
          parameter,
          actuator,
          active
        }));
      }
      break;
    }

    case "update-values": {
      const { parameter, target, inner, outer } = data;
      // Broadcast to all ESPs
      const payload = JSON.stringify({
        type: "update-values",
        parameter,
        target,
        inner,
        outer
      });
      espConnections.forEach((ws, deviceId) => {
        if (ws.readyState === 1) {
          ws.send(payload);
        }
      });
      console.log(`[APP] Broadcasted update-values for ${parameter} to ${espConnections.size} ESPs`);
      break;
    }

    case "start-virtual-esp": {
      startVirtualEsp();
      break;
    }

    case "disconnect-esp": {
      const { espId } = data;
      const espWs = espConnections.get(espId);
      if (espWs) {
        console.log(`[APP] App requested disconnect for ESP: ${espId}`);
        if (espWs.close) espWs.close(1000, "Disconnected by App");
        else if (espWs.terminate) espWs.terminate();
      }
      break;
    }

    case "start-test-plan": {
      const { espId, parameter } = data;
      const espData = espLatestData.get(espId);
      if (!espData) return;
      const paramData = espData.parameters.find(p => p.name === parameter);
      if (!paramData) return;

      const key = `${espId}:${parameter}`;
      activeTestPlans.set(key, { 
        state: 'waiting_for_deviation', 
        startTime: null, 
        duration: null, 
        target: paramData.target, 
        inner: paramData.inner, 
        outer: paramData.outer 
      });
      
      if (appConnection && appConnection.readyState === 1) {
        appConnection.send(JSON.stringify({
          type: "test-plan-update",
          espId,
          parameter,
          state: 'waiting_for_deviation',
          duration: null
        }));
      }
      break;
    }

    case "end-test-plan": {
      const { espId, parameter } = data;
      const key = `${espId}:${parameter}`;
      activeTestPlans.delete(key);
      
      if (appConnection && appConnection.readyState === 1) {
        appConnection.send(JSON.stringify({
          type: "test-plan-update",
          espId,
          parameter,
          state: 'idle',
          duration: null
        }));
      }
      break;
    }

    default:
      console.log(`[APP] Unknown message type: ${data.type}`);
  }
}

function evaluateTestPlans(espId, parameters) {
  parameters.forEach(p => {
    const key = `${espId}:${p.name}`;
    const plan = activeTestPlans.get(key);
    if (!plan) return;

    let updated = false;

    if (plan.state === 'waiting_for_deviation') {
      if (p.current > plan.target + plan.outer || p.current < plan.target - plan.outer) {
        plan.state = 'recording_duration';
        plan.startTime = Date.now();
        updated = true;
      }
    } else if (plan.state === 'recording_duration') {
      if (p.current <= plan.target + plan.inner && p.current >= plan.target - plan.inner) {
        plan.state = 'finished';
        plan.duration = (Date.now() - plan.startTime) / 1000;
        updated = true;
      }
    }

    if (updated) {
      if (appConnection && appConnection.readyState === 1) {
        appConnection.send(JSON.stringify({
          type: "test-plan-update",
          espId,
          parameter: p.name,
          state: plan.state,
          duration: plan.duration
        }));
      }
      if (plan.state === 'finished') {
        activeTestPlans.delete(key);
      }
    }
  });
}

function broadcastEspListToApp() {
  if (!appConnection || appConnection.readyState !== 1) return;

  const esps = [];
  espConnections.forEach((ws, deviceId) => {
    esps.push({
      id: deviceId,
      automatic: manualEspId !== deviceId,
      online: ws.readyState === 1
    });
  });

  appConnection.send(JSON.stringify({
    type: "esp-list",
    esps,
    manualEspId
  }));
}

// === Legacy endpoint (kept for backward compatibility) ===
app.post("/update-values", authenticatePassword, (req, res) => {
  const payload = JSON.stringify(req.body);
  espConnections.forEach((ws, deviceId) => {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  });
  console.log(`Broadcasted ${payload} to ${espConnections.size} ESP connections`);
  res.status(200).send("Values broadcasted to ESP devices");
});

function authenticatePassword(req, res, next) {
  const password = req.headers["x-password"];
  const expectedPassword = process.env.PASSWORD;

  if (password === expectedPassword) {
    next();
  } else {
    console.log("Auth Failed: Rejecting connection.");
    res.status(401).send("Unauthorized");
  }
}

function getWifiAddress() {
  const interfaces = os.networkInterfaces();
  const adapterName = process.env.WIFI_ADAPTER_NAME || "Wi-Fi";

  if (interfaces[adapterName]) {
    for (const info of interfaces[adapterName]) {
      if (info.family === "IPv4" && !info.internal) {
        return info.address;
      }
    }
  }
  return "Adapter not found or no IPv4 assigned";
}

app.use((req, res) => {
  console.log(`404 Not Found`);
  res.status(404).send("Not Found");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Server IP Address: ${getWifiAddress()}:${PORT}`);
  console.log(`Web app available at: http://${getWifiAddress()}:${PORT}`);
});
