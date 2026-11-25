import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_CUSTOM_COLORS,
  DEFAULT_NAME_STYLE,
  NAME_ANIMATION_OPTIONS,
  NAME_GRADIENT_PRESETS,
  buildGradientCss,
  createStyleFromPreset,
  isDefaultNameStyle,
  resolveNameStylePresentation,
  sanitizeColors,
  sanitizeHexColor,
  sanitizeNameStyle,
  serializeNameStyle,
} from '../src/lib/nameStyle'

test('includes at least 11 presets (19 total) with Default strictly first and every required preset present', () => {
  assert.ok(NAME_GRADIENT_PRESETS.length >= 19, `Expected >= 19 presets, got ${NAME_GRADIENT_PRESETS.length}`)
  assert.equal(NAME_GRADIENT_PRESETS[0]?.id, 'default')
  assert.equal(NAME_GRADIENT_PRESETS[0]?.name, 'Default')

  const requiredNames = [
    'Default',
    'Sunset',
    'Ocean Blue',
    'Purple Dream',
    'Neon Cyber',
    'Aurora',
    'Fire',
    'Candy',
    'Rose Gold',
    'Emerald',
    'Galaxy',
    'Rainbow',
    'Midnight',
    'Electric Violet',
    'Toxic Green',
    'Ice Crystal',
    'Cherry Blossom',
    'Golden Glow',
    'Cosmic Nebula',
  ]

  const presetNames = new Set(NAME_GRADIENT_PRESETS.map((p) => p.name))
  for (const name of requiredNames) {
    assert.ok(presetNames.has(name), `Missing required preset: ${name}`)
  }

  for (const preset of NAME_GRADIENT_PRESETS.slice(1)) {
    assert.ok(preset.colors.length >= 2, `Preset ${preset.id} must define >= 2 color stops`)
    for (const hex of preset.colors) {
      assert.match(hex, /^#[0-9A-F]{6}$/, `Preset ${preset.id} has invalid normalized hex ${hex}`)
    }
  }
})

test('includes all 9 required animated gradient effects plus None', () => {
  const requiredAnimations = [
    'Smooth Moving Gradient',
    'Rainbow Animation',
    'Neon Pulse',
    'Colour Shifting',
    'Aurora Flow',
    'Shimmer Effect',
    'RGB Flow',
    'Cosmic Glow',
    'Holographic Effect',
  ]
  const animNames = new Set(NAME_ANIMATION_OPTIONS.map((a) => a.name))
  assert.ok(NAME_ANIMATION_OPTIONS.some((a) => a.id === 'none'))
  for (const name of requiredAnimations) {
    assert.ok(animNames.has(name), `Missing required animation option: ${name}`)
  }
})

test('Default style preserves original Animestream appearance with zero gradient, animation, glow, or shadow', () => {
  assert.equal(isDefaultNameStyle(null), true)
  assert.equal(isDefaultNameStyle(undefined), true)
  assert.equal(isDefaultNameStyle(DEFAULT_NAME_STYLE), true)
  assert.equal(serializeNameStyle(DEFAULT_NAME_STYLE), null)

  const resolvedDefault = resolveNameStylePresentation(DEFAULT_NAME_STYLE)
  assert.equal(resolvedDefault.isDefault, true)
  assert.equal(resolvedDefault.className, '')
  assert.deepEqual(resolvedDefault.style, {})

  // Switching from custom preset back to Default cleanly restores default
  const customSunset = createStyleFromPreset('sunset')
  assert.equal(isDefaultNameStyle(customSunset), false)
  const resetToDefault = createStyleFromPreset('default', customSunset)
  assert.equal(isDefaultNameStyle(resetToDefault), true)
  assert.equal(serializeNameStyle(resetToDefault), null)
})

test('sanitizes hex colors, numerical bounds, and rejects CSS injection payloads', () => {
  assert.equal(sanitizeHexColor('#abc'), '#AABBCC')
  assert.equal(sanitizeHexColor('  #ff512f  '), '#FF512F')
  assert.equal(sanitizeHexColor('red; background: url(javascript:alert(1))', '#123456'), '#123456')
  assert.equal(sanitizeHexColor('expression(alert(1))', '#123456'), '#123456')
  assert.equal(sanitizeHexColor('#GGGGGG', '#123456'), '#123456')

  const cleanedColors = sanitizeColors([
    '#ff00aa',
    'javascript:alert(1)',
    '#00f',
    'url(https://evil.test)',
    '#112233',
    '#445566',
    '#778899',
    '#AABBCC',
    '#DDEEFF',
  ])
  assert.deepEqual(cleanedColors, ['#FF00AA', '#0000FF', '#112233', '#445566', '#778899', '#AABBCC'])

  const hostile = sanitizeNameStyle({
    presetId: 'sunset;color:red',
    colors: ['red;position:fixed', 'expression(1)'],
    angle: 9999,
    animation: 'evil-keyframes' as unknown as string,
    animationSpeed: 99,
    animationDirection: 'sideways' as unknown as string,
    staticGradient: false,
    gradientIntensity: -50,
    bold: true,
    glowEnabled: true,
    glowIntensity: 500,
    softShadow: true,
  })

  // Unrecognized preset falls back to 'default' and cleans unsafe colors
  assert.equal(hostile.presetId, 'default')
  assert.deepEqual(hostile.colors, [])
  assert.equal(hostile.angle, 360)
  assert.equal(hostile.animation, 'none')
  assert.equal(hostile.animationSpeed, 3)
  assert.equal(hostile.animationDirection, 'normal')
  assert.equal(hostile.gradientIntensity, 50)
  assert.equal(hostile.glowIntensity, 100)

  // Custom preset with injected colors falls back to safe default stops and safe gradient CSS
  const hostileCustom = sanitizeNameStyle({
    presetId: 'custom',
    colors: ['red; background: url(http://evil)'],
    angle: -45,
    animation: 'rainbow',
    animationSpeed: 0.1,
    animationDirection: 'reverse',
    gradientIntensity: 250,
    glowEnabled: true,
    glowIntensity: 80,
  })
  assert.equal(hostileCustom.presetId, 'custom')
  assert.deepEqual(hostileCustom.colors, DEFAULT_CUSTOM_COLORS)
  assert.equal(hostileCustom.angle, 0)
  assert.equal(hostileCustom.animation, 'rainbow')
  assert.equal(hostileCustom.animationSpeed, 0.5)
  assert.equal(hostileCustom.animationDirection, 'reverse')
  assert.equal(hostileCustom.gradientIntensity, 150)
  assert.equal(hostileCustom.glowIntensity, 80)

  const safeCss = buildGradientCss(['bad-value', '#123456', '#abcdef'], 180)
  assert.equal(safeCss, 'linear-gradient(180deg, #123456, #ABCDEF)')
})

test('resolveNameStylePresentation applies staticGradient, bold, glow, softShadow, speed, and direction accurately', () => {
  const animated = sanitizeNameStyle({
    presetId: 'neon-cyber',
    colors: ['#00F5D4', '#00BBF9', '#F15BB5'],
    angle: 120,
    animation: 'neon-pulse',
    animationSpeed: 2,
    animationDirection: 'alternate',
    staticGradient: false,
    gradientIntensity: 130,
    bold: true,
    glowEnabled: true,
    glowIntensity: 75,
    softShadow: true,
  })

  const activeRes = resolveNameStylePresentation(animated)
  assert.equal(activeRes.isDefault, false)
  assert.ok(activeRes.className.includes('zk-name-gradient'))
  assert.ok(activeRes.className.includes('zk-name-fx'))
  assert.ok(activeRes.className.includes('zk-name-fx-neon-pulse'))
  assert.equal(activeRes.style.fontWeight, 900)
  assert.equal(activeRes.style.WebkitTextFillColor, 'transparent')
  assert.ok(String(activeRes.style.filter).includes('drop-shadow('))
  assert.ok(String(activeRes.style.filter).includes('saturate(1.30)'))
  assert.equal((activeRes.style as Record<string, string>)['--zk-name-dur'], '1.20s')
  assert.equal((activeRes.style as Record<string, string>)['--zk-name-dir'], 'alternate')

  // Non-bold custom style uses medium 500 weight so bold (900) is visibly heavier
  const nonBoldRes = resolveNameStylePresentation({ ...animated, bold: false })
  assert.equal(nonBoldRes.style.fontWeight, 500)

  // Standalone bold without gradient keeps normal text color while applying fontWeight 900
  const boldOnly = sanitizeNameStyle({ ...DEFAULT_NAME_STYLE, bold: true })
  assert.equal(isDefaultNameStyle(boldOnly), false)
  const boldOnlyRes = resolveNameStylePresentation(boldOnly)
  assert.equal(boldOnlyRes.isDefault, false)
  assert.equal(boldOnlyRes.style.fontWeight, 900)
  assert.equal(boldOnlyRes.style.WebkitTextFillColor, undefined)

  // Static gradient mode disables motion classes while retaining gradient and styling
  const staticRes = resolveNameStylePresentation({ ...animated, staticGradient: true })
  assert.equal(staticRes.isDefault, false)
  assert.ok(staticRes.className.includes('zk-name-gradient'))
  assert.equal(staticRes.className.includes('zk-name-fx'), false)
  assert.equal((staticRes.style as Record<string, string>)['--zk-name-dur'], undefined)
})

test('color-shift mirrors gradient stops and preserves --zk-name-filter for animated hue rotation', async () => {
  const colorShiftGlow = sanitizeNameStyle({
    presetId: 'purple-dream',
    colors: ['#A855F7', '#EC4899', '#6366F1'],
    angle: 0,
    animation: 'color-shift',
    animationSpeed: 1.5,
    animationDirection: 'normal',
    staticGradient: false,
    gradientIntensity: 120,
    bold: true,
    glowEnabled: true,
    glowIntensity: 70,
    softShadow: false,
  })
  const res = resolveNameStylePresentation(colorShiftGlow)
  assert.ok(res.className.includes('zk-name-fx-color-shift'))
  // Mirrored stops ensure smooth cycling even at 0deg / 180deg angles
  assert.equal(
    res.style.backgroundImage,
    'linear-gradient(0deg, #A855F7, #EC4899, #6366F1, #EC4899, #A855F7, #A855F7)',
  )
  const filterVar = (res.style as Record<string, string>)['--zk-name-filter']
  assert.ok(filterVar && filterVar.includes('drop-shadow(') && filterVar.includes('saturate(1.20)'))

  const fs = await import('node:fs')
  const styledNameSrc = fs.readFileSync('src/components/StyledDisplayName.tsx', 'utf8')
  const communitySrc = fs.readFileSync('src/pages/CommunityPage.tsx', 'utf8')
  assert.match(styledNameSrc, /useUserNameStyle\(/)
  assert.match(communitySrc, /isSelf=\{Boolean\(user\?\.id && stats\.loved\.user_id === user\.id\)\}/)
})

