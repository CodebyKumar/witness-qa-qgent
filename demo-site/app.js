// Fieldnote Supply: demo store for automated QA. Bugs are seeded on purpose and marked "SEEDED BUG".
const PRODUCTS = [
  { id: "mug", name: "Enamel camp mug", price: 18, color: "#d9e7dd" },
  { id: "tee", name: "Organic cotton tee", price: 32, color: "#e6dfd3" },
  { id: "tote", name: "Canvas tote bag", price: 24, color: "#ece4c8" },
  { id: "cap", name: "Wool field cap", price: 28, color: "#d6dde8" },
  { id: "bottle", name: "Steel water bottle", price: 22, color: "#dfe3e6" },
  { id: "notebook", name: "Dot grid notebook", price: 12, color: "#efd9d2" },
];
const money = (n) => "$" + n.toFixed(2);
const cart = () => JSON.parse(localStorage.getItem("cart") || "[]");
const saveCart = (c) => { localStorage.setItem("cart", JSON.stringify(c)); renderCount(); };
const $ = (id) => document.getElementById(id);

function renderCount() { const el = $("cart-count"); if (el) el.textContent = cart().length; }

function renderProducts(filter = "") {
  const grid = $("products"); if (!grid) return;
  const q = filter.trim().toLowerCase();
  const list = PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
  grid.innerHTML = list.map((p) => `<article class="card"><div class="swatch" style="background:${p.color}">${p.name[0]}</div><h3>${p.name}</h3><span class="price">${money(p.price)}</span><button type="button" onclick="addToCart('${p.id}')">Add to cart</button></article>`).join("")
    || `<p class="msg err">No products match "${filter}".</p>`;
  const count = $("result-count"); if (count) count.textContent = q ? `${list.length} result${list.length === 1 ? "" : "s"} for "${filter}"` : "";
}
function search(e) { e.preventDefault(); renderProducts($("q").value); }
function addToCart(id) { saveCart([...cart(), id]); $("added").textContent = PRODUCTS.find((p) => p.id === id).name + " added to cart."; }

function renderCart() {
  const body = $("cart-rows"); if (!body) return;
  const c = cart();
  body.innerHTML = c.map((id, i) => { const p = PRODUCTS.find((x) => x.id === id); return `<tr><td>${p.name}</td><td>${money(p.price)}</td><td><button type="button" class="secondary" onclick="removeFromCart(${i})">Remove</button></td></tr>`; }).join("")
    || `<tr><td colspan="3">Your cart is empty.</td></tr>`;
  const subtotal = c.reduce((s, id) => s + PRODUCTS.find((x) => x.id === id).price, 0);
  $("subtotal").textContent = money(subtotal);
  $("total").textContent = money(subtotal); // SEEDED BUG: a coupon discount is never applied to the total
}
// SEEDED BUG: always removes the first item, not the one clicked.
function removeFromCart(index) { const c = cart(); c.splice(0, 1); saveCart(c); renderCart(); }
function applyCoupon(e) {
  e.preventDefault();
  const code = $("coupon").value.trim().toUpperCase(), msg = $("coupon-msg");
  if (code === "SAVE10") { msg.className = "msg"; msg.textContent = "Coupon SAVE10 applied: 10% off your order."; } // SEEDED BUG: says applied, total unchanged
  else { msg.className = "msg err"; msg.textContent = "That coupon code is not valid."; }
}

function signup(e) {
  e.preventDefault();
  const f = e.target, msg = $("signup-msg");
  if (!f.name.value.trim() || !f.password.value) { msg.className = "msg err"; msg.textContent = "Please fill in every field."; return; }
  if (!f.email.value.trim()) { msg.className = "msg err"; msg.textContent = "Please enter your email."; return; } // SEEDED BUG: no format check, "abc" is accepted
  msg.className = "msg"; msg.textContent = `Welcome, ${f.name.value.trim()}! Your account has been created.`; f.reset();
}

function contact(e) {
  e.preventDefault();
  const f = e.target, msg = $("contact-msg");
  if (!f.name.value.trim() || !f.message.value.trim()) { msg.className = "msg err"; msg.textContent = "Please add your name and a message."; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) { msg.className = "msg err"; msg.textContent = "Please enter a valid email address."; return; }
  msg.className = "msg"; msg.textContent = "Thanks! We'll reply within 1 business day."; f.reset();
}

// Order tracking sits behind a human check that never passes, like a real CAPTCHA wall an agent cannot clear.
function verifyHuman(box) {
  const msg = $("captcha-msg");
  box.disabled = true; msg.className = "msg"; msg.textContent = "Verifying...";
  setTimeout(() => { box.checked = false; box.disabled = false; msg.className = "msg err"; msg.textContent = "Verification failed. Please complete the challenge to continue."; }, 1200);
}

document.addEventListener("DOMContentLoaded", () => { renderCount(); renderProducts(); renderCart(); });
