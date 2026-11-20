const Stripe = require("stripe");

let client;

// Secret key শুধু server-এ থাকে; প্রথমবার দরকার হলে client বানানো হয়
function getStripe() {
  if (!client) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}

// দাম এখানে server-এই ঠিক করা, client থেকে কখনো আসে না
const PREMIUM_PLAN = {
  name: "PizzaHub Premium",
  description: "Unlimited active menu items, Premium badge and featured placement",
  amount: 9, // মূল একক (USD)
  currency: "usd",
  interval: "month",
};

module.exports = { getStripe, PREMIUM_PLAN };