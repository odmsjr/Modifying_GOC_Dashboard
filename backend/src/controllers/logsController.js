// backend/src/controllers/logsController.js
const db = require('../config/db');

// Fetch logs with filters and dynamic column matching
const getAllLogs = async (req, res, next) => {
    try {
        const { search, type, from, to } = req.query;
        
        // 🛠️ BUG FIX: Changed s.name to s.hostname to match your DB schema diagram
        let query = `
            SELECT l.*, s.hostname as host_name 
            FROM server_activity_log l
            JOIN servers s ON l.server_id = s.id
            WHERE 1=1
        `;
        const params = [];

        if (search) {
            query += ` AND (s.hostname LIKE ? OR l.message LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }
        if (type && type !== 'all') {
            const logType = type === 'acknowledged' ? 'ACKNOWLEDGEMENT' : 'STATUS_CHANGE';
            query += ` AND l.log_type = ?`;
            params.push(logType);
        }
        if (from) {
            query += ` AND DATE(l.created_at) >= ?`;
            params.push(from);
        }
        if (to) {
            query += ` AND DATE(l.created_at) <= ?`;
            params.push(to);
        }

        query += ` ORDER BY l.created_at DESC LIMIT 100`;

        const [results] = await db.execute(query, params);
        res.json({ result: results });

    } catch (error) {
        console.error("Error fetching logs:", error);
        res.status(500).json({ error: "Failed to fetch audit records" });
    }
};

// Insert a new log entry (e.g., when an Engineer acknowledges an alert)
const createLogEntry = async (req, res, next) => {
    try {
        const { server_id, incident_id, log_type, old_status, new_status, action_by, message } = req.body;

        if (!server_id || !log_type) {
            return res.status(400).json({ error: "server_id and log_type are required" });
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
            action_by || null, // 👤 This is where the React user's name maps perfectly
            message || null
        ]);

        res.status(201).json({ message: "Log saved successfully" });

    } catch (error) {
        console.error("Error inserting log:", error);
        res.status(500).json({ error: "Failed to record activity" });
    }
};

module.exports = {
    getAllLogs,
    createLogEntry
};