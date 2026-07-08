import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { IST_TIMEZONE, SLOT_CUTOFF_HOUR, DELIVERY_SLOT } from '../config/constants.js'
import { env } from '../config/env.js'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Get current time in IST.
 * @returns {import('dayjs').Dayjs}
 */
export function nowIST() {
  return dayjs().tz(IST_TIMEZONE)
}

/**
 * Determine delivery slot based on current IST time and holiday list.
 * @param {Date} [at] - override current time (for testing)
 * @returns {{ slot: 'SAME_DAY' | 'NEXT_DAY', reason: string | null }}
 */
export function determineSlot(at) {
  const now = at ? dayjs(at).tz(IST_TIMEZONE) : nowIST()
  const todayStr = now.format('YYYY-MM-DD')

  if (env.ZAPPR_HOLIDAYS.includes(todayStr)) {
    return { slot: DELIVERY_SLOT.NEXT_DAY, reason: 'HOLIDAY' }
  }

  if (now.hour() < SLOT_CUTOFF_HOUR) {
    return { slot: DELIVERY_SLOT.SAME_DAY, reason: null }
  }

  return { slot: DELIVERY_SLOT.NEXT_DAY, reason: null }
}

/**
 * Build a human-readable delivery promise string.
 * @param {'SAME_DAY' | 'NEXT_DAY'} slot
 * @returns {string}
 */
export function deliveryPromiseText(slot) {
  if (slot === DELIVERY_SLOT.SAME_DAY) {
    return 'Delivered today by 9 PM'
  }
  const tomorrow = nowIST().add(1, 'day').format('ddd, D MMM')
  return `Delivered by ${tomorrow}`
}
