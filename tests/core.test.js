import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, emptyState, parseDate, dayNumber, weekday, parseReply, normalizeYear, normalizeScan, applyScan, reconcile, messageHash, memoryParts, importState, eventSymbol } from '../core.js';

const message = (mes, is_user = false) => ({ mes, name: is_user ? 'User' : 'Character', is_user });
const world = () => ({ ...emptyState(), currentDate: '2024-02-28', country: 'Франция' });
const fact = (date, title, extra = {}) => ({ date, title, detail: 'Кратко', kind: 'story', ...extra });

test('calendar dates: leap years, year 1, weekday and cross-year distance', () => {
    assert.ok(parseDate('0001-01-01'));
    assert.ok(parseDate('2000-02-29'));
    for (const date of ['1900-02-29', '2024-02-30', '0000-01-01', '2024-13-01', '2024-1-01']) assert.equal(parseDate(date), null);
    assert.equal(weekday('0001-01-01'), 0);
    assert.equal(weekday('2026-10-02'), 4);
    assert.equal(dayNumber('2025-01-01') - dayNumber('2024-12-31'), 1);
});
test('model output is atomic: require a complete year and valid dates', () => {
    const raw = { currentDate: '2024-02-28', country: 'Франция', setting: 'Современность', months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, events: [] })) };
    raw.months[1].events.push({ date: '2024-02-29', kind: 'holiday', title: 'Праздник весны', detail: 'Ярмарка' });
    assert.equal(normalizeYear(raw).events.length, 1);
    assert.throws(() => normalizeYear({ ...raw, months: raw.months.slice(1) }));
    assert.throws(() => normalizeYear(raw, 2025));
    raw.months[1].events[0].kind = 'story';
    assert.throws(() => normalizeYear(raw));
    assert.deepEqual(parseReply('```json\n{"events":[]}\n```'), { events: [] });
    for (const reply of ['[]', 'null', '{"broken"', 'Here is JSON: {}']) assert.throws(() => parseReply(reply));
});
test('ignore trivial events; reject unsupported time jumps and old evidence', () => {
    const state = world();
    assert.deepEqual(normalizeScan({ currentDate: state.currentDate, events: [{ importance: 'low' }] }, state, 2, 4).events, []);
    assert.throws(() => normalizeScan({ currentDate: '2024-03-01', events: [] }, state, 2, 4));
    assert.throws(() => normalizeScan({ currentDate: state.currentDate, events: [{ ...fact(state.currentDate, 'Договор'), importance: 'high', evidenceMessage: 1 }] }, state, 2, 4));
});
test('swipe rolls back affected facts and date, preserves earlier/manual notes', () => {
    const state = world();
    const messages = [message('Начало'), message('Клятва', true), message('Наступило завтра'), message('Победа')];
    state.processed = messages.slice(0, 1).map(messageHash);
    applyScan(state, { currentDate: '2024-02-29', events: [fact('2024-02-29', 'Клятва')] }, messages, 1, 3);
    applyScan(state, { currentDate: '2024-03-01', events: [fact('2024-03-01', 'Победа')] }, messages, 3, 4);
    state.events.push(fact('2024-02-28', 'Ручная заметка'));
    messages[3].mes = 'Поражение';
    assert.equal(reconcile(state, messages), true);
    assert.equal(state.currentDate, '2024-02-29');
    assert.equal(state.processed.length, 3);
    assert.deepEqual(state.events.map(e => e.title), ['Клятва', 'Ручная заметка']);
    messages[1].mes = 'Не было клятвы';
    reconcile(state, messages);
    assert.equal(state.currentDate, '2024-02-28');
    assert.equal(state.processed.length, 1);
    assert.deepEqual(state.events.map(e => e.title), ['Ручная заметка']);
});
test('deleting trailing messages invalidates their scan; new messages do not', () => {
    const state = world();
    const messages = [message('А'), message('Б')];
    applyScan(state, { currentDate: state.currentDate, events: [] }, messages, 0, 2);
    assert.equal(reconcile(state, [...messages, message('В')]), false);
    assert.equal(reconcile(state, messages.slice(0, 1)), true);
    assert.equal(state.processed.length, 0);
});
test('bounded memory prioritizes pinned facts, distinguishes future plans and neutralizes macros', () => {
    const state = world(); state.currentDate = '2024-12-31';
    state.events = [fact('2024-01-01', 'Клятва {{user}}', { pinned: true }), fact('2024-12-30', 'Недавний факт'), fact('2025-01-01', 'Будущий факт'), { date: '2025-01-01', title: 'Новый год', kind: 'holiday' }];
    const memory = memoryParts(state, { ...DEFAULTS, memoryCount: 1, memoryLimit: 500 });
    assert.match(memory.full, /Клятва/);
    assert.doesNotMatch(memory.full, /Недавний факт|Будущий факт|\{\{user\}\}/);
    assert.match(memory.full, /План мира 2025-01-01; ещё не факт/);
    assert.ok(memory.full.length <= 500);
    assert.equal(memoryParts(state, { ...DEFAULTS, enabled: false }).full, '');
});
test('import detaches source history and validates types and dates', () => {
    const raw = world(); raw.processed = ['a']; raw.events = [fact('2024-02-28', 'Договор', { id: 'old', sourceScan: 'old-scan' })];
    const imported = importState(raw);
    assert.equal(imported.events[0].sourceScan, undefined);
    assert.notEqual(imported.events[0].id, 'old');
    assert.deepEqual(imported.processed, []);
    assert.throws(() => importState({ ...raw, events: [{ ...raw.events[0], date: '2024-02-30' }] }));
});

test('moments stay out of memory across export/import unless pinned; symbols are allowlisted', () => {
    const state = world();
    const raw = { currentDate: state.currentDate, events: [
        { ...fact(state.currentDate, 'Встреча на ярмарке'), importance: 'medium', symbol: 'people', evidenceMessage: 2 },
        { ...fact(state.currentDate, 'Заключён союз'), importance: 'high', symbol: '<svg onload=alert(1)>', evidenceMessage: 3 },
    ] };
    const result = normalizeScan(raw, state, 2, 4);
    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].symbol, 'people');
    assert.equal(result.events[1].symbol, 'star');
    assert.equal(eventSymbol({ kind: 'holiday', symbol: 'constructor' }), 'sun');
    state.events = result.events;
    const imported = importState(JSON.parse(JSON.stringify(state)));
    assert.equal(imported.events[0].importance, 'medium');
    assert.equal(imported.events[0].symbol, 'people');
    assert.doesNotMatch(memoryParts(imported, DEFAULTS).full, /Встреча на ярмарке/);
    assert.match(memoryParts(imported, DEFAULTS).full, /Заключён союз/);
    imported.events[0].pinned = true;
    assert.match(memoryParts(imported, DEFAULTS).full, /Встреча на ярмарке/);
    assert.equal(normalizeScan(raw, state, 2, 4, false).events.length, 1);
    assert.throws(() => normalizeScan({ ...raw, events: [{ ...raw.events[0], evidenceMessage: 1 }] }, state, 2, 4));
    assert.throws(() => normalizeScan({ ...raw, events: Array(7).fill(raw.events[0]) }, state, 2, 4));
});

test('richer year allows six dated background events per month but still rejects overflow', () => {
    const raw = { currentDate: '2024-01-01', country: 'Франция', setting: 'Современность', months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, events: [] })) };
    raw.months[0].events = Array.from({ length: 6 }, (_, i) => ({ date: `2024-01-0${i + 1}`, kind: 'world', symbol: 'leaf', title: `Ярмарка ${i}` }));
    assert.equal(normalizeYear(raw).events.length, 6);
    raw.months[0].events.push({ ...raw.months[0].events[0] });
    assert.throws(() => normalizeYear(raw));
});
