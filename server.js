const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "backend", ".env") });

const app = require("./backend/src/app");
require("./backend/src/config/db"); 

const PORT = process.env.PORT || 5000; 
app.listen(PORT, () => {
    console.log(`GOC SERVER IS RUNNING ON PORT ${PORT}`);
});