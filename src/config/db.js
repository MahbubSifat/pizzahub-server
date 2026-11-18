const { MongoClient } = require("mongodb");

let dbPromise;

// একবার connect করে সেটাই বারবার ব্যবহার করা হয়।
// Vercel-এ প্রতিবার নতুন connection খুললে database অচল হয়ে যেতে পারে।
function getDb() {
  if (!dbPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    dbPromise = client.connect().then((connected) =>
      connected.db(process.env.DB_NAME || "pizzahub")
    );
    // connect ব্যর্থ হলে পরের request আবার চেষ্টা করবে
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

module.exports = { getDb };