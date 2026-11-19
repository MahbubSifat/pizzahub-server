const express = require("express");
const { getDb } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");
const { CATEGORIES, ITEM_STATUSES } = require("../utils/constants");
const {
  asyncHandler,
  toObjectId,
  escapeRegex,
  asString,
  getPaging,
  firstError,
} = require("../utils/helpers");
const { adminStatusSchema } = require("../utils/schemas");

const router = express.Router();

// শুধু admin
router.use(verifyToken, requireRole("admin"));

// GET /api/admin/menu-items?search=&status=&category=&page=&limit=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = asString(req.query.search).trim();
    const status = asString(req.query.status).trim();
    const category = asString(req.query.category).trim();
    const { page, limit, skip } = getPaging(req.query, 10, 50);

    const match = {};
    if (status) {
      if (!ITEM_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      match.status = status;
    }
    if (category) {
      if (!CATEGORIES.includes(category)) {
        return res.status(400).json({ message: "Invalid category" });
      }
      match.category = category;
    }
    if (search) {
      const pattern = { $regex: escapeRegex(search), $options: "i" };
      match.$or = [{ itemName: pattern }, { location: pattern }];
    }

    const db = await getDb();
    const [result] = await db
      .collection("menuItems")
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: "users",
            localField: "vendorId",
            foreignField: "_id",
            as: "vendor",
          },
        },
        { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            itemName: 1,
            category: 1,
            description: 1,
            price: 1,
            location: 1,
            images: 1,
            status: 1,
            createdAt: 1,
            vendorId: 1,
            "vendor.name": 1,
            "vendor.email": 1,
            "vendor.businessName": 1,
          },
        },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $facet: {
            items: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    const total = result.total[0]?.count || 0;
    res.json({ items: result.items, total, page, limit, pages: Math.ceil(total / limit) });
  })
);

// PATCH /api/admin/menu-items/:id/status  body: { status: "approved" | "rejected" | "inactive" | "pending" }
router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const itemId = toObjectId(req.params.id);
    if (!itemId) {
      return res.status(400).json({ message: "Invalid item ID" });
    }
    const parsed = adminStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: firstError(parsed) });
    }

    const { status } = parsed.data;
    const update = { $set: { status, reviewedAt: new Date() } };
    if (status === "inactive") {
      update.$set.inactiveBy = "admin";
    } else {
      update.$unset = { inactiveBy: "" };
    }

    const db = await getDb();
    const result = await db.collection("menuItems").updateOne({ _id: itemId }, update);
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Menu item not found" });
    }
    res.json({ message: `Item marked as ${status}` });
  })
);

// DELETE /api/admin/menu-items/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const itemId = toObjectId(req.params.id);
    if (!itemId) {
      return res.status(400).json({ message: "Invalid item ID" });
    }
    const db = await getDb();
    const result = await db.collection("menuItems").deleteOne({ _id: itemId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Menu item not found" });
    }
    res.json({ message: "Menu item deleted" });
  })
);

module.exports = router;