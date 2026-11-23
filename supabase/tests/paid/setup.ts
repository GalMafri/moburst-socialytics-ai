// Every test file starts with the paying desk on a test meter (testMeter.ts),
// so no test reaches the database or reads a provider key through it.
import { useTestMeter } from "./testMeter";

useTestMeter();
