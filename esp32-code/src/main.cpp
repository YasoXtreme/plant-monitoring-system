#include <Arduino.h>
#include <DHT.h>

const int increasePin = 12;
const int decreasePin = 14;
const int flowSensorPin = 36; 
const int ldrSensorPin = 34; 
const int soilMoisturePin = 35;

// Variables for pulse counting
volatile long pulseCount = 0;
float flowRate = 0.0;
unsigned int flowMilliLitres = 0;
unsigned long totalMilliLitres = 0;
unsigned long oldTime = 0;

// float temp = 15;

void IRAM_ATTR pulseCounter() {
  pulseCount++;
}
void increaseTemp();
void decreaseTemp();
bool inBetween(float x, float minimum, float maximum);
void takeAction(float target, float current, void (*increase)(), void (*decrease)());
bool actuate(float current, float target, float innerTolerance, float outerTolerance, void (*increase)(), void (*decrease)(), bool state, float calibration = 0);

bool temperatureState = false;
bool sensorState = false;

DHT dht(26, DHT11);

void setup() {
  pinMode(increasePin, OUTPUT);
  pinMode(decreasePin, OUTPUT);
  dht.begin();

  pinMode(flowSensorPin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(flowSensorPin), pulseCounter, FALLING);
  oldTime = millis();
  delay(2000);
  Serial.begin(115200);
}

void loop() {
  // if (temp == 24) sensorState = true;
  // if (temp == 14) sensorState = false;
  
  // if (sensorState) temp -= 0.5;
  // else temp += 0.5;
  
  //Temp & Humidity sensor
  float temp = dht.readTemperature();
  float humidity = dht.readHumidity();

  Serial.print("Temp: ");
  Serial.print(temp);
  Serial.print(" C, Humidity: ");
  Serial.print(humidity);
  Serial.println(" %");
  temperatureState = actuate(temp, 23, 1, 3, increaseTemp, decreaseTemp, temperatureState, 0);
  delay(2000);
  digitalWrite(increasePin, LOW);
  digitalWrite(decreasePin, LOW);

  //Flow rate sensor
    // Calculate flow every 1 second
  if ((millis() - oldTime) > 1000) {
    
    // Disable interrupts while reading/resetting pulseCount to avoid data corruption
    detachInterrupt(digitalPinToInterrupt(flowSensorPin));
    
    // The YF-S201 characteristic: Frequency (Hz) = 7.5 * Q (L/min)
    // Q = pulses / 7.5
    flowRate = (pulseCount / 7.5); 
    
    oldTime = millis();
    
    // Calculate volume passed in this second
    flowMilliLitres = (flowRate / 60) * 1000;
    totalMilliLitres += flowMilliLitres;

    // Print results
    Serial.print("Flow rate: ");
    Serial.print(flowRate);
    Serial.print(" L/min");
    Serial.print("\t Total: ");
    Serial.print(totalMilliLitres);
    Serial.println(" mL");

    // Reset pulse count for the next second
    pulseCount = 0;
    attachInterrupt(digitalPinToInterrupt(flowSensorPin), pulseCounter, FALLING);

    //ldrSensorPin
    int ldrValue = analogRead(ldrSensorPin);
    Serial.print("LDR Value: ");
    Serial.println(ldrValue);

    //soilMoisture
    int soilMoistureValue = analogRead(soilMoisturePin);
    Serial.print("Soil Moisture value: ");
    Serial.println(soilMoistureValue);
}
}

void increaseTemp() {
  digitalWrite(increasePin, HIGH);
}

void decreaseTemp() {
  digitalWrite(decreasePin, HIGH);
}

bool actuate(float current, float target, float innerTolerance, float outerTolerance, void (*increase)(), void (*decrease)(), bool state, float calibration) {
  current += calibration;
  float minimumInner = target - innerTolerance, maximumInner = target + innerTolerance, minimumOuter = target - outerTolerance, maximumOuter = target + outerTolerance;
   
  if (!inBetween(current, minimumOuter, maximumOuter)) {
    state = false;
  }
  else if (inBetween(current, minimumInner, maximumInner)) {
    state = true;
  }

  if (!state) takeAction(target, current, increase, decrease);
  return state;
}

void takeAction(float target, float current, void (*increase)(), void (*decrease)()) {
  if (current > target) decrease();
  if (current < target) increase();
}

bool inBetween(float x, float minimum, float maximum) {
  return (x > minimum && x < maximum);
}