#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

struct Parameter {
    String name;
    float targetValue;
    float innerTolerance;
    float outerTolerance;
    float calibration;
    bool state;

    float (*readFunction)();
    void (*increaseFunction)();
    void (*decreaseFunction)();
};

class Engine {
    private:
        static const int _parameterLimit = 10;

        Parameter _parameters[_parameterLimit];
        int _parameterCount;

        bool inBetween(float x, float minimum, float maximum);
        void takeAction(float target, float current, void (*increase)(), void (*decrease)());
        bool actuate(float current, float target, float innerTolerance, float outerTolerance, void (*increase)(), void (*decrease)(), bool state, float calibration);

    public:
        void registerParameter(String name, float targetValue, float innerTolerance, float outerTolerance, float calibration, float (*readFunction)(), void (*increaseFunction)(), void (*decreaseFunction)());
        void updateFromJSON(String jsonPayload);
        void run(int verbose);
};