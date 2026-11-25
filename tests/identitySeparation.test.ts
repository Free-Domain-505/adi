import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatCommunityAuthorLabel,
  getPostAuthorIdentityKey,
  isOwnCommunityPost,
  parseCommunityAuthor,
} from '../src/lib/communityIdentity'

test('parseCommunityAuthor cleanly separates display name and unique @handle', () => {
  assert.deepEqual(parseCommunityAuthor('Shadow (@shadow_1)'), {
    displayName: 'Shadow',
    handle: 'shadow_1',
    raw: 'Shadow (@shadow_1)',
  })

  assert.deepEqual(parseCommunityAuthor('  @Shadow_2  '), {
    displayName: 'Shadow_2',
    handle: 'shadow_2',
    raw: '@Shadow_2',
  })

  assert.deepEqual(parseCommunityAuthor('Gojo Satoru'), {
    displayName: 'Gojo Satoru',
    handle: null,
    raw: 'Gojo Satoru',
  })

  assert.deepEqual(parseCommunityAuthor(''), {
    displayName: 'Otaku',
    handle: null,
    raw: 'Otaku',
  })
})

test('formatCommunityAuthorLabel strips duplicate @handle suffixes cleanly', () => {
  assert.equal(formatCommunityAuthorLabel('Shadow', 'shadow_1'), 'Shadow (@shadow_1)')
  assert.equal(formatCommunityAuthorLabel('Shadow (@old_handle)', 'shadow_2'), 'Shadow (@shadow_2)')
  assert.equal(formatCommunityAuthorLabel('Shadow', null), 'Shadow')
})

test('getPostAuthorIdentityKey distinguishes two users with the exact same display name', () => {
  const userOneKey = getPostAuthorIdentityKey({
    user_id: '11111111-1111-1111-1111-111111111111',
    username: 'Shadow (@shadow_1)',
  })
  const userTwoKey = getPostAuthorIdentityKey({
    user_id: '22222222-2222-2222-2222-222222222222',
    username: 'Shadow (@shadow_2)',
  })
  const userThreeSameNameNoHandleKey = getPostAuthorIdentityKey({
    user_id: '33333333-3333-3333-3333-333333333333',
    username: 'Shadow',
  })

  assert.notEqual(userOneKey, userTwoKey)
  assert.notEqual(userOneKey, userThreeSameNameNoHandleKey)
  assert.notEqual(userTwoKey, userThreeSameNameNoHandleKey)
  assert.equal(userOneKey, 'uid:11111111-1111-1111-1111-111111111111')
})

test('isOwnCommunityPost strictly separates users with identical display names and prevents substring collisions', () => {
  const mySentIds = new Set<string>(['legacy-self-post'])

  // User A ("Shadow" / @shadow_1) vs User B ("Shadow" / @shadow_2)
  assert.equal(
    isOwnCommunityPost(
      { id: 'p1', user_id: 'uid-a', username: 'Shadow (@shadow_1)' },
      { userId: 'uid-a', handle: 'shadow_1', mySentIds },
    ),
    true,
  )
  assert.equal(
    isOwnCommunityPost(
      { id: 'p2', user_id: 'uid-b', username: 'Shadow (@shadow_2)' },
      { userId: 'uid-a', handle: 'shadow_1', mySentIds },
    ),
    false,
  )

  // Authoritative UUID mismatch cannot be overridden by handle or local sent list
  assert.equal(
    isOwnCommunityPost(
      { id: 'legacy-self-post', user_id: 'uid-b', username: 'Shadow (@shadow_1)' },
      { userId: 'uid-a', handle: 'shadow_1', mySentIds },
    ),
    false,
  )

  // Prefix/substring handle collision (@ali must NOT match @alina)
  assert.equal(
    isOwnCommunityPost(
      { id: 'p3', user_id: null, username: 'Gojo (@alina)' },
      { userId: 'uid-ali', handle: 'ali', mySentIds },
    ),
    false,
  )

  // Legacy post matching exact @handle still resolves when user_id is null
  assert.equal(
    isOwnCommunityPost(
      { id: 'p4', user_id: null, username: 'Gojo (@ALI)' },
      { userId: 'uid-ali', handle: 'ali', mySentIds },
    ),
    true,
  )

  // Two anonymous guests with same display name "Shadow" are never cross-owned
  assert.equal(
    isOwnCommunityPost(
      { id: 'guest-other', user_id: null, username: 'Shadow' },
      { userId: null, handle: null, mySentIds },
    ),
    false,
  )
  assert.equal(
    isOwnCommunityPost(
      { id: 'legacy-self-post', user_id: null, username: 'Shadow' },
      { userId: null, handle: null, mySentIds },
    ),
    true,
  )

  // Optimistic temporary messages always belong to the sender
  assert.equal(
    isOwnCommunityPost(
      { id: 'temp-12345', user_id: null, username: 'Shadow' },
      { userId: null, handle: null, mySentIds },
    ),
    true,
  )
})
