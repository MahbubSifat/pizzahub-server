const express = require("express");
const { getDb } = require("../config/db");
const { verifyToken } = require("../middleware/auth");
const { CATEGORIES } = require("../utils/constants");
const {
  asyncHandler,
  toObjectId,
  escapeRegex,
  asString,
  getPaging,
} = require("../utils/helpers");

const router = express.Router();

// Vendor-এর তথ্য জুড়ে দেওয়া, blocked vendor-এর item বাদ, Premium vendor চিহ্নিত করা
const withVendor = [
  {
    $lookup: {
      from: "users",
      localField: "vendorId",
      foreignField: "_id",
      as: "vendor",
    },
  },
  { $unwind: "$vendor" },
  { $match: { "vendor.isBlocked": { $ne: true } } },
  {
    $addFields: {
      isPremiumVendor: {
        $and: [
          { $eq: ["$vendor.subscriptionPlan", "premium"] },
          {
            $or: [
              { $eq: [{ $ifNull: ["$vendor.subscriptionExpiresAt", null] }, null] },
              { $gt: ["$vendor.subscriptionExpiresAt", "$$NOW"] },
            ],
          },
        ],
      },
    },
  },
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
      isPremiumVendor: 1,
      "vendor._id": 1,
      "vendor.name": 1,
      "vendor.businessName": 1,
      "vendor.image": 1,
    },
  },
];

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { price: 1, _id: -1 },
  price_desc: { price: -1, _id: -1 },
};

// GET /api/menu-items?search=&category=&location=&sort=newest|price_asc|price_desc&featured=true&page=&limit=
// সবার জন্য খোলা, শুধু approved item দেখায়
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = asString(req.query.search).trim();
    const category = asString(req.query.category).trim();
    const location = asString(req.query.location).trim();
    const sortKey = asString(req.query.sort);
    const featured = req.query.featured === "true";
    const { page, limit, skip } = getPaging(req.query);

    const match = { status: "approved" };

    if (search) {
      const pattern = { $regex: escapeRegex(search), $options: "i" };
      match.$or = [{ itemName: pattern }, { description: pattern }, { category: pattern }];
    }
    if (category) {
      if (!CATEGORIES.includes(category)) {
        return res.status(400).json({ message: "Invalid category" });
      }
      match.category = category;
    }
    if (location) {
      match.location = { $regex: escapeRegex(location), $options: "i" };
    }

    // Featured হলে Premium vendor-এর item আগে আসে
    const sort = featured
      ? { isPremiumVendor: -1, createdAt: -1, _id: -1 }
      : SORTS[sortKey] || SORTS.newest;

    const db = await getDb();
    const [result] = await db
      .collection("menuItems")
      .aggregate([
        { $match: match },
        ...withVendor,
        { $sort: sort },
        {
          $facet: {
            items: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    const total = result.total[0]?.count || 0;
    res.json({
      items: result.items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  })
);

// GET /api/menu-items/locations: filter dropdown-এর জন্য
router.get(
  "/locations",
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const locations = await db.collection("menuItems").distinct("location", { status: "approved" });
    res.json({ locations: locations.sort((a, b) => a.localeCompare(b)) });
  })
);

// GET /api/menu-items/:id: login লাগবে, শুধু approved item
router.get(
  "/:id",
  verifyToken,
  asyncHandler(async (req, res) => {
    const itemId = toObjectId(req.params.id);
    if (!itemId) {
      return res.status(400).json({ message: "Invalid item ID" });
    }

    const db = await getDb();
    const [item] = await db
      .collection("menuItems")
      .aggregate([{ $match: { _id: itemId, status: "approved" } }, ...withVendor])
      .toArray();

    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }
    res.json({ item });
  })
);

module.exports = router;