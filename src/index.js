require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { getDb } = require("./config/db");


const app = express();
const PORT = process.env.PORT || 5000;

// শুধু আমাদের client-কে এই server-এর সাথে কথা বলতে দেওয়া হচ্ছে
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// পরে Stripe webhook route এখানে, express.json()-এর আগে বসবে
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

// শুধু নিজের PC-তে সরাসরি চালালে listen করবে; Vercel-এ export হওয়া app-ই ব্যবহার হবে
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PizzaHub server listening on port ${PORT}`);
  });
}

module.exports = app;