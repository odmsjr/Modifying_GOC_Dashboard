const serverModel = require("../models/serverModel");

const getAllServers = async (req, res, next) => {
    try {
        const servers = await serverModel.getAllServers();

        res.json({
            success: true,
            count: servers.length,
            data: servers
        });
    } catch (error) {
        next(error);
    }
};

const getServerById = async (req, res, next) => {
    try {
        const server = await serverModel.getServerById(req.params.id);

        if (!server) {
            return res.status(404).json({
                success: false,
                message: "Server not found"
            });
        }

        res.status(200).json({
            success: true,
            data: server
        });
    } catch (error) {
        next(error);
    }
};

const getServerSummary = async (req, res, next) => {
    try {
        const summary = await serverModel.getServerSummary();

        res.status(200).json({
            success: true,
            data: summary
        });
    } catch (error) {
        next(error);
    }
};

const getServerEnvironment = async (req, res, next) => {
    try {
        const { environment } = req.params;

        const servers = await serverModel.getServerEnvironment(environment);

        res.status(200).json({
            success: true,
            count: servers.length,
            data: servers
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAllServers,
    getServerById,
    getServerSummary,
    getServerEnvironment
};