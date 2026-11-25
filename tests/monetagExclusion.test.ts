import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  MONETAG_EXCLUDED_UIDS,
  MONETAG_SCRIPT_SRC,
  MONETAG_ZONE_ID,
  isExcludedAdUser,
  resolveMonetagExclusion,
  syncMonetagForAuthState,
} from '../src/lib/monetag'

test('Monetag ads are completely removed and disabled across the application', () => {
  assert.equal(MONETAG_ZONE_ID, '')
  assert.equal(MONETAG_SCRIPT_SRC, '')
  assert.equal(MONETAG_EXCLUDED_UIDS.size, 0)
  assert.equal(isExcludedAdUser('any-uid'), true)

  const html = fs.readFileSync(path.resolve('index.html'), 'utf8')
  assert.equal(html.includes('monetag'), false)
  assert.equal(html.includes('al5sm.com'), false)
})

test('resolveMonetagExclusion and syncMonetagForAuthState return excluded/inert status', async () => {
  const res = await resolveMonetagExclusion('any-token')
  assert.deepEqual(res, { resolved: true, excluded: true })

  const state = await syncMonetagForAuthState({ authLoading: false, accessToken: null })
  assert.equal(state, 'excluded')
})
