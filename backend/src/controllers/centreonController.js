const axios = require('axios');

const centreonHost = process.env.CENTREON_HOST;

// 💡 HELPER: Dynamically extract the token sent from the React frontend
const getCentreonHeaders = (req) => {
    const userToken = req.headers.authorization; // Expects "Bearer <token>"
    
    // Fallback to .env token if the frontend didn't pass one (useful for offline sandbox testing)
    const activeToken = userToken || `Bearer ${process.env.CENTREON_API_TOKEN}`;
    
    return {
        'Authorization': activeToken,
        'Content-Type': 'application/json'
    };
};

const getAllHosts = async (req, res, next) => {
    try {
        // Pass the headers dynamically per request
        const response = await axios.get(`${centreonHost}/api/v2/monitoring/hosts`, {
            headers: getCentreonHeaders(req)
        });
        
        res.json({
            success: true,
            count: response.data.result?.length || 0,
            data: response.data
        });
    } catch (error) {
        // If Centreon tells our backend the user's token is invalid, pass the 401 straight to React
        if (error.response?.status === 401) {
            return res.status(401).json({ success: false, message: "Centreon session invalid or expired." });
        }
        next(error);
    }
};

const getHostById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const response = await axios.get(`${centreonHost}/api/v2/monitoring/hosts/${id}`, {
            headers: getCentreonHeaders(req)
        });
        
        res.json({
            success: true,
            data: response.data
        });
    } catch (error) {
        if (error.response?.status === 401) {
            return res.status(401).json({ success: false, message: "Centreon session invalid or expired." });
        }
        next(error);
    }
};

const getHostStatus = async (req, res, next) => {
    try {
        const response = await axios.get(
            `${centreonHost}/api/v2/monitoring/hosts?search={"status":{"$in":["UP","DOWN"]}}`, 
            { headers: getCentreonHeaders(req) }
        );
        
        res.json({
            success: true,
            data: response.data
        });
    } catch (error) {
        if (error.response?.status === 401) {
            return res.status(401).json({ success: false, message: "Centreon session invalid or expired." });
        }
        next(error);
    }
};

const getAllServices = async (req, res, next) => {
    try {
        const response = await axios.get(`${centreonHost}/api/v2/monitoring/services`, {
            headers: getCentreonHeaders(req)
        });
        
        res.json({
            success: true,
            count: response.data.result?.length || 0,
            data: response.data
        });
    } catch (error) {
        if (error.response?.status === 401) {
            return res.status(401).json({ success: false, message: "Centreon session invalid or expired." });
        }
        next(error);
    }
};

const getServicesByHost = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        const response = await axios.get(
            `${centreonHost}/api/v2/monitoring/services?search={"host.id":${hostId}}`, 
            { headers: getCentreonHeaders(req) }
        );
        
        res.json({
            success: true,
            data: response.data
        });
    } catch (error) {
        if (error.response?.status === 401) {
            return res.status(401).json({ success: false, message: "Centreon session invalid or expired." });
        }
        next(error);
    }
};

module.exports = {
    getAllHosts,
    getHostById,
    getHostStatus,
    getAllServices,
    getServicesByHost
};