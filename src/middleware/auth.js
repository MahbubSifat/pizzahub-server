const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");

// jose নতুন version-এ ESM, তাই dynamic import ব্যবহার করা হয়েছে (CommonJS-এ নিরাপদ)
let joseModule;
let remoteKeys;

async function loadJose() {
  if (!joseModule) {
    joseModule = await import("jose");
    remoteKeys = joseModule.createRemoteJWKSet(
      new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`)
    );
  }
  return { jwtVerify: joseModule.jwtVerify, keys: remoteKeys };
}

/**
 * Middleware 1: JWT যাচাই।
 * 1) Authorization: Bearer <token> আছে কি না
 * 2) Better Auth-এর public key (JWKS) দিয়ে signature ও মেয়াদ যাচাই
 * 3) Token-এর role বিশ্বাস না করে database থেকে আসল user, role ও isBlocked নেওয়া
 */
async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required" });
  }
  const token = header.slice(7).trim();

  let payload;
  try {
    const { jwtVerify, keys } = await loadJose();
    ({ payload } = await jwtVerify(token, keys, {
      issuer: process.env.BETTER_AUTH_URL,
    }));
  } catch (error) {
    const code = error && error.code ? String(error.code) : "";
    const isTokenProblem = code.startsWith("ERR_J") && code !== "ERR_JWKS_TIMEOUT";
    if (isTokenProblem) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    console.error("Token verification failed:", error.message);
    return res.status(500).json({ message: "Could not verify token" });
  }

  try {
    const userId = String(payload.sub || payload.id || "");
    if (!userId) {
      return res.status(401).json({ message: "Invalid token" });
    }
    const db = await getDb();
    const filter = ObjectId.isValid(userId)
      ? { $or: [{ _id: new ObjectId(userId) }, { id: userId }] }
      : { id: userId };
    const user = await db.collection("users").findOne(filter);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked" });
    }

    // Premium তখনই, যখন plan premium এবং মেয়াদ শেষ হয়নি
    const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
    const isPremium =
      user.subscriptionPlan === "premium" && (!expiresAt || expiresAt > new Date());

    // শুধু database-এর মান ব্যবহার হবে, client-এর পাঠানো role নয়
    req.user = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      businessName: user.businessName,
      subscriptionPlan: user.subscriptionPlan || "free",
      isPremium,
    };
    next();
  } catch (error) {
    console.error("User lookup failed:", error.message);
    res.status(500).json({ message: "Could not verify user" });
  }
}

/**
 * Middleware 2: Role যাচাই। verifyToken-এর পরে বসাতে হয়।
 * ব্যবহার: router.get("/x", verifyToken, requireRole("admin"), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission to do this" });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };