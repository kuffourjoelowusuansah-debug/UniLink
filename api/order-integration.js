/**
 * UniLink GH — Frontend Order Integration (v2)
 * =============================================
 * Uses exact DataMart API field names from docs.
 *
 * Network codes:  MTN → YELLO | AirtelTigo → AT_PREMIUM | Telecel → TELECEL
 * Bundle system:  capacity in GB (integer) — no bundle codes needed
 * Auth:           X-API-Key header (handled server-side only)
 *
 * SETUP:
 *  1. Replace PAYSTACK_PUBLIC_KEY with your live public key
 *  2. Replace BACKEND_URL with your Vercel deployment URL
 *  3. Add <script src="https://js.paystack.co/v1/inline.js"></script> to HTML
 *  4. Add <div id="order-status"></div> wherever you want status messages
 */

const PAYSTACK_PUBLIC_KEY = "pk_live_90305707d30b6282979eac837bbbc9509da579af"; // ← your key
const BACKEND_URL = "https://uni-link-iota.vercel.app";

// ─── Network display names ────────────────────────────────────────────────────
const NETWORK_DISPLAY = {
  YELLO:      "MTN",
  TELECEL:    "Telecel",
  AT_PREMIUM: "AirtelTigo",
};

// ─── Bundle catalogue (loaded dynamically from DataMart /data-packages) ───────
// Fallback static prices if API fetch fails
const FALLBACK_BUNDLES = {
  YELLO: [
    { capacity: 1,  price: 4.00  },
    { capacity: 2,  price: 9.00  },
    { capacity: 5,  price: 23.00 },
    { capacity: 10, price: 42.00 },
    { capacity: 20, price: 80.00 },
    { capacity: 30, price: 120.00 },
    { capacity: 50, price: 195.00 },
  ],
  TELECEL: [
    { capacity: 5,  price: 40.00  },
    { capacity: 10, price: 75.00  },
    { capacity: 20, price: 140.00 },
  ],
  AT_PREMIUM: [
    { capacity: 1,  price: 4.50  },
    { capacity: 2,  price: 8.50  },
    { capacity: 5,  price: 21.00 },
    { capacity: 10, price: 40.00 },
    { capacity: 20, price: 78.00 },
  ],
};

let liveBundles = null; // populated from DataMart API

// ─── Load live prices from DataMart API ──────────────────────────────────────
async function loadLiveBundles() {
  try {
    const r = await fetch(`${BACKEND_URL}/api/datamart?action=packages`);
    const json = await r.json();
    if (json?.data) {
      liveBundles = json.data;
      console.log("✅ Loaded live DataMart bundle prices.");
    }
  } catch (err) {
    console.warn("Could not load live prices, using fallback.", err);
    liveBundles = FALLBACK_BUNDLES;
  }
}

function getBundles(network) {
  const src = liveBundles ?? FALLBACK_BUNDLES;
  return src[network] ?? [];
}

// ─── Generate reference ID ────────────────────────────────────────────────────
function makeRef() {
  return `UNILINK-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// ─── Main: initiate a Paystack payment then fulfill via DataMart ──────────────
async function initiateOrder({ customerName, customerEmail, phoneNumber, network, capacityGB }) {
  const bundles = getBundles(network);
  const bundle  = bundles.find((b) => b.capacity === Number(capacityGB));
  if (!bundle) throw new Error(`Bundle ${capacityGB}GB not found for ${network}.`);

  // Add your markup on top of DataMart's price
  // e.g. if DataMart charges GH₵23, you charge GH₵25 → profit GH₵2
  const MARKUP_GHS  = 2.00; // adjust per bundle size if you want tiered margins
  const chargePrice = bundle.price + MARKUP_GHS;
  const amountInPesewas = Math.round(chargePrice * 100);

  const networkLabel = NETWORK_DISPLAY[network] ?? network;
  const bundleLabel  = `${capacityGB}GB ${networkLabel}`;

  return new Promise((resolve, reject) => {
    const handler = PaystackPop.setup({
      key:      PAYSTACK_PUBLIC_KEY,
      email:    customerEmail,
      amount:   amountInPesewas,
      currency: "GHS",
      ref:      makeRef(),
      label:    `UniLink GH — ${bundleLabel}`,
      metadata: {
        custom_fields: [
          { display_name: "Customer",   variable_name: "customer",    value: customerName },
          { display_name: "Recipient",  variable_name: "phone",       value: phoneNumber  },
          { display_name: "Network",    variable_name: "network",     value: networkLabel },
          { display_name: "Bundle",     variable_name: "bundle",      value: bundleLabel  },
        ],
      },

      // ── Payment confirmed → call backend to fulfill ───────────────────────
      callback: async function (response) {
        showStatus("loading", `Payment confirmed! Sending ${bundleLabel} to ${phoneNumber}…`);

        try {
          const res = await fetch(`${BACKEND_URL}/api/fulfill-order`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paystackRef:  response.reference,
              phoneNumber,          // e.g. "0244123456"
              network,              // "YELLO" | "TELECEL" | "AT_PREMIUM"
              capacityGB,           // e.g. 5
              bundleLabel,          // "5GB MTN"
              customerEmail,
              customerName,
            }),
          });

          const result = await res.json();

          if (res.ok && result.status === "fulfilled") {
            showStatus("success",
              `✅ ${bundleLabel} is on its way to ${phoneNumber}! ` +
              `Order ref: ${result.order?.datamartOrderRef ?? response.reference}`
            );
            saveToHistory(result.order);
            resolve(result);

          } else if (result.status === "already_fulfilled") {
            showStatus("success", "✅ Bundle already sent. Check your phone.");
            resolve(result);

          } else {
            // Payment went through but DataMart delivery failed
            showStatus("error",
              `Payment received (ref: ${response.reference}). ` +
              `There was a delivery issue — WhatsApp us at 0248745662 immediately.`
            );
            reject(new Error(result.error));
          }

        } catch (err) {
          showStatus("error",
            `Network error. Your payment ref is <strong>${response.reference}</strong>. ` +
            `WhatsApp us at 0248745662 and we'll fix it within 5 minutes.`
          );
          reject(err);
        }
      },

      onClose: function () {
        showStatus("idle", "");
      },
    });

    handler.openIframe();
  });
}

// ─── Order history ────────────────────────────────────────────────────────────
function saveToHistory(order) {
  try {
    const history = JSON.parse(localStorage.getItem("unilink_orders") || "[]");
    history.unshift(order);
    localStorage.setItem("unilink_orders", JSON.stringify(history.slice(0, 100)));
  } catch {}
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem("unilink_orders") || "[]");
  } catch { return []; }
}

// ─── UI status display ────────────────────────────────────────────────────────
function showStatus(type, message) {
  const el = document.getElementById("order-status");
  if (!el) return;
  const icons = { loading: "⏳", success: "✅", error: "❌", idle: "" };
  el.innerHTML  = message ? `<span>${icons[type]} ${message}</span>` : "";
  el.className  = `order-status order-status--${type}`;
}

// ─── Populate bundle <select> dropdown dynamically ────────────────────────────
function populateBundleDropdown(selectId, network) {
  const select  = document.getElementById(selectId);
  if (!select) return;
  const bundles = getBundles(network);
  select.innerHTML = `<option value="">Select bundle</option>`;
  bundles.forEach((b) => {
    const opt   = document.createElement("option");
    opt.value   = b.capacity;
    opt.textContent = `${b.capacity}GB — GH₵${(b.price + 2).toFixed(2)}`; // show your price
    select.appendChild(opt);
  });
}

// ─── Form submit handler ──────────────────────────────────────────────────────
// Wire to your existing form submit button
async function handleOrderSubmit() {
  const customerName  = document.getElementById("customer-name")?.value?.trim();
  const customerEmail = document.getElementById("customer-email")?.value?.trim();
  const phoneNumber   = document.getElementById("recipient-phone")?.value?.trim();
  const networkRaw    = document.getElementById("network-select")?.value;   // "MTN" | "TELECEL" | "AT"
  const capacityGB    = document.getElementById("bundle-select")?.value;    // GB number as string

  // Map display names to DataMart codes
  const networkMap = { MTN: "YELLO", TELECEL: "TELECEL", AT: "AT_PREMIUM", AIRTELTIGO: "AT_PREMIUM" };
  const network = networkMap[networkRaw?.toUpperCase()] ?? networkRaw;

  if (!customerName || !customerEmail || !phoneNumber || !network || !capacityGB) {
    showStatus("error", "Please fill in all fields."); return;
  }

  // Ghana phone number validation
  if (!/^(\+233|0)(2[0-9]|5[0-9])\d{7}$/.test(phoneNumber)) {
    showStatus("error", "Enter a valid Ghana phone number (e.g. 024XXXXXXX)."); return;
  }

  try {
    await initiateOrder({
      customerName, customerEmail, phoneNumber,
      network, capacityGB: Number(capacityGB),
    });
  } catch (err) {
    console.error("Order error:", err);
  }
}

// ─── Check DataMart wallet balance (admin use) ────────────────────────────────
async function checkBalance() {
  const r    = await fetch(`${BACKEND_URL}/api/datamart?action=balance`);
  const json = await r.json();
  return json?.data?.balance; // GHS amount
}

// ─── Initialise on page load ──────────────────────────────────────────────────
(async function init() {
  await loadLiveBundles();
  console.log("UniLink order system ready.");
})();

// ─── Public API ───────────────────────────────────────────────────────────────
window.UniLink = {
  initiateOrder,
  handleOrderSubmit,
  populateBundleDropdown,
  checkBalance,
  getHistory,
  getBundles,
  loadLiveBundles,
};
