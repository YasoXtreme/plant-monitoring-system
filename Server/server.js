const express = require("express");
require("dotenv").config({ quiet: true });
const os = require("os");

const app = express();
require("express-ws")(app);
const PORT = process.env.PORT || 3000;

const espConnections = new Map();

app.use(express.json());

app.use((req, res, next) => {
  console.log(
    `[TRAFFIC] ${req.method} request to "${req.url}" from ${req.socket.remoteAddress}`,
  );
  next();
});

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

  ws.on("close", () => {
    console.log(`-> 🔌 WebSocket connection closed for ESP: ${deviceId}`);
    if (espConnections.get(deviceId) === ws) {
      espConnections.delete(deviceId);
    }
  });
});

/*
  Expects: {
    "parameter": "parameter name",
    "target": target_value,
    "inner": inner_tolernace,
    "outer": outer_tolerance
  }
*/

app.post("/update-values", authenticatePassword, (req, res) => {
  broadcastToESP(req.body);
  res.status(200).send("Values broadcasted to ESP devices");
});

function broadcastToESP(data = {}) {
  if (espConnections.size === 0) {
    console.log("No ESP connections available to broadcast");
    return;
  }

  espConnections.forEach((ws, deviceId) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  });

  console.log(
    `Broadcasted ${JSON.stringify(data)} to ${espConnections.size} ESP connections`,
  );
}

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
});
