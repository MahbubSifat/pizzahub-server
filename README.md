# 🍕 PizzaHub — Pizza Ordering & Delivery Platform (Server)

REST API for PizzaHub, built with **Express.js** and **MongoDB**. It serves menu items, orders, vendor subscriptions (Stripe), dashboards, admin tools and profile management. Authentication is handled by Better Auth on the client side; this server **verifies the JWT** on every protected route.

## Links

- **Live API:** https://pizzahub-server-plum.vercel.app
- **Server repository:** https://github.com/MahbubSifat/pizzahub-server
- **Client repository:** https://github.com/MahbubSifat/pizzahub-client
- **Live site:** https://pizzahub-client-jet.vercel.app

## Important Features

- JWT verification middleware (remote JWKS) with database-backed role and blocked checks
- Role-based access control on every protected route (401 unauthorized, 403 forbidden)
- Menu items: public browsing with advanced search, filters, price sorting and pagination
- Vendor CRUD with ownership checks and a Free plan limit (3 active items)
- Admin approval workflow for menu items
- Orders with business rules: no self-orders, no duplicate active orders, accept / reject / cancel only while pending
- Stripe Checkout (subscription) with a **signature-verified webhook**; Premium is activated only by the webhook
- Read-only transactions for admins
- Request validation with Zod, safe regex search, ObjectId validation

## Technology Stack (npm packages)

| Package | Purpose |
|---|---|
| express | HTTP server and routing |
| cors | Allows only the client origin |
| dotenv | Loads environment variables |
| mongodb | MongoDB driver (aggregation, `$lookup`, `$facet`) |
| jose | JWT verification with remote JWKS |
| zod | Request validation |
| stripe | Checkout Sessions and webhook signature verification |
| nodemon (dev) | Auto-restart in development |

## Environment Variables

Create `.env` (never commit it). Names are listed in `.env.example`:

```
PORT=
MONGODB_URI=
DB_NAME=
CLIENT_URL=
BETTER_AUTH_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

`BETTER_AUTH_URL` must be exactly the client's base URL (it is the JWT issuer and the JWKS host). `CLIENT_URL` is the only allowed CORS origin. Neither should end with `/`.

## Installation and Running Locally

```bash
git clone https://github.com/MahbubSifat/pizzahub-server
cd pizzahub-server
npm install
cp .env.example .env     # then fill in the values
npm run dev              # http://localhost:5000
```

Test the Stripe webhook locally with the Stripe CLI:

```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```

Put the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`.

## Database (collections)

`users` (managed by Better Auth, with `role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt`), `menuItems`, `orders`, `transactions`.

## API Overview

**Public**

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health`, `/api/health/db` | Health checks |
| GET | `/api/menu-items` | Approved items (search, filters, sort, pagination) |
| GET | `/api/menu-items/locations` | Locations for the filter |

**Any logged-in user**

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/menu-items/:id` | Item details (approved items only) |
| GET / PATCH | `/api/profile` | Own profile (role, email and subscription cannot be changed: 403) |

**Customer**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/orders` | Place an order |
| GET | `/api/orders/mine` | Own orders |
| PATCH | `/api/orders/:id/cancel` | Cancel own pending order |
| GET | `/api/overview/customer` | Dashboard statistics |

**Vendor**

| Method | Endpoint | Description |
|---|---|---|
| GET / POST | `/api/vendor/menu-items` | List own / create item |
| GET / PATCH / DELETE | `/api/vendor/menu-items/:id` | Read, update, delete own item |
| PATCH | `/api/vendor/menu-items/:id/availability` | Activate / deactivate |
| GET | `/api/vendor/orders` | Orders for own items |
| PATCH | `/api/vendor/orders/:id` | Accept or reject a pending order |
| POST | `/api/payments/checkout-session` | Start Premium checkout |
| GET | `/api/payments/status` | Plan, usage, renewal state |
| POST | `/api/payments/cancel`, `/api/payments/resume` | Stop / resume renewal |
| GET | `/api/payments/session/:sessionId` | Is the payment confirmed by the webhook? |
| GET | `/api/overview/vendor` | Dashboard statistics |

**Admin**

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/menu-items` | All items (search, filter) |
| PATCH | `/api/admin/menu-items/:id/status` | Approve, reject or change status |
| DELETE | `/api/admin/menu-items/:id` | Delete an item |
| GET | `/api/admin/users` | Users (search, role filter, pagination) |
| PATCH | `/api/admin/users/:id/block` | Block / unblock (admins cannot be blocked) |
| GET | `/api/admin/transactions` | Read-only transactions |
| GET | `/api/overview/admin` | Dashboard statistics |

**Webhook**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/payments/webhook` | Stripe events (raw body, signature verified) |

## Challenge 1: Advanced Search and Sorting

`GET /api/menu-items` accepts these query parameters:

| Parameter | Example | Behaviour |
|---|---|---|
| `search` | `search=margherita` | Case-insensitive match on item name, description and category. User input is regex-escaped, so it is safe. |
| `category` | `category=Meat Lovers` | Must be one of the six categories, otherwise 400. |
| `location` | `location=Dhanmondi` | Case-insensitive partial match. |
| `sort` | `sort=price_asc` or `price_desc` or `newest` | Whitelisted sort keys. Default is `newest`. |
| `featured` | `featured=true` | Premium vendors first, then newest (used on the home page). |
| `page`, `limit` | `page=2&limit=12` | Pagination (default limit 12, maximum 48). |

Only `approved` items are ever returned. Filtering, vendor lookup, sorting and pagination run in one MongoDB aggregation (`$match`, `$lookup`, `$sort`, `$facet`), and the response contains `items`, `total`, `page`, `limit` and `pages`. The client keeps the same parameters in the page URL.

## Challenge 2: JWT Verification Middleware

`verifyToken` (`src/middleware/auth.js`) runs before every protected route:

1. **Read the header.** `Authorization: Bearer <token>` must be present, otherwise **401**.
2. **Verify the token.** `jose.jwtVerify` checks the signature against Better Auth's public keys (JWKS at `${BETTER_AUTH_URL}/api/auth/jwks`), the expiry and the issuer. A malformed, tampered or expired token gives **401**. A key-server problem gives 500 (not a false 401).
3. **Load the real user.** The `sub` claim is used to read the user from MongoDB. A missing user gives **401**.
4. **Blocked check.** A blocked user gets **403**.
5. **Attach the identity.** `req.user` is built from the database (id, name, email, role, plan). The role inside the token or request body is never trusted.

`requireRole("vendor")` (and `"admin"`, `"customer"`) runs next and returns **403** when the role does not match.

```
Request → verifyToken → requireRole → route handler → 2xx / 4xx
            401 / 403       403
```

## Stripe Premium Flow

1. Vendor clicks **Upgrade to Premium**. `POST /api/payments/checkout-session` creates a Checkout Session. The vendor id comes from the verified token, so nobody can create a session for another vendor.
2. The vendor pays on Stripe's page and returns to the **Payment Success** or **Payment Cancel** page.
3. The success page does **not** activate anything. It only asks whether the webhook has confirmed the payment.
4. Stripe calls `POST /api/payments/webhook`. The raw body is verified with the webhook signature (`express.raw` is mounted before `express.json`).
5. On `checkout.session.completed` the server saves the transaction (idempotent, keyed by the Stripe session id) and sets `subscriptionPlan: "premium"` with `subscriptionExpiresAt`.
6. `invoice.paid` extends the period on renewal. `customer.subscription.deleted` moves the vendor back to Free. The expiry date is also checked on every request, so an expired Premium plan stops working immediately.

Test card: `4242 4242 4242 4242`, any future date, any CVC.

## Security Notes

- Role verification on every protected API, not only in the UI
- Ownership checks (a vendor cannot touch another vendor's items or orders; a customer cannot cancel another customer's order)
- Single-use order decisions use conditional updates (`status: "pending"` inside the filter), so double clicks and race conditions cannot change a decided order
- Validation with Zod; invalid ObjectIds return 400, missing records 404
- CORS limited to `CLIENT_URL`
- No secrets in the repository