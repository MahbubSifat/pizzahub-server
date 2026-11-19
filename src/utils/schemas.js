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

module.exports = { menuItemSchema, availabilitySchema, adminStatusSchema };