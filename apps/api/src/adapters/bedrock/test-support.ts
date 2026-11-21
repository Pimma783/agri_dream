// Test-support entry point. Only tests, seeds for local UI work and the acceptance script's mock mode
// import this; src/adapters/bedrock/select.ts and the production wiring must not.
export { MockBedrock, INJECTION_TEXT } from './mock.js';
export type { MockStep } from './mock.js';
