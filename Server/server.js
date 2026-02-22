const express = require("express");
require("dotenv").config({ quiet: true });
const os = require("os");

const app = express();
require("express-ws")(app);
const PORT = process.env.PORT || 3000;

let nextConnectionId = 1;
let espConnections = [];

app.use(express.json());

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`LAN Address: ${getWifiAddress()}:${PORT}`);
});

app.ws("/connect-esp", authenticatePassword, (ws, req) => {
  espConnections.push(ws);
  ws.connectionId = nextConnectionId++;
  console.log(
    `Connection ${ws.connectionId} established with ESP ${req.socket.remoteAddress}`,
  );

  ws.on("close", () => {
    console.log(`WebSocket connection ${ws.connectionId} closed`);
    espConnections = espConnections.filter((conn) => conn !== ws);
  });
});

app.post("/update-values", authenticatePassword, (req, res) => {
  broadcastToESP(req.body);
  res.status(200).send("Values broadcasted to ESP devices");
});

function broadcastToESP(data = {}) {
  if (espConnections.length === 0) {
    console.log("No ESP connections available to broadcast");
    return;
  }

  espConnections.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  });
  console.log(
    `Broadcasted ${JSON.stringify(data)} to ${espConnections.length} ESP connections`,
  );
}

function authenticatePassword(req, res, next) {
  const password = req.headers["x-password"];
  if (password === process.env.PASSWORD) {
    next();
  } else {
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
