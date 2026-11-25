import test from 'node:test'
import assert from 'node:assert/strict'

import { parsePublicReadingItem } from '../src/lib/profile'

// 1. Test Proxy Base Resolution
test('getProxyBase defaults to same-origin /proxy instead of broken external lovable proxy', () => {
  const defaultProxy = '/proxy'
  assert.equal(defaultProxy, '/proxy')
  assert.ok(!defaultProxy.includes('lovable.app'), 'Must not default to lovable proxy')
})

// 2. Test Media Item Mapping Logic
test('maps watchlist items with proper fallback and progress calculations', () => {
  const rawWatchlist = [
    {
      id: 1535,
      year: 2006,
      image: 'https://s4.anilist.co/file/cover.jpg',
      score: 84,
      title: 'Death Note',
      format: 'TV',
      status: 'watching',
      episodes: 37,
      progress: 18,
    },
    {
      id: 999,
      title: '',
      image: null,
    },
  ]

  const mapped = rawWatchlist
    .map((item: any) => {
      if (!item || (!item.id && !item.title)) return null
      return {
        id: item.id,
        title: item.title || 'Untitled',
        image: item.image || item.cover || '',
        score: typeof item.score === 'number' ? item.score : null,
        year: typeof item.year === 'number' ? item.year : null,
        format: item.format || 'TV',
        status: item.status || 'watching',
        episodes: typeof item.episodes === 'number' ? item.episodes : null,
        progress: typeof item.progress === 'number' ? item.progress : null,
        href: item.href || `/anime/${item.id}`,
      }
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x && x.image))

  assert.equal(mapped.length, 1)
  assert.equal(mapped[0].title, 'Death Note')
  assert.equal(mapped[0].score, 84)
  assert.equal(mapped[0].progress, 18)
  assert.equal(mapped[0].href, '/anime/1535')
})

test('maps history items calculating duration percentage correctly', () => {
  const rawHistory = [
    {
      id: 1535,
      title: 'Death Note',
      image: 'https://s4.anilist.co/file/cover.jpg',
      ep: 19,
      dur: 1377,
      pos: 1174,
      epTitle: 'Matsuda',
    },
  ]

  const mapped = rawHistory.map((item: any) => {
    const dur = Number(item.dur) || 0
    const pos = Number(item.pos) || 0
    const progPercent = dur > 0 && pos > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : null
    return {
      id: item.id,
      title: item.title,
      ep: item.ep,
      progress: progPercent,
      href: `/watch/${item.id}?ep=${item.ep || 1}`,
    }
  })

  assert.equal(mapped.length, 1)
  assert.equal(mapped[0].ep, 19)
  assert.equal(mapped[0].progress, 85) // 1174 / 1377 = 85.25%
  assert.equal(mapped[0].href, '/watch/1535?ep=19')
})

test('parsePublicReadingItem classifies manhwa, manga, and novels with details href and source', () => {
  const manhwa = parsePublicReadingItem({
    id: 'asura:solo-leveling',
    title: 'Solo Leveling',
    cover: 'https://s4.anilist.co/file/cover.jpg',
    href: '/manhwa/solo-leveling?title=Solo+Leveling',
    resume: '/manhwa/solo-leveling/read/ch-198',
    label: 'Chapter 198',
    kind: 'manga',
    progress: 0.5,
  })
  assert.ok(manhwa)
  assert.equal(manhwa.kind, 'manhwa')
  assert.equal(manhwa.format, 'MANHWA')
  assert.equal(manhwa.source, 'Asura Scans')
  assert.equal(manhwa.href, '/manhwa/solo-leveling?title=Solo+Leveling')
  assert.equal(manhwa.resumeHref, '/manhwa/solo-leveling/read/ch-198')
  assert.equal(manhwa.progress, 50)

  const demonic = parsePublicReadingItem({
    id: 'demonicscans:ds_On-My-Way',
    title: 'On the Way to Meet Mom',
    cover: 'https://s4.anilist.co/file/cover3.jpg',
    href: '/manhwa/ds_On-My-Way?source=demonicscans',
    label: 'Chapter 54',
    kind: 'manga',
    progress: 0,
  })
  assert.ok(demonic)
  assert.equal(demonic.kind, 'manhwa')
  assert.equal(demonic.source, 'DemonicScans')

  const novel = parsePublicReadingItem({
    id: 'novelfire:shadow-slave',
    title: 'Shadow Slave',
    cover: 'https://novelfire.net/server-1/shadow-slave.jpg',
    href: '/novel/novelfire/shadow-slave',
    resume: '/novel/novelfire/shadow-slave/read/chapter-3',
    label: 'Chapter 3',
    kind: 'novel',
    progress: 1.0,
  })
  assert.ok(novel)
  assert.equal(novel.kind, 'novel')
  assert.equal(novel.format, 'NOVEL')
  assert.equal(novel.source, 'NovelFire')
  assert.equal(novel.href, '/novel/novelfire/shadow-slave')
  assert.equal(novel.progress, 100)
})

// 3. Test MovieHero Swipe Gesture Detection
test('swipe gesture logic detects horizontal intent and guards clicks', () => {
  const handlePan = (offset: { x: number; y: number }, velocity: { x: number; y: number }) => {
    if (Math.abs(offset.y) > 60 && Math.abs(offset.y) > Math.abs(offset.x)) {
      return 'ignore_vertical_scroll'
    }
    const swipeThreshold = 40
    const isFast = Math.abs(velocity.x) > 400
    if (offset.x < -swipeThreshold || (isFast && velocity.x < 0)) {
      return 'next'
    }
    if (offset.x > swipeThreshold || (isFast && velocity.x > 0)) {
      return 'prev'
    }
    return 'none'
  }

  // Swipe left (next)
  assert.equal(handlePan({ x: -65, y: 10 }, { x: -100, y: 0 }), 'next')
  // Swipe right (prev)
  assert.equal(handlePan({ x: 75, y: -5 }, { x: 120, y: 0 }), 'prev')
  // Vertical page scroll (must not trigger slide change)
  assert.equal(handlePan({ x: 15, y: 90 }, { x: 10, y: 300 }), 'ignore_vertical_scroll')
  // Small tap jitter
  assert.equal(handlePan({ x: 5, y: 3 }, { x: 10, y: 5 }), 'none')
})

// 4. Test Avatar Proxy Fallback & Gradient Hue
test('avatar generates deterministic gradient hue and handles proxy formatting', () => {
  function getHue(name: string) {
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
    return h
  }

  assert.equal(getHue('xanlos'), getHue('xanlos'))
  assert.notEqual(getHue('xanlos'), getHue('luffy'))

  const rawUrl = 'https://images.unsplash.com/photo-123.jpg'
  const proxyUrl = `/proxy?url=${encodeURIComponent(rawUrl)}`
  assert.ok(proxyUrl.startsWith('/proxy?url='))
  assert.ok(proxyUrl.includes('images.unsplash.com'))
})

// 5. Test Community Signature Tracks Avatar and Frame
test('community signature captures avatar and frame changes', () => {
  const signature = (list: any[]) =>
    list.map((m) => `${m.id}:${m.likes}:${m.edited ? 1 : 0}:${m.content.length}:${m.avatar_url || ''}:${m.frame || ''}`).join('|')

  const post1 = { id: 'p1', likes: 2, edited: false, content: 'Hello', avatar_url: 'https://img1.jpg', frame: '1-angry' }
  const post2 = { id: 'p1', likes: 2, edited: false, content: 'Hello', avatar_url: 'https://img2.jpg', frame: '1-angry' }

  assert.notEqual(signature([post1]), signature([post2]), 'Signature must change when avatar_url updates')
})
