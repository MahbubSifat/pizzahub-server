const CATEGORIES = [
  "Classic Pizzas",
  "Vegetarian Pizzas",
  "Meat Lovers",
  "Specialty / Gourmet Pizzas",
  "Sides & Appetizers",
  "Beverages & Desserts",
];

const ITEM_STATUSES = ["pending", "approved", "rejected", "inactive"];

// Free plan-এ pending ও approved মিলিয়ে সর্বোচ্চ ৩টা item
const FREE_PLAN_ITEM_LIMIT = 3;

module.exports = { CATEGORIES, ITEM_STATUSES, FREE_PLAN_ITEM_LIMIT };