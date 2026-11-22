const express = require("express");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// Returns the logged-in user's basic info (used by the vendor items page)
router.get("/", verifyToken, (req, res) => {
  const u = req.user || {};
  res.json({
    user: {
      id: u.id || u._id || u.sub || null,
      role: u.role || null,
      isPremium: Boolean(u.isPremium),
    },
  });
});

module.exports = router;