// api/fulfill-order.js
// UniLink GH — Paystack → DataMart GH fulfillment
// Vercel serverless function — deploy at /api/fulfill-order.js

const PAYSTACK_SECRET  = process.env.PAYSTACK_SECRET_KEY;
const DATAMART_API_KEY = process.env.DATAMART_API_KEY;
const DATAMART_BASE    = "https://api.datamartgh.shop/api/developer";

// DataMart network codes (from their docs)
const NETWORK_MAP = {
  MTN:        "YELLO",
  YELLO:      "YELLO",
  TELECEL:    "TELECEL",
  AT:         "AT_PREMIUM",
  AIRTELTIGO: "AT_PREMIUM",
  AT_PREMIUM: "AT_PREMIUM",
};

// ─── Verify Paystack payment ──────────────────────────────────────────────────
async function verifyPaystackPayment(reference) {
  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
  );
  return res.json();
}

// ─── Purchase data via DataMart API ──────────────────────────────────────────
// POST https://api.datamartgh.shop/api/developer/purchase
// Body: { phoneNumber, network, capacity, gateway }
async function purchaseData({ phoneNumber, network, capacityGB }) {
  const res = await fetch(`${DATAMART_BASE}/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": DATAMART_API_KEY,      // exact header name from docs
    },
    body: JSON.stringify({
      phoneNumber: phoneNumber,            // "0551234567"
      network:     NETWORK_MAP[network.toUpperCase()] ?? network,  // "YELLO" | "TELECEL" | "AT_PREMIUM"
      capacity:    String(capacityGB),     // GB as string e.g. "5"
      gateway:     "wallet",              // always wallet for API purchases
    }),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, data: json };
}

// ─── Duplicate order guard (in-memory — swap for Supabase in production) ─────
const fulfilled = new Map();

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "https://uni-link-iota.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const {
    paystackRef,     // Paystack transaction reference
    phoneNumber,     // recipient phone e.g. "0244123456"
    network,         // "MTN" | "TELECEL" | "AT"
    capacityGB,      // number e.g. 5
    bundleLabel,     // display name e.g. "5GB MTN" (for confirmation message)
    customerEmail,
    customerName,
  } = req.body ?? {};

  // ── 1. Validate ────────────────────────────────────────────────────────────
  if (!paystackRef || !phoneNumber || !network || !capacityGB) {
    return res.status(400).json({
      error: "Missing fields: paystackRef, phoneNumber, network, capacityGB",
    });
  }

  // ── 2. Prevent double fulfillment ──────────────────────────────────────────
  if (fulfilled.has(paystackRef)) {
    return res.status(200).json({
      status:  "already_fulfilled",
      message: "This order was already processed.",
      order:   fulfilled.get(paystackRef),
    });
  }

  // ── 3. Verify Paystack payment ─────────────────────────────────────────────
  let ps;
  try { ps = await verifyPaystackPayment(paystackRef); }
  catch (err) {
    console.error("Paystack error:", err);
    return res.status(502).json({ error: "Could not verify payment with Paystack." });
  }

  if (!ps?.data || ps.data.status !== "success") {
    return res.status(402).json({
      error: `Payment not confirmed. Paystack status: ${ps?.data?.status ?? "unknown"}`,
    });
  }

  const amountPaid = ps.data.amount / 100; // Paystack stores in pesewas
  console.log(`✅ Paystack verified | ref: ${paystackRef} | GH₵${amountPaid} | ${customerEmail}`);

  // ── 4. Purchase via DataMart API ───────────────────────────────────────────
  let result;
  try { result = await purchaseData({ phoneNumber, network, capacityGB }); }
  catch (err) {
    console.error("DataMart error:", err);
    return res.status(502).json({
      error:      "Payment confirmed but DataMart delivery failed. Please contact support.",
      paystackRef,
      support:    "WhatsApp: 0248745662",
    });
  }

  // DataMart insufficient balance error
  if (!result.ok && result.data?.message?.includes("Insufficient")) {
    console.error("DataMart insufficient balance:", result.data);
    return res.status(502).json({
      error:          "Service temporarily unavailable. Please contact support immediately.",
      paystackRef,
      support:        "WhatsApp: 0248745662",
      datamartError:  result.data,
    });
  }

  // Other DataMart errors
  if (!result.ok) {
    console.error("DataMart rejected order:", result);
    return res.status(502).json({
      error:      `DataMart error: ${result.data?.message ?? "Unknown error"}`,
      paystackRef,
      support:    "WhatsApp: 0248745662",
    });
  }

  // ── 5. Success ─────────────────────────────────────────────────────────────
  const dm = result.data?.data ?? {};
  const order = {
    paystackRef,
    phoneNumber,
    network,
    capacityGB,
    bundleLabel:          bundleLabel ?? `${capacityGB}GB ${network}`,
    customerEmail,
    customerName,
    amountPaid,
    datamartPurchaseId:   dm.purchaseId,
    datamartOrderRef:     dm.orderReference,
    datamartTxRef:        dm.transactionReference,
    datamartStatus:       dm.orderStatus,
    datamartBalanceAfter: dm.balanceAfter,
    fulfilledAt:          new Date().toISOString(),
  };

  fulfilled.set(paystackRef, order);
  console.log(`📦 Delivered: ${bundleLabel} → ${phoneNumber} | DM ref: ${dm.orderReference}`);

  return res.status(200).json({
    status:  "fulfilled",
    message: `✅ Your ${order.bundleLabel} bundle is on its way to ${phoneNumber}!`,
    order,
  });
}
