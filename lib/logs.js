'use strict';

const { EventEmitter } = require('events');

const logBus = new EventEmitter();
logBus.setMaxListeners(50);

const LOG_BUFFER_SIZE = 200;
const logBuffer = [];

/**
 * Emit a structured log entry to connected clients and the local buffer.
 *
 * @param {'info'|'success'|'warn'|'error'|'cmd'} level - severity ('cmd' for shell commands)
 * @param {string} msg - human-readable message
 * @param {Object} [meta={}] - optional extra fields (action, status, ms, bytes, task, …)
 */
function emitLog(level, msg, meta = {}) {
  const entry = { ts: Date.now(), level, msg, ...meta };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  logBus.emit('log', entry);
}

module.exports = { logBus, logBuffer, LOG_BUFFER_SIZE, emitLog };
