import { MONTHS, KINDS, SYMBOLS, eventSymbol, isMemoryFact, clean, uid, emptyState, daysInMonth, dateKey, parseDate, weekday, shortDate, importState } from './core.js';
import { SEED_PROMPT, SCAN_PROMPT } from './prompts.js';

const paths = {
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    flame: '<path d="M12 2c2 6-4 7-4 11 0 2 1 3 2 3-1-4 4-5 4-8 4 4 6 7 4 11-2 4-10 4-12-1C3 12 9 8 12 2Z"/>',
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v3"/>',
    leaf: '<path d="M20 3C10 2 3 6 4 13s10 10 14 2c2-4 2-8 2-12ZM3 21 15 9"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    moon: '<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/><path d="M18 3v4m-2-2h4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="m15 5 4 4M4 20l4-1L20 7a3 3 0 0 0-4-4L4 15z"/>',
    pin: '<path d="m16 3 5 5-5 2-2 5-5-5 5-2zM9 15l-6 6"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    memory: '<path d="M5 3h13a2 2 0 0 1 2 2v16H6a3 3 0 0 1 0-6h14M6 3v12m4-8h6m-6 4h4"/>',
};
export function node(tag, className = '', text = '') {
    const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
}
function icon(name) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.6'); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true'); el.classList.add('stcal-icon'); el.innerHTML = paths[name] || paths.calendar; return el;
}
function eventBadge(event) {
    const symbol = eventSymbol(event);
    const badge = node('span', `stcal-event-badge stcal-symbol-${symbol}`);
    badge.title = SYMBOLS[symbol]; badge.append(icon(symbol)); return badge;
}
function button(text, action, glyph, className = '') {
    const b = node('button', `stcal-btn ${className}`, ''); b.type = 'button';
    if (glyph) b.append(icon(glyph));
    if (text) b.append(node('span', '', text));
    b.addEventListener('click', action); return b;
}
function iconButton(label, action, glyph) {
    const b = button('', action, glyph, 'stcal-icon-btn'); b.title = label; b.setAttribute('aria-label', label); return b;
}
function field(label, control, help = '') {
    const toggle = control.type === 'checkbox';
    const wrap = node('label', `stcal-field${toggle ? ' stcal-toggle' : control.type === 'number' ? ' stcal-number-field' : ''}`);
    const text = node('span', 'stcal-field-copy'); text.append(node('span', 'stcal-label', label));
    if (help) {
        const description = node('span', 'stcal-hint', help); description.id = `stcal-help-${uid()}`;
        control.setAttribute('aria-describedby', description.id); text.append(description);
    }
    wrap.append(text, control);
    if (toggle) {
        wrap.classList.toggle('stcal-checked', control.checked);
        control.addEventListener('change', () => wrap.classList.toggle('stcal-checked', control.checked));
    }
    return wrap;
}
function input(value, type = 'text') { const el = node('input', 'stcal-input'); el.type = type; el.value = value; return el; }
function select(value, options) {
    const el = node('select', 'stcal-input');
    for (const [key, text, disabled] of options) { const option = node('option', '', text); option.value = key; option.disabled = !!disabled; el.append(option); }
    el.value = value; return el;
}
function card(title) { const el = node('section', 'stcal-card'); if (title) el.append(node('h3', '', title)); return el; }
function hint(text) { return node('p', 'stcal-hint', text); }

export function mountUi(api) {
    let dialog = null;
    let body = null;
    let status = null;
    let tab = 'calendar';
    let selected = '';
    let year = 1;
    let month = 1;
    let yearView = false;
    let editor = null;
    let focusBefore = null;
    let activeChat = null;
    let fab;
    let panel;
    let wand;
    const context = () => SillyTavern.getContext();
    const inform = text => globalThis.toastr?.info?.(text, 'Календарь');
    const fail = error => globalThis.toastr?.error?.(error.message, 'Календарь');
    function jump(date) {
        const p = parseDate(date); if (!p) return;
        selected = date; year = p.year; month = p.month;
    }
    function close() {
        if (!dialog) return;
        const shell = dialog;
        dialog = null; body = null; status = null; editor = null;
        if (shell.open) shell.close();
        if (shell.hasAttribute('popover') && shell.matches(':popover-open')) shell.hidePopover();
        shell.remove();
        if (focusBefore?.isConnected) focusBefore.focus();
    }
    function isShowing() {
        return dialog?.isConnected && (dialog.open || (dialog.hasAttribute('popover') && dialog.matches(':popover-open')));
    }
    function present() {
        const mode = api.settings.windowMode === 'floating' ? 'floating' : 'popup';
        if (isShowing() && dialog.dataset.mode === mode) return;
        if (dialog.open) dialog.close();
        if (dialog.hasAttribute('popover') && dialog.matches(':popover-open')) dialog.hidePopover();
        dialog.removeAttribute('popover');
        dialog.classList.toggle('stcal-floating', mode === 'floating');
        dialog.classList.toggle('stcal-popup', mode === 'popup');
        dialog.dataset.mode = mode;
        if (!dialog.isConnected) document.body.append(dialog);
        // A modeless dialog sits inside Tavern's transformed html element.
        // Its fixed mobile body can leave that containing block with zero height.
        // A manual popover uses the viewport top layer without making chat inert.
        if (mode === 'floating' && typeof dialog.showPopover === 'function') {
            dialog.setAttribute('popover', 'manual');
            dialog.showPopover();
        } else dialog.showModal(); // Older browsers still get an accessible window.
    }
    function open() {
        if (dialog) { present(); dialog.focus(); return; }
        focusBefore = document.activeElement;
        activeChat = context().getCurrentChatId?.();
        jump(api.state()?.currentDate);
        dialog = node('dialog', `stcal-shell stcal-${api.settings.windowMode}`);
        dialog.setAttribute('aria-labelledby', 'stcal-title');
        dialog.tabIndex = -1;
        const header = node('header', 'stcal-header');
        const brand = node('div', 'stcal-brand');
        const mark = node('div', 'stcal-mark'); mark.append(icon('calendar'));
        const text = node('div'); const heading = node('h2', '', 'Календарь'); heading.id = 'stcal-title';
        text.append(heading, node('p', 'stcal-eyebrow', 'У каждой истории есть своё время'));
        brand.append(mark, text);
        header.append(brand, iconButton('Закрыть календарь', close, 'close'));
        const tabs = node('nav', 'stcal-tabs'); tabs.setAttribute('aria-label', 'Разделы календаря');
        for (const [id, label, glyph] of [['calendar', 'Календарь', 'calendar'], ['memory', 'Память', 'memory'], ['settings', 'Настройки', 'settings']]) {
            const b = button(label, () => { tab = id; editor = null; render(); }, glyph); b.dataset.tab = id; tabs.append(b);
        }
        body = node('div', 'stcal-body');
        status = node('div', 'stcal-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        dialog.append(header, tabs, body, status);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.addEventListener('keydown', event => { if (event.key === 'Escape' && dialog.classList.contains('stcal-floating')) { event.preventDefault(); close(); } });
        const shell = dialog;
        // Let a close→show transition finish before deciding the user dismissed it.
        const dismissed = () => queueMicrotask(() => { if (dialog === shell && !isShowing()) close(); });
        shell.addEventListener('close', dismissed);
        shell.addEventListener('toggle', dismissed);
        document.body.append(dialog);
        render();
        present();
        dialog.querySelector('button')?.focus();
    }
    api.open = open;
    function renderStatus() {
        if (!status) return;
        status.replaceChildren(node('span', '', api.status));
        if (api.busy) status.append(button('Отмена', api.cancel, 'close'));
        status.classList.toggle('stcal-working', api.busy);
        dialog?.querySelectorAll('[data-ai]').forEach(b => { b.disabled = api.busy || !api.settings.enabled; });
    }
    function render() {
        if (!body) return;
        dialog.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', String(b.dataset.tab === tab)));
        body.replaceChildren();
        if (editor) renderEditor();
        else if (tab === 'settings') renderSettings();
        else if (tab === 'memory') renderMemory();
        else renderCalendar();
        renderStatus();
    }
    function aiButton(label, mode, targetYear) {
        const b = button(label, () => void api.run(mode, targetYear), 'spark', 'stcal-primary'); b.dataset.ai = ''; return b;
    }
    function renderCalendar() {
        const s = api.state();
        if (!api.hasChat()) { const c = card('История ещё не открыта'); c.append(hint('Выбери персонажа или групповой чат. Календарь сохраняется внутри отдельного чата.')); body.append(c); return; }
        if (!s?.currentDate) {
            const c = card('Какой сегодня день в твоём мире?'); c.classList.add('stcal-empty');
            c.prepend(icon('calendar'));
            c.append(hint('Модель прочитает персонажа, персону, сценарий, связанный лор и последние сообщения. Определит дату и место, затем придумает уместные события на весь год.'), aiButton('Создать календарь года', 'seed'), button('Задать дату вручную', () => { editor = { type: 'world' }; render(); }, 'edit'));
            body.append(c); return;
        }
        if (!selected) jump(s.currentDate);
        const hero = node('section', 'stcal-hero');
        const info = node('div'); info.append(node('div', 'stcal-eyebrow', 'Сейчас в истории'), node('div', 'stcal-date-title', shortDate(s.currentDate)), node('div', 'stcal-place', [s.country, s.era].filter(Boolean).join(' · ')));
        hero.append(info, iconButton('Изменить дату и сеттинг', () => { editor = { type: 'world' }; render(); }, 'edit'));
        body.append(hero);
        const nav = node('div', 'stcal-month-nav');
        nav.append(iconButton('Назад', () => move(-1), 'left'));
        const center = button(yearView ? `${year}` : `${MONTHS[month - 1]} ${year}`, () => { yearView = !yearView; render(); }, null, 'stcal-month-title');
        center.title = 'Переключить месяц / весь год';
        nav.append(center, iconButton('Вперёд', () => move(1), 'right'));
        const actions = node('div', 'stcal-toolbar');
        actions.append(button('К текущей дате', () => { jump(s.currentDate); yearView = false; render(); }), button(yearView ? 'Месяц' : 'Весь год', () => { yearView = !yearView; render(); }));
        body.append(nav, actions);
        if (yearView) {
            const grid = node('div', 'stcal-year-grid');
            for (let m = 1; m <= 12; m++) {
                const box = node('section', 'stcal-mini');
                box.append(button(MONTHS[m - 1], () => { month = m; yearView = false; render(); }));
                box.append(calendarGrid(s, year, m, true)); grid.append(box);
            }
            body.append(grid);
        } else body.append(calendarGrid(s, year, month));
        const legend = node('div', 'stcal-legend');
        for (const [kind, text] of Object.entries(KINDS)) { const item = node('span', '', text); item.prepend(node('i', `stcal-dot stcal-${kind}`)); legend.append(item); }
        body.append(legend);
        const agenda = card(shortDate(selected));
        const events = s.events.filter(e => e.date === selected);
        if (!events.length) agenda.append(hint('Пока без пометок. Иногда важнее просто прожить этот день.'));
        for (const event of events) agenda.append(eventRow(event));
        agenda.append(button('Добавить пометку', () => { editor = { type: 'event', date: selected }; render(); }, 'plus'));
        body.append(agenda);
        const monthEvents = s.events.filter(e => e.date.startsWith(dateKey(year, month, 1).slice(0, 7))).sort((a, b) => a.date.localeCompare(b.date));
        if (!yearView && monthEvents.length) {
            const overview = node('details', 'stcal-card stcal-month-agenda');
            overview.append(node('summary', '', `В этом месяце · ${monthEvents.length} пометок`));
            for (const event of monthEvents) {
                const item = button('', () => { jump(event.date); render(); }, null, 'stcal-month-item');
                item.append(eventBadge(event), node('span', 'stcal-month-day', String(parseDate(event.date).day)), node('span', 'stcal-month-copy', event.title));
                item.title = `${KINDS[event.kind]} · ${event.detail || event.title}`;
                overview.append(item);
            }
            body.append(overview);
        }
        const tools = node('div', 'stcal-toolbar');
        tools.append(aiButton('Проверить сюжет', 'scan'));
        if (!s.years.includes(year)) tools.append(aiButton(`Придумать события ${year} года`, 'seed', year));
        else tools.append(button('Обновить события года', () => { if (window.confirm(`Заново придумать фоновые события ${year} года? Ручные пометки и сюжетные факты сохранятся.`)) void api.run('seed', year); }, 'spark'));
        body.append(tools);
        if (s.dateBasis) body.append(hint(`Основание даты: ${s.dateBasis}`));
    }
    function move(direction) {
        if (yearView) year = Math.max(1, Math.min(9999, year + direction));
        else {
            const index = (year - 1) * 12 + month - 1 + direction;
            if (index < 0 || index >= 9999 * 12) return;
            year = Math.floor(index / 12) + 1; month = index % 12 + 1;
        }
        selected = dateKey(year, month, 1); render();
    }
    function calendarGrid(s, y, m, mini = false) {
        const grid = node('div', `stcal-grid${mini ? ' stcal-grid-mini' : ''}`);
        for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) grid.append(node('span', 'stcal-weekday', day));
        for (let i = 0; i < weekday(dateKey(y, m, 1)); i++) grid.append(node('span', 'stcal-blank'));
        for (let d = 1; d <= daysInMonth(y, m); d++) {
            const date = dateKey(y, m, d);
            const events = s.events.filter(e => e.date === date);
            const day = button('', () => {
                selected = date; month = m; year = y; if (mini) yearView = false; render();
                body.querySelector(`[data-date="${date}"]`)?.focus({ preventScroll: true });
            }, null, 'stcal-day');
            day.dataset.date = date;
            day.append(node('span', 'stcal-day-number', String(d)));
            day.setAttribute('aria-label', `${shortDate(date)}${events.length ? `: ${events.map(e => e.title).join('; ')}` : ''}`);
            day.setAttribute('aria-pressed', String(selected === date));
            if (date === s.currentDate) { day.classList.add('stcal-today'); day.setAttribute('aria-current', 'date'); }
            const dots = node('span', mini ? 'stcal-dots' : 'stcal-day-symbols');
            if (mini) {
                for (const kind of new Set(events.map(e => e.kind))) dots.append(node('i', `stcal-dot stcal-${kind}`));
            } else if (events.length) {
                dots.append(eventBadge(events.find(isMemoryFact) || events[0]));
                if (events.length > 1) dots.append(node('span', 'stcal-day-count', `+${events.length - 1}`));
                day.classList.add('stcal-has-events');
            }
            day.append(dots); grid.append(day);
        }
        grid.addEventListener('keydown', event => {
            const days = [...grid.querySelectorAll('.stcal-day')];
            const index = days.indexOf(document.activeElement);
            const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
            if (index >= 0 && step) { event.preventDefault(); days[Math.max(0, Math.min(days.length - 1, index + step))].focus(); }
        });
        return grid;
    }
    function eventRow(event, dated = false) {
        const row = node('article', 'stcal-event'); row.append(eventBadge(event));
        const content = node('div', 'stcal-event-copy');
        const meaning = event.kind !== 'story' ? 'план мира' : isMemoryFact(event) ? 'важное · для памяти' : 'момент · только календарь';
        content.append(node('span', 'stcal-eyebrow', `${dated ? `${shortDate(event.date)} · ` : ''}${KINDS[event.kind]} · ${meaning}${event.pinned ? ' · закреплено' : ''}`), node('strong', '', event.title));
        if (event.detail) content.append(node('p', '', event.detail));
        const actions = node('div', 'stcal-event-actions');
        if (event.kind === 'story') {
            const pin = iconButton(event.pinned ? 'Открепить пометку' : 'Закрепить на дне', () => { event.pinned = !event.pinned; api.save(); }, 'pin'); pin.setAttribute('aria-pressed', String(event.pinned)); actions.append(pin);
        }
        actions.append(iconButton('Редактировать пометку', () => { editor = { type: 'event', id: event.id }; render(); }, 'edit'), iconButton('Удалить пометку', () => {
            if (!window.confirm(`Удалить «${event.title}»?`)) return;
            const s = api.state(); s.events = s.events.filter(e => e.id !== event.id); api.save();
        }, 'trash'));
        row.append(content, actions); return row;
    }
    function renderEditor() {
        if (!api.hasChat()) { editor = null; render(); return; }
        const s = api.state() || emptyState();
        const current = s.events.find(e => e.id === editor.id);
        const form = node('form', 'stcal-card');
        form.append(node('h3', '', editor.type === 'world' ? 'Дата и мир истории' : current ? 'Изменить пометку' : 'Новая пометка'));
        const date = input(current?.date || editor.date || s.currentDate || '0001-01-01', 'date'); date.required = true; date.min = '0001-01-01'; date.max = '9999-12-31';
        form.append(field('Дата', date));
        const inputs = {};
        if (editor.type === 'world') {
            for (const [key, label, max] of [['country', 'Страна / регион', 120], ['era', 'Название эры (необязательно)', 80], ['setting', 'Сеттинг', 400]]) {
                const el = input(s[key]); el.maxLength = max; inputs[key] = el; form.append(field(label, el));
            }
            form.append(hint('Сетка календаря: 12 григорианских месяцев. Год может быть годом вымышленной эры. Смена текущей даты вручную закрепляет её как новую точку отсчёта.'));
        } else {
            inputs.kind = select(current?.kind || 'story', Object.entries(KINDS));
            inputs.title = input(current?.title || ''); inputs.title.required = true; inputs.title.maxLength = 60;
            inputs.detail = input(current?.detail || ''); inputs.detail.maxLength = 120;
            form.append(field('Тип', inputs.kind), field('Название · 2–7 слов', inputs.title), field('Суть · одна короткая фраза', inputs.detail));
            inputs.importance = select(current?.importance || 'high', [['medium', 'Момент · только календарь'], ['high', 'Важное · для памяти РП'], ['critical', 'Переломное событие · для памяти РП']]);
            const importanceField = field('Значимость сюжетной пометки', inputs.importance, 'Для праздников и планов мира не применяется. Закрепление сохраняет пометку на её дне при пересчёте истории и даёт приоритет в памяти.');
            const syncKind = () => { importanceField.hidden = inputs.kind.value !== 'story'; };
            inputs.kind.addEventListener('change', syncKind); syncKind(); form.append(importanceField);
            inputs.symbol = { value: eventSymbol(current || { kind: 'story' }) };
            const picker = node('div', 'stcal-symbol-picker'); picker.setAttribute('role', 'group'); picker.setAttribute('aria-label', 'Символ пометки');
            for (const [symbol, label] of Object.entries(SYMBOLS)) {
                const choice = button(label, () => {
                    inputs.symbol.value = symbol;
                    picker.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.symbol === symbol)));
                }, symbol, `stcal-symbol-choice stcal-symbol-${symbol}`);
                choice.dataset.symbol = symbol; choice.setAttribute('aria-pressed', String(inputs.symbol.value === symbol)); picker.append(choice);
            }
            form.append(node('span', 'stcal-label', 'Символ пометки'), picker);
        }
        const error = node('p', 'stcal-error'); error.setAttribute('role', 'alert');
        const tools = node('div', 'stcal-toolbar');
        const submit = node('button', 'stcal-btn stcal-primary', 'Сохранить'); submit.type = 'submit';
        tools.append(submit, button('Назад', () => { editor = null; render(); }));
        form.append(error, tools);
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!parseDate(date.value)) { error.textContent = 'Выбери существующую дату от 0001 до 9999 года.'; return; }
            if (editor.type === 'world') {
                if (!api.state()) api.replace(emptyState());
                const state = api.state();
                for (const [key, el] of Object.entries(inputs)) state[key] = clean(el.value, { country: 120, setting: 400, era: 80 }[key]);
                state.dateBasis = 'Дата задана пользователем.';
                api.setDate(date.value);
            } else {
                const title = clean(inputs.title.value, 60);
                if (!title) { error.textContent = 'Напиши короткое название.'; return; }
                const updated = { id: current?.id || uid(), date: date.value, kind: inputs.kind.value, symbol: inputs.symbol.value, importance: inputs.importance.value, title, detail: clean(inputs.detail.value), pinned: current?.pinned || false };
                if (current) Object.assign(current, updated, { generated: false, sourceScan: undefined });
                else api.state().events.push(updated);
                api.save();
            }
            jump(date.value); editor = null; render();
        });
        body.append(form);
    }
    function renderMemory() {
        const c = card('Коротко, чтобы помнить');
        c.append(hint('В контекст идут текущая дата, важные факты и ближайшие события мира. Закреплённые факты имеют приоритет. Будущее всегда помечено как план, а не воспоминание.'));
        const memory = api.memory();
        const preview = node('pre', 'stcal-memory', memory.full || 'Пока нет календаря или расширение выключено.');
        c.append(preview, hint(`${memory.full.length} / ${api.settings.memoryLimit} символов · режим: ${{ auto: 'автоподстановка', macro: 'макросы', off: 'не отправлять' }[api.settings.memoryMode]}`));
        c.append(hint('Макросы для промпта / заметки автора: {{rp_calendar}} — весь блок; {{rp_date}} — дата и место; {{rp_events}} — пометки. Выбирай режим «Только макросы», чтобы не отправлять память дважды.'));
        const copy = button('Копировать память', async () => { try { await navigator.clipboard.writeText(memory.full); inform('Память скопирована.'); } catch { inform('Копирование недоступно. Текст можно выделить вручную.'); } });
        c.append(copy); body.append(c);
        const s = api.state();
        if (!s?.events) return;
        const history = card('Важное в сюжете');
        const events = s.events.filter(isMemoryFact).sort((a, b) => b.date.localeCompare(a.date));
        if (!events.length) history.append(hint('Здесь появятся только значимые изменения.'));
        for (const event of events) history.append(eventRow(event, true));
        body.append(history);
    }
    function control(parent, key, label, options, help) {
        const settings = api.settings;
        let el;
        if (Array.isArray(options)) el = select(settings[key], options);
        else if (typeof settings[key] === 'boolean') { el = input('', 'checkbox'); el.checked = settings[key]; }
        else { el = input(settings[key], typeof settings[key] === 'number' ? 'number' : 'text'); if (options) Object.assign(el, options); }
        el.dataset.setting = key;
        el.addEventListener('change', () => {
            settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
            api.saveSettings();
            if (el.type === 'number') el.value = settings[key];
        }); parent.append(field(label, el, help)); return el;
    }
    function renderSettings() {
        const settings = api.settings;
        const ai = card('Модель-календарист');
        const options = [['', 'По умолчанию · текущее подключение ST'], ...api.profiles().map(p => [p.id, `${p.name || p.id}${p.supported ? '' : ' · несовместим'}`, !p.supported])];
        if (settings.profileId && !options.some(([id]) => id === settings.profileId)) options.push([settings.profileId, 'Профиль удалён — выбери другой', true]);
        control(ai, 'profileId', 'Профиль подключения', options, 'По умолчанию: активный профиль Connection Manager, а без него — текущее Chat Completion подключение ST. Для другой модели выбери сохранённый профиль.');
        control(ai, 'autoScan', 'Автоматически проверять сюжет');
        control(ai, 'includeMoments', 'Сохранять памятные моменты', null, 'Встречи, подарки, прогулки — в календарь. В память РП идут только важные или закреплённые пометки.');
        control(ai, 'interval', 'Интервал проверки', { min: 2, max: 100 }, '2 сообщения = пользователь + персонаж. После готового ответа. Это частота анализа, а не срок хранения пометок.');
        control(ai, 'historyCount', 'Сообщений контекста', { min: 2, max: 100 });
        control(ai, 'maxTokens', 'Токенов на ответ', { min: 1024, max: 32768, step: 1024 }, 'Для целого года: 8192–16384.');
        body.append(ai);
        const memory = card('Память для РП');
        control(memory, 'memoryMode', 'Отправлять память', [['auto', 'Автоматически в промпт'], ['macro', 'Только через мои макросы'], ['off', 'Не отправлять']]);
        control(memory, 'memoryLimit', 'Лимит, символов', { min: 500, max: 8000 });
        control(memory, 'memoryCount', 'Сюжетных пометок', { min: 1, max: 40 }, 'Лимит отправляемых в РП фактов. Записи на днях календаря не удаляются.');
        control(memory, 'upcomingDays', 'План на дней вперёд', { min: 0, max: 90 });
        control(memory, 'depth', 'Глубина вставки', { min: 0, max: 20 });
        body.append(memory);
        const prompts = card('Сеттинг и промпты');
        for (const [key, label, fallback] of [['extraContext', 'Дополнительный сеттинг / правила мира', ''], ['seedPrompt', 'Промпт создания года', SEED_PROMPT], ['scanPrompt', 'Промпт важных событий', SCAN_PROMPT]]) {
            const el = node('textarea', 'stcal-input'); el.rows = key === 'extraContext' ? 3 : 8; el.value = settings[key] || fallback;
            el.addEventListener('change', () => { settings[key] = el.value; api.saveSettings(); });
            const details = node('details', 'stcal-details'); details.append(node('summary', '', label), el);
            if (fallback) details.append(button('Вернуть стандартный промпт', () => { settings[key] = ''; el.value = fallback; api.saveSettings(); }));
            prompts.append(details);
        }
        prompts.append(hint('Стандартные промпты на английском, названия и пометки — на языке РП. Промпты и дополнительный сеттинг общие. Данные календаря отдельные для каждого чата. При изменении промптов сохраняй JSON-контракт.'));
        body.append(prompts);
        const data = card('Данные этого чата');
        const tools = node('div', 'stcal-toolbar');
        tools.append(button('Экспорт JSON', () => {
            const s = api.state(); if (!s?.currentDate) { inform('Сначала создай календарь.'); return; }
            const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
            const a = node('a'); a.href = url; a.download = `calendar-${s.currentDate}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }));
        const file = input('', 'file'); file.accept = '.json,application/json'; file.hidden = true;
        file.addEventListener('change', async () => {
            const picked = file.files[0]; if (!picked) return;
            const chat = context().getCurrentChatId?.();
            try {
                if (!api.hasChat()) throw new Error('Сначала открой чат.');
                if (picked.size > 3000000) throw new Error('Файл слишком большой (максимум 3 МБ).');
                const value = importState(JSON.parse(await picked.text()));
                if (chat !== context().getCurrentChatId?.()) throw new Error('Чат изменился. Повтори импорт.');
                if (window.confirm('Заменить календарь этого чата данными из файла?')) { api.replace(value); jump(value.currentDate); inform('Календарь импортирован.'); }
            } catch (error) { fail(error); }
            file.value = '';
        });
        tools.append(button('Импорт JSON', () => file.click()), file, button('Удалить календарь', () => {
            if (!api.hasChat()) return;
            if (window.confirm('Удалить календарь и все его пометки в этом чате?')) { api.replace(emptyState()); selected = ''; render(); }
        }, 'trash'));
        data.append(tools); body.append(data);
    }
    function refreshEntrypoints() {
        if (wand) wand.hidden = api.settings.entry === 'floating';
        if (fab) fab.hidden = api.settings.entry === 'wand';
        panel?.querySelectorAll('[data-setting]').forEach(el => {
            if (el.type === 'checkbox') {
                el.checked = api.settings[el.dataset.setting];
                el.closest('.stcal-toggle').classList.toggle('stcal-checked', el.checked);
            } else el.value = api.settings[el.dataset.setting];
        });
    }
    function settingsPanel() {
        const root = node('div', 'stcal-settings-entry'); root.id = 'stcal-settings';
        // Same native Extensions drawer structure as LiteBranch.
        const drawer = node('div', 'inline-drawer');
        const header = node('div', 'inline-drawer-toggle inline-drawer-header');
        header.tabIndex = 0; header.setAttribute('role', 'button');
        const title = node('b', 'stcal-settings-title'); title.append(icon('calendar'), node('span', '', 'Календарь'));
        const chevron = node('span', 'stcal-settings-chevron'); chevron.append(icon('right'));
        header.append(title, chevron);
        const content = node('div', 'inline-drawer-content'); content.id = 'stcal-settings-content'; content.hidden = true;
        header.setAttribute('aria-controls', content.id); header.setAttribute('aria-expanded', 'false');
        // Own the toggle so keyboard and SVG state follow the same path; avoid
        // a second toggle from Tavern's delegated inline-drawer click handler.
        header.addEventListener('click', event => {
            event.stopPropagation();
            const expanded = header.getAttribute('aria-expanded') !== 'true';
            header.setAttribute('aria-expanded', String(expanded)); content.hidden = !expanded;
        });
        header.addEventListener('keydown', event => {
            if (['Enter', ' '].includes(event.key)) { event.preventDefault(); header.click(); }
        });
        const card = node('div', 'stcal-settings-card');
        card.append(hint('Время мира, важные события и короткая память истории.'));
        control(card, 'enabled', 'Календарь включён', null, 'Анализ сюжета и память для модели.');
        control(card, 'entry', 'Где показывать кнопку', [['wand', 'В волшебной палочке'], ['floating', 'Плавающая кнопка'], ['both', 'И там, и там']]);
        control(card, 'windowMode', 'Окно календаря', [['popup', 'Всплывающее'], ['floating', 'Плавающее рядом с чатом']], 'Режим открытого окна меняется сразу.');
        const actions = node('div', 'stcal-toolbar');
        const openTab = target => { tab = target; editor = null; open(); render(); };
        actions.append(button('Открыть календарь', () => openTab('calendar'), 'calendar'), button('Модель и память', () => openTab('settings'), 'settings'));
        card.append(actions); content.append(card); drawer.append(header, content); root.append(drawer);
        return root;
    }
    function installEntrypoints() {
        const menu = document.getElementById('extensionsMenu');
        if (menu && !wand?.isConnected) {
            wand = node('div', 'list-group-item flex-container flexGap5 interactable'); wand.id = 'stcal-wand'; wand.tabIndex = 0; wand.setAttribute('role', 'button');
            const glyph = node('span', 'extensionsMenuExtensionButton'); glyph.append(icon('calendar')); wand.append(glyph, node('span', '', 'Календарь'));
            wand.addEventListener('click', () => { menu.style.display = 'none'; open(); });
            wand.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); wand.click(); } }); menu.append(wand);
        }
        const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (container && !panel?.isConnected) {
            panel = settingsPanel(); container.append(panel);
        }
        refreshEntrypoints();
    }
    fab = button('', open, 'calendar'); fab.id = 'stcal-fab'; fab.title = 'Календарь сюжета'; fab.setAttribute('aria-label', 'Открыть календарь сюжета'); document.body.append(fab);
    installEntrypoints();
    const observer = new MutationObserver(installEntrypoints); observer.observe(document.body, { childList: true, subtree: true });
    const unsubscribe = api.subscribe(() => {
        refreshEntrypoints();
        if (dialog && activeChat !== context().getCurrentChatId?.()) { editor = null; selected = ''; close(); return; }
        if (dialog && dialog.dataset.mode !== api.settings.windowMode) present();
        // Do not destroy partially typed settings/forms when a background job finishes.
        if (dialog && tab !== 'settings' && !editor) render(); else renderStatus();
    });
    return () => { unsubscribe(); observer.disconnect(); close(); fab?.remove(); wand?.remove(); panel?.remove(); };
}
