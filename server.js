const path = require("path");

// Load .env from project root: d_goc/.env
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = require("./backend/src/app");

// Optional for now:
// If MySQL is not ready yet, comment this line while testing Centreon login.
// require("./backend/src/config/db");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`GOC SERVER IS RUNNING ON PORT ${PORT}`);
    console.log("CENTREON_API_URL:", process.env.CENTREON_API_URL);
});