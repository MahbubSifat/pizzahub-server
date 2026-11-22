const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");
const { asyncHandler, toObjectId, asString, firstError } = require("../utils/helpers");
const { vendorOrderActionSchema } = require("../utils/schemas");

const router = express.Router();
const ORDER_STATUSES = ["pending", "accepted", "rejected", "cancelled"];

// এই router-এর সব route-এ শুধু vendor
router.use(verifyToken, requireRole("vendor"));

const withDetails = [
  { $lookup: { from: "menuItems", localField: "itemId", foreignField: "_id", as: "item" } },
  { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "customerId", foreignField: "_id", as: "customer" } },
  { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      deliveryDate: 1,
      deliveryAddress: 1,
      message: 1,
      status: 1,
      createdAt: 1,
      updatedAt: 1,
      "item._id": 1,
      "item.itemName": 1,
      "item.images": 1,
      "item.price": 1,
      "item.category": 1,
      "customer.name": 1,
      "customer.email": 1,
    },
  },
];

// GET /api/vendor/orders?status=: আমার item-এর উপর আসা order
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = asString(req.query.status);
    const match = { vendorId: new ObjectId(req.user.id) };
    if (status) {
      if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      match.status = status;
    }

    const db = await getDb();
    const orders = await db
      .collection("orders")
      .aggregate([{ $match: match }, { $sort: { createdAt: -1 } }, { $limit: 200 }, ...withDetails])
      .toArray();
    res.json({ orders });
  })
);

// PATCH /api/vendor/orders/:id  body: { status: "accepted" | "rejected" }
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const orderId = toObjectId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ message: "Invalid order ID" });
    }
    const parsed = vendorOrderActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: firstError(parsed) });
    }

    const db = await getDb();
    const order = await db.collection("orders").findOne({ _id: orderId });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    // অন্য vendor-এর order ছোঁয়া যাবে না
    if (String(order.vendorId) !== req.user.id) {
      return res.status(403).json({ message: "You can only manage your own orders" });
    }

    // শুধু pending থেকে, এবং একবারই (শর্তসহ update)
    const result = await db
      .collection("orders")
      .updateOne(
        { _id: orderId, vendorId: order.vendorId, status: "pending" },
        { $set: { status: parsed.data.status, updatedAt: new Date() } }
      );
    if (result.matchedCount === 0) {
      return res
        .status(409)
        .json({ message: "Only pending orders can be accepted or rejected" });
    }
    res.json({ message: `Order ${parsed.data.status}` });
  })
);

module.exports = router;