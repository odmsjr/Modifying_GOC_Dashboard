const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");

const centreonBaseUrl = process.env.CENTREON_API_URL;

if (!centreonBaseUrl) {
    throw new Error("CENTREON_API_URL is not configured in .env");
}

const certPathFromEnv = process.env.CENTREON_CA_CERT_PATH || "certs/centreon-ca-chain.pem";

const resolvedCertPath = path.isAbsolute(certPathFromEnv)
    ? certPathFromEnv
    : path.join(process.cwd(), certPathFromEnv);

console.log("Resolved Centreon cert path:", resolvedCertPath);
console.log("Cert exists:", fs.existsSync(resolvedCertPath));

let httpsAgent;

if (fs.existsSync(resolvedCertPath)) {
    httpsAgent = new https.Agent({
        ca: fs.readFileSync(resolvedCertPath),
        rejectUnauthorized: true
    });

    console.log("Centreon CA certificate loaded from:", resolvedCertPath);
} else {
    console.warn("Centreon CA certificate not found. HTTPS requests may fail.");
}

const centreonAxios = axios.create({
    baseURL: centreonBaseUrl.replace(/\/+$/, ""),
    timeout: 30000,
    httpsAgent,
    headers: {
        "Content-Type": "application/json"
    }
});

module.exports = centreonAxios;