import { describe, expect, test } from 'bun:test'
import { SlotPool } from './dispatcher'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('SlotPool', () => {
  test('hands out distinct slots up to its size', async () => {
    const pool = new SlotPool(3)
    const got = [await pool.acquire(), await pool.acquire(), await pool.acquire()]
    expect(new Set(got).size).toBe(3)
    expect(got.sort()).toEqual([0, 1, 2])
  })

  test('blocks once every slot is taken', async () => {
    const pool = new SlotPool(2)
    await pool.acquire()
    await pool.acquire()

    let granted = false
    pool.acquire().then(() => (granted = true))
    await tick()
    expect(granted).toBe(false)
  })

  test('a released slot goes to the longest waiter', async () => {
    const pool = new SlotPool(1)
    const first = await pool.acquire()

    const order: string[] = []
    const a = pool.acquire().then(() => order.push('a'))
    const b = pool.acquire().then(() => order.push('b'))

    pool.release(first)
    await a
    expect(order).toEqual(['a'])

    pool.release(0)
    await b
    expect(order).toEqual(['a', 'b'])
  })

  test('never gives the same slot to two holders at once', async () => {
    const pool = new SlotPool(2)
    const held = new Set<number>()
    let maxConcurrent = 0

    // Ten tasks racing through two slots.
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        const slot = await pool.acquire()
        expect(held.has(slot)).toBe(false)
        held.add(slot)
        maxConcurrent = Math.max(maxConcurrent, held.size)
        await tick()
        held.delete(slot)
        pool.release(slot)
      })
    )

    expect(maxConcurrent).toBe(2)
    expect(pool.available).toBe(2)
  })
})
