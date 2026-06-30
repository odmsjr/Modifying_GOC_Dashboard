const teamModel = require("../models/teamModel");

const getAllTeams = async (req, res, next) => {
    try {
        const teams = await teamModel.getAllTeams();

        res.json({
            success: true,
            count: teams.length,
            data: teams
        });
    } catch (error) {
        next(error);
    }
};

const getTeamById = async (req, res, next) => {
    try {
        const team = await teamModel.getTeamById(req.params.id);

        if (!team) {
            return res.status(404).json({
                success: false,
                message: "Team not found"
            });
        }

        res.status(200).json({
            success: true,
            data: team
        });
    } catch (error) {
        next(error);
    }
};

const getTeamSummary = async (req, res, next) => {
    try {
        const summary = await teamModel.getTeamSummary();

        res.status(200).json({
            success: true,
            data: summary
        });
    } catch (error) {
        next(error);
    }
};

const getTeamSummaryByMonth = async (req, res, next) => {
    try {
        const summary = await teamModel.getTeamSummaryByMonth();

        res.status(200).json({
            success: true,
            data: summary
        });
    } catch (error) {
        next(error);
    }
};

const getTeamSummaryByDateRange = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        const summary = await teamModel.getTeamSummaryByDateRange(startDate, endDate);

        res.status(200).json({
            success: true,
            data: summary
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAllTeams,
    getTeamById,
    getTeamSummary,
    getTeamSummaryByMonth,
    getTeamSummaryByDateRange
};
