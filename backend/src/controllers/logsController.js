// backend/src/controllers/logsController.js
const db = require('../config/db');

const getTableColumns = async (tableName) => {
    const [rows] = await db.execute(`SHOW COLUMNS FROM ${tableName}`);
    return rows.map(row => row.Field);
};

const hasColumn = (columns, columnName) => {
    return columns.includes(columnName);
};

const pickColumn = (columns, candidates, fallback = null) => {
    return candidates.find(column => columns.includes(column)) || fallback;
};

const q = (columnName) => {
    return `\`${columnName}\``;
};

// Fetch logs with filters
const getAllLogs = async (req, res, next) => {
    try {
        const { search, type, from, to } = req.query;

        const logColumns = await getTableColumns('server_activity_log');
        const serverColumns = await getTableColumns('servers');

        const serverHostColumn = pickColumn(serverColumns, [
            'hostname',
            'host_name',
            'name',
            'server_name'
        ], 'hostname');

        const logIdColumn = pickColumn(logColumns, ['id', 'log_id'], null);
        const serviceColumn = pickColumn(logColumns, [
            'incident_id',
            'service_name',
            'service',
            'description'
        ], null);

        const messageColumn = pickColumn(logColumns, [
            'message',
            'output',
            'details'
        ], null);

        const statusColumn = pickColumn(logColumns, [
            'new_status',
            'status',
            'log_type'
        ], null);

        const oldStatusColumn = pickColumn(logColumns, ['old_status'], null);
        const newStatusColumn = pickColumn(logColumns, ['new_status'], null);
        const actionByColumn = pickColumn(logColumns, ['action_by', 'user', 'username'], null);
        const logTypeColumn = pickColumn(logColumns, ['log_type', 'type', 'event_type'], null);
        const timestampColumn = pickColumn(logColumns, [
            'created_at',
            'timestamp',
            'createdAt',
            'date_created'
        ], null);

        const idSelect = logIdColumn
            ? `l.${q(logIdColumn)} AS id`
            : `NULL AS id`;

        const serviceSelect = serviceColumn
            ? `l.${q(serviceColumn)} AS service_name`
            : `NULL AS service_name`;

        const outputSelect = messageColumn
            ? `l.${q(messageColumn)} AS output`
            : `NULL AS output`;

        const statusSelect = statusColumn
            ? `l.${q(statusColumn)} AS status`
            : `NULL AS status`;

        const timestampSelect = timestampColumn
            ? `l.${q(timestampColumn)} AS timestamp`
            : `NULL AS timestamp`;

        const logTypeSelect = logTypeColumn
            ? `l.${q(logTypeColumn)} AS log_type`
            : `NULL AS log_type`;

        const oldStatusSelect = oldStatusColumn
            ? `l.${q(oldStatusColumn)} AS old_status`
            : `NULL AS old_status`;

        const newStatusSelect = newStatusColumn
            ? `l.${q(newStatusColumn)} AS new_status`
            : `NULL AS new_status`;

        const actionBySelect = actionByColumn
            ? `l.${q(actionByColumn)} AS action_by`
            : `NULL AS action_by`;

        const messageSelect = messageColumn
            ? `l.${q(messageColumn)} AS message`
            : `NULL AS message`;

        let query = `
            SELECT
                ${idSelect},
                s.${q(serverHostColumn)} AS host_name,
                ${serviceSelect},
                ${outputSelect},
                ${statusSelect},
                ${timestampSelect},
                ${logTypeSelect},
                ${oldStatusSelect},
                ${newStatusSelect},
                ${actionBySelect},
                ${messageSelect}
            FROM server_activity_log l
            JOIN servers s ON l.server_id = s.id
            WHERE 1=1
        `;

        const params = [];

        if (search) {
            const searchParts = [`s.${q(serverHostColumn)} LIKE ?`];
            params.push(`%${search}%`);

            if (serviceColumn) {
                searchParts.push(`l.${q(serviceColumn)} LIKE ?`);
                params.push(`%${search}%`);
            }

            if (messageColumn) {
                searchParts.push(`l.${q(messageColumn)} LIKE ?`);
                params.push(`%${search}%`);
            }

            if (actionByColumn) {
                searchParts.push(`l.${q(actionByColumn)} LIKE ?`);
                params.push(`%${search}%`);
            }

            query += ` AND (${searchParts.join(' OR ')})`;
        }

        if (type && type !== 'all') {
            if (type === 'acknowledged') {
                if (logTypeColumn) {
                    query += ` AND l.${q(logTypeColumn)} = ?`;
                    params.push('ACKNOWLEDGEMENT');
                }
            } else if (['critical', 'warning', 'unknown'].includes(type)) {
                if (newStatusColumn) {
                    query += ` AND l.${q(newStatusColumn)} = ?`;
                    params.push(type.toUpperCase());
                } else if (statusColumn) {
                    query += ` AND l.${q(statusColumn)} = ?`;
                    params.push(type.toUpperCase());
                }
            }
        }

        if (from && timestampColumn) {
            query += ` AND DATE(l.${q(timestampColumn)}) >= ?`;
            params.push(from);
        }

        if (to && timestampColumn) {
            query += ` AND DATE(l.${q(timestampColumn)}) <= ?`;
            params.push(to);
        }

        if (timestampColumn) {
            query += ` ORDER BY l.${q(timestampColumn)} DESC LIMIT 100`;
        } else if (logIdColumn) {
            query += ` ORDER BY l.${q(logIdColumn)} DESC LIMIT 100`;
        } else {
            query += ` LIMIT 100`;
        }

        const [results] = await db.execute(query, params);

        res.json({
            success: true,
            result: results
        });

    } catch (error) {
        console.error("Error fetching logs:", {
            message: error.message,
            code: error.code,
            sqlMessage: error.sqlMessage,
            sql: error.sql
        });

        res.status(500).json({
            success: false,
            error: "Failed to fetch audit records",
            details: error.sqlMessage || error.message
        });
    }
};

// Insert a new log entry manually if needed
const createLogEntry = async (req, res, next) => {
    try {
        const {
            server_id,
            incident_id,
            log_type,
            old_status,
            new_status,
            action_by,
            message
        } = req.body;

        if (!server_id || !log_type) {
            return res.status(400).json({
                success: false,
                error: "server_id and log_type are required"
            });
        }

        const query = `
            INSERT INTO server_activity_log
            (server_id, incident_id, log_type, old_status, new_status, action_by, message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        await db.execute(query, [
            server_id,
            incident_id || null,
            log_type,
            old_status || null,
            new_status || null,
            action_by || null,
            message || null
        ]);

        res.status(201).json({
            success: true,
            message: "Log saved successfully"
        });

    } catch (error) {
        console.error("Error inserting log:", {
            message: error.message,
            code: error.code,
            sqlMessage: error.sqlMessage
        });

        res.status(500).json({
            success: false,
            error: "Failed to record activity",
            details: error.sqlMessage || error.message
        });
    }
};

module.exports = {
    getAllLogs,
    createLogEntry
};