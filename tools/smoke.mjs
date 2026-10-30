// Локальная проверка клиентской половины без браузера:
// подсказки тарифа/баланса, геометрия графика и разметка чипа.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** Найти каталог, из которого резолвится react (сначала env, потом соседний Voice). */
function resolveReactDir() {
  const candidates = [
    process.env.DSH_TEST_NODE_MODULES,
    join(root, '..', '..', 'Voice', 'node_modules'),
    join(root, 'node_modules'),
  ].filter(Boolean)
  for (const dir of candidates) {
    try {
      const require = createRequire(join(dir, 'noop.js'))
      require.resolve('react')
      require.resolve('react-dom/server')
      return { dir, require }
    } catch {
      /* следующий кандидат */
    }
  }
  return null
}

const found = resolveReactDir()
if (found === null) {
  console.warn('smoke: react не найден, проверяю только чистые функции')
}

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      captured = registration
    },
  },
}

const source = await readFile(join(root, 'client.js'), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', source)(globalThis.window)
assert.ok(captured !== null, 'client.js не зарегистрировал модуль через __ModuleLoader__.load')
assert.equal(captured.id, 'dsh-plugin-wallet-ru')

const react = found?.require('react') ?? null
const client = captured.factory((name) => {
  if (found !== null) return found.require(name)
  throw new Error(`нет модуля ${name}`)
})
assert.equal(typeof client.apply, 'function')
assert.deepEqual(client.inject, ['slots'])

const { priceTooltip, balanceTooltip, weekday, dayText, chartBars, weekWindow, usageReason } = client.__internals
assert.equal(typeof priceTooltip, 'function')
assert.equal(typeof balanceTooltip, 'function')

// --- Подсказка тарифа: активный первым, второй — ниже, только цены.
const peakHint = priceTooltip('peak', { input: 0.28, cacheHit: 0.028, output: 0.42 })
const peakLines = peakHint.split('\n')
assert.equal(peakLines[0], 'Пик (сейчас)')
assert.match(peakLines[1], /ввод \$0\.28 · кэш \$0\.028 · вывод \$0\.42 за 1M токенов/)
assert.equal(peakLines[3], 'Не пик')
assert.match(peakLines[4], /ввод \$0\.14 · кэш \$0\.014 · вывод \$0\.21 за 1M токенов/)
assert.ok(!/Сеанс|Баланс|Источник|Пополнение/.test(peakHint), 'в подсказке тарифа осталось лишнее')

const offpeakHint = priceTooltip('offpeak', null)
assert.equal(offpeakHint.split('\n')[0], 'Не пик (сейчас)')
assert.equal(offpeakHint.split('\n')[3], 'Пик')

// --- Подсказка баланса: доллары, юани, бонусные баллы.
const rich = balanceTooltip({
  phase: 'ready',
  balance: {
    usd: '9.2493601560000000',
    other: [{ currency: 'CNY', balance: '12.5' }],
    bonus: [{ currency: 'USD', balance: '1' }],
  },
})
assert.match(rich, /^Текущий баланс: \$9\.25$/m)
assert.match(rich, /^В юанях: ¥12\.50$/m)
assert.match(rich, /^Бонусные баллы: \$1\.00$/m)

const poor = balanceTooltip({
  phase: 'ready',
  balance: { usd: '0.00', other: [], bonus: [{ currency: 'USD', balance: '0' }] },
})
assert.match(poor, /^В юанях: нет$/m)
assert.match(poor, /^Бонусные баллы: 0$/m)
assert.match(balanceTooltip({ phase: 'loading', balance: null }), /загрузка/)

// --- График: высота по стоимости, нулевой день остаётся полоской.
const days = [
  { date: '2026-10-24', cost: 0, tokens: 0, requests: 0 },
  { date: '2026-10-25', cost: 2.5, tokens: 1_000_000, requests: 10 },
  { date: '2026-10-26', cost: 0.25, tokens: 500_000, requests: 5 },
  { date: '2026-10-27', cost: 0, tokens: 0, requests: 0 },
  { date: '2026-10-28', cost: 1.25, tokens: 700_000, requests: 7 },
  { date: '2026-10-29', cost: 5, tokens: 2_000_000, requests: 20 },
  { date: '2026-10-30', cost: 0.1, tokens: 100_000, requests: 2 },
]
const bars = chartBars(days)
assert.equal(bars.length, 7)
assert.equal(bars[1].height, Math.round(8 + 0.5 * 72))
assert.equal(bars[5].height, 80)
assert.equal(bars[0].height, 3)
assert.equal(bars[3].height, 3)
assert.equal(weekday('2026-10-29'), 'чт')
assert.match(dayText(days[5]), /^29\.10 · \$5\.00 · 2,0 млн токенов · 20 запросов$/)

// --- Старый хост присылает только дни с тратами: окно достраивается до семи.
const now = new Date()
const key = (offset) => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const sparse = [
  { date: key(3), cost: 1.5, tokens: 100, requests: 2 },
  { date: key(0), cost: 0.5, tokens: 50, requests: 1 },
]
const window = weekWindow(sparse)
assert.equal(window.length, 7)
assert.deepEqual(window.map((day) => day.date), [...window.map((day) => day.date)].sort())
assert.equal(window.at(-1).date, key(0))
assert.equal(window.at(-4).date, key(3))
assert.equal(window.at(-4).cost, 1.5)
assert.equal(window.filter((day) => day.requests === 0).length, 5)
assert.deepEqual(weekWindow([]).map((day) => day.requests), [0, 0, 0, 0, 0, 0, 0])
assert.equal(usageReason('no-session-persistence'), 'хост не отдаёт журналы сессий')
assert.equal(usageReason(null), 'нет данных')
assert.equal(usageReason('boom'), 'boom')

// --- Разметка чипа: у сеанса нет title, у тарифа и баланса — есть.
if (found !== null) {
  const { renderToStaticMarkup } = found.require('react-dom/server')
  const html = renderToStaticMarkup(
    react.createElement(client.__internals.BalanceChip, {
      useProjection: (name) =>
        name === 'tokenUsage'
          ? { uncachedInputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500 }
          : undefined,
    }),
  )
  const titles = html.match(/ title="/g) ?? []
  assert.equal(titles.length, 2, `ожидались две подсказки, получено: ${titles.length}`)
  assert.match(html, /title="(Пик|Не пик) \(сейчас\)/)
  assert.match(html, /title="Баланс: загрузка…"/)
  assert.match(html, /aria-label="Траты за 7 дней"/)
  assert.ok(!/title="Траты/.test(html), 'у сеанса не должно быть подсказки')
  assert.ok(!/title="Пополнить/.test(html), 'у ссылки баланса не должно быть отдельной подсказки')
  assert.match(html, /data-composer-stat="balance"/)
}

console.log('smoke: ok')
