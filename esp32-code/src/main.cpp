#include <Arduino.h>
#include <DHT.h>
#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <math.h>
#include "engine.h"

float readLightSensor();
float readSoilMoisture();
float readTemperature();
float readHumidity();
float readFlowRate();
void increaseTemperature();
void decreaseTemperature();
void increaseHumidity();
void decreaseHumidity();
void increaseSoilMoisture();
void decreaseSoilMoisture();
void increaseLight();
void decreaseLight();
void increaseFlowRate();
void decreaseFlowRate();
void setupEngine();
void setupPins();
void connectWifi();
void setupWebsocket();
void connectToWebSocket();

const int DHT_PIN = 13;
const int LDR_PIN = 34;
const int SOIL_MOISTURE_PIN = 35;
const int FLOW_SENSOR_PIN = 36;

const char* SSID = "Yaso's A15";
const char* PASSWORD = "SpilledChip9978";
const char* SERVER_URL = "ws://10.192.141.51:3000/connect-esp";
const char* SERVER_PASSWORD = "SpilledChip9978";

volatile int pulseCount = 0;
const int CONNECTION_ATTEMPTS_BEFORE_START = 20;

DHT dht(DHT_PIN, DHT11);
Engine engine;

using namespace websockets;
WebsocketsClient client;

void IRAM_ATTR countPulse() {
    pulseCount++;
}

void setup() {
    dht.begin();
    Serial.begin(115200);

    connectWifi();
    setupWebsocket();
    connectToWebSocket();
    setupPins();
    setupEngine();
}

void loop() {
    engine.run(1);
    if (WiFi.status() == WL_CONNECTED) {
         if (client.available()) {
            client.poll();
        } else {
            Serial.println("WebSocket disconnected. Attempting to reconnect.");
            connectToWebSocket();
        }
    } 
    delay(1000);
}

void connectToWebSocket() {
    if (WiFi.status() != WL_CONNECTED) return;
    Serial.println("Connecting to Node.js server...");
    bool connected = client.connect(SERVER_URL);
  
    if (connected) {
        Serial.println("Successfully connected to the server!");    
    } else {
        Serial.println("Failed to connect to the server.");
    }
}

void setupWebsocket() {
    client.onMessage([](WebsocketsMessage message) {
        Serial.print("Received Data: ");
        Serial.println(message.data());
        engine.updateFromJSON(message.data());
    });

    client.onEvent([](WebsocketsEvent event, String data) {
        if(event == WebsocketsEvent::ConnectionOpened) {
            Serial.println("WebSocket Connection Opened!");
        } else if(event == WebsocketsEvent::ConnectionClosed) {
            Serial.println("WebSocket Connection Closed!");
        }
    });

    String macAddress = WiFi.macAddress();
    Serial.print("My Device ID (MAC): ");
    Serial.println(macAddress);

    client.addHeader("x-password", SERVER_PASSWORD);
    client.addHeader("x-device-id", macAddress);

}

void connectWifi() {
    WiFi.begin(SSID, PASSWORD);
    Serial.print("Connecting to Wi-Fi");
    for (int i = 0; i < CONNECTION_ATTEMPTS_BEFORE_START; i++)
    {
        if (WiFi.status() == WL_CONNECTED) break;
        Serial.print(".");
        delay(500);
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWi-Fi Connected!");
        Serial.println("IP Address: " + String(WiFi.localIP()));
    } else {
        Serial.println("\nTimed Out!!");
    }
}

void setupPins() {
    pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), countPulse, FALLING);
}

void setupEngine() {
    engine.registerParameter("Temperature", 25.0, 1.0, 3.0, 0.0, readTemperature, increaseTemperature, decreaseTemperature);
    engine.registerParameter("Humidity", 60.0, 5.0, 15.0, 0.0, readHumidity, increaseHumidity, decreaseHumidity);
    engine.registerParameter("Soil Moisture", 50.0, 5.0, 20.0, 0.0, readSoilMoisture, increaseSoilMoisture, decreaseSoilMoisture);
    engine.registerParameter("Light", 300.0, 50.0, 150.0, 0.0, readLightSensor, increaseLight, decreaseLight);
    engine.registerParameter("Flow Rate", 0.1, 0.2, 0.5, 0.0, readFlowRate, increaseFlowRate, decreaseFlowRate);
}

float readFlowRate() {
    noInterrupts();
    int count = pulseCount;
    pulseCount = 0;
    interrupts();

    float flowRate = (count / 7.5);
    return flowRate;
}

float readSoilMoisture() {
    const int DRY_CALIBRATION_VALUE = 4095;
    const int WET_CALIBRATION_VALUE = 857;

    int rawValue = analogRead(SOIL_MOISTURE_PIN);
    float soilMoisturePercentage = map(rawValue, DRY_CALIBRATION_VALUE, WET_CALIBRATION_VALUE, 0, 100);
    soilMoisturePercentage = constrain(soilMoisturePercentage, 0, 100);

    return soilMoisturePercentage;
}

float readTemperature() {
    return dht.readTemperature();
}

float readHumidity() {
    return dht.readHumidity();
}

float readLightSensor() {
    const float GAMMA = 0.6;
    const float R10 = 15000.0;
    const float FIXED_RESISTOR = 10000.0;

    int rawValue = analogRead(LDR_PIN);
  
    if (rawValue == 0) return 0.0;
    if (rawValue == 4095) return 100000.0;

    float voltage = rawValue * (3.3 / 4095.0);
    float rLDR = FIXED_RESISTOR * ((3.3 - voltage) / voltage);
    float lux = 10.0 * pow((R10 / rLDR), (1.0 / GAMMA));

    return lux;
}

void increaseTemperature() {
    // Serial.println("[Action] Increasing temperature (e.g., turning on heater)");
}

void decreaseTemperature() {
    // Serial.println("[Action] Decreasing temperature (e.g., turning off heater)");
}

void increaseHumidity() {
    // Serial.println("[Action] Increasing humidity (e.g., turning on humidifier)");
}

void decreaseHumidity() {
    // Serial.println("[Action] Decreasing humidity (e.g., turning off humidifier)");
}

void increaseSoilMoisture() {
    // Serial.println("[Action] Increasing soil moisture (e.g., watering)");
}

void decreaseSoilMoisture() {
    // Serial.println("[Action] Decreasing soil moisture (e.g., stopping watering)");
}

void increaseLight() {
    // Serial.println("[Action] Increasing light (e.g., turning on lights)");
}

void decreaseLight() {
    // Serial.println("[Action] Decreasing light (e.g., turning off lights)");
}

void increaseFlowRate() {
    // Serial.println("[Action] Increasing flow rate (e.g., turning on pump)");
}

void decreaseFlowRate() {
    // Serial.println("[Action] Decreasing flow rate (e.g., turning off pump)");
}