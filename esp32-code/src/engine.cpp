#include "Engine.h"

// === Private helpers ====

bool Engine::inBetween(float x, float minimum, float maximum) {
    return (x > minimum && x < maximum);
}

int Engine::takeAction(float target, float current, void (*increase)(), void (*decrease)(), void (*reset)(), int direction) {
    int desiredDirection = 0;
    if (current > target) desiredDirection = -1;
    if (current < target) desiredDirection = 1;

    if (desiredDirection != direction) {
        if (desiredDirection == 1) increase();
        else if (desiredDirection == -1) decrease();
        else reset();
    }

    return desiredDirection;
}

ActuationResults Engine::actuate(float current, float target, float innerTolerance, float outerTolerance, void (*increase)(), void (*decrease)(), void (*reset)(), bool state, int direction, float calibration) {
    current += calibration;
    float minimumInner = target - innerTolerance, maximumInner = target + innerTolerance, minimumOuter = target - outerTolerance, maximumOuter = target + outerTolerance;

    // Force FALSE if outside outer bounds. Force TRUE if inside inner bounds. Otherwise, hold current state.
    bool newState = inBetween(current, minimumOuter, maximumOuter) && (inBetween(current, minimumInner, maximumInner) || state);

    if (state && !newState) {
        direction = 0;
    }
    
    state = newState;

    if (!state) direction = takeAction(target, current, increase, decrease, reset, direction);
    else reset();
    
    return {state, direction};
}

// === Public Methods ===

void Engine::registerParameter(String name, float targetValue, float innerTolerance, float outerTolerance, float calibration, float (*readFunction)(), void (*increaseFunction)(), void (*decreaseFunction)(), void (*resetFunction)(), String increaseName, String decreaseName) {
    if (_parameterCount >= _parameterLimit) return;
    _parameters[_parameterCount++] = {name, targetValue, innerTolerance, outerTolerance, calibration, false, 0, increaseName, decreaseName, readFunction, increaseFunction, decreaseFunction, resetFunction, false, false};
    Serial.println("[Engine] Registered parameter: " + name);
}

void Engine::updateFromJSON(String jsonPayload) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, jsonPayload);
    
    if (error) return;

    // Handle message types
    String type = doc["type"] | "update-values";

    if (type == "set-automatic") {
        automaticMode = doc["automatic"] | true;
        Serial.println("[Engine] Automatic mode set to: " + String(automaticMode ? "ON" : "OFF"));
        // When switching mode, reset all actuators
        for (int i = 0; i < _parameterCount; i++) {
            _parameters[i].manualIncreaseActive = false;
            _parameters[i].manualDecreaseActive = false;
            _parameters[i].resetFunction();
        }
        return;
    }

    if (type == "toggle-actuator") {
        String paramName = doc["parameter"] | "";
        String actuator = doc["actuator"] | "";
        bool active = doc["active"] | false;
        setActuator(paramName, actuator, active);
        return;
    }

    // Default: update-values (also handles legacy messages without type)
    if (doc.containsKey("parameter")) {
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

void Engine::setActuator(String parameter, String actuator, bool active) {
    for (int i = 0; i < _parameterCount; i++) {
        if (_parameters[i].name == parameter) {
            if (actuator == "increase") {
                _parameters[i].manualIncreaseActive = active;
                if (active) {
                    _parameters[i].increaseFunction();
                } else {
                    _parameters[i].resetFunction();
                }
            } else if (actuator == "decrease") {
                _parameters[i].manualDecreaseActive = active;
                if (active) {
                    _parameters[i].decreaseFunction();
                } else {
                    _parameters[i].resetFunction();
                }
            }
            Serial.println("[Engine] Manual actuator `" + actuator + "` for `" + parameter + "` set to: " + String(active ? "ON" : "OFF"));
            return;
        }
    }
}

String Engine::toJSON() {
    JsonDocument doc;
    doc["type"] = "sensor-data";
    JsonArray params = doc["parameters"].to<JsonArray>();

    for (int i = 0; i < _parameterCount; i++) {
        float currentValue = _parameters[i].readFunction();

        JsonObject p = params.add<JsonObject>();
        p["name"] = _parameters[i].name;
        p["current"] = serialized(String(currentValue, 1));
        p["target"] = _parameters[i].targetValue;
        p["inner"] = _parameters[i].innerTolerance;
        p["outer"] = _parameters[i].outerTolerance;
        p["state"] = _parameters[i].state;
        p["direction"] = _parameters[i].direction;

        JsonArray actuators = p["actuators"].to<JsonArray>();

        // Add increase actuator
        JsonObject inc = actuators.add<JsonObject>();
        inc["role"] = "increase";
        inc["name"] = _parameters[i].increaseName;
        if (automaticMode) {
            inc["active"] = (_parameters[i].direction == 1);
        } else {
            inc["active"] = _parameters[i].manualIncreaseActive;
        }

        // Add decrease actuator (only if it has a name)
        if (_parameters[i].decreaseName.length() > 0) {
            JsonObject dec = actuators.add<JsonObject>();
            dec["role"] = "decrease";
            dec["name"] = _parameters[i].decreaseName;
            if (automaticMode) {
                dec["active"] = (_parameters[i].direction == -1);
            } else {
                dec["active"] = _parameters[i].manualDecreaseActive;
            }
        }
    }

    String output;
    serializeJson(doc, output);
    return output;
}

void Engine::run(int verbose) {
    for (int i = 0; i < _parameterCount; i++) {
        float currentValue = _parameters[i].readFunction();

        if (automaticMode) {
            ActuationResults results = actuate(currentValue, _parameters[i].targetValue, _parameters[i].innerTolerance, _parameters[i].outerTolerance, _parameters[i].increaseFunction, _parameters[i].decreaseFunction, _parameters[i].resetFunction, _parameters[i].state, _parameters[i].direction, _parameters[i].calibration);
            _parameters[i].state = results.state;
            _parameters[i].direction = results.direction;
        }
        // In manual mode, actuators are controlled directly via setActuator — we just read sensors

        if (verbose > 0) {
            Serial.println("[Engine] " + _parameters[i].name + ": " + String(currentValue));
        }
    }
    if (verbose > 0) Serial.println("-----------------------------");
}