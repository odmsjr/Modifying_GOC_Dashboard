const teamPerformance = (req, res) => {"../models/teamPerformance"};

const getAllTeams = async (req, res) => {
    try {
        const teams = await teamPerformance.getAllTeams();
        
        res.status(200).json({
            success: true,
            count: data.length,
            data
        });
    } catch (error) {
        next(error);
    }
}

const getTeamById = async (req, res) => {
    try {
        const { id } = req.params;

        const team = await teamPerformance.getTeamById(req.params.id);

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
}

const getTeamSummaryByMonth = async (req, res) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                success: false,
                message: "Year and month are required"
            });
        }

        const data = await teamPerformance.getTeamSummaryByMonth(month, year);

        res.status(200).json({
            success: true,
            year: Number(year),
            month: Number(month),
            count: data.length,
            data
        });
    } catch (error) {
        next(error);
    }

}

const getTeamSummaryByDateRange = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                message: "Start date and end date are required"
            });
        }

        const data = await teamPerformance.getTeamSummaryByDateRange(start_date, end_date);

        res.status(200).json({
            success: true,
            start_date,
            end_date,
            count: data.length,
            data
        });
    } catch (error) {
        next(error);
    }
};

const getTeamSummary = async (req, res) => {
    try {
        const data = await teamPerformance.getTeamSummary();

        res.status(200).json({
            success: true,
            count: data.length,
            data
        });
    } catch (error) {
        next(error);
    }
};

const getTeamSummaryByMonth = async (req, res, next) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                success: false,
                message: "Year and month are required"
            });
        }

        const data = await teamPerformance.getTeamSummaryByMonth(month, year);

        res.status(200).json({
            success: true,
            year: Number(year),
            month: Number(month),
            count: data.length,
            data
        });
    }
    catch (error) {
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
