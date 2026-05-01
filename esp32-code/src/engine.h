#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

struct ActuationResults {
    bool state;
    int direction;
};

struct Parameter {
    String name;
    float targetValue;
    float innerTolerance;
    float outerTolerance;
    float calibration;
    bool state;
    int direction; 

    String increaseName;
    String decreaseName;

    float (*readFunction)();
    void (*increaseFunction)();
    void (*decreaseFunction)();
    void (*resetFunction)();

    // Manual actuator overrides
    bool manualIncreaseActive;
    bool manualDecreaseActive;
};

class Engine {
    private:
        static const int _parameterLimit = 10;

        Parameter _parameters[_parameterLimit];
        int _parameterCount;

        bool inBetween(float x, float minimum, float maximum);
        int takeAction(float target, float current, void (*increase)(), void (*decrease)(), void (*reset)(), int direction);
        ActuationResults actuate(float current, float target, float innerTolerance, float outerTolerance, void (*increase)(), void (*decrease)(), void (*reset)(), bool state, int direction, float calibration);

    public:
        bool automaticMode = true;

        void registerParameter(String name, float targetValue, float innerTolerance, float outerTolerance, float calibration, float (*readFunction)(), void (*increaseFunction)(), void (*decreaseFunction)(), void (*resetFunction)(), String increaseName, String decreaseName);
        void updateFromJSON(String jsonPayload);
        void setActuator(String parameter, String actuator, bool active);
        String toJSON();
        void run(int verbose);
};