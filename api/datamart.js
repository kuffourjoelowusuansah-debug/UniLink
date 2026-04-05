// api/datamart.js
// UniLink GH — DataMart utility endpoints
// Routes: ?action=balance | order-status | packages | tracker

const DATAMART_API_KEY = process.env.DATAMART_API_KEY;
const BASE = "https://api.datamartgh.shop/api/developer";

const dmHeaders = {
  "Content-Type": "application/json",
  "X-API-Key": DATAMART_API_KEY,
};

async function dmGet(path) {
  const r = await fetch(`${BASE}${path}`, { headers: dmHeaders });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "https://uni-link-iota.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, reference, network } = req.query;

  try {
    // ── GET /balance ─────────────────────────────────────────────────────────
    // Returns: { balance, currency, user: { id, name, email } }
    if (action === "balance") {
      const data = await dmGet("/balance");
      return res.status(200).json(data);
    }

    // ── GET /order-status/:reference ─────────────────────────────────────────
    // Returns: { orderId, reference, phoneNumber, network, capacity,
    //            price, orderStatus, processingMethod, createdAt, updatedAt }
    if (action === "order-status") {
      if (!reference) return res.status(400).json({ error: "?reference= required" });
      const data = await dmGet(`/order-status/${encodeURIComponent(reference)}`);
      return res.status(200).json(data);
    }

    // ── GET /data-packages?network=YELLO ─────────────────────────────────────
    // Returns packages grouped by network with capacity (GB) and price (GHS)
    // Networks: YELLO | TELECEL | AT_PREMIUM
    if (action === "packages") {
      const net = network ?? "";  // empty = all networks
      const data = await dmGet(`/data-packages${net ? `?network=${net}` : ""}`);
      return res.status(200).json(data);
    }

    // ── GET /delivery-tracker ─────────────────────────────────────────────────
    // Returns live scanner status + your orders in current batch
    if (action === "tracker") {
      const data = await dmGet("/delivery-tracker");
      return res.status(200).json(data);
    }

    // ── GET /transactions?page=1&limit=20 ─────────────────────────────────────
    if (action === "transactions") {
      const page  = req.query.page  ?? 1;
      const limit = req.query.limit ?? 20;
      const data  = await dmGet(`/transactions?page=${page}&limit=${limit}`);
      return res.status(200).json(data);
    }

    return res.status(400).json({
      error: "?action= must be: balance | order-status | packages | tracker | transactions",
    });

  } catch (err) {
    console.error("DataMart utility error:", err);
    return res.status(502).json({ error: "DataMart request failed.", detail: err.message });
  }
}
