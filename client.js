/**
 * Клиентская половина: «Не пик 12 ч 38 мин · Баланс: $0.86 · Сессия: 12,3 тыс. ток · $0.04».
 *
 * Клик по сумме баланса открывает страницу пополнения, клик по расходу за сеанс —
 * маленькое окно с тратами за последнюю неделю.
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

    /** Цены DeepSeek в долларах за миллион токенов вне пика. */
    const OFFPEAK_USD = { input: 0.14, cacheHit: 0.014, output: 0.21 }
    /** В пик — полная цена, то есть вдвое дороже. */
    const PEAK_MULTIPLIER = 2

    /** Не пик — зелёный, пик — красный. */
    const GREEN = '#22c55e'
    const RED = '#ef4444'

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
     * Состояние баланса с хоста: запрос раз в минуту плюс тик для отсчёта.
     * @returns {object}
     */
    function useBalance() {
      const [remote, setRemote] = React.useState({
        phase: 'loading',
        balance: null,
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
              source: data.source || null,
              reason: data.reason || null,
              topUpUrl: data.topUpUrl || 'https://platform.deepseek.com/top_up',
            })
          } catch (error) {
            if (!alive) return
            setRemote({
              phase: 'error',
              balance: null,
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
     * Маленькое окно с тратами за неделю.
     * @param {object} props - якорь и обработчик закрытия.
     */
    function UsagePopover({ anchor, onClose }) {
      const panelRef = React.useRef(null)
      const [state, setState] = React.useState({ phase: 'loading', days: [], reason: null })
      const [position, setPosition] = React.useState(null)

      React.useEffect(() => {
        if (anchor !== null && anchor !== undefined) {
          const rect = anchor.getBoundingClientRect()
          setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)),
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

      const total = state.days.reduce((sum, day) => sum + (day.cost ?? 0), 0)
      const rows =
        state.days.length === 0
          ? [h('div', { key: 'empty', style: { opacity: 0.6 } }, state.phase === 'loading' ? 'Загрузка…' : 'Нет данных')]
          : state.days.map((day) =>
              h(
                'div',
                {
                  key: day.date,
                  style: { display: 'flex', gap: '12px', padding: '2px 0' },
                },
                h('span', null, `${day.date.slice(8, 10)}.${day.date.slice(5, 7)}`),
                h('span', { style: { opacity: 0.65, marginLeft: 'auto' } }, tokenText(day.tokens)),
                h('span', { style: { minWidth: '56px', textAlign: 'right' } }, dollars(day.cost)),
              ),
            )

      return h(
        'div',
        {
          ref: panelRef,
          role: 'dialog',
          style: {
            position: 'fixed',
            left: `${position === null ? 8 : position.left}px`,
            bottom: `${position === null ? 40 : position.bottom}px`,
            zIndex: 2147483000,
            minWidth: '240px',
            maxHeight: '320px',
            overflow: 'auto',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'var(--dsw-alias-bg-elevated, Canvas)',
            color: 'var(--dsw-alias-label-primary, CanvasText)',
            border: '1px solid var(--dsw-alias-separator-primary, GrayText)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
            fontSize: '12px',
            lineHeight: '18px',
            fontVariantNumeric: 'tabular-nums',
          },
        },
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, `Траты за ${USAGE_DAYS} дней`),
        state.phase === 'error' ? h('div', { style: { opacity: 0.6 } }, state.reason) : rows,
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: '12px',
              marginTop: '6px',
              paddingTop: '6px',
              borderTop: '1px solid var(--dsw-alias-separator-primary, GrayText)',
            },
          },
          h('span', null, 'Итого'),
          h('span', { style: { marginLeft: 'auto', minWidth: '56px', textAlign: 'right', fontWeight: 600 } }, dollars(total)),
        ),
      )
    }

    /**
     * Подсказка: период, цены и источник суммы.
     * @param {'peak'|'offpeak'} tier - тариф.
     * @param {object} remote - состояние с хоста.
     * @param {number} cost - стоимость сеанса.
     * @returns {string}
     */
    function tooltip(tier, remote, cost) {
      const lines = [
        tier === 'peak' ? 'Пик: полная цена' : 'Не пик: половина цены',
        'Ввод $0.14/M · кэш $0.014/M · вывод $0.21/M вне пика',
        `Сеанс: ${dollars(cost)}`,
      ]
      if (remote.balance) {
        if (remote.balance.usd !== null && remote.balance.usd !== undefined) {
          lines.push(`Баланс: ${dollars(Number(remote.balance.usd))}`)
        }
        for (const wallet of Array.isArray(remote.balance.other) ? remote.balance.other : []) {
          lines.push(`Кошелёк ${wallet.currency}: ${currencyText(String(wallet.currency), wallet.balance)}`)
        }
        for (const wallet of Array.isArray(remote.balance.bonus) ? remote.balance.bonus : []) {
          lines.push(`Бонусные баллы ${wallet.currency}: ${currencyText(String(wallet.currency), wallet.balance)}`)
        }
      }
      if (remote.source === 'account') lines.push('Источник: вход в аккаунт')
      else if (remote.source === 'api-key') lines.push('Источник: ключ API')
      else if (remote.reason) lines.push(`Баланс недоступен: ${remote.reason}`)
      const platform = typeof window === 'undefined' ? undefined : window.dshPlatform
      lines.push(
        platform !== undefined && platform !== null && typeof platform.open === 'function'
          ? 'Пополнение: окно платформы внутри приложения'
          : 'Пополнение: только внешний браузер',
      )
      return lines.join('\n')
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

    /** Сам чип. */
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
          { style: PILL_STYLE, title: tooltip(tier, remote, cost) },
          h('span', { style: { color: peak ? RED : GREEN } }, peak ? 'Пик' : 'Не пик'),
          h('span', null, ' ', remaining),
          sep,
          h('span', null, 'Баланс: '),
          h(
            'a',
            {
              href: remote.topUpUrl,
              title: 'Пополнить баланс (внутри приложения)',
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
          extras.length > 0
            ? h('span', { title: 'Другие кошельки и бонусные баллы' }, ` · ${extras.join(' · ')}`)
            : null,
          sep,
          h('span', null, 'Сессия: '),
          h(
            'button',
            {
              ref: buttonRef,
              type: 'button',
              onClick: toggle,
              title: `Траты за ${USAGE_DAYS} дней`,
              style: BUTTON_STYLE,
            },
            `${tokenText(sessionTokens)} ток · ${dollars(cost)}`,
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
    return module.exports
  },
})
