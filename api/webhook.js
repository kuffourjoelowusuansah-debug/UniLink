// api/webhook.js — Vercel Serverless Function

import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ✅ STEP 1: Verify the request is genuinely from Paystack
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const hash = crypto
    .createHmac("sha512", paystackSecret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    console.log("❌ Invalid signature — request not from Paystack");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ✅ STEP 2: Only act on successful payments
  const event = req.body;
  if (event.event !== "charge.success") {
    return res.status(200).json({ message: "Event ignored" });
  }

  // ✅ STEP 3: Extract customer details from the payment metadata
  // These come from your Paystack payment form's metadata field
  const { phone, network, bundleCode } = event.data.metadata;
  const amount = event.data.amount / 100; // Paystack sends in pesewas

  console.log(`📦 Order received: ${bundleCode} for ${phone} on ${network}`);

  // ✅ STEP 4: Send the bundle via Datamartgh API
  try {
    const datamartResponse = await fetch("https://api.datamartgh.shop/api/developer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${process.env.DATAMARTGH_API_KEY}`,
      },
      body: JSON.stringify({
        phone_number: phone,   // customer's number
        network: network,      // e.g. "MTN", "AirtelTigo", "Telecel"
        bundle_code: bundleCode, // the specific bundle ID from Datamartgh
      }),
    });

    const result = await datamartResponse.json();
    console.log("✅ Datamartgh response:", result);

    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("❌ Datamartgh API error:", error);
    return res.status(500).json({ error: "Bundle delivery failed" });
  }
}
