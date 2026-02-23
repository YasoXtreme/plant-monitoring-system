#include <WiFi.h>
#include <ArduinoWebsockets.h>

const char* ssid = "Yaso's A15";
const char* password = "SpilledChip9978";

const char* websockets_server = "ws://192.168.1.XXX:3000/connect-esp"; 

const char* server_password = "YOUR_SECRET_PASSWORD"; 

using namespace websockets;
WebsocketsClient client;

void connectToWebSocket();

void setup() {
  Serial.begin(115200);
  Serial.println("Starting ESP32...");

  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  client.onMessage([](WebsocketsMessage message) {
    Serial.print("Received Data: ");
    Serial.println(message.data());
  });

  client.onEvent([](WebsocketsEvent event, String data) {
    if(event == WebsocketsEvent::ConnectionOpened) {
      Serial.println("WebSocket Connection Opened!");
    } else if(event == WebsocketsEvent::ConnectionClosed) {
      Serial.println("WebSocket Connection Closed!");
    }
  });

  connectToWebSocket();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi dropped! Waiting for reconnect...");
    delay(5000);
    return;
  }

  if (client.available()) {
    client.poll();
  } else {
    Serial.println("WebSocket disconnected. Attempting to reconnect in 5 seconds...");
    delay(5000);
    connectToWebSocket();
  }
}

void connectToWebSocket() {
  String macAddress = WiFi.macAddress();
  Serial.print("My Device ID (MAC): ");
  Serial.println(macAddress);

  client.addHeader("x-password", server_password);
  client.addHeader("x-device-id", macAddress);

  Serial.println("Connecting to Node.js server...");
  bool connected = client.connect(websockets_server);
  
  if (connected) {
    Serial.println("Successfully connected to the server!");    
  } else {
    Serial.println("Failed to connect to the server.");
  }
}