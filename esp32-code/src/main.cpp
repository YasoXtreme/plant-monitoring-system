#include <Arduino.h>
#include <DHT.h>

int increasePin = 12;
int decreasePin = 14;
// float temp = 15;

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
  delay(2000);
  Serial.begin(115200);
}

void loop() {
  // if (temp == 24) sensorState = true;
  // if (temp == 14) sensorState = false;
  
  // if (sensorState) temp -= 0.5;
  // else temp += 0.5;
  
  float temp = dht.readTemperature();
  float humidity = dht.readHumidity();

  Serial.print("Temp: ");
  Serial.print(temp);
  Serial.print(" C, Humidity: ");
  Serial.print(humidity);
  Serial.println(" %");
  temperatureState = actuate(temp, 23, 1, 3, increaseTemp, decreaseTemp, temperatureState, 0);
  Serial.println(temp, !temperatureState);
  delay(2000);
  digitalWrite(increasePin, LOW);
  digitalWrite(decreasePin, LOW);
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