const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { getStripe, PREMIUM_PLAN } = require("../config/stripe");
const { verifyToken, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/helpers");
const { FREE_PLAN_ITEM_LIMIT } = require("../utils/constants");

const router = express.Router();

// শুধু logged-in vendor; vendorId সবসময় token থেকে (body থেকে কখনো নয়)
router.use(verifyToken, requireRole("vendor"));

function isPremiumNow(user) {
  return (
    user.subscriptionPlan === "premium" &&
    !!user.subscriptionExpiresAt &&
    new Date(user.subscriptionExpiresAt) > new Date()
  );
}

async function latestSubscriptionId(db, vendorId) {
  const txn = await db.collection("transactions").findOne(
    { vendorId, status: "paid", stripeSubscriptionId: { $ne: null } },
    { sort: { createdAt: -1 } }
  );
  return txn ? txn.stripeSubscriptionId : null;
}

// ওই subscription সত্যিই এই vendor-এর কি না, Stripe-এ রাখা metadata দিয়ে মিলিয়ে নেওয়া
async function loadOwnSubscription(db, req) {
  const subscriptionId = await latestSubscriptionId(db, new ObjectId(req.user.id));
  if (!subscriptionId) return null;
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  if (!subscription.metadata || subscription.metadata.vendorId !== req.user.id) return null;
  return subscription;
}

// POST /api/payments/checkout-session
router.post(
  "/checkout-session",
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const vendor = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!vendor) return res.status(401).json({ message: "User not found" });
    if (isPremiumNow(vendor)) {
      return res.status(409).json({ message: "You already have an active Premium plan" });
    }

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: PREMIUM_PLAN.currency,
            unit_amount: Math.round(PREMIUM_PLAN.amount * 100),
            recurring: { interval: PREMIUM_PLAN.interval },
            product_data: { name: PREMIUM_PLAN.name, description: PREMIUM_PLAN.description },
          },
        },
      ],
      customer_email: vendor.email,
      client_reference_id: req.user.id,
      metadata: { vendorId: req.user.id },
      subscription_data: { metadata: { vendorId: req.user.id } },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    });

    res.json({ url: session.url });
  })
);

// GET /api/payments/status: subscription পাতার সব তথ্য
router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const vendorId = new ObjectId(req.user.id);
    const vendor = await db.collection("users").findOne({ _id: vendorId });
    if (!vendor) return res.status(401).json({ message: "User not found" });

    const isPremium = isPremiumNow(vendor);

    const activeItems = await db.collection("menuItems").countDocuments({
      vendorId: { $in: [vendorId, req.user.id] },
      status: { $in: ["pending", "approved"] },
    });

    // Stripe থেকে সরাসরি জেনে নেওয়া: cancel করা আছে কি না (ব্যর্থ হলেও পাতা চলবে)
    let cancelAtPeriodEnd = false;
    if (isPremium) {
      try {
        const subscription = await loadOwnSubscription(db, req);
        cancelAtPeriodEnd = !!(subscription && subscription.cancel_at_period_end);
      } catch (error) {
        console.error("Could not read subscription from Stripe:", error.message);
      }
    }

    res.json({
      plan: isPremium ? "premium" : "free",
      isPremium,
      expiresAt: isPremium ? vendor.subscriptionExpiresAt : null,
      cancelAtPeriodEnd,
      activeItems,
      freeLimit: FREE_PLAN_ITEM_LIMIT,
      price: {
        amount: PREMIUM_PLAN.amount,
        currency: PREMIUM_PLAN.currency,
        interval: PREMIUM_PLAN.interval,
      },
    });
  })
);

// POST /api/payments/cancel: মেয়াদ শেষে আর নবায়ন হবে না (এখনকার মেয়াদ পর্যন্ত Premium থাকে)
router.post(
  "/cancel",
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const subscription = await loadOwnSubscription(db, req);
    if (!subscription) {
      return res.status(404).json({ message: "No active subscription found" });
    }
    await getStripe().subscriptions.update(subscription.id, { cancel_at_period_end: true });
    res.json({ message: "Subscription will end at the end of the current period" });
  })
);

// POST /api/payments/resume: cancel বাতিল
router.post(
  "/resume",
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const subscription = await loadOwnSubscription(db, req);
    if (!subscription) {
      return res.status(404).json({ message: "No active subscription found" });
    }
    await getStripe().subscriptions.update(subscription.id, { cancel_at_period_end: false });
    res.json({ message: "Your Premium plan will keep renewing" });
  })
);

// GET /api/payments/session/:sessionId
// Success পাতা শুধু জানতে চায় "webhook payment নিশ্চিত করেছে কি?"; এটা কিছু চালু করে না
router.get(
  "/session/:sessionId",
  asyncHandler(async (req, res) => {
    const sessionId = String(req.params.sessionId || "");
    if (!/^cs_[A-Za-z0-9_]{5,200}$/.test(sessionId)) {
      return res.status(400).json({ message: "Invalid session ID" });
    }
    const db = await getDb();
    const txn = await db.collection("transactions").findOne({
      stripeSessionId: sessionId,
      vendorId: new ObjectId(req.user.id), // অন্যের session দেখা যাবে না
    });
    res.json({
      confirmed: !!txn && txn.status === "paid",
      amount: txn ? txn.amount : null,
      currency: txn ? txn.currency : null,
    });
  })
);

module.exports = router;