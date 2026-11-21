// Baler channel handler (task 9.10). Shared behavior lives in dashboard.ts.
import { createDashboardHandler, type DashboardHandlerDeps } from './dashboard.js';
import type { LineChannelHandler } from './types.js';
export type BalerHandlerDeps = DashboardHandlerDeps;
export const createBalerHandler = (deps: DashboardHandlerDeps): LineChannelHandler => createDashboardHandler('baler', deps);
