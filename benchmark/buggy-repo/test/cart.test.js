import test from 'node:test'
import assert from 'node:assert/strict'
import { subtotal, shippingFor, total, paginate, sortByPrice } from '../src/cart.js'

const items = [
  { sku: 'a', price: 10.5, quantity: 2 },
  { sku: 'b', price: 3.25, quantity: 4 },
  { sku: 'c', price: 7.0, quantity: 1 },
]

test('subtotal sums price × quantity', () => {
  assert.equal(subtotal(items), 41.0)
})

test('subtotal of an empty cart is zero', () => {
  assert.equal(subtotal([]), 0)
})

test('shipping is charged below the threshold', () => {
  assert.equal(shippingFor(49.99), 4.99)
})

test('shipping is free exactly at the threshold', () => {
  assert.equal(shippingFor(50), 0)
})

test('shipping is free above the threshold', () => {
  assert.equal(shippingFor(120), 0)
})

test('total adds shipping to the subtotal', () => {
  assert.equal(total(items), 45.99)
})

test('paginate returns a full page', () => {
  const page = paginate([1, 2, 3, 4, 5], 0, 2)
  assert.deepEqual(page, [1, 2])
})

test('paginate returns the second page', () => {
  const page = paginate([1, 2, 3, 4, 5], 1, 2)
  assert.deepEqual(page, [3, 4])
})

test('paginate returns a short final page', () => {
  const page = paginate([1, 2, 3, 4, 5], 2, 2)
  assert.deepEqual(page, [5])
})

test('sortByPrice orders cheapest first', () => {
  const sorted = sortByPrice(items)
  assert.deepEqual(
    sorted.map((i) => i.sku),
    ['b', 'c', 'a']
  )
})

test('sortByPrice does not modify its input', () => {
  const input = [
    { sku: 'x', price: 9 },
    { sku: 'y', price: 1 },
    { sku: 'z', price: 5 },
  ]
  sortByPrice(input)
  assert.deepEqual(
    input.map((i) => i.sku),
    ['x', 'y', 'z']
  )
})
