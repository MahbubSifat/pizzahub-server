const express = require("express");
const { z } = require("zod");
const { getDb } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");
const { asyncHandler, toObjectId, escapeRegex, asString, firstError } = require("../utils/helpers");

const router = express.Router();
const ROLES = ["vendor", "customer", "admin"];
const PAGE_SIZE = 10;

router.use(verifyToken, requireRole("admin"));

const blockSchema = z.object({
  blocked: z.boolean({ message: "blocked must be true or false" }),
});

// GET /api/admin/users?search=&role=&page=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = (asString(req.query.search) || "").trim().slice(0, 80);
    const role = asString(req.query.role) || "";
    const page = Math.max(1, parseInt(asString(req.query.page) || "1", 10) || 1);

    const match = {};
    if (role) {
      if (!ROLES.includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      match.role = role;
    }
    if (search) {
      const pattern = new RegExp(escapeRegex(search), "i");
      match.$or = [{ name: pattern }, { email: pattern }];
    }

    const db = await getDb();
    const total = await db.collection("users").countDocuments(match);
    const users = await db
      .collection("users")
      .find(match, {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          businessName: 1,
          isBlocked: 1,
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray();

    res.json({ users, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
  })
);

// PATCH /api/admin/users/:id/block   body: { blocked: true | false }
router.patch(
  "/:id/block",
  asyncHandler(async (req, res) => {
    const userId = toObjectId(req.params.id);
    if (!userId) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: firstError(parsed) });
    }
    if (String(userId) === req.user.id) {
      return res.status(400).json({ message: "You cannot block your own account" });
    }

    const db = await getDb();
    const target = await db.collection("users").findOne({ _id: userId });
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }
    if (target.role === "admin") {
      return res.status(403).json({ message: "Admin accounts cannot be blocked" });
    }

    await db
      .collection("users")
      .updateOne(
        { _id: userId, role: { $ne: "admin" } },
        { $set: { isBlocked: parsed.data.blocked, updatedAt: new Date() } }
      );
    res.json({ message: parsed.data.blocked ? "User blocked" : "User unblocked" });
  })
);

module.exports = router;