import { describe, expect, test } from 'bun:test'
import { parseDependencies } from './worker'

describe('parseDependencies', () => {
  test('reads a real dependency list', () => {
    expect(parseDependencies('Done.\nDEPENDENCIES: stripe, zod')).toEqual(['stripe', 'zod'])
  })

  test('accepts scoped and versioned packages', () => {
    expect(parseDependencies('DEPENDENCIES: @scope/pkg, lodash@4.17.21')).toEqual([
      '@scope/pkg',
      'lodash@4.17.21',
    ])
  })

  test('rejects "none" — agents write this constantly', () => {
    expect(parseDependencies('DEPENDENCIES: none')).toEqual([])
    expect(parseDependencies('DEPENDENCIES: N/A')).toEqual([])
  })

  test('ignores prose that merely mentions dependencies', () => {
    expect(parseDependencies('No new dependencies were needed.')).toEqual([])
  })

  test('strips quotes and backticks', () => {
    expect(parseDependencies('DEPENDENCIES: `stripe`, "zod"')).toEqual(['stripe', 'zod'])
  })

  test('deduplicates', () => {
    expect(parseDependencies('DEPENDENCIES: zod, zod')).toEqual(['zod'])
  })

  test('returns nothing when the line is absent', () => {
    expect(parseDependencies('I finished the work.')).toEqual([])
  })
})
