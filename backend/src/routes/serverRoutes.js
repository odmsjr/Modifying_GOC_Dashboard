const express = require("express");
const router = express.Router();

const {
    getAllServers,
    getServerById,
    getServerSummary,
    getServerEnvironment
} = require("../controllers/serverController");

router.get("/", getAllServers);
router.get("/:id", getServerById);
router.get("/summary", getServerSummary);
router.get("/environment/:environment", getServerEnvironment);

module.exports = router;