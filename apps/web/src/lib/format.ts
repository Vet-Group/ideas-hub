// Dates and times shown in the UI are in Asia/Ho_Chi_Minh, 24 h.
import { t } from './strings.vi';

const TZ = 'Asia/Ho_Chi_Minh';

const time = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const dayMonth = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const date = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

/** "14:20". */
export const formatTime = (d: Date) => time.format(d);
/** "19/10 14:20". */
export const formatDateTime = (d: Date | null | undefined) => (d ? dateTime.format(d).replace(',', '') : t.common.none);
/** "19/10" from a `YYYY-MM-DD` date. */
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "19/10" of the Asia/Ho_Chi_Minh day of an instant. */
export const formatDayMonth = (d: Date) => {
  // Parts, not format(): the pattern's separator depends on the ICU data ("20-10" in some builds).
  const part = (type: string) => dayMonth.formatToParts(d).find((p) => p.type === type)?.value;
  return `${part('day')}/${part('month')}`;
};
/** "19/10/2026". */
export const formatDate = (d: Date) => date.format(d);
