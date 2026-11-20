const express = require("express");
const { getDb } = require("../config/db");
const { verifyToken, requireRole } = require("../middleware/auth");
const { asyncHandler, asString } = require("../utils/helpers");

const router = express.Router();
const STATUSES = ["paid", "failed", "pending"];
const PAGE_SIZE = 10;

router.use(verifyToken, requireRole("admin"));

// GET /api/admin/transactions?status=&page=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = asString(req.query.status) || "";
    const page = Math.max(1, parseInt(asString(req.query.page) || "1", 10) || 1);

    const match = {};
    if (status) {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      match.status = status;
    }

    const db = await getDb();
    const total = await db.collection("transactions").countDocuments(match);
    const transactions = await db
      .collection("transactions")
      .aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * PAGE_SIZE },
        { $limit: PAGE_SIZE },
        { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor" } },
        { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
        {
          // Stripe-এর id ইত্যাদি সংবেদনশীল তথ্য ইচ্ছে করেই পাঠানো হচ্ছে না
          $project: {
            plan: 1,
            amount: 1,
            currency: 1,
            status: 1,
            createdAt: 1,
            "vendor.name": 1,
            "vendor.email": 1,
            "vendor.businessName": 1,
          },
        },
      ])
      .toArray();

    const paid = await db
      .collection("transactions")
      .aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, sum: { $sum: "$amount" } } }])
      .toArray();
    const all = await db.collection("transactions").countDocuments({});

    res.json({
      transactions,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      summary: { totalTransactions: all, totalPaid: paid[0] ? paid[0].sum : 0, currency: "usd" },
    });
  })
);

module.exports = router;