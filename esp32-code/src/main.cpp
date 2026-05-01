#include <Arduino.h>
#include <DHT.h>
#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <math.h>
#include "engine.h"
#include "time.h"

// === Forward Declarations ===
float readTemperature();
void resetTemperature();
void increaseTemperature();
void decreaseTemperature();
void increaseSoilMoisture();
void decreaseSoilMoisture();
void increaseLight();
void decreaseLight();
void setupEngine();
void setupPins();
void connectWifi();
void setupWebsocket();
void connectToWebSocket();
void resetSoilMoisture();
void resetLight();
float readLightSensor();
float readSoilMoisture();

const int SOIL_MOISTURE_PIN = 35;
const int DHT_PIN = 27;
const int FLOW_SENSOR_PIN = 34;
const int LDR_PIN = 36;
const int FAN_PIN = 18;
const int WHITE_LAMP_PIN = 19;
const int HEAT_LAMP_PIN = 5;
const int PUMPING_MOTOR_PIN = 23;

// Wi-Fi credentials and server details
const char* SSID = "Yaso's A15";
const char* PASSWORD = "SpilledChip9978";
const char* SERVER_URL = "ws://10.224.227.25:3000/connect-esp";
const char* SERVER_PASSWORD = "1234";

// === timezone settings for NTP ===
const char* ntpServer = "pool.ntp.org"; 
const long  gmtOffset_sec = 7200;  // 2 hours * 3600 seconds
// Set to 3600 if your country observes Daylight Saving Time (DST), otherwise 0
const int   daylightOffset_sec = 0; 

//Watering Schedule 
const int WATERING_HOUR = 4;        // 8 AM (Use 24-hour format: 14 = 2 PM)
const int WATERING_START_MINUTE = 30; // Start at 8:00 AM
const int WATERING_DURATION = 2;       // Water for 2 minutes
volatile int pulseCount = 0;
float flowRate = 0.0;
int flowMilliLitres = 0;
float totalMilliLitres = 0;
long oldTime = 0;
const float CALIBRATION_FACTOR = 7.5; // 7.5 is standard for YF-S201 sensors

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
    delay(2000); // Wait a moment to ensure WiFi connection is stable before proceeding
    
    setupWebsocket();
    connectToWebSocket();
    setupPins();
    setupEngine();
}

void loop() {
    engine.run(1);

    // Send sensor data to server every loop
    if (WiFi.status() == WL_CONNECTED) {
        if (client.available()) {
            client.poll();
            String data = engine.toJSON();
            client.send(data);
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
    pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP); // Use internal pull-up resistor for flow sensor input
    attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), countPulse, FALLING);
    pinMode(FAN_PIN, OUTPUT);
    pinMode(WHITE_LAMP_PIN, OUTPUT);
    pinMode(HEAT_LAMP_PIN, OUTPUT);
    pinMode(PUMPING_MOTOR_PIN, OUTPUT);
    pinMode(SOIL_MOISTURE_PIN, INPUT);
    pinMode(LDR_PIN, INPUT);
    
}

void setupEngine() {
    engine.registerParameter("Temperature", 17.0, 1.0, 3.0, 0.0, readTemperature, increaseTemperature, decreaseTemperature, resetTemperature, "Heat Lamp", "DC Fan");
    engine.registerParameter("Soil Moisture", 50.0, 5.0, 20.0, 0.0, readSoilMoisture, increaseSoilMoisture, decreaseSoilMoisture, resetSoilMoisture, "Water Pump", "");
    engine.registerParameter("Light", 300.0, 50.0, 150.0, 0.0, readLightSensor, increaseLight, decreaseLight, resetLight, "White Lamp", "");
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

float readLightSensor() {
    const float GAMMA = 0.6;
    const float R10 = 15000.0;
    const float FIXED_RESISTOR = 10000.0;
    const float MAX_VOLTAGE = 5;

    int rawValue = analogRead(LDR_PIN);
  
    if (rawValue == 0) return 0.0;
    if (rawValue == 4095) return 100000.0;

    float voltage = rawValue * (MAX_VOLTAGE / 4095.0);
    float rLDR = FIXED_RESISTOR * ((MAX_VOLTAGE - voltage) / voltage);
    float lux = 10.0 * pow((R10 / rLDR), (1.0 / GAMMA));

    return lux;
}

void resetTemperature() {
    digitalWrite(FAN_PIN, HIGH);
    digitalWrite(HEAT_LAMP_PIN, HIGH);
    Serial.println("[Action] Resetting temperature controls");
}

void increaseTemperature() {
     digitalWrite(FAN_PIN, LOW);
     Serial.println("[Action] Increasing temperature (e.g., turning on heater)");
}

void decreaseTemperature() {
    digitalWrite(HEAT_LAMP_PIN, LOW);
    Serial.println("[Action] Decreasing temperature (e.g., turning on fan)");
}

void increaseSoilMoisture() {
    Serial.println("[Action] Increasing soil moisture (e.g., watering)");
    digitalWrite(PUMPING_MOTOR_PIN, LOW);
}

void decreaseSoilMoisture() {
    Serial.println("[Action] Decreasing soil moisture (e.g., stopping watering)");
    digitalWrite(PUMPING_MOTOR_PIN, HIGH);
}

void increaseLight() {
    Serial.println("[Action] Increasing light (e.g., turning on lights)");
    digitalWrite(WHITE_LAMP_PIN, LOW);
}

void decreaseLight() {
    Serial.println("[Action] Decreasing light (e.g., turning off lights)");
    digitalWrite(WHITE_LAMP_PIN, HIGH);
}

void resetSoilMoisture() {
    Serial.println("[Action] Resetting soil moisture controls");
    digitalWrite(PUMPING_MOTOR_PIN, HIGH);
}

void resetLight() {
    Serial.println("[Action] Resetting light controls");
    digitalWrite(WHITE_LAMP_PIN, HIGH);
}
