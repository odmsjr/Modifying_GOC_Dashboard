const express = require("express");
const router = express.Router();

const {
    getAllTeams,
    getTeamById,
    getTeamSummary,
    getTeamSummaryByMonth,
    getTeamSummaryByDateRange
} = require("../controllers/teamController");

router.get("/", getAllTeams);
router.get("/summary", getTeamSummary);
router.get("/summary/monthly", getTeamSummaryByMonth);
router.get("/summary/range", getTeamSummaryByDateRange);
router.get("/:id", getTeamById);

module.exports = router;