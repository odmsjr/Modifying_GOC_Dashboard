const db = require("../config/db");

const getAllServers = async () => {
    const [rows] = await db.query(`
        SELECT
        id,
        hostname,
        ip_address,
        location,
        managed_by,
        server_type,
        environment,
        app_name,
        app_summary,
        app_owner,
        app_support_group,
        status,
        cpu_usage,
        memory_usage,
        last_polled,
        is_active
        FROM servers
        ORDER BY hostname ASC
    `);
    return rows;
}

const getServerById = async (id) => {
    const [rows] = await db.query(`
        SELECT
        id,
        hostname,
        ip_address,
        location,
        managed_by,
        server_type,
        environment,
        app_name,
        app_summary,
        app_owner,
        app_support_group,
        status,
        cpu_usage,
        memory_usage,
        last_polled,
        is_active
        FROM servers
        WHERE id = ?
    `, [id]);
    return rows[0];
}

const getServerSummary = async () => {
    const [rows] = await db.query(`
        SELECT
            environment,
            server_type,
            COUNT(*) as total_servers,
        FROM servers
        GROUP BY environment ASC, server_type ASC
    `);
    return rows;
};

const getServerEnvironment = async (environment) => {
    const [rows] = await db.query(`
        SELECT
        id,
        hostname,
        ip_address,
        location,
        managed_by,
        server_type,
        environment,
        app_name,
        app_summary,
        app_owner,
        app_support_group,
        status,
        cpu_usage,
        memory_usage,
        last_polled,
        is_active
        FROM servers
        WHERE environment = ?
    `, [environment]);
    return rows;
}

module.exports = {
    getAllServers,
    getServerById,
    getServerSummary,
    getServerEnvironment
};