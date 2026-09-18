/**
 * 「下一题」与键盘同步冒烟探测（开发用）：无头 Edge 打开「和弦指法」页，
 * 跟弹模式下用屏幕键盘锁定 4 个键，点「下一题」后断言：
 *  1. 上一题按住态不残留（有内联点亮样式的锁定键 ≤ 3 = 最多只是新题目标半亮）；
 *  2. 键盘组件锁定态已释放——任意一个先前锁定的键，单击一下立即点亮
 *     （修复前第一下点击是"解锁"，看起来像键盘失灵）；
 *  3. 再点一下熄灭（锁定/解锁循环正常）。
 * 另验证切模式（浏览 → 手碟 → 浏览）后锁定态同样被释放。
 * 用法：先 `pnpm dev`，再 `node scripts/probe-next-sync.mjs`
 */
import { chromium } from 'playwright'

const BASE_URL = process.env.PIANOKITS_URL ?? 'http://localhost:5173'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

/** 派发鼠标 PointerEvent（黑键层拦截真实点击，按仓库惯例走 evaluate 派发） */
async function mouseClickKey(pitch) {
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

/** 键是否有内联点亮样式（setLit 写 style.background） */
const keyLit = (pitch) =>
  page.evaluate((p) => {
    const key = document.querySelector(`[data-pitch="${p}"]`)
    return key !== null && key.style.background !== ''
  }, pitch)

const expect = (cond, msg) => {
  if (!cond) throw new Error(msg)
  console.log(`✓ ${msg}`)
}

try {
  await page.goto(`${BASE_URL}/chord-fingering`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.chordf', { timeout: 30000 })

  // —— 场景 1：跟弹模式，锁定 4 键后点下一题 ——
  await page.getByRole('button', { name: '跟弹', exact: true }).click()
  await page.waitForSelector('.chordf__exambar:not([hidden])')
  for (const p of [60, 64, 67, 69]) await mouseClickKey(p)
  await page.waitForTimeout(150)

  await page.getByRole('button', { name: '下一题' }).click()
  await page.waitForTimeout(150)

  const litLatched = (
    await Promise.all([60, 64, 67, 69].map(async (p) => ((await keyLit(p)) ? p : null)))
  ).filter((p) => p !== null)
  expect(
    litLatched.length <= 3,
    `上一题按住态不残留（点亮锁定键 ${litLatched.length} 个 ≤ 3，仅可能为新题目标半亮）`,
  )

  const before = await page.evaluate(
    () => document.querySelector('[data-pitch="60"]').style.background,
  )
  await mouseClickKey(60)
  await page.waitForTimeout(100)
  const after = await page.evaluate(
    () => document.querySelector('[data-pitch="60"]').style.background,
  )
  expect(before !== after, '下一题后单击 C4 立即生效（组件锁定态已释放，不再需要"解锁"空点）')

  await mouseClickKey(60)
  await page.waitForTimeout(100)
  const restored = await page.evaluate(
    () => document.querySelector('[data-pitch="60"]').style.background,
  )
  expect(restored === before, '再点一下 C4 熄灭（锁定/解锁循环正常）')

  // —— 场景 2：切模式同样释放锁定态 ——
  await mouseClickKey(61)
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: '浏览', exact: true }).click()
  await page.getByRole('button', { name: '手碟', exact: true }).click()
  await page.getByRole('button', { name: '浏览', exact: true }).click()
  await page.waitForTimeout(150)
  const before2 = await page.evaluate(
    () => document.querySelector('[data-pitch="61"]').style.background,
  )
  await mouseClickKey(61)
  await page.waitForTimeout(100)
  const after2 = await page.evaluate(
    () => document.querySelector('[data-pitch="61"]').style.background,
  )
  expect(before2 !== after2, '切模式（浏览→手碟→浏览）后单击 C#4 立即生效（无跨模式锁定残留）')

  if (problems.length > 0) {
    console.error('页面错误:')
    for (const p of problems) console.error('  ' + p)
    throw new Error('存在 pageerror')
  }
  console.log('下一题同步冒烟通过')
} catch (err) {
  console.error('冒烟失败:', err.message)
  await page.screenshot({ path: '/tmp/pianokits-nextsync-fail.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
