import { KEY, DEFAULTS, clamp, emptyState, parseDate, parseReply, normalizeYear, normalizeScan, visibleMessages, messageHash, reconcile, applyScan, dedupe, memoryParts } from './core.js';
import { SEED_PROMPT, SCAN_PROMPT, contextSnapshot, readLore } from './prompts.js';
import { mountUi } from './ui.js';

const ctx = () => SillyTavern.getContext();

export function startCalendar() {
    window.__stCalendarDispose?.();
    const initial = ctx();
    const settings = Object.assign({}, DEFAULTS, initial.extensionSettings[KEY]);
    initial.extensionSettings[KEY] = settings;
    const listeners = new Set();
    const bindings = [];
    let job = null;
    let timer = null;
    let generationActive = false;
    let epoch = 0;
    let revision = 0;
    let disposed = false;
    let autoFailed = false;
    let status = 'Открой чат и создай его календарь.';
    let unmount = () => {};

    function normalizeSettings() {
        for (const [key, min, max] of [['interval', 2, 100], ['historyCount', 2, 100], ['maxTokens', 1024, 32768], ['memoryLimit', 500, 8000], ['memoryCount', 1, 40], ['upcomingDays', 0, 90], ['depth', 0, 20]]) {
            settings[key] = clamp(settings[key], min, max, DEFAULTS[key]);
        }
        for (const [key, values] of Object.entries({ entry: ['wand', 'floating', 'both'], windowMode: ['popup', 'floating'], memoryMode: ['auto', 'macro', 'off'] })) {
            if (!values.includes(settings[key])) settings[key] = DEFAULTS[key];
        }
    }
    normalizeSettings();
    function hasChat(context = ctx()) { return !!context.getCurrentChatId?.() && !!context.chatMetadata; }
    function state(create = false) {
        const c = ctx();
        if (!hasChat(c)) return null;
        if (create && !c.chatMetadata[KEY]) c.chatMetadata[KEY] = emptyState();
        return c.chatMetadata[KEY] || null;
    }
    function notify(type, text) { globalThis.toastr?.[type]?.(text, 'Календарь'); }
    function publish(text) {
        if (text !== undefined) status = text;
        for (const listener of listeners) listener();
    }
    function memory() { return memoryParts(state(), settings); }
    function inject() {
        const text = settings.memoryMode === 'auto' ? memory().full : '';
        ctx().setExtensionPrompt?.(KEY, text, 1, settings.depth, false, 0);
    }
    function persist() {
        inject();
        const c = ctx();
        if (!hasChat(c)) return;
        try { Promise.resolve(c.saveMetadata()).catch(error => { console.error('[Calendar] save', error); notify('error', 'Не удалось сохранить календарь чата.'); }); }
        catch (error) { console.error('[Calendar] save', error); notify('error', 'Не удалось сохранить календарь чата.'); }
    }
    function save() { revision++; persist(); publish(); }
    function saveSettings() {
        normalizeSettings();
        if (!settings.enabled) cancel();
        autoFailed = false;
        ctx().saveSettingsDebounced(); inject(); publish();
    }
    function on(type, handler) {
        if (!type) return;
        initial.eventSource.on(type, handler); bindings.push([type, handler]);
    }
    function cancel() {
        if (!job) return;
        // Cancel only our isolated request, never Tavern's global generator.
        job.controller.abort();
        publish('Отмена запрошена; результат не будет записан.');
    }
    function profiles() {
        return (ctx().extensionSettings.connectionManager?.profiles || []).map(p => {
            const map = ctx().CONNECT_API_MAP?.[p.api];
            return { ...p, supported: !!map && ((map.selected === 'openai' && !!map.source) || (map.selected === 'textgenerationwebui' && !!map.type)) };
        });
    }
    async function request(c, prompt, options, signal) {
        signal.throwIfAborted();
        if (options.profileId) {
            const profile = profiles().find(p => p.id === options.profileId);
            if (!profile) throw new Error('Выбранный профиль удалён. Выбери другой в настройках.');
            if (!profile.supported) throw new Error('Для анализа нужен профиль Chat Completion или Text Completion.');
            if (c.extensionSettings.disabledExtensions?.includes('connection-manager') || !c.ConnectionManagerRequestService) throw new Error('Включи Connection Manager и обнови SillyTavern.');
            const result = await c.ConnectionManagerRequestService.sendRequest(profile.id, prompt, options.maxTokens, {
                stream: false, extractData: true, includePreset: true,
                includeInstruct: c.CONNECT_API_MAP[profile.api].selected === 'textgenerationwebui', signal,
            });
            signal.throwIfAborted();
            return parseReply(typeof result === 'string' ? result : result?.content);
        }
        // Use the isolated request service, never Tavern's global RP generator.
        if (options.currentApi !== 'openai') throw new Error('Текущее подключение: выбери Chat Completion в ST или сохранённый профиль Chat/Text Completion в календаре.');
        const service = c.ChatCompletionService;
        if (!service?.presetToGeneratePayload || !service?.sendRequest) throw new Error('Для текущего подключения обнови SillyTavern или выбери сохранённый профиль в календаре.');
        const current = options.currentSettings;
        const source = current.chat_completion_source;
        const model = current[`${source === 'makersuite' ? 'google' : source}_model`];
        const payload = await service.presetToGeneratePayload({}, current, {
            messages: prompt, model: model === 'OR_Website' ? null : model,
            chat_completion_source: source, max_tokens: options.maxTokens, stream: false,
        });
        signal.throwIfAborted();
        const result = await service.sendRequest(payload, true, signal);
        signal.throwIfAborted();
        return parseReply(typeof result === 'string' ? result : result?.content);
    }
    async function run(mode = 'scan', targetYear = null, automatic = false) {
        if (job || disposed) return;
        if (!settings.enabled) { if (!automatic) notify('info', 'Включи календарь в настройках.'); return; }
        if (generationActive || ctx().streamingProcessor && !ctx().streamingProcessor.isFinished) {
            if (!automatic) notify('info', 'Дождись завершения ответа персонажа.');
            return;
        }
        if (!hasChat()) { if (!automatic) notify('info', 'Сначала открой чат с персонажем.'); return; }
        const s = state(true);
        const c = ctx();
        const messages = structuredClone(visibleMessages(c.chat));
        if (reconcile(s, messages)) { revision++; persist(); }
        const firstSeed = mode === 'seed' && !parseDate(s.currentDate);
        const recovery = mode === 'scan' ? s.pendingHistory : null;
        const retrospective = mode === 'history' || firstSeed || !!recovery;
        if (mode !== 'seed' && !parseDate(s.currentDate)) { if (!automatic) notify('info', 'Сначала создай календарь года.'); return; }
        const from = recovery ? Math.min(recovery.from, s.processed.length, messages.length) : retrospective ? Math.max(0, messages.length - settings.historyCount) : s.processed.length;
        if (mode !== 'seed' && from >= messages.length) { if (!automatic) publish(mode === 'history' ? 'В чате нет сообщений для анализа.' : 'Новых сообщений для анализа нет.'); return; }
        // Small sequential batches keep every unprocessed message reachable.
        const to = recovery ? Math.min(messages.length, recovery.to) : mode === 'scan' ? Math.min(messages.length, from + settings.historyCount) : messages.length;
        const options = { ...settings, profileId: settings.profileId || c.extensionSettings.connectionManager?.selectedProfile || '', currentApi: c.mainApi, currentSettings: structuredClone(c.chatCompletionSettings || {}) };
        const snapshot = contextSnapshot(c, messages.slice(0, to), options);
        const draft = structuredClone(s);
        const runEpoch = epoch;
        const runRevision = revision;
        const metadata = c.chatMetadata;
        const chatId = c.getCurrentChatId();
        const sourceHashes = messages.slice(0, to).map(messageHash);
        const currentJob = { controller: new AbortController(), mode };
        job = currentJob;
        autoFailed = false;
        const timeout = setTimeout(() => currentJob.controller.abort(new DOMException('Время ожидания истекло', 'TimeoutError')), 180000);
        publish(mode === 'seed' ? `Создаю календарь ${targetYear || 'сюжета'} · все 12 месяцев…` : `Проверяю сообщения ${from + 1}–${to}…`);
        let succeeded = false;
        try {
            const lore = await readLore(c, snapshot.books, snapshot.embeddedLore);
            currentJob.controller.signal.throwIfAborted();
            const analyze = (system, payload) => request(c, [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }], options, currentJob.controller.signal);
            const isStale = () => {
                const live = ctx();
                return disposed || runEpoch !== epoch || runRevision !== revision || metadata !== live.chatMetadata || chatId !== live.getCurrentChatId() || JSON.stringify(sourceHashes) !== JSON.stringify(visibleMessages(live.chat).slice(0, to).map(messageHash));
            };
            let yearResult;
            if (mode === 'seed') {
                const raw = await analyze(options.seedPrompt.trim() || SEED_PROMPT, { ...snapshot.material, lore, requestedYear: targetYear || 'Infer from the story', existingCalendar: draft.currentDate ? { currentDate: draft.currentDate, country: draft.country, setting: draft.setting, era: draft.era } : null });
                if (isStale()) { publish('Чат или календарь изменился: устаревший результат отброшен.'); return; }
                yearResult = normalizeYear(raw, targetYear);
                if (firstSeed) {
                    for (const key of ['currentDate', 'country', 'setting', 'era', 'dateBasis']) draft[key] = yearResult[key];
                }
                draft.events = dedupe([...draft.events.filter(e => e.pinned || !(e.generated && e.kind !== 'story' && parseDate(e.date)?.year === yearResult.year)), ...yearResult.events]);
                draft.years = [...new Set([...draft.years, yearResult.year])].sort((a, b) => a - b);
            }
            if (mode !== 'seed' || firstSeed && from < to) {
                if (firstSeed) publish(`Год подготовлен. Выбираю главное по дням · сообщения ${from + 1}–${to}…`);
                const payload = { ...snapshot.material, lore, analysisMode: retrospective ? 'history' : 'incremental', includeMoments: options.includeMoments, currentDate: draft.currentDate, country: draft.country, setting: draft.setting, newRange: { from, toExclusive: to },
                    newMessages: messages.slice(from, to).map((m, i) => ({ index: from + i, name: m.name, role: m.is_user ? 'user' : 'character', text: m.mes.slice(-12000) })),
                    knownEvents: [...draft.events.filter(e => e.kind === 'story').slice(-200), ...draft.events.filter(e => e.kind !== 'story' && e.date >= draft.currentDate).slice(0, 8)].map(({ date, title, detail, kind }) => ({ date, title, detail, kind })),
                };
                const raw = await analyze(options.scanPrompt.trim() || SCAN_PROMPT, payload);
                const scanResult = normalizeScan(raw, draft, from, to, options.includeMoments);
                applyScan(draft, scanResult, messages, from, to, retrospective ? 'history' : 'incremental');
                delete draft.pendingHistory;
            }
            if (isStale()) {
                publish('Чат или календарь изменился: устаревший результат отброшен.'); return;
            }
            const added = draft.events.filter(e => e.kind === 'story').length - s.events.filter(e => e.kind === 'story').length;
            if (!draft.pendingHistory) delete s.pendingHistory;
            Object.assign(s, draft);
            save();
            if (mode === 'seed') {
                publish(`Готово: ${yearResult.year} год, ${yearResult.events.length} событий мира${firstSeed ? `, ${added} сюжетных пометок по ${to - from} сообщениям` : ''}. Дата и страна доступны для правки.`);
            } else {
                publish(added > 0 ? `Новых пометок: ${added}. В память РП идут только важные и закреплённые.` : 'Проверено. Новых событий для пометок не было.');
            }
            succeeded = true;
        } catch (error) {
            if (disposed || runEpoch !== epoch) return;
            const reason = currentJob.controller.signal.reason;
            if (currentJob.controller.signal.aborted && reason?.name !== 'TimeoutError') publish('Анализ отменён.');
            else {
                autoFailed = automatic;
                const detail = reason?.name === 'TimeoutError' ? 'Модель не ответила за 3 минуты.' : error.cause?.message || error.message;
                publish(`Ошибка: ${detail}${automatic ? ' Автопроверка приостановлена до ручной проверки или изменения настроек.' : ''}`);
                notify('error', detail); console.error('[Calendar] analysis', error);
            }
        } finally {
            clearTimeout(timeout);
            if (job === currentJob) job = null;
            if (!disposed) publish();
            if (succeeded || runEpoch !== epoch) schedule();
        }
    }
    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (disposed) return;
            const s = state();
            if (!s) { inject(); return; }
            const messages = visibleMessages(ctx().chat);
            if (!generationActive && reconcile(s, messages)) { revision++; persist(); publish('История изменилась: зависимые пометки откатились.'); }
            inject();
            const pending = messages.length - s.processed.length;
            if (settings.enabled && settings.autoScan && !autoFailed && !job && !generationActive && s.currentDate && pending >= settings.interval && !messages.at(-1)?.is_user) void run('scan', null, true);
        }, 650);
    }
    const types = initial.eventTypes || initial.event_types || {};
    on(types.CHAT_CHANGED, () => {
        epoch++; revision++; cancel(); autoFailed = false; generationActive = false;
        inject(); publish(state()?.currentDate ? 'Календарь этого чата загружен.' : 'Создай календарь для этого чата.'); schedule();
    });
    on(types.GENERATION_STARTED, (type, _params, dryRun) => {
        if (dryRun) return;
        const s = state();
        if (s && reconcile(s, visibleMessages(ctx().chat))) { revision++; persist(); }
        generationActive = true; inject();
    });
    on(types.GENERATION_ENDED, () => { generationActive = false; schedule(); });
    on(types.GENERATION_STOPPED, () => { generationActive = false; schedule(); });
    for (const key of ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED']) on(types[key], schedule);
    const ownedMacros = new Map();
    const macroValue = key => settings.memoryMode === 'off' ? '' : memory()[key];
    const newMacros = initial.powerUserSettings?.experimental_macro_engine && initial.macros?.register;
    const registry = initial.macros?.registry;
    for (const [name, part] of [['rp_calendar', 'full'], ['rp_date', 'date'], ['rp_events', 'events']]) {
        if (registry?.hasMacro?.(name)) {
            console.warn(`[Calendar] Macro ${name} already exists; keeping its owner.`);
            continue;
        }
        if (newMacros) initial.macros.register(name, { description: 'Календарь: память и хронология текущего РП', handler: () => macroValue(part) });
        else initial.registerMacro?.(name, () => macroValue(part), 'Календарь: память текущего РП');
        ownedMacros.set(name, registry?.getMacro?.(name));
    }
    const api = {
        settings, state, hasChat, save, saveSettings, run, cancel, profiles, memory,
        get status() { return status; }, get busy() { return !!job; },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        replace(value) { if (!hasChat()) return; cancel(); ctx().chatMetadata[KEY] = value; value.processed = visibleMessages(ctx().chat).map(messageHash); save(); },
        setDate(date) {
            if (!parseDate(date)) throw new Error('Некорректная дата.');
            const s = state(true); if (!s) return;
            // Manual correction becomes a new anchor; earlier facts stay intact.
            s.currentDate = date; s.scans = []; s.events.forEach(e => delete e.sourceScan);
            delete s.pendingHistory;
            save();
        },
    };
    unmount = mountUi(api);
    const parser = initial.SlashCommandParser;
    let slashCommand;
    if (parser && initial.SlashCommand && !parser.commands?.calendar) {
        slashCommand = initial.SlashCommand.fromProps({ name: 'calendar', callback: () => { api.open(); return ''; }, helpString: 'Открыть календарь сюжета.' });
        parser.addCommandObject(slashCommand);
    }
    inject(); schedule();
    window.__stCalendarDispose = () => {
        disposed = true; cancel(); clearTimeout(timer); bindings.forEach(([event, fn]) => initial.eventSource.removeListener(event, fn));
        for (const [name, definition] of ownedMacros) {
            if (registry?.getMacro && registry.getMacro(name) !== definition) continue;
            if (newMacros) initial.macros.registry.unregisterMacro(name);
            else initial.unregisterMacro?.(name);
        }
        if (slashCommand && parser.commands?.calendar === slashCommand) delete parser.commands.calendar;
        ctx().setExtensionPrompt?.(KEY, '', 1, settings.depth, false, 0);
        unmount(); listeners.clear();
    };
    return api;
}

if (typeof jQuery !== 'undefined') jQuery(() => startCalendar());
