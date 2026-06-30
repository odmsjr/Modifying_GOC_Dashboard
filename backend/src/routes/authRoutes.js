// backend/src/routes/authRoutes.js
const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// Maps a POST request hitting /api/auth/login straight to our controller function
router.post("/login", authController.loginUser);

module.exports = router;