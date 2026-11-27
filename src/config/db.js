const { MongoClient } = require("mongodb");
const { attachDatabasePool } = require("@vercel/functions");

let dbPromise = null;

// একবার connect করে সেটাই বারবার ব্যবহার করা হয়।
// Client বন্ধ বা ব্যর্থ হলে cache মুছে যায়, পরের request নতুন করে connect করে।
function getDb() {
  if (!dbPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      appName: "pizzahub-server",
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 5000, // function ঘুমানোর আগেই অলস সংযোগ বন্ধ হয়
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      family: 4,
    });

    // Vercel-এ function freeze হওয়ার আগে সংযোগ গুছিয়ে নেয়
    if (process.env.VERCEL) {
      attachDatabasePool(client);
    }

    const promise = client
      .connect()
      .then((connected) => connected.db(process.env.DB_NAME || "pizzahub"));
    dbPromise = promise;

    // client বন্ধ হয়ে গেলে মরা cache ফেলে দেওয়া
    client.on("close", () => {
      if (dbPromise === promise) dbPromise = null;
    });

    // connect ব্যর্থ হলে পরের request আবার চেষ্টা করবে
    promise.catch(() => {
      if (dbPromise === promise) dbPromise = null;
      client.close().catch(() => {});
    });
  }
  return dbPromise;
}

module.exports = { getDb };