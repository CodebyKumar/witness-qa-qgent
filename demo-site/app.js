const PRODUCTS = [
  { id: "mug", name: "Enamel camp mug", price: 18 },
  { id: "tee", name: "Organic cotton tee", price: 32 },
  { id: "bag", name: "Canvas tote bag", price: 24 },
  { id: "cap", name: "Wool field cap", price: 28 },
  { id: "bottle", name: "Steel water bottle", price: 22 },
  { id: "notebook", name: "Dot grid notebook", price: 12 },
];
const cart = () => JSON.parse(localStorage.getItem("cart") || "[]");
const saveCart = (c) => { localStorage.setItem("cart", JSON.stringify(c)); renderCount(); };
function renderCount() { const el = document.getElementById("cart-count"); if (el) el.textContent = cart().length; }
function addToCart(id) { saveCart([...cart(), id]); document.getElementById("added").textContent = PRODUCTS.find((p) => p.id === id).name + " added to cart"; }
// BUG (seeded): removes the first item in the cart, not the one clicked.
function removeFromCart(index) { const c = cart(); c.splice(0, 1); saveCart(c); renderCart(); }
function renderCart() {
  const c = cart(), body = document.getElementById("cart-rows");
  if (!body) return;
  body.innerHTML = c.map((id, i) => { const p = PRODUCTS.find((x) => x.id === id); return `<tr><td>${p.name}</td><td>$${p.price.toFixed(2)}</td><td><button onclick="removeFromCart(${i})">Remove</button></td></tr>`; }).join("") || `<tr><td colspan="3">Your cart is empty.</td></tr>`;
  const subtotal = c.reduce((s, id) => s + PRODUCTS.find((x) => x.id === id).price, 0);
  document.getElementById("subtotal").textContent = "$" + subtotal.toFixed(2);
  document.getElementById("total").textContent = "$" + subtotal.toFixed(2);
}
function applyCoupon(e) {
  e.preventDefault();
  const code = document.getElementById("coupon").value.trim().toUpperCase(), msg = document.getElementById("coupon-msg");
  // BUG (seeded): the message says 10% off, but the total is never recalculated.
  if (code === "SAVE10") { msg.className = "msg"; msg.textContent = "Coupon SAVE10 applied: 10% off your order."; }
  else { msg.className = "msg err"; msg.textContent = "That coupon code is not valid."; }
}
function signup(e) {
  e.preventDefault();
  const f = e.target, msg = document.getElementById("signup-msg");
  if (!f.name.value.trim() || !f.password.value) { msg.className = "msg err"; msg.textContent = "Please fill in every field."; return; }
  // BUG (seeded): no email format check, so "abc" is accepted.
  if (!f.email.value.trim()) { msg.className = "msg err"; msg.textContent = "Please enter your email."; return; }
  msg.className = "msg"; msg.textContent = `Welcome, ${f.name.value.trim()}! Your account has been created.`; f.reset();
}
document.addEventListener("DOMContentLoaded", () => {
  renderCount(); renderCart();
  const grid = document.getElementById("products");
  if (grid) grid.innerHTML = PRODUCTS.map((p) => `<div class="card"><h3>${p.name}</h3><p>$${p.price.toFixed(2)}</p><button onclick="addToCart('${p.id}')">Add to cart</button></div>`).join("");
});
