#include <Arduino.h>
#include <DHT.h>
#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <math.h>
#include "engine.h"
#include "time.h"

// === Forward Declarations ===
//float readLightSensor();
//float readSoilMoisture();
float readTemperature();
float readHumidity();
float readFlowRate();
void resetTemperature();
void increaseTemperature();
void decreaseTemperature();
void resetHumidity();
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
void timeSync();
void wateringschedule();

//const int SOIL_MOISTURE_PIN = 35;
const int DHT_PIN = 27;
const int FLOW_SENSOR_PIN = 34;
const int LDR_PIN = 36;
const int lamp = 23;
const int fan1 = 19;
const int fan2 = 18;
const int pump = 5;

// Wi-Fi credentials and server details
const char* SSID = "Rosa";
const char* PASSWORD = "12345678";
const char* SERVER_URL = "ws://10.234.171.51:3000/connect-esp";
const char* SERVER_PASSWORD = "SpilledChip9978";

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
    timeSync();
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

    totalMilliLitres = readFlowRate();
    wateringschedule();
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
    pinMode(lamp, OUTPUT);
    pinMode(fan1, OUTPUT);
    pinMode(fan2, OUTPUT);
    pinMode(pump, OUTPUT);
}

void setupEngine() {
    engine.registerParameter("Temperature", 25.0, 1.0, 3.0, 0.0, readTemperature, increaseTemperature, decreaseTemperature, resetTemperature);
    engine.registerParameter("Humidity", 70.0, 5.0, 15.0, 0.0, readHumidity, increaseHumidity, decreaseHumidity, resetHumidity);
    // engine.registerParameter("Soil Moisture", 50.0, 5.0, 20.0, 0.0, readSoilMoisture, increaseSoilMoisture, decreaseSoilMoisture);
    // engine.registerParameter("Light", 300.0, 50.0, 150.0, 0.0, readLightSensor, increaseLight, decreaseLight);
}

float readFlowRate() {
     // Check the flow rate every 1 second (1000 milliseconds)
  if ((millis() - oldTime) > 1000) {
    
    // Temporarily turn off the interrupt so we don't mess up our math
    detachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN));

    // Calculate Flow Rate in Liters per minute
    // Math: (1000ms / time passed) * pulses / calibration factor
    flowRate = ((1000.0 / (millis() - oldTime)) * pulseCount) / CALIBRATION_FACTOR;
    
    // Calculate how many milliliters just passed through
    flowMilliLitres = (flowRate / 60) * 1000;
    
    // Add it to our total volume tracker
    totalMilliLitres += flowMilliLitres;

    // Print the results to the Serial Monitor
    Serial.print("Flow Rate: ");
    Serial.print(flowRate);
    Serial.print(" L/min  |  Total Dispensed: ");
    Serial.print(totalMilliLitres / 1000.0); // Divide by 1000 to show Liters
    Serial.println(" Liters");

    // Reset the pulse counter and timer for the next second
    pulseCount = 0;
    oldTime = millis();

    // Turn the interrupt back on to catch the next pulses
    attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), countPulse, FALLING);
  }
  
  return totalMilliLitres;
}


//float readSoilMoisture() {
//  const int DRY_CALIBRATION_VALUE = 4095;
//  const int WET_CALIBRATION_VALUE = 857;

//  int rawValue = analogRead(SOIL_MOISTURE_PIN);
//  float soilMoisturePercentage = map(rawValue, DRY_CALIBRATION_VALUE, WET_CALIBRATION_VALUE, 0, 100);
//  soilMoisturePercentage = constrain(soilMoisturePercentage, 0, 100);

    //return soilMoisturePercentage;
//}

float readTemperature() {
    return dht.readTemperature();
}

float readHumidity() {
    return dht.readHumidity();
}

//float readLightSensor() {
  //  const float GAMMA = 0.6;
    //const float R10 = 15000.0;
    //const float FIXED_RESISTOR = 10000.0;

    //int rawValue = analogRead(LDR_PIN);
  
    //if (rawValue == 0) return 0.0;
    //if (rawValue == 4095) return 100000.0;

    //float voltage = rawValue * (3.3 / 4095.0);
    //float rLDR = FIXED_RESISTOR * ((3.3 - voltage) / voltage);
    //float lux = 10.0 * pow((R10 / rLDR), (1.0 / GAMMA));

    //return lux;
//}

void resetTemperature() {
    digitalWrite(lamp, HIGH);
    digitalWrite(fan2, HIGH);
    Serial.println("[Action] Resetting temperature controls");
}

void increaseTemperature() {
     digitalWrite(lamp, LOW);
     Serial.println("[Action] Increasing temperature (e.g., turning on heater)");
}

void decreaseTemperature() {
    digitalWrite(fan2, LOW);
    Serial.println("[Action] Decreasing temperature (e.g., turning on fan)");
}

void resetHumidity() {
    digitalWrite(fan1, HIGH);
    Serial.println("[Action] Resetting humidity controls");
}

void increaseHumidity() {
     digitalWrite(fan1, LOW);
     Serial.println("[Action] Increasing humidity (e.g., turning on humidifier)");
}

void decreaseHumidity() {
    Serial.println("[Action] Decreasing humidity (e.g., turning on dehumidifier)");
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

void timeSync() {
    // Verify WiFi is actually connected before attempting NTP sync
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi not connected. Skipping time synchronization.");
        return;
    }
    
    Serial.println("Starting time synchronization with NTP server...");
    // Use multiple NTP servers for better reliability
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer, "pool.ntp.org", "time.nist.gov");
    
    Serial.println("Waiting for time synchronization...");
    struct tm timeinfo;
    time_t start = time(nullptr);
    const time_t timeout = 15; // 15 second timeout
    
    while (!getLocalTime(&timeinfo)) {
        // Check timeout
        if (time(nullptr) - start > timeout) {
            Serial.println("\nTime synchronization FAILED - Timeout after 15 seconds");
            Serial.println("Check: NTP server reachability, WiFi stability, and system clock");
            return;
        }
        Serial.print(".");
        delay(1000);
    }
    
    Serial.println("\nTime successfully synchronized!");
    Serial.println(&timeinfo, "Current time: %A, %B %d %Y %H:%M:%S");
}

void wateringschedule() {
        struct tm timeinfo;
  
  // If we can't get the time, wait and try again
  if (!getLocalTime(&timeinfo)) {
    Serial.println("Failed to obtain time");
    delay(2000);
    return;
  }

  // Print the current time to the Serial Monitor (for debugging)
  Serial.println(&timeinfo, "Current Time: %H:%M:%S");

  // Get current hour and minute
  int currentHour = timeinfo.tm_hour;
  int currentMinute = timeinfo.tm_min;

  // Calculate when watering should end
  int wateringEndMinute = WATERING_START_MINUTE + WATERING_DURATION;

  // Check if current time falls within our watering window
  if (currentHour == WATERING_HOUR && currentMinute >= WATERING_START_MINUTE && currentMinute < wateringEndMinute) {
  
    if(totalMilliLitres < 100){
          Serial.println("Watering schedule ACTIVE! Pump is ON.");
        digitalWrite(pump, LOW); // Turn pump ON
    }else {
        Serial.println("Watering limit reached. Pump is OFF.");
        digitalWrite(pump, HIGH);  // Turn pump OFF
    }
  } else {
    Serial.println("Watering schedule INACTIVE. Pump is OFF.");
    digitalWrite(pump, HIGH);  // Turn pump OFF
    totalMilliLitres = 0; // Reset total water dispensed for the next watering cycle
  }
}
