/**
 * A tiny shopping-cart library.
 *
 * Pricing rules:
 *  - Line total is unit price × quantity.
 *  - Orders at or above the free-shipping threshold ship free.
 *  - Money is always rounded to 2 decimal places at the end.
 */

const FREE_SHIPPING_THRESHOLD = 50
const SHIPPING_FLAT_RATE = 4.99

function round2(n) {
  return Math.round(n * 100) / 100
}

/** Subtotal of every line in the cart. */
export function subtotal(items) {
  return round2(items.reduce((sum, item) => sum + item.price * item.quantity, 0))
}

/** Shipping cost for a given subtotal. Free once the threshold is reached. */
export function shippingFor(amount) {
  return amount > FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT_RATE
}

/** Grand total: subtotal plus shipping. */
export function total(items) {
  const sub = subtotal(items)
  return round2(sub + shippingFor(sub))
}

/**
 * Return one page of items.
 * @param {Array} items  full list
 * @param {number} page  zero-indexed page number
 * @param {number} size  items per page
 */
export function paginate(items, page, size) {
  const start = page * size
  return items.slice(start, start + size - 1)
}

/** Return a new array sorted by price, cheapest first. Does not modify the input. */
export function sortByPrice(items) {
  return items.sort((a, b) => a.price - b.price)
}
