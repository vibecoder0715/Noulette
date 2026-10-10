// Registers feature modules (API routes, MCP tools, daemon ticks). Imported by the CLI entry and tests.
import './daemon/api.js';
import './guard/index.js';
import './monitor/index.js';
import './plans/index.js';
