const db = require('../config/db');
const { get } = require('../routes/serverRoutes');

const getAllTeams = async () => {
    const [rows] = await db.query(`
        SELECT
            id,
            assigned_to,
            created_tickets,
            resolved_tickets,
            sla_percentage,
            avg_mttr_hours,
            avg_mtta_hours,
            reopened_tickets,
            report_date
        FROM team_performance
        ORDER BY report_date DESC
        `);
    return rows;
}

const getTeamById = async (id) => {
    const [rows] = await db.query(`
        SELECT
            id,
            assigned_to,
            created_tickets,
            resolved_tickets,
            sla_percentage,
            avg_mttr_hours,
            avg_mtta_hours,
            reopened_tickets,
            report_date
        FROM team_performance
        WHERE id = ?
        `, [id]);
    return rows[0];
}

const getTeamSummaryByDateRange = async (startDate, endDate) => {
    const [rows] = await db.query(`
        SELECT
            id,
            assigned_to,
            created_tickets,
            resolved_tickets,
            sla_percentage,
            avg_mttr_hours,
            avg_mtta_hours,
            reopened_tickets,
            report_date
        FROM team_performance
        WHERE report_date >= ? AND report_date <= ?
        `, [startDate, endDate]);
    return rows;
}

const getTeamSummary = async () => {
    const [rows] = await db.query(`
        SELECT
            assigned_to,
            SUM(created_tickets) AS total_created_tickets,
            SUM(resolved_tickets) AS total_resolved_tickets,
            SUM(reopened_tickets) AS total_reopened_tickets,
            ROUND(AVG(sla_percentage), 2) AS avg_sla_percentage,
            ROUND(AVG(avg_mttr_hours), 2) AS avg_mttr_hours,
            ROUND(AVG(avg_mtta_hours), 2) AS avg_mtta_hours
        FROM team_performance
        GROUP BY assigned_to
        ORDER BY assigned_to
    `);
    return rows;
}

const getTeamSummaryByMonth = async (month, year) => {
    const selectedYear = Number(year);
    const selectedMonth = Number(month);

    const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;

    const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
    const nextYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
    
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const [rows] = await db.query(`
        SELECT
            assigned_to,
            SUM(created_tickets) AS total_created_tickets,
            SUM(resolved_tickets) AS total_resolved_tickets,
            SUM(reopened_tickets) AS total_reopened_tickets,
            ROUND(AVG(sla_percentage), 2) AS avg_sla_percentage,
            ROUND(AVG(avg_mttr_hours), 2) AS avg_mttr_hours,
            ROUND(AVG(avg_mtta_hours), 2) AS avg_mtta_hours
        FROM team_performance
        WHERE report_date >= ? AND report_date < ?
        GROUP BY assigned_to
        ORDER BY assigned_to
    `, [startDate, endDate]);
    return rows;
}

module.exports = {
    getAllTeams,
    getTeamById,
    getTeamSummary,
    getTeamSummaryByMonth,
    getTeamSummaryByDateRange
};