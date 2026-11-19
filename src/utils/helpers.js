const { ObjectId } = require("mongodb");

// async route-এর error নিজে global error handler-এ পাঠায়, তাই বারবার try/catch লাগে না
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// শুধু ঠিক ২৪ অক্ষরের hex হলেই ObjectId, নইলে null (invalid ID ধরার জন্য)
function toObjectId(value) {
  const text = String(value || "");
  return /^[a-fA-F0-9]{24}$/.test(text) ? new ObjectId(text) : null;
}

// Search-এ বিশেষ চিহ্ন থাকলে regex যেন না ভাঙে
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Query param array বা object হলে সমস্যা হয়, তাই শুধু string নেওয়া হয়
function asString(value) {
  return typeof value === "string" ? value : "";
}

function getPaging(query, defaultLimit = 12, maxLimit = 48) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

function firstError(result) {
  return result.error.issues[0].message;
}

module.exports = { asyncHandler, toObjectId, escapeRegex, asString, getPaging, firstError };