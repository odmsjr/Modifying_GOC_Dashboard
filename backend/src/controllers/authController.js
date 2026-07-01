// backend/src/controllers/authControllers.js
const centreonAxios = require("../config/axiosCentreon");

const loginUser = async (req, res, next) => {
    try {
        const { username, password, ssoToken } = req.body;

        if (ssoToken) {
            return res.status(200).json({
                success: true,
                message: "SSO Authentication successful. GOC Engineer Session active.",
                token: ssoToken,
                user: username || "SSO User",
                expires: Date.now() + 8 * 60 * 60 * 1000
            });
        }

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required."
            });
        }

        // Local test only. Remove before production.
        if (username === "admin" && password === "goc123") {
            return res.status(200).json({
                success: true,
                message: "Sandbox Authentication successful.",
                token: "mock-corporate-secure-jwt-token-xyz789",
                user: username,
                expires: Date.now() + 2 * 60 * 60 * 1000
            });
        }

        try {
            console.log("Trying Centreon login URL:", `${process.env.CENTREON_API_URL}/login`);

            const response = await centreonAxios.post("/login", {
                security: {
                    credentials: {
                        login: username,
                        password: password
                    }
                }
            });

            const realCentreonToken = response.data?.security?.token;

            if (!realCentreonToken) {
                console.error("Centreon login response did not include token:", response.data);

                return res.status(401).json({
                    success: false,
                    message: "Centreon did not return a valid session token."
                });
            }

            return res.status(200).json({
                success: true,
                message: "GOC Live Authentication successful.",
                token: realCentreonToken,
                user: username,
                expires: Date.now() + 2 * 60 * 60 * 1000
            });

        } catch (centreonApiError) {
            console.error("Centreon Authentication Rejected:", {
                status: centreonApiError.response?.status,
                data: centreonApiError.response?.data,
                message: centreonApiError.message,
                code: centreonApiError.code
            });

            return res.status(401).json({
                success: false,
                message:
                    centreonApiError.response?.data?.message ||
                    centreonApiError.message ||
                    "Invalid work credentials or unauthorized Centreon access."
            });
        }

    } catch (error) {
        next(error);
    }
};

module.exports = {
    loginUser
};