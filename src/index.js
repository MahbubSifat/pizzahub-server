require("dotenv").config();
const express = require("express");
const cors = require("cors");

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

app.listen(PORT, () => {
  console.log(`PizzaHub server listening on port ${PORT}`);
});