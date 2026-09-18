/**
 * 识别模式冒烟探测（开发用）：无头 Edge 打开「和弦指法」页，
 * 切到识别模式，用屏幕键盘点按出 C大三 / C6 / Am7，断言大字识别结果。
 * 用法：先 `pnpm dev`，再 `node scripts/probe-identify.mjs`
 * 产物：截图写入 /tmp/pianokits-identify-*.png
 */
import { chromium } from 'playwright'

const BASE_URL = process.env.PIANOKITS_URL ?? 'http://localhost:5173'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

/** 点击屏幕键盘键（鼠标点按 = 锁定，再点解锁）。
 *  黑键层会拦截白键上的真实点击（Playwright actionability 校验过不去），
 *  按仓库惯例改用 evaluate 直接在键元素上派发 PointerEvent（pointerType=mouse
 *  走组件的「锁定/解锁」路径）。 */
async function latchPitch(pitch) {
  await page.evaluate((p) => {
    const key = document.querySelector(`[data-pitch="${p}"]`)
    if (key === null) throw new Error(`找不到键 data-pitch=${p}`)
    const opts = {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'mouse',
    }
    key.dispatchEvent(new PointerEvent('pointerdown', opts))
    key.dispatchEvent(new PointerEvent('pointerup', opts))
  }, pitch)
}

try {
  await page.goto(`${BASE_URL}/chord-fingering`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.chordf', { timeout: 30000 })
  console.log('和弦指法工具已挂载')

  // 切到识别模式
  await page.getByRole('button', { name: '识别', exact: true }).click()
  await page.waitForSelector('.chordf__identify')
  const headline0 = await page.locator('.chordf__headline-main').textContent()
  console.log('识别模式初始大字:', JSON.stringify(headline0))

  // C 大三：C4 E4 G4（60 / 64 / 67）
  for (const p of [60, 64, 67]) await latchPitch(p)
  await page.waitForTimeout(200)
  const triad = await page.locator('.chordf__headline-main').textContent()
  const triadSub = await page.locator('.chordf__headline-sub').textContent()
  console.log('C-E-G 识别:', JSON.stringify(triad), '/', JSON.stringify(triadSub))
  await page.screenshot({ path: '/tmp/pianokits-identify-triad.png' })

  // 加 A4（69）→ C6（低音优先：低音 C 记 C6，别解 Am7）
  await latchPitch(69)
  await page.waitForTimeout(200)
  const six = await page.locator('.chordf__headline-main').textContent()
  const sixSub = await page.locator('.chordf__headline-sub').textContent()
  console.log('C-E-G-A 识别:', JSON.stringify(six), '/', JSON.stringify(sixSub))
  await page.screenshot({ path: '/tmp/pianokits-identify-six.png' })

  // 解锁全部后再按 A3 C4 E4 G4（57/60/64/67）→ Am7
  for (const p of [60, 64, 67, 69]) await latchPitch(p)
  await page.waitForTimeout(200)
  for (const p of [57, 60, 64, 67]) await latchPitch(p)
  await page.waitForTimeout(200)
  const am7 = await page.locator('.chordf__headline-main').textContent()
  console.log('A-C-E-G 识别:', JSON.stringify(am7))
  await page.screenshot({ path: '/tmp/pianokits-identify-am7.png' })

  // 识别历史以按压手势为单位：手势 1 = C6（C→C6 演进只留最终），手势 2 = Am7
  // （逐键路过 Am 不单列）→ 共 2 项
  const chips = await page.locator('.chordf__identify .chordf__chip').allTextContents()
  console.log('识别历史:', JSON.stringify(chips))

  const expect = (name, actual, wanted) => {
    if (actual !== wanted) {
      throw new Error(`${name}: 期望 ${JSON.stringify(wanted)}，实际 ${JSON.stringify(actual)}`)
    }
    console.log(`✓ ${name} = ${actual}`)
  }
  expect('C大三识别', triad, 'C')
  expect('C6 识别', six, 'C6')
  expect('Am7 识别', am7, 'Am7')
  if (chips.length !== 2)
    throw new Error(`识别历史应为 2 项（C6、Am7），实际 ${chips.length}: ${JSON.stringify(chips)}`)
  if (JSON.stringify(chips) !== JSON.stringify(['Am7', 'C6'])) {
    throw new Error(`识别历史内容异常：${JSON.stringify(chips)}`)
  }
  if (chips.includes('Am')) throw new Error('逐键中间态 Am 不应入历史')

  if (problems.length > 0) {
    console.error('页面错误:')
    for (const p of problems) console.error('  ' + p)
    throw new Error('存在 pageerror')
  }
  console.log('识别模式冒烟通过')
} catch (err) {
  console.error('冒烟失败:', err.message)
  await page.screenshot({ path: '/tmp/pianokits-identify-fail.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
