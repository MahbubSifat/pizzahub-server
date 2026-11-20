const express = require("express");
const { ObjectId } = require("mongodb");
const { z } = require("zod");
const { getDb } = require("../config/db");
const { verifyToken } = require("../middleware/auth");
const { asyncHandler, firstError } = require("../utils/helpers");

const router = express.Router();

// যেকোনো logged-in user (vendor, customer, admin) নিজের profile দেখতে ও বদলাতে পারে
router.use(verifyToken);

// এগুলো profile থেকে বদলানোর চেষ্টা করলেই 403
const FORBIDDEN_FIELDS = [
  "role",
  "isBlocked",
  "subscriptionPlan",
  "subscriptionExpiresAt",
  "email",
];

const profileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60, "Name is too long"),
  businessName: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters")
    .max(80, "Business name is too long")
    .optional(),
  image: z
    .string()
    .url("Image must be a valid URL")
    .refine((url) => url.startsWith("https://"), "Image must use https")
    .nullable()
    .optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ message: "User not found" });

    const premium =
      user.subscriptionPlan === "premium" &&
      !!user.subscriptionExpiresAt &&
      new Date(user.subscriptionExpiresAt) > new Date();

    res.json({
      profile: {
        name: user.name,
        email: user.email,
        image: user.image || null,
        role: user.role,
        businessName: user.businessName || "",
        plan: user.role === "vendor" ? (premium ? "premium" : "free") : null,
        createdAt: user.createdAt || null,
      },
    });
  })
);

router.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (FORBIDDEN_FIELDS.some((field) => field in body)) {
      return res
        .status(403)
        .json({ message: "You cannot change your role, email or subscription from here" });
    }

    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ message: firstError(parsed) });
    }

    const update = { name: parsed.data.name, updatedAt: new Date() };
    if (parsed.data.image !== undefined) update.image = parsed.data.image;
    // businessName শুধু vendor-এর
    if (req.user.role === "vendor" && parsed.data.businessName !== undefined) {
      update.businessName = parsed.data.businessName;
    }

    const db = await getDb();
    await db.collection("users").updateOne({ _id: new ObjectId(req.user.id) }, { $set: update });
    res.json({ message: "Profile updated" });
  })
);

module.exports = router;