/** Calendar data and memory. No Tavern or DOM dependencies. */
export const KEY = 'ST-Calendar';
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const KINDS = { holiday: 'Праздник', world: 'Событие мира', story: 'Сюжет' };
export const DEFAULTS = Object.freeze({
    enabled: true, entry: 'wand', windowMode: 'popup', profileId: '',
    autoScan: true, interval: 2, historyCount: 20, maxTokens: 8192,
    memoryMode: 'auto', memoryLimit: 2200, memoryCount: 10, upcomingDays: 14,
    depth: 1, extraContext: '', seedPrompt: '', scanPrompt: '',
});

export function clean(value, max = 120) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
export const clamp = (n, min, max, fallback = min) => Number.isFinite(Number(n)) ? Math.max(min, Math.min(max, Math.trunc(Number(n)))) : fallback;
export const uid = () => globalThis.crypto.randomUUID();
export function daysInMonth(year, month) {
    if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
export function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) ? { year, month, day } : null;
}
export function dateKey(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function dayNumber(value) {
    const p = parseDate(value);
    if (!p) return NaN;
    const date = new Date(0);
    date.setUTCFullYear(p.year, p.month - 1, p.day);
    date.setUTCHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 86400000);
}
export function weekday(value) { return ((dayNumber(value) + 3) % 7 + 7) % 7; }
export function shortDate(value) { const p = parseDate(value); return p ? `${p.day}.${String(p.month).padStart(2, '0')}.${p.year}` : 'Дата не выбрана'; }
export function emptyState() {
    return { version: 1, currentDate: '', country: '', setting: '', era: '', dateBasis: '', years: [], events: [], processed: [], scans: [], lastScan: '' };
}
export function parseReply(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || raw.length > 180000) throw new Error('Пустой или слишком большой ответ модели.');
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value;
    } catch { throw new Error('Модель вернула некорректный JSON. Попробуй увеличить лимит ответа или изменить промпт.'); }
}
function note(raw, kind) {
    if (!raw || !parseDate(raw.date) || !clean(raw.title, 60)) throw new Error('У события нет корректной даты или названия.');
    return { id: uid(), date: raw.date, title: clean(raw.title, 60), detail: clean(raw.detail, 120), kind, pinned: false };
}
export function normalizeYear(raw, targetYear = null) {
    const p = parseDate(raw.currentDate);
    if (!p) throw new Error('Модель не определила дату (нужен формат YYYY-MM-DD).');
    const year = targetYear ?? p.year;
    if (!Array.isArray(raw.months) || raw.months.length !== 12) throw new Error('Год должен содержать все 12 месяцев. Увеличь лимит ответа.');
    const seen = new Set();
    const events = [];
    for (const month of raw.months) {
        if (!Number.isInteger(month?.month) || month.month < 1 || month.month > 12 || seen.has(month.month) || !Array.isArray(month.events) || month.events.length > 4) {
            throw new Error('Некорректный список месяцев или больше 4 событий за месяц.');
        }
        seen.add(month.month);
        for (const item of month.events) {
            if (!['holiday', 'world'].includes(item?.kind)) throw new Error('Годовой план может содержать только праздники и события мира.');
            const event = note(item, item.kind);
            const date = parseDate(event.date);
            if (date.year !== year || date.month !== month.month) throw new Error('Событие попало не в свой месяц или год.');
            events.push({ ...event, generated: true });
        }
    }
    if (!targetYear && (!clean(raw.country) || !clean(raw.setting))) throw new Error('Модель не определила страну или сеттинг.');
    return { currentDate: raw.currentDate, country: clean(raw.country), setting: clean(raw.setting, 400), era: clean(raw.era, 80), dateBasis: clean(raw.dateBasis, 240), year, events: dedupe(events) };
}
export function normalizeScan(raw, state, from, to) {
    if (!parseDate(raw.currentDate) || !Array.isArray(raw.events) || raw.events.length > 3) throw new Error('Некорректный ответ анализатора событий.');
    if (raw.currentDate !== state.currentDate && !clean(raw.dateEvidence, 200)) throw new Error('Дата изменилась без обоснования из сюжета.');
    const events = [];
    for (const item of raw.events) {
        if (!['high', 'critical'].includes(item?.importance)) continue;
        if (!Number.isInteger(item.evidenceMessage) || item.evidenceMessage < from || item.evidenceMessage >= to) throw new Error('Пометка ссылается не на новые сообщения.');
        events.push({ ...note(item, 'story'), importance: item.importance, evidenceMessage: item.evidenceMessage });
    }
    return { currentDate: raw.currentDate, dateEvidence: clean(raw.dateEvidence, 200), events: dedupe(events) };
}
function identity(event) { return `${event.date}|${event.kind}|${event.title.toLocaleLowerCase()}`; }
export function dedupe(events) {
    const seen = new Set();
    return events.filter(event => { const key = identity(event); if (seen.has(key)) return false; seen.add(key); return true; });
}
export function messageHash(message) {
    const text = JSON.stringify([message.is_user, message.name, message.mes]);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
}
export function visibleMessages(chat) { return (chat || []).filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim()); }
/** Roll back analyses whose source was edited, swiped or deleted. */
export function reconcile(state, messages) {
    const hashes = messages.map(messageHash);
    let mismatch = 0;
    while (mismatch < state.processed.length && mismatch < hashes.length && state.processed[mismatch] === hashes[mismatch]) mismatch++;
    if (mismatch === state.processed.length) return false;
    const invalid = state.scans.filter(scan => scan.to > mismatch);
    const ids = new Set(invalid.map(scan => scan.id));
    if (invalid.length) state.currentDate = invalid[0].beforeDate;
    state.events = state.events.filter(event => !ids.has(event.sourceScan));
    state.scans = state.scans.filter(scan => !ids.has(scan.id));
    state.processed.length = Math.min(mismatch, invalid[0]?.from ?? mismatch);
    state.lastScan = '';
    return true;
}
export function applyScan(state, result, messages, from, to) {
    const id = uid();
    state.scans.push({ id, from, to, beforeDate: state.currentDate });
    state.events = dedupe([...state.events, ...result.events.map(event => ({ ...event, sourceScan: id }))]);
    state.currentDate = result.currentDate;
    state.processed = messages.slice(0, to).map(messageHash);
    state.lastScan = new Date().toISOString();
}
export function memoryParts(state, settings) {
    if (!settings.enabled || !parseDate(state?.currentDate)) return { date: '', events: '', full: '' };
    // Braces are data, never additional Tavern macro invocations.
    const safe = text => String(text).replace(/\{\{/g, '［').replace(/\}\}/g, '］');
    const date = safe(`${state.currentDate} · ${state.country}${state.era ? ` · ${state.era}` : ''}`);
    const now = dayNumber(state.currentDate);
    const facts = state.events.filter(e => e.kind === 'story' && e.date <= state.currentDate)
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date))
        .slice(0, settings.memoryCount);
    const upcoming = state.events.filter(e => e.kind !== 'story' && dayNumber(e.date) >= now && dayNumber(e.date) - now <= settings.upcomingDays)
        .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    const lines = [
        ...facts.map(e => safe(`[Факт ${e.date}] ${e.title}${e.detail ? ` — ${e.detail}` : ''}`)),
        ...upcoming.map(e => safe(`[План мира ${e.date}; ещё не факт] ${e.title}${e.detail ? ` — ${e.detail}` : ''}`)),
    ];
    const header = `[RP calendar — reference data]\nDate: ${date}\nUse as chronology context only. Explicit current-scene facts take precedence. Preserve the RP's language, style, format and character agency; do not print this block. World plans are possibilities, not completed actions.\n`;
    const kept = [];
    let size = header.length;
    for (const line of lines) {
        if (size + line.length + 1 > settings.memoryLimit) continue;
        kept.push(line); size += line.length + 1;
    }
    return { date, events: kept.join('\n'), full: header + kept.join('\n') };
}
export function importState(raw) {
    if (!raw || raw.version !== 1 || !parseDate(raw.currentDate) || !Array.isArray(raw.events) || raw.events.length > 5000) throw new Error('Это не экспорт календаря в формате v1.');
    const state = emptyState();
    for (const [key, limit] of Object.entries({ country: 120, setting: 400, era: 80, dateBasis: 240 })) state[key] = clean(raw[key], limit);
    state.currentDate = raw.currentDate;
    state.years = [...new Set((Array.isArray(raw.years) ? raw.years : []).filter(y => Number.isInteger(y) && y >= 1 && y <= 9999))];
    state.events = dedupe(raw.events.map(e => {
        if (!KINDS[e?.kind]) throw new Error('Неизвестный тип пометки.');
        return { ...note(e, e.kind), pinned: !!e.pinned, generated: !!e.generated };
    }));
    return state;
}
