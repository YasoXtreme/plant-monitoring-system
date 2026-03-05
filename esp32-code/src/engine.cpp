#include "Engine.h"

// === Private helpers ====

bool Engine::inBetween(float x, float minimum, float maximum) {
    return (x > minimum && x < maximum);
}

void Engine::takeAction(float target, float current, void (*increase)(), void (*decrease)()) {
    if (current > target) decrease();
    if (current < target) increase();
}

bool Engine::actuate(float current, float target, float innerTolerance, float outerTolerance, void (*increase)(), void (*decrease)(), bool state, float calibration) {
    current += calibration;
    float minimumInner = target - innerTolerance, maximumInner = target + innerTolerance, minimumOuter = target - outerTolerance, maximumOuter = target + outerTolerance;

    // Force FALSE if outside outer bounds. Force TRUE if inside inner bounds. Otherwise, hold current state.
    state = inBetween(current, minimumOuter, maximumOuter) && (inBetween(current, minimumInner, maximumInner) || state);

    if (!state) takeAction(target, current, increase, decrease);
    return state;
}

// === Public Methods ===

void Engine::registerParameter(String name, float targetValue, float innerTolerance, float outerTolerance, float calibration, float (*readFunction)(), void (*increaseFunction)(), void (*decreaseFunction)()) {
    if (_parameterCount >= _parameterLimit) return;
    _parameters[_parameterCount++] = {name, targetValue, innerTolerance, outerTolerance, calibration, false, readFunction, increaseFunction, decreaseFunction};
    Serial.println("[Engine] Registered parameter: " + name);
}

void Engine::updateFromJSON(String jsonPayload) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, jsonPayload);
    
    if (!error && doc.containsKey("parameter")) {
        String paramName = doc["parameter"].as<String>();
        
        for (int i = 0; i < _parameterCount; i++) {
            if (_parameters[i].name == paramName) {
                if (doc.containsKey("target")) _parameters[i].targetValue = doc["target"];
                if (doc.containsKey("inner")) _parameters[i].innerTolerance = doc["inner"];
                if (doc.containsKey("outer")) _parameters[i].outerTolerance = doc["outer"];
            
                Serial.println("[Engine] Updated `" + paramName + "` target to " + jsonPayload);
                return;
            }
        }
    }
}

void Engine::run(int verbose) {
    for (int i = 0; i < _parameterCount; i++) {
        float currentValue = _parameters[i].readFunction();
        _parameters[i].state = actuate(currentValue, _parameters[i].targetValue, _parameters[i].innerTolerance, _parameters[i].outerTolerance, _parameters[i].increaseFunction, _parameters[i].decreaseFunction, _parameters[i].state, _parameters[i].calibration);
        if (verbose > 0) {
            Serial.println("[Engine] " + _parameters[i].name + ": " + String(currentValue));
        }
    }
    if (verbose > 0) Serial.println("-----------------------------");
}