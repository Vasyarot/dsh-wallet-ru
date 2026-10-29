/**
 * Баланс DeepSeek и тариф (Пик / Не пик) для дока композера.
 *
 * Хост-половина отдаёт GET /wallet-ru. Баланс берётся из двух источников:
 *
 * 1. `deepseekAccount.getBalance()` — штатный сервис DSH, работает по обычному
 *    входу в аккаунт, ключ API не нужен.
 * 2. `GET https://api.deepseek.com/user/balance` с ключом из credentials
 *    (`DEEPSEEK_API_KEY`) или окружения — запасной путь для тех, у кого ключ.
 *
 * Тариф считается локально по пекинскому времени (UTC+8), окна 09–12 и 14–18.
 * В ответе всегда есть тариф и остаток времени до его смены — даже если ни один
 * источник баланса не ответил, чип остаётся осмысленным.
 *
 * Модуль импортирует только встроенные модули Node, чтобы загрузка не зависела
 * от резолва пакетов рантайма.
 *
 * @module dsh-plugin-wallet-ru
 */

/** Имя плагина для диагностики загрузчика. */
export const name = 'wallet-ru'

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const DEFAULT_TIMEOUT_MS = 10_000

/** Куда ведёт клик по сумме баланса. */
const TOP_UP_URL = 'https://platform.deepseek.com/top_up'
/** Глубина окна недельной статистики, дней. */
const USAGE_DAYS = 7

/** Базовые цены DeepSeek за миллион токенов вне пика (USD). */
const OFFPEAK_PRICES = { input: 0.14, cacheHit: 0.014, output: 0.21 }
/** Во сколько раз дороже пик. */
const PEAK_MULTIPLIER = 2
/** Окна пика по пекинскому времени: [начало, конец). */
const PEAK_WINDOWS = [
  [9, 12],
  [14, 18],
]
/** Границы окон — точки, где тариф потенциально меняется. */
const BOUNDARIES = [9, 12, 14, 18]

/** Сдвиг Пекина относительно UTC, мс. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * Тариф для момента времени.
 * @param {Date} at - момент.
 * @returns {'peak'|'offpeak'}
 */
function tierAt(at) {
  const hour = (at.getUTCHours() + 8) % 24
  return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end) ? 'peak' : 'offpeak'
}

/**
 * Сколько миллисекунд осталось до следующей смены тарифа.
 *
 * Считаются только границы, где тариф действительно меняется: в 20:00 по Пекину
 * ответ — «до 09:00 завтра», а не «до полуночи».
 * @param {Date} at - момент отсчёта.
 * @returns {number} остаток в миллисекундах.
 */
function msUntilTierChange(at) {
  const now = at.getTime()
  const current = tierAt(at)
  // Пекинские сутки в UTC-полях: так восьмичасовой сдвиг учитывается один раз.
  const beijing = new Date(now + BEIJING_OFFSET_MS)
  const dayStart = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate())
  const candidates = []
  for (const dayOffset of [0, 1, 2]) {
    for (const hour of BOUNDARIES) {
      candidates.push(dayStart + dayOffset * 86_400_000 + hour * 3_600_000 - BEIJING_OFFSET_MS)
    }
  }
  for (const candidate of candidates.sort((a, b) => a - b)) {
    if (candidate <= now) continue
    if (tierAt(new Date(candidate)) !== current) return candidate - now
  }
  return 0
}

/**
 * Состояние тарифа для ответа.
 * @param {Date} [at] - момент, по умолчанию сейчас.
 * @returns {{tier: 'peak'|'offpeak', remainingMs: number, perMillion: object}}
 */
export function pricingState(at = new Date()) {
  const tier = tierAt(at)
  const multiplier = tier === 'peak' ? PEAK_MULTIPLIER : 1
  return {
    tier,
    remainingMs: msUntilTierChange(at),
    perMillion: {
      input: OFFPEAK_PRICES.input * multiplier,
      cacheHit: OFFPEAK_PRICES.cacheHit * multiplier,
      output: OFFPEAK_PRICES.output * multiplier,
    },
  }
}

/**
 * Найти ключ API: сервис credentials, затем окружение.
 * @param {object} ctx - контекст плагина.
 * @param {string} envName - имя ссылки на секрет.
 * @returns {Promise<string|null>}
 */
async function resolveApiKey(ctx, envName) {
  try {
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    if (credentials !== undefined && typeof credentials.resolve === 'function') {
      const hit = await credentials.resolve(envName)
      if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value.length > 0) {
        return hit.value
      }
    }
  } catch {
    /* ключа в сервисе нет — пробуем окружение */
  }
  const ambient = process.env[envName]
  return typeof ambient === 'string' && ambient.length > 0 ? ambient : null
}

/**
 * Метаданные клиента, которые платформа ждёт от UI.
 * @returns {{version: string, locale: string, timezoneOffsetSeconds: number}}
 */
function accountClient() {
  return {
    version: process.env.DSH_CLIENT_VERSION ?? '0.2.1-rc.3',
    locale: 'ru-RU',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * Привести кошельки к простому виду.
 * @param {Array<{currency: string, balance: string}>} wallets - кошельки платформы.
 * @returns {Array<{currency: string, balance: string}>}
 */
function normalizeWallets(wallets) {
  if (!Array.isArray(wallets)) return []
  return wallets
    .filter((wallet) => wallet !== null && typeof wallet === 'object' && typeof wallet.currency === 'string')
    .map((wallet) => ({ currency: wallet.currency, balance: String(wallet.balance ?? '0') }))
}

/**
 * Найти долларовый кошелёк в списке.
 * @param {Array<{currency: string, balance: string}>} wallets - кошельки.
 * @returns {{currency: string, balance: string}|null}
 */
function usdWallet(wallets) {
  if (!Array.isArray(wallets)) return null
  return wallets.find((wallet) => wallet !== null && wallet.currency === 'USD') ?? null
}

/**
 * Баланс через штатный сервис аккаунта: обычный вход, без ключа API.
 * @param {object} ctx - контекст плагина.
 * @returns {Promise<{ok: boolean, usd: string|null, other: Array, bonus: Array, reason?: string}>}
 */
async function accountBalance(ctx) {
  const account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined
  if (account === undefined || account === null || typeof account.getBalance !== 'function') {
    return { ok: false, usd: null, other: [], bonus: [], reason: 'account-unavailable' }
  }
  let result
  try {
    result = await account.getBalance(accountClient())
  } catch (error) {
    return { ok: false, usd: null, other: [], bonus: [], reason: error instanceof Error ? error.message : String(error) }
  }
  if (result === null || result === undefined) {
    return { ok: false, usd: null, other: [], bonus: [], reason: 'not-signed-in' }
  }
  if (result.status !== 'ready') {
    return { ok: false, usd: null, other: [], bonus: [], reason: 'platform-failed' }
  }
  const wallets = normalizeWallets(result.value)
  const bonusWallets = normalizeWallets(result.bonusWallets)
  const main = usdWallet(wallets)
  if (main === null && bonusWallets.length === 0 && wallets.length === 0) {
    return { ok: false, usd: null, other: [], bonus: [], reason: 'no-wallet' }
  }
  return {
    ok: true,
    usd: main?.balance ?? null,
    other: wallets.filter((wallet) => wallet.currency !== 'USD'),
    bonus: bonusWallets,
  }
}

/**
 * Баланс через ключ API.
 * @param {object} ctx - контекст плагина.
 * @param {object} config - конфигурация строки.
 * @returns {Promise<{ok: boolean, usd: string|null, bonus: string|null, reason?: string}>}
 */
async function apiKeyBalance(ctx, config) {
  const envName = typeof config.apiKeyEnv === 'string' ? config.apiKeyEnv : DEFAULT_API_KEY_ENV
  const apiKey = await resolveApiKey(ctx, envName)
  if (apiKey === null) return { ok: false, usd: null, other: [], bonus: [], reason: `no-api-key:${envName}` }

  const baseURL = typeof config.baseURL === 'string' ? config.baseURL : DEFAULT_BASE_URL
  const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, '')}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
    const usd = infos.find((info) => info?.currency === 'USD')
    if (usd === undefined) return { ok: false, usd: null, other: [], bonus: [], reason: 'no-usd-wallet' }
    return {
      ok: true,
      usd: String(usd.total_balance ?? '0.00'),
      other: infos
        .filter((info) => info?.currency && info.currency !== 'USD')
        .map((info) => ({ currency: String(info.currency), balance: String(info.total_balance ?? '0') })),
      bonus: [],
    }
  } catch (error) {
    return { ok: false, usd: null, other: [], bonus: [], reason: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Собрать состояние для чипа: сначала аккаунт, затем ключ API.
 * @param {object} ctx - контекст плагина.
 * @param {object} config - конфигурация строки.
 * @returns {Promise<object>}
 */
async function buildState(ctx, config) {
  const pricing = pricingState()

  const account = await accountBalance(ctx)
  if (account.ok) {
    return {
      ok: true,
      data: {
        ...pricing,
        balance: { usd: account.usd, other: account.other, bonus: account.bonus },
        source: 'account',
        at: new Date().toISOString(),
      },
    }
  }

  const keyed = await apiKeyBalance(ctx, config)
  if (keyed.ok) {
    return {
      ok: true,
      data: {
        ...pricing,
        balance: { usd: keyed.usd, other: keyed.other, bonus: keyed.bonus },
        source: 'api-key',
        at: new Date().toISOString(),
      },
    }
  }

  return {
    ok: true,
    data: {
      ...pricing,
      balance: null,
      source: 'none',
      reason: account.reason === 'not-signed-in' ? keyed.reason : account.reason,
      at: new Date().toISOString(),
    },
  }
}

/**
 * Цены на момент времени: в пик полные, вне пика половинные.
 * @param {Date} at - момент.
 * @returns {{input: number, cacheHit: number, output: number}}
 */
function pricesAt(at) {
  const multiplier = tierAt(at) === 'peak' ? PEAK_MULTIPLIER : 1
  return {
    input: OFFPEAK_PRICES.input * multiplier,
    cacheHit: OFFPEAK_PRICES.cacheHit * multiplier,
    output: OFFPEAK_PRICES.output * multiplier,
  }
}

/**
 * Локальная дата события в формате YYYY-MM-DD.
 * @param {number} ms - отметка времени.
 * @returns {string}
 */
function localDate(ms) {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Расход по дням за окно: читает журналы сессий и складывает usage по датам.
 * @param {object} ctx - контекст плагина.
 * @param {number} days - глубина окна в днях.
 * @returns {Promise<{ok: boolean, days?: Array<object>, reason?: string}>}
 */
async function dailyUsage(ctx, days) {
  const persistence = typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined
  if (persistence === undefined || persistence === null) return { ok: false, reason: 'no-session-persistence' }

  const cutoff = Date.now() - days * 86_400_000
  const perDay = new Map()
  const snapshots = await persistence.list()

  for (const snapshot of snapshots) {
    if (snapshot.header.createdAt < cutoff) continue
    const handle = await persistence.open(snapshot.header.id, 'read')
    try {
      const { events } = await handle.read()
      for (const event of events) {
        if (event.type !== 'assistant/message') continue
        const usage = event.data?.usage
        if (usage === undefined || usage === null) continue
        const prices = pricesAt(new Date(event.time))
        const input = usage.inputTokens ?? 0
        const cacheRead = usage.cacheReadTokens ?? 0
        const cacheWrite = usage.cacheWriteTokens ?? 0
        const output = usage.outputTokens ?? 0
        const cost =
          ((input + cacheWrite) * prices.input + cacheRead * prices.cacheHit + output * prices.output) / 1_000_000
        const key = localDate(event.time)
        const entry = perDay.get(key) ?? { date: key, requests: 0, tokens: 0, cost: 0 }
        entry.requests += 1
        entry.tokens += input + cacheRead + cacheWrite + output
        entry.cost += cost
        perDay.set(key, entry)
      }
    } finally {
      await handle.close()
    }
  }

  return { ok: true, days: [...perDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)) }
}

/**
 * Повесить маршруты плагина на веб-сервер хоста.
 *
 * Сервис webServer может появиться после активации плагина, поэтому маршруты
 * регистрируются либо сразу, либо на первое связывание сервиса — один раз.
 * @param {object} ctx - контекст плагина.
 * @param {object} config - конфигурация строки.
 */
function registerRoute(ctx, config) {
  const handler = async (_req, res) => {
    let body
    try {
      body = await buildState(ctx, config)
    } catch (error) {
      body = {
        ok: true,
        data: {
          ...pricingState(),
          balance: null,
          source: 'none',
          reason: error instanceof Error ? error.message : String(error),
        },
      }
    }
    if (body !== null && typeof body === 'object' && body.data !== undefined) {
      body.data.topUpUrl = TOP_UP_URL
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  const usageHandler = async (req, res) => {
    let payload
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const requested = Number(url.searchParams.get('days') ?? USAGE_DAYS)
      const days = Number.isInteger(requested) && requested >= 1 && requested <= 30 ? requested : USAGE_DAYS
      payload = await dailyUsage(ctx, days)
      if (payload.ok) payload.days = payload.days.slice(-days)
    } catch (error) {
      payload = { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }

  const attach = (server) => {
    const disposers = [
      server.register({ kind: 'exact', path: '/wallet-ru', handler }),
      server.register({ kind: 'exact', path: '/wallet-ru/usage', handler: usageHandler }),
    ]
    return () => {
      for (const disposer of disposers) disposer()
    }
  }

  const present = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (present !== undefined) return attach(present)

  const disposers = []
  let attached = false
  const off = ctx.on('internal/service', (serviceName, value) => {
    if (serviceName !== 'webServer' || attached) return
    attached = true
    disposers.push(attach(value))
  })
  return () => {
    off()
    for (const disposer of disposers) disposer()
  }
}

/**
 * Точка входа плагина.
 * @param {object} ctx - контекст плагина.
 * @param {object} [config] - конфигурация строки профиля.
 */
export function apply(ctx, config) {
  const resolved = config !== null && typeof config === 'object' ? config : {}
  ctx.effect(() => registerRoute(ctx, resolved), 'wallet-ru: web route')
}
