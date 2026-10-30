// Проверка хост-маршрутов без запуска DSH: /wallet-ru и /wallet-ru/usage.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// Плагин — ESM; грузим как файл, чтобы тест не зависел от type пакета.
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const module = await import(pathToFileURL(join(root, pkg.main)).href)

const now = Date.now()
const DAY = 86_400_000
const session = (id, time, tokens) => ({
  header: { id, createdAt: time },
  events: [
    {
      type: 'assistant/message',
      time,
      data: {
        usage: {
          inputTokens: tokens.input ?? 0,
          cacheReadTokens: tokens.cacheRead ?? 0,
          cacheWriteTokens: tokens.cacheWrite ?? 0,
          outputTokens: tokens.output ?? 0,
        },
      },
    },
  ],
})

const today = new Date()
const at = (daysAgo, hour) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, 0, 0).getTime()

const sessions = [
  session('today', at(0, 10), { input: 1000, cacheRead: 400, cacheWrite: 0, output: 500 }),
  session('yesterday', at(1, 11), { input: 2000, cacheRead: 0, cacheWrite: 100, output: 1000 }),
  session('three-days', at(3, 15), { input: 300, cacheRead: 0, cacheWrite: 0, output: 100 }),
  // Вне окна: не должно попасть в ответ.
  session('old', at(20, 12), { input: 9_000_000, cacheRead: 0, cacheWrite: 0, output: 9_000_000 }),
]

const persistence = {
  async list() {
    return sessions.map((entry) => ({ header: entry.header, id: entry.header.id }))
  },
  async open(id) {
    const entry = sessions.find((candidate) => candidate.header.id === id)
    return {
      async read() {
        return { events: entry.events }
      },
      async close() {},
    }
  },
}

const captured = []
const server = {
  register(route) {
    captured.push(route)
    return () => {}
  },
}

const ctx = {
  get(name) {
    if (name === 'webServer') return server
    if (name === 'sessionPersistence') return persistence
    return undefined
  },
  on() {
    return () => {}
  },
  effect(fn) {
    fn()
  },
}

module.apply(ctx, {})

const byPath = new Map(captured.map((route) => [route.path, route.handler]))
assert.deepEqual([...byPath.keys()].sort(), ['/wallet-ru', '/wallet-ru/usage'])

const call = (handler, url) =>
  new Promise((resolve, reject) => {
    const res = {
      status: 0,
      headers: null,
      body: '',
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(chunk) {
        this.body = String(chunk)
        try {
          resolve({ status: this.status, headers: this.headers, json: JSON.parse(this.body) })
        } catch (error) {
          reject(error)
        }
      },
    }
    Promise.resolve(handler({ url }, res)).catch(reject)
  })

const usage = await call(byPath.get('/wallet-ru/usage'), '/wallet-ru/usage?days=7')
assert.equal(usage.status, 200)
assert.equal(usage.json.ok, true, JSON.stringify(usage.json))
assert.equal(usage.json.days.length, 7, 'окно должно быть заполнено целиком')

const dates = usage.json.days.map((day) => day.date)
assert.deepEqual([...dates].sort(), dates, 'дни должны идти по возрастанию')
assert.equal(dates.at(-1), `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)

const byDate = new Map(usage.json.days.map((day) => [day.date, day]))
const dayKey = (ms) => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
assert.equal(byDate.get(dayKey(at(0, 10))).tokens, 1900)
assert.equal(byDate.get(dayKey(at(1, 11))).tokens, 3100)
assert.equal(byDate.get(dayKey(at(3, 15))).tokens, 400)
assert.equal(byDate.get(dayKey(at(3, 15))).requests, 1)

const zeroDays = usage.json.days.filter((day) => day.requests === 0)
assert.equal(zeroDays.length, 4, 'в окне 7 дней заняты 3, остальные — нулевые')
assert.ok(zeroDays.every((day) => day.cost === 0 && day.tokens === 0))
assert.ok(!usage.json.days.some((day) => day.tokens > 1_000_000), 'сессия вне окна не должна попасть в ответ')

for (const day of usage.json.days) {
  assert.ok(day.cost >= 0)
  assert.ok(Number.isFinite(day.cost))
}

const balance = await call(byPath.get('/wallet-ru'), '/wallet-ru')
assert.equal(balance.status, 200)
assert.equal(balance.json.ok, true)
assert.ok(['peak', 'offpeak'].includes(balance.json.data.tier))
assert.ok(balance.json.data.remainingMs >= 0)
assert.equal(balance.json.data.topUpUrl, 'https://platform.deepseek.com/top_up')
assert.equal(balance.json.data.balance, null)
assert.equal(typeof balance.json.data.reason, 'string')
assert.equal(balance.json.data.perMillion.input > 0, true)

const pricing = module.pricingState(new Date('2026-10-30T04:00:00Z')) // 12:00 по Пекину — не пик
assert.equal(pricing.tier, 'offpeak')
assert.equal(pricing.perMillion.input, 0.14)
const peak = module.pricingState(new Date('2026-10-30T03:00:00Z')) // 11:00 по Пекину — пик
assert.equal(peak.tier, 'peak')
assert.equal(peak.perMillion.input, 0.28)

console.log('routes: ok')
