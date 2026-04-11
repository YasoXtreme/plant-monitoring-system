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

    float (*readFunction)();
    void (*increaseFunction)();
    void (*decreaseFunction)();
    void (*resetFunction)();
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
        void registerParameter(String name, float targetValue, float innerTolerance, float outerTolerance, float calibration, float (*readFunction)(), void (*increaseFunction)(), void (*decreaseFunction)(), void (*resetFunction)());
        void updateFromJSON(String jsonPayload);
        void run(int verbose);
};