const express = require("express");
const cors = require("cors");

const serverRoutes = require("./routes/serverRoutes");
const teamRoutes = require("./routes/teamRoutes");
const centreonRoutes = require("./routes/centreonRoutes");
const authRoutes = require("./routes/authRoutes");
const errorHandler = require("./middleware/errorHandler");
const logsRoutes = require("./routes/logsRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json ({ message: "Welcome to GOC API",
        status: "success",
    });
});

app.use("/api/auth", authRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/centreon", centreonRoutes);
app.use("/api/logs", logsRoutes);


app.use(errorHandler);

module.exports = app;