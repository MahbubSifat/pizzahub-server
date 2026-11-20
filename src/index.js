require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { getDb } = require("./config/db");
const { verifyToken, requireRole } = require("./middleware/auth");
const stripeWebhook = require("./routes/stripeWebhook");

const app = express();
const PORT = process.env.PORT || 5000;

// শুধু আমাদের client-কে এই server-এর সাথে কথা বলতে দেওয়া হচ্ছে
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Stripe webhook-এ raw body লাগে, তাই এটা অবশ্যই express.json()-এর আগে
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "PizzaHub server is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/health/db", async (req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    res.status(500).json({ status: "error", database: "unreachable" });
  }
});

// ---- Auth পরীক্ষার route (পরে মুছে ফেলা যাবে) ----
app.get("/api/me", verifyToken, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/admin/ping", verifyToken, requireRole("admin"), (req, res) => {
  res.json({ message: "Hello admin", user: req.user.email });
});

// ---- Menu items ----
app.use("/api/menu-items", require("./routes/menuItems"));
app.use("/api/vendor/menu-items", require("./routes/vendorMenuItems"));
app.use("/api/admin/menu-items", require("./routes/adminMenuItems"));

// ---- Orders ----
app.use("/api/orders", require("./routes/customerOrders"));
app.use("/api/vendor/orders", require("./routes/vendorOrders"));

// ---- Payments (Stripe, শুধু vendor subscription) ----
app.use("/api/payments", require("./routes/payments"));

// ---- Dashboards, admin ও profile ----
app.use("/api/overview", require("./routes/overview"));
app.use("/api/admin/users", require("./routes/adminUsers"));
app.use("/api/admin/transactions", require("./routes/adminTransactions"));
app.use("/api/profile", require("./routes/profile"));

// ---- 404 ও global error handler ----
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error.message);
  res.status(500).json({ message: "Something went wrong on the server" });
});

// শুধু নিজের PC-তে সরাসরি চালালে listen করবে; Vercel-এ export হওয়া app-ই ব্যবহার হবে
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PizzaHub server listening on port ${PORT}`);
  });
}

module.exports = app;