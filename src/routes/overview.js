const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/helpers");

const router = express.Router();

async function groupCount(db, collection, match, field) {
  const rows = await db
    .collection(collection)
    .aggregate([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }])
    .toArray();
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

// tone = client-এ bar-এর রং ঠিক করে
function series(counts, keys, labels) {
  return keys.map((key) => ({ label: labels[key] || key, value: counts[key] || 0, tone: key }));
}

const ITEM_KEYS = ["pending", "approved", "rejected", "inactive"];
const ITEM_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", inactive: "Inactive" };
const ORDER_KEYS = ["pending", "accepted", "rejected", "cancelled"];
const ORDER_LABELS = { pending: "Pending", accepted: "Accepted", rejected: "Rejected", cancelled: "Cancelled" };

// ---- Vendor ----
router.get(
  "/vendor",
  verifyToken,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const vendorId = new ObjectId(req.user.id);
    const items = await groupCount(
      db,
      "menuItems",
      { vendorId: { $in: [vendorId, req.user.id] } },
      "status"
    );
    const orders = await groupCount(db, "orders", { vendorId }, "status");
    const totalItems = Object.values(items).reduce((sum, n) => sum + n, 0);

    res.json({
      stats: [
        { key: "total", label: "Total menu items", value: totalItems, icon: "package" },
        { key: "active", label: "Active menu items", value: items.approved || 0, icon: "check", hint: "Approved and visible" },
        { key: "pending", label: "Pending customer orders", value: orders.pending || 0, icon: "clock" },
        { key: "accepted", label: "Accepted orders", value: orders.accepted || 0, icon: "check" },
        { key: "plan", label: "Current plan", value: req.user.isPremium ? "Premium" : "Free", icon: "crown" },
      ],
      charts: [
        { title: "Menu items by status", data: series(items, ITEM_KEYS, ITEM_LABELS) },
        { title: "Orders by status", data: series(orders, ORDER_KEYS, ORDER_LABELS) },
      ],
    });
  })
);

// ---- Customer ----
router.get(
  "/customer",
  verifyToken,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const customerId = new ObjectId(req.user.id);
    const orders = await groupCount(db, "orders", { customerId }, "status");
    const total = Object.values(orders).reduce((sum, n) => sum + n, 0);

    res.json({
      stats: [
        { key: "total", label: "Total orders", value: total, icon: "shopping" },
        { key: "pending", label: "Pending orders", value: orders.pending || 0, icon: "clock" },
        { key: "accepted", label: "Accepted orders", value: orders.accepted || 0, icon: "check" },
        { key: "rejected", label: "Rejected orders", value: orders.rejected || 0, icon: "x" },
      ],
      charts: [{ title: "My orders by status", data: series(orders, ORDER_KEYS, ORDER_LABELS) }],
    });
  })
);

// ---- Admin ----
router.get(
  "/admin",
  verifyToken,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const users = await groupCount(db, "users", {}, "role");
    const items = await groupCount(db, "menuItems", {}, "status");
    const orders = await groupCount(db, "orders", {}, "status");
    const totalUsers = Object.values(users).reduce((sum, n) => sum + n, 0);
    const totalItems = Object.values(items).reduce((sum, n) => sum + n, 0);
    const totalTransactions = await db.collection("transactions").countDocuments({});

    res.json({
      stats: [
        { key: "users", label: "Registered users", value: totalUsers, icon: "users" },
        { key: "vendors", label: "Vendors", value: users.vendor || 0, icon: "store" },
        { key: "customers", label: "Customers", value: users.customer || 0, icon: "user" },
        { key: "items", label: "Menu items", value: totalItems, icon: "package" },
        { key: "pending", label: "Pending menu items", value: items.pending || 0, icon: "hourglass" },
        { key: "transactions", label: "Transactions", value: totalTransactions, icon: "receipt" },
      ],
      charts: [
        {
          title: "Users by role",
          data: series(users, ["vendor", "customer", "admin"], {
            vendor: "Vendors",
            customer: "Customers",
            admin: "Admins",
          }),
        },
        { title: "Menu items by status", data: series(items, ITEM_KEYS, ITEM_LABELS) },
        { title: "Orders by status", data: series(orders, ORDER_KEYS, ORDER_LABELS) },
      ],
    });
  })
);

module.exports = router;