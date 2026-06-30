// backend/src/routes/logRoutes.js
const express = require('express');
const router = express.Router();
const logsController = require('../controllers/logsController');

// 1. GET: Fetch logs with support for filters
router.get('/', logsController.getAllLogs);

// 2. POST: Add a new activity entry (Engineer Acknowledgments)
router.post('/add', logsController.createLogEntry);

module.exports = router;