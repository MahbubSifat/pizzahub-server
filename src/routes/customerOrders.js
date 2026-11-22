const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");
const { asyncHandler, toObjectId, asString, firstError } = require("../utils/helpers");
const { orderSchema } = require("../utils/schemas");

const router = express.Router();
const ORDER_STATUSES = ["pending", "accepted", "rejected", "cancelled"];
const DAY_MS = 24 * 60 * 60 * 1000;

// এই router-এর সব route-এ শুধু customer
router.use(verifyToken, requireRole("customer"));

const withDetails = [
  { $lookup: { from: "menuItems", localField: "itemId", foreignField: "_id", as: "item" } },
  { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor" } },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
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
      "vendor.name": 1,
      "vendor.businessName": 1,
    },
  },
];

// POST /api/orders: নতুন order
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: firstError(parsed) });
    }
    const { itemId, deliveryDate, deliveryAddress, message } = parsed.data;

    // Delivery date যাচাই (UTC midnight হিসেবে সংরক্ষণ; এক দিনের ছাড়, যাতে সময়ক্ষেত্রের গরমিলে আটকে না যায়)
    const date = new Date(`${deliveryDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== deliveryDate) {
      return res.status(400).json({ message: "Invalid delivery date" });
    }
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (date.getTime() < todayUtc - DAY_MS) {
      return res.status(400).json({ message: "Delivery date cannot be in the past" });
    }
    if (date.getTime() > todayUtc + 90 * DAY_MS) {
      return res.status(400).json({ message: "Delivery date must be within the next 90 days" });
    }

    const db = await getDb();

    // শুধু approved item order করা যায়
    const item = await db
      .collection("menuItems")
      .findOne({ _id: new ObjectId(itemId), status: "approved" });
    const vendor = item
      ? await db.collection("users").findOne({ _id: item.vendorId }, { projection: { isBlocked: 1 } })
      : null;
    if (!item || !vendor || vendor.isBlocked) {
      return res.status(404).json({ message: "This item is not available for ordering" });
    }

    // নিজের item order করা যাবে না
    if (String(item.vendorId) === req.user.id) {
      return res.status(403).json({ message: "You cannot order your own menu item" });
    }

    // একই item ও একই তারিখে চালু order থাকলে নতুন নয়
    const customerId = new ObjectId(req.user.id);
    const duplicate = await db.collection("orders").findOne({
      customerId,
      itemId: item._id,
      deliveryDate: date,
      status: { $in: ["pending", "accepted"] },
    });
    if (duplicate) {
      return res.status(409).json({
        message: "You already have an active order for this item on that date",
      });
    }

    const doc = {
      itemId: item._id,
      vendorId: item.vendorId, // item থেকে নেওয়া, client-এর পাঠানো নয়
      customerId,
      deliveryDate: date,
      deliveryAddress,
      message,
      status: "pending",
      createdAt: new Date(),
    };
    const result = await db.collection("orders").insertOne(doc);
    res.status(201).json({
      message: "Order placed. The restaurant will review it soon.",
      orderId: result.insertedId,
    });
  })
);

// GET /api/orders/mine?status=: নিজের সব order
router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const status = asString(req.query.status);
    const match = { customerId: new ObjectId(req.user.id) };
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

// PATCH /api/orders/:id/cancel: শুধু নিজের pending order
router.patch(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const orderId = toObjectId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const db = await getDb();
    const order = await db.collection("orders").findOne({ _id: orderId });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (String(order.customerId) !== req.user.id) {
      return res.status(403).json({ message: "You can only cancel your own orders" });
    }

    // status: "pending" শর্তসহ update, তাই একই সময়ে vendor accept করলেও ভুল হয় না
    const result = await db
      .collection("orders")
      .updateOne(
        { _id: orderId, customerId: order.customerId, status: "pending" },
        { $set: { status: "cancelled", updatedAt: new Date() } }
      );
    if (result.matchedCount === 0) {
      return res.status(409).json({ message: "Only pending orders can be cancelled" });
    }
    res.json({ message: "Order cancelled" });
  })
);

module.exports = router;