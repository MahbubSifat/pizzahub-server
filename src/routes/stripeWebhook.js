const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { getStripe } = require("../config/stripe");

const FALLBACK_DAYS = 32;

function toVendorId(value) {
  return typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value) ? new ObjectId(value) : null;
}

function idOf(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id || null;
}

// Stripe-এর নতুন API version-এ period end subscription item-এ থাকে, পুরনোতে subscription-এ; দুটোই ধরা হলো
function periodEnd(subscription) {
  const seconds =
    subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  return seconds
    ? new Date(seconds * 1000)
    : new Date(Date.now() + FALLBACK_DAYS * 24 * 60 * 60 * 1000);
}

// 1) প্রথম payment সফল: transaction সেভ + Premium চালু
async function handleCheckoutCompleted(session) {
  if (session.mode !== "subscription" || session.payment_status !== "paid") return;

  const vendorId = toVendorId(session.metadata && session.metadata.vendorId);
  if (!vendorId) {
    console.error("Webhook: checkout session without a valid vendorId", session.id);
    return;
  }

  const db = await getDb();
  const vendor = await db.collection("users").findOne({ _id: vendorId, role: "vendor" });
  if (!vendor) {
    console.error("Webhook: vendor not found for session", session.id);
    return;
  }

  const subscriptionId = idOf(session.subscription);
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);

  // একই event দুইবার এলেও একটাই transaction (stripeSessionId দিয়ে upsert)
  await db.collection("transactions").updateOne(
    { stripeSessionId: session.id },
    {
      $setOnInsert: {
        vendorId,
        plan: "premium",
        amount: (session.amount_total || 0) / 100,
        currency: session.currency,
        stripeSessionId: session.id,
        stripeSubscriptionId: subscriptionId,
        status: "paid",
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  await db.collection("users").updateOne(
    { _id: vendorId },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: periodEnd(subscription),
        updatedAt: new Date(),
      },
    }
  );
}

// 2) পরের মাসের নবায়ন সফল: মেয়াদ বাড়ানো (প্রথম payment উপরেরটা সামলায়)
async function handleInvoicePaid(invoice) {
  if (invoice.billing_reason !== "subscription_cycle") return;

  const subscriptionId = idOf(
    invoice.subscription ?? invoice.parent?.subscription_details?.subscription
  );
  if (!subscriptionId) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const vendorId = toVendorId(subscription.metadata && subscription.metadata.vendorId);
  if (!vendorId) return;

  const db = await getDb();
  await db.collection("users").updateOne(
    { _id: vendorId, role: "vendor" },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: periodEnd(subscription),
        updatedAt: new Date(),
      },
    }
  );
}

// 3) Subscription শেষ (cancel-এর মেয়াদ পূর্ণ বা payment ব্যর্থ): Free-তে ফেরা
async function handleSubscriptionDeleted(subscription) {
  const vendorId = toVendorId(subscription.metadata && subscription.metadata.vendorId);
  if (!vendorId) return;

  const db = await getDb();
  await db.collection("users").updateOne(
    { _id: vendorId, role: "vendor" },
    { $set: { subscriptionPlan: "free", subscriptionExpiresAt: new Date(), updatedAt: new Date() } }
  );
}

// express.raw() দিয়ে mount হয়, তাই req.body এখানে Buffer (signature যাচাইয়ের জন্য এটাই লাগে)
async function stripeWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return res.status(500).json({ message: "Webhook is not configured" });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);
  } catch (error) {
    console.error("Webhook signature check failed:", error.message);
    return res.status(400).json({ message: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        break; // বাকি event-এ কিছু করার নেই
    }
  } catch (error) {
    console.error(`Webhook handler failed for ${event.type}:`, error.message);
    // 500 দিলে Stripe নিজে আবার পাঠাবে
    return res.status(500).json({ message: "Webhook processing failed" });
  }

  res.json({ received: true });
}

module.exports = stripeWebhook;