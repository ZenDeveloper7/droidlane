'use strict';

const express = require('express');

/**
 * Logs route: GET /api/logs/stream
 */
module.exports = function logsRoutes({ logBus, logBuffer, startSSE }) {
  const router = express.Router();

  /**
   * GET /api/logs/stream
   * Server-Sent Events stream of structured server log entries.
   * On connect, replays the last LOG_BUFFER_SIZE entries, then streams live.
   *
   * Entry shape: { ts: number, level: string, msg: string, ...meta }
   */
  router.get('/api/logs/stream', (req, res) => {
    startSSE(res);

    // Replay history to the new client
    for (const entry of logBuffer) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const onLog = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
    logBus.on('log', onLog);
    req.on('close', () => logBus.off('log', onLog));
  });

  return router;
};
