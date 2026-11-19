const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");
const { FREE_PLAN_ITEM_LIMIT } = require("../utils/constants");
const { asyncHandler, toObjectId, firstError } = require("../utils/helpers");
const { menuItemSchema, availabilitySchema } = require("../utils/schemas");

const router = express.Router();

// এই router-এর সব route-এ শুধু logged-in vendor ঢুকতে পারবে
router.use(verifyToken, requireRole("vendor"));

const LIMIT_MESSAGE =
  "Free plan allows up to 3 active items. Upgrade to Premium to add more.";

async function countActiveItems(db, vendorId, excludeId) {
  const filter = { vendorId, status: { $in: ["pending", "approved"] } };
  if (excludeId) filter._id = { $ne: excludeId };
  return db.collection("menuItems").countDocuments(filter);
}

// Item আছে কি না ও এই vendor-এর নিজের কি না যাচাই (অন্যের হলে 403)
async function loadOwnedItem(req, res) {
  const itemId = toObjectId(req.params.id);
  if (!itemId) {
    res.status(400).json({ message: "Invalid item ID" });
    return null;
  }
  const db = await getDb();
  const item = await db.collection("menuItems").findOne({ _id: itemId });
  if (!item) {
    res.status(404).json({ message: "Menu item not found" });
    return null;
  }
  if (String(item.vendorId) !== req.user.id) {
    res.status(403).json({ message: "You can only manage your own menu items" });
    return null;
  }
  return { db, item };
}

// GET /api/vendor/menu-items: নিজের সব item (সব status সহ)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const items = await db
      .collection("menuItems")
      .find({ vendorId: new ObjectId(req.user.id) })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ items });
  })
);

// GET /api/vendor/menu-items/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const owned = await loadOwnedItem(req, res);
    if (!owned) return;
    res.json({ item: owned.item });
  })
);

// POST /api/vendor/menu-items: নতুন item, সবসময় pending হয়ে শুরু
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = menuItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: firstError(parsed) });
    }

    const db = await getDb();
    const vendorId = new ObjectId(req.user.id);

    if (!req.user.isPremium) {
      const count = await countActiveItems(db, vendorId);
      if (count >= FREE_PLAN_ITEM_LIMIT) {
        return res.status(403).json({ message: LIMIT_MESSAGE, code: "PLAN_LIMIT" });
      }
    }

    const doc = {
      ...parsed.data,
      vendorId,
      status: "pending", // client কী পাঠালো তাতে কিছু আসে যায় না
      createdAt: new Date(),
    };
    const result = await db.collection("menuItems").insertOne(doc);
    res.status(201).json({
      message: "Menu item submitted for admin review",
      item: { _id: result.insertedId, ...doc },
    });
  })
);

// PATCH /api/vendor/menu-items/:id: তথ্য বদল। বদলালে আবার admin review-এ (pending) যায়
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const owned = await loadOwnedItem(req, res);
    if (!owned) return;
    const { db, item } = owned;

    const parsed = menuItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: firstError(parsed) });
    }

    // Rejected বা inactive item আবার pending হলে active গোনায় ঢোকে, তাই limit দেখতে হয়
    const becomesActive = ["rejected", "inactive"].includes(item.status);
    if (becomesActive && !req.user.isPremium) {
      const count = await countActiveItems(db, item.vendorId, item._id);
      if (count >= FREE_PLAN_ITEM_LIMIT) {
        return res.status(403).json({ message: LIMIT_MESSAGE, code: "PLAN_LIMIT" });
      }
    }

    await db.collection("menuItems").updateOne(
      { _id: item._id },
      {
        $set: { ...parsed.data, status: "pending", updatedAt: new Date() },
        $unset: { inactiveBy: "" },
      }
    );
    res.json({ message: "Menu item updated and sent for review" });
  })
);

// PATCH /api/vendor/menu-items/:id/availability  body: { available: true|false }
router.patch(
  "/:id/availability",
  asyncHandler(async (req, res) => {
    const owned = await loadOwnedItem(req, res);
    if (!owned) return;
    const { db, item } = owned;

    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: firstError(parsed) });
    }

    if (!parsed.data.available) {
      if (item.status !== "approved") {
        return res.status(400).json({ message: "Only approved items can be hidden" });
      }
      await db
        .collection("menuItems")
        .updateOne({ _id: item._id }, { $set: { status: "inactive", inactiveBy: "vendor" } });
      return res.json({ message: "Item hidden from customers" });
    }

    // আবার চালু: শুধু নিজে লুকালে। Admin বন্ধ করলে vendor চালু করতে পারবে না
    if (item.status !== "inactive" || item.inactiveBy !== "vendor") {
      return res.status(403).json({
        message: "This item was deactivated by an admin and cannot be re-enabled by you",
      });
    }
    if (!req.user.isPremium) {
      const count = await countActiveItems(db, item.vendorId, item._id);
      if (count >= FREE_PLAN_ITEM_LIMIT) {
        return res.status(403).json({ message: LIMIT_MESSAGE, code: "PLAN_LIMIT" });
      }
    }
    await db
      .collection("menuItems")
      .updateOne({ _id: item._id }, { $set: { status: "approved" }, $unset: { inactiveBy: "" } });
    res.json({ message: "Item is visible to customers again" });
  })
);

// DELETE /api/vendor/menu-items/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const owned = await loadOwnedItem(req, res);
    if (!owned) return;
    await owned.db.collection("menuItems").deleteOne({ _id: owned.item._id });
    res.json({ message: "Menu item deleted" });
  })
);

module.exports = router;