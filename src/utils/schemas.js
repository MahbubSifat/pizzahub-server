const { z } = require("zod");
const { CATEGORIES, ITEM_STATUSES } = require("./constants");

// Client যা-ই পাঠাক, শুধু এই field-গুলো রাখা হয় (status, vendorId ইত্যাদি বাদ পড়ে যায়)
const menuItemSchema = z.object({
  itemName: z
    .string()
    .trim()
    .min(2, "Item name must be at least 2 characters")
    .max(80, "Item name is too long"),
  category: z.enum(CATEGORIES, { message: "Please choose a valid category" }),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(1000, "Description is too long"),
  price: z.coerce
    .number({ message: "Price must be a number" })
    .positive("Price must be greater than 0")
    .max(100000, "Price is too high")
    .transform((value) => Math.round(value * 100) / 100),
  location: z
    .string()
    .trim()
    .min(2, "Location must be at least 2 characters")
    .max(80, "Location is too long"),
  images: z
    .array(
      z
        .string()
        .url("Each image must be a valid URL")
        .refine((url) => url.startsWith("https://"), "Images must use https")
    )
    .min(1, "At least one image is required")
    .max(4, "You can add up to 4 images"),
});

const availabilitySchema = z.object({
  available: z.boolean({ message: "available must be true or false" }),
});

const adminStatusSchema = z.object({
  status: z.enum(ITEM_STATUSES, { message: "Invalid status" }),
});

// Order: customerId, vendorId ও status কখনো client থেকে আসে না, server নিজে বসায়
const orderSchema = z.object({
  itemId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid item ID"),
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a delivery date"),
  deliveryAddress: z
    .string()
    .trim()
    .min(5, "Delivery address must be at least 5 characters")
    .max(200, "Delivery address is too long"),
  message: z.string().trim().max(300, "Message must be 300 characters or fewer").default(""),
});

const vendorOrderActionSchema = z.object({
  status: z.enum(["accepted", "rejected"], {
    message: "Status must be accepted or rejected",
  }),
});

module.exports = {
  menuItemSchema,
  availabilitySchema,
  adminStatusSchema,
  orderSchema,
  vendorOrderActionSchema,
};