/**
 * Клиентская половина: «Не пик 12 ч 38 мин · Баланс: $0.86 · ¥12.50 · Сессия: 12,3 тыс. ток · $0.04».
 *
 * Подсказки разнесены по элементам чипа:
 *  - наведение на «Пик / Не пик» — цены: сначала активный тариф, ниже второй;
 *  - наведение на сумму баланса — текущий баланс в долларах, юанях и бонусные баллы;
 *  - у сеанса подсказки нет; клик открывает окно трат за неделю с графиком.
 *
 * Требует только react. Типографика повторяет штатные плашки статистики под
 * композером («Попадание в кэш», «ток/с»): те же переменные темы и размер шрифта.
 * Данные сеанса берутся из проекции `tokenUsage`, которую отдаёт слот.
 *
 * @module dsh-plugin-wallet-ru/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-wallet-ru',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** Как часто перезапрашивать баланс у хоста, мс. */
    const REFRESH_MS = 60_000
    /** Как часто пересчитывать обратный отсчёт, мс. */
    const TICK_MS = 15_000
    /** Окна пика по пекинскому времени. */
    const PEAK_WINDOWS = [
      [9, 12],
      [14, 18],
    ]
    const BOUNDARIES = [9, 12, 14, 18]
    const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
    /** Окно недельной статистики. */
    const USAGE_DAYS = 7
    /** Ширина окна статистики. */
    const PANEL_WIDTH = 300

    /** Цены DeepSeek в долларах за миллион токенов вне пика. */
    const OFFPEAK_USD = { input: 0.14, cacheHit: 0.014, output: 0.21 }
    /** В пик — полная цена, то есть вдвое дороже. */
    const PEAK_MULTIPLIER = 2

    /** Не пик — зелёный, пик — красный. */
    const GREEN = '#22c55e'
    const RED = '#ef4444'
    const BAR = '#3b82f6'

    /** Короткие дни недели для оси графика. */
    const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

    // Типографика штатных плашек композера (StatsPills.module.css).
    const ANCHOR_STYLE = {
      minWidth: 0,
      fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
      lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
      display: 'inline-flex',
      position: 'relative',
    }
    const PILL_STYLE = {
      boxSizing: 'border-box',
      borderRadius: 'var(--dsw-radius-sm)',
      maxWidth: '100%',
      color: 'var(--dsw-alias-label-tertiary)',
      font: 'inherit',
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 'inherit',
      whiteSpace: 'nowrap',
      background: 'none',
      border: 'none',
      alignItems: 'center',
      gap: '6px',
      padding: '1px 8px',
      display: 'inline-flex',
    }
    const SEP_STYLE = {
      color: 'var(--dsw-alias-separator-primary)',
      margin: '0 6px',
    }
    const HINT_STYLE = { cursor: 'help' }
    // Окно платформы: тот же материал и та же геометрия, что у штатного
    // встроенного просмотра (PlatformOverlay.module.css в ui-settings-account):
    // полоса 48 px сверху и область просмотра под ней. На Windows всё окно
    // сдвинуто вниз на высоту заголовка окна, иначе нативная вьюха залезает
    // под системную полосу с кнопками.
    const OVERLAY_STYLE = {
      position: 'fixed',
      inset: 0,
      zIndex: 1001,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--dsw-alias-bg-base, Canvas)',
      paddingTop: 'var(--dsh-windows-titlebar-height, 0px)',
    }
    const OVERLAY_HEADER_STYLE = {
      boxSizing: 'border-box',
      flex: 'none',
      height: '48px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '0 16px',
      borderBottom: '0.5px solid var(--dsw-alias-border-l1, GrayText)',
    }
    const OVERLAY_BUTTON_STYLE = {
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '28px',
      padding: '0 6px',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      background: 'none',
      color: 'var(--dsw-alias-label-secondary, CanvasText)',
      font: 'inherit',
      fontSize: '14px',
      lineHeight: '22px',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    }
    const OVERLAY_TITLE_STYLE = {
      color: 'var(--dsw-alias-label-secondary, CanvasText)',
      fontSize: '14px',
      lineHeight: '22px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }
    const OVERLAY_VIEWPORT_STYLE = {
      position: 'relative',
      flex: 1,
      minHeight: 0,
      color: 'var(--dsw-alias-label-secondary, CanvasText)',
    }
    const OVERLAY_STATUS_STYLE = {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      padding: '0 24px',
      textAlign: 'center',
      color: 'var(--dsw-alias-label-tertiary, GrayText)',
      fontSize: '14px',
      lineHeight: '22px',
    }
    const OVERLAY_RETRY_STYLE = {
      boxSizing: 'border-box',
      minWidth: '58px',
      height: '32px',
      padding: '0 12px',
      border: '0.5px solid var(--dsw-alias-border-l2, GrayText)',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      background: 'none',
      color: 'inherit',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '20px',
      cursor: 'pointer',
    }
    const OVERLAY_SPINNER_STYLE = {
      width: '24px',
      height: '24px',
      boxSizing: 'border-box',
      border: '2px solid var(--dsw-alias-border-l2, GrayText)',
      borderTopColor: 'var(--dsw-alias-label-secondary, CanvasText)',
      borderRadius: '50%',
      animation: 'dsh-wallet-ru-spin 900ms linear infinite',
    }

    /** Кадры для спиннера: без <style> анимация из инлайнового стиля не играет. */
    function ensureKeyframes() {
      if (typeof document === 'undefined') return
      const id = 'dsh-wallet-ru-keyframes'
      if (document.getElementById(id) !== null) return
      const tag = document.createElement('style')
      tag.id = id
      tag.textContent = '@keyframes dsh-wallet-ru-spin{to{transform:rotate(360deg)}}'
      document.head.appendChild(tag)
    }
    const BUTTON_STYLE = {
      color: 'inherit',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      padding: 0,
      margin: 0,
      font: 'inherit',
      fontVariantNumeric: 'tabular-nums',
    }

    /**
     * Тариф на момент времени.
     * @param {Date} [at] - момент, по умолчанию сейчас.
     * @returns {'peak'|'offpeak'}
     */
    function tierAt(at = new Date()) {
      const hour = (at.getUTCHours() + 8) % 24
      return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end) ? 'peak' : 'offpeak'
    }

    /**
     * Миллисекунды до следующей реальной смены тарифа.
     * @param {Date} [at] - момент отсчёта.
     * @returns {number}
     */
    function msUntilTierChange(at = new Date()) {
      const now = at.getTime()
      const current = tierAt(at)
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
     * Человеческий остаток: «3 ч 12 мин», «48 мин», «5 ч».
     * @param {number} ms - остаток в миллисекундах.
     * @returns {string}
     */
    function humanize(ms) {
      const totalMinutes = Math.max(0, Math.round(ms / 60_000))
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      if (hours === 0) return `${minutes} мин`
      if (minutes === 0) return `${hours} ч`
      return `${hours} ч ${minutes} мин`
    }

    /**
     * Деньги в долларах: мелкие суммы — с четырьмя знаками.
     * @param {number} value - сумма.
     * @returns {string}
     */
    function dollars(value) {
      if (!Number.isFinite(value)) return '$—'
      return value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
    }

    /**
     * Цена за миллион токенов: `$0.14`, `$0.014`, `$0.028`.
     * @param {number} value - цена.
     * @returns {string}
     */
    function price(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '$—'
      return `$${number < 0.1 ? number.toFixed(3) : number.toFixed(2)}`
    }

    /**
     * Сумма в валюте кошелька: доллар — `$`, юань — `¥`, прочее — код после числа.
     * @param {string} currency - код валюты платформы.
     * @param {string|number} value - остаток.
     * @returns {string}
     */
    function currencyText(currency, value) {
      const number = Number(value)
      const plain = dollars(number)
      if (currency === 'USD') return plain
      if (currency === 'CNY') return `¥${plain.slice(1)}`
      return `${plain.slice(1)} ${currency}`
    }

    /**
     * Ненулевые остатки, которые показываются после долларов.
     * @param {object|null} balance - состояние баланса с хоста.
     * @returns {string[]}
     */
    function extraWallets(balance) {
      if (balance === null || balance === undefined) return []
      const parts = []
      for (const wallet of Array.isArray(balance.other) ? balance.other : []) {
        const value = Number(wallet?.balance)
        if (Number.isFinite(value) && value > 0) parts.push(currencyText(String(wallet.currency), value))
      }
      for (const wallet of Array.isArray(balance.bonus) ? balance.bonus : []) {
        const value = Number(wallet?.balance)
        if (Number.isFinite(value) && value > 0) parts.push(`бонус ${currencyText(String(wallet.currency), value)}`)
      }
      return parts
    }

    /**
     * Компактное число токенов: «847», «12,3 тыс.», «1,2 млн».
     * @param {number} value - количество токенов.
     * @returns {string}
     */
    function tokenText(value) {
      if (!Number.isFinite(value) || value <= 0) return '0'
      if (value < 1000) return String(Math.round(value))
      if (value < 1_000_000) {
        const thousands = value / 1000
        return `${thousands < 100 ? thousands.toFixed(1).replace('.', ',') : Math.round(thousands)} тыс.`
      }
      return `${(value / 1_000_000).toFixed(1).replace('.', ',')} млн`
    }

    /**
     * Стоимость набора корзин по тарифу.
     * @param {{input: number, cacheRead: number, cacheWrite: number, output: number}} buckets - токены.
     * @param {'peak'|'offpeak'} tier - тариф.
     * @returns {number}
     */
    function costOf(buckets, tier) {
      const multiplier = tier === 'peak' ? PEAK_MULTIPLIER : 1
      const input = buckets.input + buckets.cacheWrite
      return (
        ((input * OFFPEAK_USD.input + buckets.cacheRead * OFFPEAK_USD.cacheHit + buckets.output * OFFPEAK_USD.output) *
          multiplier) /
        1_000_000
      )
    }

    /**
     * Цены за миллион токенов по тарифу.
     * @param {'peak'|'offpeak'} tier - тариф.
     * @returns {{input: number, cacheHit: number, output: number}}
     */
    function pricesFor(tier) {
      const multiplier = tier === 'peak' ? PEAK_MULTIPLIER : 1
      return {
        input: OFFPEAK_USD.input * multiplier,
        cacheHit: OFFPEAK_USD.cacheHit * multiplier,
        output: OFFPEAK_USD.output * multiplier,
      }
    }

    /**
     * Расход текущего сеанса по проекции tokenUsage.
     * @param {object|undefined} usage - проекция.
     * @param {'peak'|'offpeak'} tier - тариф.
     * @returns {{total: number, tokens: number}}
     */
    function sessionCost(usage, tier) {
      if (usage === undefined || usage === null) return { total: 0, tokens: 0 }
      const buckets = {
        input: usage.uncachedInputTokens ?? 0,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
        output: usage.outputTokens ?? 0,
      }
      return {
        total: costOf(buckets, tier),
        tokens: buckets.input + buckets.cacheRead + buckets.cacheWrite + buckets.output,
      }
    }

    /**
     * Подсказка тарифа: сначала действующий, ниже второй. Только цены.
     * @param {'peak'|'offpeak'} tier - действующий тариф.
     * @param {{input: number, cacheHit: number, output: number}|null} current - цены с хоста.
     * @returns {string}
     */
    function priceTooltip(tier, current) {
      const active = current ?? pricesFor(tier)
      const other = pricesFor(tier === 'peak' ? 'offpeak' : 'peak')
      const line = (label, prices) =>
        `${label}\nввод ${price(prices.input)} · кэш ${price(prices.cacheHit)} · вывод ${price(prices.output)} за 1M токенов`
      return tier === 'peak'
        ? `${line('Пик (сейчас)', active)}\n\n${line('Не пик', other)}`
        : `${line('Не пик (сейчас)', active)}\n\n${line('Пик', other)}`
    }

    /**
     * Подсказка баланса: доллары, юани, бонусные баллы.
     * @param {object} remote - состояние баланса с хоста.
     * @returns {string}
     */
    function balanceTooltip(remote) {
      if (!remote.balance) {
        return remote.phase === 'loading' ? 'Баланс: загрузка…' : `Баланс недоступен${remote.reason ? `: ${remote.reason}` : ''}`
      }
      const balance = remote.balance
      const usd = balance.usd !== null && balance.usd !== undefined ? dollars(Number(balance.usd)) : '$—'
      const wallets = Array.isArray(balance.other) ? balance.other : []
      const cny = wallets.find((wallet) => String(wallet?.currency).toUpperCase() === 'CNY')
      const bonusWallets = Array.isArray(balance.bonus) ? balance.bonus : []
      const bonusTotal = bonusWallets.reduce((sum, wallet) => sum + (Number(wallet?.balance) || 0), 0)
      const bonusCurrency = String(bonusWallets[0]?.currency ?? 'USD')
      return [
        `Текущий баланс: ${usd}`,
        `В юанях: ${cny ? currencyText('CNY', cny.balance) : 'нет'}`,
        `Бонусные баллы: ${bonusTotal > 0 ? currencyText(bonusCurrency, bonusTotal) : '0'}`,
      ].join('\n')
    }

    /**
     * Состояние баланса с хоста: запрос раз в минуту плюс тик для отсчёта.
     * @returns {object}
     */
    function useBalance() {
      const [remote, setRemote] = React.useState({
        phase: 'loading',
        balance: null,
        perMillion: null,
        source: null,
        reason: null,
        topUpUrl: 'https://platform.deepseek.com/top_up',
      })
      const [, setTick] = React.useState(0)

      React.useEffect(() => {
        let alive = true

        const load = async () => {
          try {
            const response = await fetch('/wallet-ru', {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            const body = await response.json()
            if (!alive) return
            const data = (body && body.data) || {}
            setRemote({
              phase: 'ready',
              balance: data.balance || null,
              perMillion: data.perMillion || null,
              source: data.source || null,
              reason: data.reason || null,
              topUpUrl: data.topUpUrl || 'https://platform.deepseek.com/top_up',
            })
          } catch (error) {
            if (!alive) return
            setRemote({
              phase: 'error',
              balance: null,
              perMillion: null,
              source: null,
              reason: error instanceof Error ? error.message : String(error),
              topUpUrl: 'https://platform.deepseek.com/top_up',
            })
          }
        }

        load()
        const refresh = setInterval(load, REFRESH_MS)
        const tick = setInterval(() => setTick((value) => value + 1), TICK_MS)
        return () => {
          alive = false
          clearInterval(refresh)
          clearInterval(tick)
        }
      }, [])

      return remote
    }

    /**
     * День недели по дате YYYY-MM-DD (полдень, чтобы не зависеть от перехода часов).
     * @param {string} date - локальная дата.
     * @returns {string}
     */
    function weekday(date) {
      const at = new Date(`${date}T12:00:00`)
      return Number.isNaN(at.getTime()) ? '' : WEEKDAYS[at.getDay()]
    }

    /**
     * Дата в виде «29.10».
     * @param {string} date - локальная дата.
     * @returns {string}
     */
    function dayLabel(date) {
      return `${date.slice(8, 10)}.${date.slice(5, 7)}`
    }

    /**
     * Подпись одного дня для нативного title и строки деталей.
     * @param {object} day - день из /wallet-ru/usage.
     * @returns {string}
     */
    function dayText(day) {
      return `${dayLabel(day.date)} · ${dollars(day.cost ?? 0)} · ${tokenText(day.tokens ?? 0)} токенов · ${day.requests ?? 0} запросов`
    }

    /**
     * Геометрия столбцов: высота пропорциональна стоимости дня, ноль — тонкая
     * полоска-заглушка, чтобы день не исчезал с оси.
     * @param {Array<{date: string, cost?: number}>} days - дни окна.
     * @returns {Array<{date: string, weekday: string, height: number}>}
     */
    function chartBars(days) {
      const maxCost = days.reduce((max, day) => Math.max(max, day.cost ?? 0), 0)
      return days.map((day) => {
        const cost = day.cost ?? 0
        const ratio = maxCost > 0 ? Math.min(1, cost / maxCost) : 0
        return {
          date: day.date,
          weekday: weekday(day.date),
          height: cost > 0 ? Math.round(10 + ratio * 72) : 3,
        }
      })
    }

    /**
     * Маленькое окно с тратами за неделю: столбцы по дням и итог.
     * @param {object} props - якорь и обработчик закрытия.
     */
    function UsagePopover({ anchor, onClose }) {
      const panelRef = React.useRef(null)
      const [state, setState] = React.useState({ phase: 'loading', days: [], reason: null })
      const [position, setPosition] = React.useState(null)
      const [hovered, setHovered] = React.useState(null)

      React.useEffect(() => {
        if (anchor !== null && anchor !== undefined) {
          const rect = anchor.getBoundingClientRect()
          setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 12)),
            bottom: window.innerHeight - rect.top + 8,
          })
        }
      }, [anchor])

      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const response = await fetch(`/wallet-ru/usage?days=${USAGE_DAYS}`, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            const body = await response.json()
            if (!alive) return
            if (body && body.ok) setState({ phase: 'ready', days: body.days ?? [], reason: null })
            else setState({ phase: 'error', days: [], reason: (body && body.reason) || 'нет данных' })
          } catch (error) {
            if (!alive) return
            setState({ phase: 'error', days: [], reason: error instanceof Error ? error.message : String(error) })
          }
        }
        load()
        return () => {
          alive = false
        }
      }, [])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        const onPointer = (event) => {
          if (panelRef.current !== null && panelRef.current.contains(event.target)) return
          onClose()
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('pointerdown', onPointer, true)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onPointer, true)
        }
      }, [onClose])

      const days = state.days
      const total = days.reduce((sum, day) => sum + (day.cost ?? 0), 0)
      const totalTokens = days.reduce((sum, day) => sum + (day.tokens ?? 0), 0)
      const totalRequests = days.reduce((sum, day) => sum + (day.requests ?? 0), 0)
      const active = hovered !== null ? days[hovered] : undefined

      const detail =
        state.phase !== 'ready'
          ? state.phase === 'loading'
            ? 'Загрузка…'
            : state.reason
          : active
            ? dayText(active)
            : `${tokenText(totalTokens)} токенов · ${totalRequests} запросов`

      const bars =
        state.phase !== 'ready'
          ? null
          : h(
              'div',
              {
                role: 'img',
                'aria-label': `Стоимость по дням за ${USAGE_DAYS} дней`,
                title: 'Высота столбца — стоимость дня. Наведите на столбец.',
                style: {
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '6px',
                  height: '86px',
                  marginTop: '2px',
                },
              },
              chartBars(days).map((bar, index) => {
                const day = days[index]
                const isActive = hovered === index
                return h(
                  'div',
                  {
                    key: day.date,
                    onMouseEnter: () => setHovered(index),
                    onMouseLeave: () => setHovered((value) => (value === index ? null : value)),
                    title: dayText(day),
                    style: {
                      flex: '1 1 0',
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: '4px',
                    },
                  },
                  h(
                    'div',
                    { style: { height: '74px', display: 'flex', alignItems: 'flex-end' } },
                    h('div', {
                      style: {
                        width: '100%',
                        height: `${bar.height}px`,
                        borderRadius: '4px 4px 2px 2px',
                        background: isActive
                          ? `linear-gradient(180deg, #93c5fd, ${BAR})`
                          : day.cost > 0
                            ? `linear-gradient(180deg, #60a5fa, ${BAR})`
                            : 'var(--dsw-alias-border-l2, #9ca3af)',
                        opacity: day.cost > 0 ? 1 : 0.5,
                        transition: 'background 120ms ease',
                      },
                    }),
                  ),
                  h(
                    'div',
                    {
                      style: {
                        fontSize: '10px',
                        lineHeight: '12px',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        color: isActive
                          ? 'var(--dsw-alias-label-primary, CanvasText)'
                          : 'var(--dsw-alias-label-tertiary, GrayText)',
                      },
                    },
                    bar.weekday,
                  ),
                )
              }),
            )

      return h(
        'div',
        {
          ref: panelRef,
          role: 'dialog',
          'aria-label': `Траты за ${USAGE_DAYS} дней`,
          style: {
            position: 'fixed',
            left: `${position === null ? 8 : position.left}px`,
            bottom: `${position === null ? 40 : position.bottom}px`,
            zIndex: 2147483000,
            width: `${PANEL_WIDTH}px`,
            boxSizing: 'border-box',
            padding: '10px 12px 8px',
            borderRadius: '10px',
            background: 'var(--dsw-alias-bg-elevated, Canvas)',
            color: 'var(--dsw-alias-label-primary, CanvasText)',
            border: '1px solid var(--dsw-alias-separator-primary, GrayText)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
            fontSize: '12px',
            lineHeight: '16px',
            fontVariantNumeric: 'tabular-nums',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' } },
          h('span', { style: { fontWeight: 600 } }, `Траты за ${USAGE_DAYS} дней`),
          h('span', { style: { marginLeft: 'auto', fontWeight: 600, color: state.phase === 'error' ? 'inherit' : '#3b82f6' } }, state.phase === 'error' ? '' : dollars(total)),
        ),
        h(
          'div',
          {
            style: {
              minHeight: '16px',
              fontSize: '11px',
              color: 'var(--dsw-alias-label-tertiary, GrayText)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          },
          detail,
        ),
        bars,
        state.phase === 'error' ? h('div', { style: { padding: '6px 0', opacity: 0.7 } }, 'Нет данных о тратах') : null,
        h(
          'div',
          {
            style: {
              marginTop: '6px',
              paddingTop: '6px',
              borderTop: '1px solid var(--dsw-alias-separator-primary, GrayText)',
              display: 'flex',
              alignItems: 'baseline',
              gap: '8px',
              color: 'var(--dsw-alias-label-tertiary, GrayText)',
              fontSize: '11px',
            },
          },
          h('span', null, `Итого ${dollars(total)}`),
          h('span', { style: { marginLeft: 'auto' } }, tokenText(totalTokens)),
        ),
      )
    }

    /**
     * Прямоугольник для нативного просмотра платформы, когда оверлей недоступен:
     * почти всё окно, кроме нижней полосы под кнопки.
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    function topUpBounds() {
      const inset = 20
      const bar = 56
      return {
        x: inset,
        y: inset,
        width: Math.max(320, window.innerWidth - inset * 2),
        height: Math.max(240, window.innerHeight - inset * 2 - bar),
      }
    }

    /**
     * Общий канал «покажи страницу платформы». Чип просит страницу, а оверлей в
     * `shell.overlay` её показывает. Так нативная вьюха живёт в устойчивом хосте
     * и не закрывается, когда композер перерисовывается.
     */
    const pageStore = (() => {
      let state = null
      const listeners = new Set()
      const publish = () => {
        for (const listener of [...listeners]) listener(state)
      }
      return {
        hosted: false,
        read: () => state,
        open(page) {
          state = { page }
          publish()
        },
        close() {
          state = null
          publish()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    })()

    /**
     * Текст отказа из IPC: Electron добавляет к нему свою обёртку.
     * @param {unknown} error - ошибка вызова.
     * @returns {string}
     */
    function errorText(error) {
      const message = error instanceof Error ? error.message : String(error)
      return message.replace(/^Error invoking remote method '[^']+':\s*/, '')
    }

    /**
     * Окно платформы: полоса с кнопками и область, в которую оболочка кладёт
     * нативную вьюху `platform.deepseek.com/top_up`.
     *
     * Геометрия области отдаётся в main как есть (`getBoundingClientRect`), и
     * обновляется наблюдателем размера — при смене окна или сворачивании
     * панелей нативная вьюха едет вместе с областью.
     *
     * @param {{onClose: () => void}} props - закрытие окна.
     * @returns {object}
     */
    function TopUpWindow(props) {
      const [attempt, setAttempt] = React.useState(0)
      const [status, setStatus] = React.useState('loading')
      const [failure, setFailure] = React.useState(null)
      const viewportRef = React.useRef(null)

      ensureKeyframes()

      React.useEffect(() => {
        const platform = typeof window === 'undefined' ? undefined : window.dshPlatform
        const element = viewportRef.current
        if (element === null) return undefined
        if (platform === undefined || platform === null || typeof platform.open !== 'function') {
          setStatus('failed')
          setFailure('окно платформы недоступно в этом окне')
          return undefined
        }
        let disposed = false
        let observer
        let autoRetry
        const bounds = () => {
          const rect = element.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }
        setStatus('loading')
        setFailure(null)
        Promise.resolve(platform.open('top-up', bounds())).then(
          () => {
            if (!disposed) setStatus('loaded')
          },
          (error) => {
            if (disposed) return
            setStatus('failed')
            setFailure(errorText(error))
            // Обрыв на TLS до platform.deepseek.com случается регулярно
            // (ERR_SSL_PROTOCOL_ERROR): соединение живёт секунды, а следующий
            // заход обычно проходит. Пока вьюхи нет — повторять безопасно.
            if (attempt < 3) {
              autoRetry = setTimeout(() => {
                if (!disposed) setAttempt(attempt + 1)
              }, 800 + attempt * 700)
            }
          },
        )
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(() => {
            if (disposed) return
            Promise.resolve(platform.setBounds(bounds())).catch(() => {})
          })
          observer.observe(element)
        }
        return () => {
          disposed = true
          clearTimeout(autoRetry)
          if (observer !== undefined) observer.disconnect()
          Promise.resolve(platform.close()).catch(() => {})
        }
      }, [attempt])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [props.onClose])

      const openInBrowser = () => {
        window.open('https://platform.deepseek.com/top_up', '_blank', 'noopener,noreferrer')
      }

      return h(
        'div',
        { style: OVERLAY_STYLE, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Пополнение баланса' },
        h(
          'header',
          { style: OVERLAY_HEADER_STYLE },
          h('button', { type: 'button', style: OVERLAY_BUTTON_STYLE, onClick: () => props.onClose() }, '‹ Назад'),
          h('span', { style: OVERLAY_TITLE_STYLE }, 'Пополнение баланса'),
          h(
            'button',
            {
              type: 'button',
              // Кнопка нужна всегда: проверка CloudFront нет-нет да и оставит
              // пустую страницу, а перезагрузить её можно только пересоздав вьюху.
              style: { ...OVERLAY_BUTTON_STYLE, marginLeft: 'auto', fontWeight: 600 },
              onClick: () => setAttempt((value) => value + 1),
            },
            'Перезагрузить',
          ),
          h(
            'button',
            {
              type: 'button',
              style: OVERLAY_BUTTON_STYLE,
              onClick: openInBrowser,
            },
            'В браузере',
          ),
        ),
        h(
          'div',
          { ref: viewportRef, style: OVERLAY_VIEWPORT_STYLE },
          status === 'loaded'
            ? null
            : h(
                'div',
                { style: OVERLAY_STATUS_STYLE, role: 'status' },
                status === 'failed'
                  ? h(
                      'span',
                      null,
                      `Страница не загрузилась: ${failure ?? 'неизвестная ошибка'}`,
                    )
                  : h('span', { style: OVERLAY_SPINNER_STYLE, 'aria-hidden': true }),
                status === 'failed'
                  ? h(
                      'button',
                      { type: 'button', style: OVERLAY_RETRY_STYLE, onClick: () => setAttempt((value) => value + 1) },
                      'Повторить',
                    )
                  : null,
                status === 'failed'
                  ? h(
                      'span',
                      { style: { fontSize: '13px', opacity: 0.8, maxWidth: '460px' } },
                      attempt < 3
                        ? 'Соединение с платформой оборвалось — пробую ещё раз автоматически.'
                        : 'Платформа не отдаёт страницу: проверка CloudFront не проходит. Нажмите «Повторить» или откройте страницу в браузере.',
                    )
                  : null,
              ),
        ),
      )
    }

    /**
     * Хост окна платформы в `shell.overlay`: живёт всё время работы плагина,
     * поэтому окно не зависит от перерисовок композера.
     * @returns {object|null}
     */
    function PlatformPageHost() {
      const [page, setPage] = React.useState(pageStore.read())

      React.useEffect(() => {
        pageStore.hosted = true
        const unsubscribe = pageStore.subscribe(setPage)
        return () => {
          pageStore.hosted = false
          unsubscribe()
        }
      }, [])

      if (page === null) return null
      return h(TopUpWindow, { onClose: () => pageStore.close() })
    }

    /**
     * Чип: тариф, баланс и расход сеанса. У каждого смыслового блока своя
     * подсказка, поэтому длинного общего title больше нет.
     */
    function BalanceChip(props) {
      const remote = useBalance()
      const usage = typeof props.useProjection === 'function' ? props.useProjection('tokenUsage') : undefined
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const buttonRef = React.useRef(null)

      const now = new Date()
      const tier = tierAt(now)
      const remaining = humanize(msUntilTierChange(now))
      const peak = tier === 'peak'
      const { total: cost, tokens: sessionTokens } = sessionCost(usage, tier)
      const hasSession = typeof props.useProjection === 'function'
      // Доллары всегда первыми; юани и бонусные баллы — только если они есть.
      const walletParts = []
      if (remote.balance && remote.balance.usd !== null && remote.balance.usd !== undefined) {
        walletParts.push(dollars(Number(remote.balance.usd)))
      }
      walletParts.push(...extraWallets(remote.balance))
      const balanceText = walletParts.length > 0 ? walletParts[0] : '$—'
      const extras = walletParts.slice(1)

      const sep = h('span', { style: SEP_STYLE, 'aria-hidden': true }, ' ')

      const toggle = () => {
        setAnchor(buttonRef.current)
        setOpen((value) => !value)
      }

      // Пополнение открывается встроенным окном платформы: чип просит
      // страницу у общего канала, а оверлей в `shell.overlay` отдаёт её
      // нативному просмотру оболочки. Во внешний браузер сами не уводим —
      // только по явной кнопке «В браузере».
      const openTopUp = () => {
        if (pageStore.hosted) {
          pageStore.open('top-up')
          return
        }
        const platform = typeof window === 'undefined' ? undefined : window.dshPlatform
        if (platform === undefined || platform === null || typeof platform.open !== 'function') return
        Promise.resolve(platform.open('top-up', topUpBounds())).catch(() => {})
      }

      return h(
        'span',
        { style: ANCHOR_STYLE, 'data-composer-stat': 'balance' },
        h(
          'span',
          { style: PILL_STYLE },
          h(
            'span',
            { style: { color: peak ? RED : GREEN, ...HINT_STYLE }, title: priceTooltip(tier, remote.perMillion) },
            peak ? 'Пик' : 'Не пик',
          ),
          h('span', null, ' ', remaining),
          sep,
          h(
            'span',
            { style: { display: 'inline-flex', alignItems: 'baseline', ...HINT_STYLE }, title: balanceTooltip(remote) },
            h('span', null, 'Баланс: '),
            h(
              'a',
              {
                href: remote.topUpUrl,
                'aria-label': 'Пополнить баланс (внутри приложения)',
                style: BUTTON_STYLE,
                onClick: (event) => {
                  // Обычный клик открывает встроенную панель; Ctrl/Cmd/Shift+клик
                  // оставляем ссылке — тогда сработает браузер.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                  event.preventDefault()
                  openTopUp()
                },
              },
              balanceText,
            ),
            extras.length > 0 ? h('span', null, ` · ${extras.join(' · ')}`) : null,
          ),
          sep,
          h(
            'span',
            { style: { display: 'inline-flex', alignItems: 'baseline' } },
            h('span', null, 'Сессия: '),
            h(
              'button',
              {
                ref: buttonRef,
                type: 'button',
                onClick: toggle,
                'aria-label': `Траты за ${USAGE_DAYS} дней`,
                style: BUTTON_STYLE,
              },
              hasSession ? `${tokenText(sessionTokens)} ток · ${dollars(cost)}` : '—',
            ),
          ),
        ),
        open ? h(UsagePopover, { anchor, onClose: () => setOpen(false) }) : null,
      )
    }

    const inject = ['slots']

    /**
     * Подписать чип на слот дока композера и окно платформы на общий оверлей.
     * @param {object} ctx - клиентский контекст плагина.
     */
    function apply(ctx) {
      // Окно платформы живёт в устойчивом оверлее оболочки, а не в доке
      // композера: перерисовка композера больше не может снести нативную вьюху.
      try {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'wallet-ru.platform-page',
            },
            PlatformPageHost,
          ),
        )
      } catch (_error) {
        // Без общего оверлея чип откроет страницу напрямую (запасная ветка).
      }

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'wallet-ru',
            order: 0.5,
          },
          BalanceChip,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    // Локальные проверки (tools/smoke.mjs): оболочка эти поля не читает.
    exports.__internals = { priceTooltip, balanceTooltip, weekday, dayText, chartBars, BalanceChip }
    return module.exports
  },
})
