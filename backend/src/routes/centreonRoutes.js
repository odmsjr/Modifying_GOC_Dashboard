const express = require('express');
const router = express.Router();
const centreonController = require('../controllers/centreonController');

// Host endpoints
router.get('/hosts/status/all', centreonController.getHostStatus);
router.get('/hosts', centreonController.getAllHosts);
router.get('/hosts/:id', centreonController.getHostById);

// Poller endpoints
router.get('/pollers', centreonController.getAllPollers);
router.get('/pollers/:pollerId/hosts', centreonController.getPollerHosts);
router.get('/pollers/:pollerId/services/summary', centreonController.getPollerServiceSummary);

// Temporary test endpoint for real Centreon poller names
router.get('/test-monitoring-servers', centreonController.testMonitoringServers);

// Service endpoints
router.get('/services/search', centreonController.searchServicesGlobally);
router.get('/services/status/summary', centreonController.getServiceStatusSummary);
router.get('/services', centreonController.getAllServices);
router.get('/services/host/:hostId', centreonController.getServicesByHost);

module.exports = router;