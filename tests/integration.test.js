import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Window } from 'happy-dom';
import { startCalendar } from '../index.js';
import { KEY, emptyState, messageHash } from '../core.js';

function setup(configure = () => {}) {
    const window = new Window();
    Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver });
    document.body.innerHTML = '<div id="extensionsMenu"></div><div id="extensions_settings2"></div>';
    const eventSource = new EventEmitter();
    const eventTypes = Object.fromEntries(['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED'].map(e => [e, e]));
    const macros = new Map();
    const context = {
        extensionSettings: { [KEY]: { autoScan: false, includeMoments: true, profileId: 'analyst' }, connectionManager: { profiles: [{ id: 'analyst', name: 'Analyst', api: 'test' }] } },
        chatMetadata: {}, chat: [{ mes: 'Сегодня 1 января 2040 года', name: 'Char', is_user: false }],
        name1: 'User', name2: 'Char', characterId: 0, characters: [{ name: 'Char', personality: 'Добрый', scenario: 'Лондон' }],
        getCurrentChatId() { return this.id; }, id: 'chat-one',
        CONNECT_API_MAP: { test: { selected: 'openai', source: 'openai' } },
        ConnectionManagerRequestService: { sendRequest: async (_id, messages) => ({ content: JSON.stringify(replyFor(messages)) }) },
        saveSettingsDebounced() {}, saveMetadata() {},
        setExtensionPrompt(_key, text) { context.prompt = text; },
        registerMacro(name, callback) { macros.set(name, callback); }, unregisterMacro(name) { macros.delete(name); },
        eventSource, eventTypes,
    };
    configure(context, macros);
    globalThis.SillyTavern = { getContext: () => context };
    const api = startCalendar();
    return { api, context, macros, async cleanup() { window.__stCalendarDispose(); await window.happyDOM.close(); } };
}
function yearReply() { return { currentDate: '2040-01-01', country: 'Англия', setting: 'Лондон', months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, events: [] })) }; }
function replyFor(messages) { return JSON.parse(messages[1].content).newRange ? { currentDate: '2040-01-01', events: [] } : yearReply(); }
function ready(context) {
    context.chatMetadata[KEY] = { ...emptyState(), currentDate: '2040-01-01', country: 'Англия', processed: context.chat.map(messageHash) };
    context.chat.push({ mes: 'Обещаю вернуться', name: 'User', is_user: true }, { mes: 'Мы заключили союз', name: 'Char', is_user: false });
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('first creation analyzes the selected recent history and lore before saving both results', async () => {
    const env = setup(context => {
        delete context.extensionSettings[KEY].includeMoments;
        context.chat = Array.from({ length: 65 }, (_, i) => ({ mes: `Сцена ${i}`, name: 'Char', is_user: false }));
        context.chatMetadata.world_info = 'История мира';
        context.characters[0].data = { extensions: { world: 'Герои' } };
    });
    try {
        const { api, context } = env;
        const loaded = [];
        context.loadWorldInfo = async name => {
            loaded.push(name);
            return { entries: { one: { content: `Лор: ${name}` }, disabled: { disable: true, content: 'Скрытая запись' } } };
        };
        const requests = [];
        context.ConnectionManagerRequestService.sendRequest = async (_id, messages) => {
            const payload = JSON.parse(messages[1].content); requests.push(payload);
            assert.match(payload.lore, /Лор: История мира/);
            assert.match(payload.lore, /Лор: Герои/);
            assert.doesNotMatch(payload.lore, /Скрытая запись/);
            assert.equal(api.state().currentDate, '');
            if (!payload.newRange) return { content: JSON.stringify(yearReply()) };
            assert.equal(payload.analysisMode, 'history');
            assert.equal(payload.includeMoments, false);
            assert.deepEqual(payload.newRange, { from: 15, toExclusive: 65 });
            assert.equal(payload.newMessages.length, 50);
            assert.equal(payload.newMessages[0].index, 15);
            assert.equal(payload.currentDate, '2040-01-01');
            return { content: JSON.stringify({ currentDate: '2040-01-01', events: [
                { date: '2039-12-31', title: 'Раскрыта тайна', importance: 'high', evidenceMessage: 20 },
                { date: '2040-01-01', title: 'Заключён союз', importance: 'critical', evidenceMessage: 64 },
            ] }) };
        };
        await api.run('seed');
        assert.equal(requests.length, 2);
        assert.deepEqual(loaded, ['История мира', 'Герои']);
        assert.equal(api.state().events.filter(e => e.kind === 'story').length, 2);
        assert.equal(api.state().processed.length, 65);
        assert.equal(api.state().scans[0].from, 15);
        assert.match(context.prompt, /Раскрыта тайна/);
        assert.match(api.status, /2 сюжетных пометок по 50 сообщениям/);
        context.chat[64].mes = 'Союз не состоялся';
        context.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
        assert.equal(api.state().events.length, 0);
        assert.equal(api.state().processed.length, 15);
        context.eventSource.emit('GENERATION_ENDED');
        context.ConnectionManagerRequestService.sendRequest = async (_id, messages) => {
            const payload = JSON.parse(messages[1].content);
            assert.equal(payload.analysisMode, 'history');
            assert.equal(payload.currentDate, '2040-01-01');
            assert.deepEqual(payload.newRange, { from: 15, toExclusive: 65 });
            return { content: JSON.stringify({ currentDate: payload.currentDate, events: [] }) };
        };
        await api.run('scan');
        assert.equal(api.state().pendingHistory, undefined);
        assert.equal(api.state().currentDate, '2040-01-01');
    } finally { await env.cleanup(); }
});

test('history action recovers already processed messages with chosen count and deduplicates repeated facts', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        api.state().processed = context.chat.map(messageHash);
        api.settings.historyCount = 2;
        let calls = 0;
        context.ConnectionManagerRequestService.sendRequest = async (_id, messages) => {
            calls++;
            const payload = JSON.parse(messages[1].content);
            assert.equal(payload.analysisMode, 'history');
            assert.deepEqual(payload.newRange, { from: 1, toExclusive: 3 });
            if (calls === 2) assert.ok(payload.knownEvents.some(e => e.title === 'Заключён союз'));
            return { content: JSON.stringify({ currentDate: '2040-01-01', events: [{ date: '2040-01-01', title: 'Заключён союз', importance: 'high', evidenceMessage: 2 }] }) };
        };
        await api.run('history');
        await api.run('history');
        assert.equal(calls, 2);
        assert.equal(api.state().events.length, 1);
        assert.equal(api.state().currentDate, '2040-01-01');
        api.open();
        assert.ok([...document.querySelectorAll('button')].some(b => b.textContent.includes('Разобрать последние 2 сообщений')));
    } finally { await env.cleanup(); }
});

test('failed or stale second request leaves initial history unprocessed and calendar unsaved', async () => {
    for (const outcome of ['invalid', 'cancel', 'edit', 'chat']) {
        const env = setup();
        try {
            const { api, context } = env;
            const originalMetadata = context.chatMetadata;
            context.ConnectionManagerRequestService.sendRequest = async (_id, messages) => {
                if (!JSON.parse(messages[1].content).newRange) return { content: JSON.stringify(yearReply()) };
                if (outcome === 'cancel') api.cancel();
                if (outcome === 'edit') context.chat[0].mes = 'Другой сюжет';
                if (outcome === 'chat') {
                    context.id = 'chat-two'; context.chatMetadata = {}; context.chat = [];
                    context.eventSource.emit('CHAT_CHANGED');
                }
                return { content: outcome === 'invalid' ? '{}' : JSON.stringify({ currentDate: '2040-01-01', events: [] }) };
            };
            await api.run('seed');
            assert.equal(originalMetadata[KEY].currentDate, '', outcome);
            assert.deepEqual(originalMetadata[KEY].processed, [], outcome);
            assert.deepEqual(originalMetadata[KEY].years, [], outcome);
            if (outcome === 'chat') assert.equal(context.chatMetadata[KEY], undefined);
        } finally { await env.cleanup(); }
    }
});

test('incremental scans process every pending message in configurable sequential batches', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        api.settings.historyCount = 2;
        context.chat.push({ mes: 'Следующий день', name: 'Char', is_user: false });
        const ranges = [];
        context.ConnectionManagerRequestService.sendRequest = async (_id, messages) => {
            const payload = JSON.parse(messages[1].content); ranges.push(payload.newRange);
            assert.equal(payload.analysisMode, 'incremental');
            return { content: JSON.stringify({ currentDate: payload.currentDate, events: [] }) };
        };
        await api.run('scan'); await api.run('scan');
        assert.deepEqual(ranges, [{ from: 1, toExclusive: 3 }, { from: 3, toExclusive: 4 }]);
        assert.equal(api.state().processed.length, 4);
    } finally { await env.cleanup(); }
});

test('history rollback still reaches new messages after the selected window is deleted', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        api.state().processed = context.chat.map(messageHash);
        api.settings.historyCount = 2;
        await api.run('history');
        context.chat = [];
        context.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
        assert.equal(api.state().processed.length, 0);
        context.eventSource.emit('GENERATION_ENDED');
        context.chat.push({ mes: 'Новая сцена', name: 'Char', is_user: false });
        let called = false;
        context.ConnectionManagerRequestService.sendRequest = async (_id, messages) => {
            called = true;
            const payload = JSON.parse(messages[1].content);
            assert.deepEqual(payload.newRange, { from: 0, toExclusive: 1 });
            return { content: JSON.stringify({ currentDate: payload.currentDate, events: [] }) };
        };
        await api.run('scan');
        assert.equal(called, true);
        assert.equal(api.state().processed.length, 1);
    } finally { await env.cleanup(); }
});

test('window mode changes in place and reopening recovers closed or detached shells', async () => {
    const env = setup();
    try {
        const { api } = env;
        api.open();
        const shell = document.querySelector('.stcal-shell');
        document.querySelector('[data-tab=settings]').click();
        const draft = document.querySelector('.stcal-details textarea');
        draft.value = 'Unsaved world context';
        api.settings.windowMode = 'floating'; api.saveSettings();
        assert.equal(shell.dataset.mode, 'floating');
        assert.equal(document.querySelector('.stcal-shell'), shell);
        assert.equal(draft.value, 'Unsaved world context');
        api.settings.windowMode = 'popup'; api.saveSettings();
        assert.equal(shell.dataset.mode, 'popup');
        assert.equal(shell.open, true);
        shell.close();
        api.open();
        assert.equal(document.querySelector('.stcal-shell').open, true);
        document.querySelector('.stcal-shell').remove();
        api.open();
        assert.equal(document.querySelectorAll('.stcal-shell').length, 1);
        assert.equal(document.querySelector('.stcal-shell').open, true);
    } finally { await env.cleanup(); }
});

test('seed via separate profile, DOM rendering, macros and scoped entrypoints', async () => {
    const env = setup();
    try {
        const { api, context, macros } = env;
        let request;
        context.ConnectionManagerRequestService.sendRequest = async (...args) => { request = args; return { content: JSON.stringify(replyFor(args[1])) }; };
        await api.run('seed');
        assert.equal(request[0], 'analyst');
        assert.equal(request[3].includePreset, true);
        assert.equal(context.chatMetadata[KEY].years.length, 1);
        assert.match(context.prompt, /2040-01-01/);
        assert.match(macros.get('rp_calendar')(), /Англия/);
        api.open();
        assert.equal(document.querySelectorAll('.stcal-day').length, 31);
        assert.equal(document.querySelectorAll('#stcal-wand').length, 1);
        assert.equal(document.querySelector('#stcal-fab').hidden, true);
        context.chatMetadata[KEY].events.push({ id: 'unsafe', date: '2040-01-01', kind: 'story', title: '<img src=x onerror=alert(1)>', detail: 'Кратко' });
        api.save();
        assert.equal(document.querySelector('.stcal-event img'), null);
        assert.match(document.querySelector('.stcal-event').textContent, /<img/);
        api.settings.memoryMode = 'macro'; api.saveSettings(); assert.equal(context.prompt, '');
        api.settings.memoryMode = 'off'; api.saveSettings(); assert.equal(macros.get('rp_calendar')(), '');
    } finally { await env.cleanup(); }
});
test('late response cannot write into another chat', async () => {
    const env = setup();
    try {
        const { api, context } = env;
        ready(context);
        const previous = context.chatMetadata;
        let respond;
        context.ConnectionManagerRequestService.sendRequest = () => new Promise(resolve => { respond = resolve; });
        const pending = api.run('scan'); await tick();
        context.id = 'chat-two'; context.chatMetadata = {}; context.chat = [];
        context.eventSource.emit('CHAT_CHANGED');
        respond({ content: JSON.stringify({ currentDate: '2040-01-01', events: [] }) });
        await pending;
        assert.equal(context.chatMetadata[KEY], undefined);
        assert.equal(previous[KEY].processed.length, 1);
        assert.equal(context.prompt, '');
    } finally { await env.cleanup(); }
});

test('scan shows SVG moments, manual symbol selection persists and pinning opts into memory', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        context.ConnectionManagerRequestService.sendRequest = async (_id, messages) => {
            assert.equal(JSON.parse(messages[1].content).includeMoments, true);
            return { content: JSON.stringify({ currentDate: '2040-01-01', events: [{ date: '2040-01-01', title: 'Встреча у реки', detail: 'Герои прогулялись вместе', importance: 'medium', symbol: 'heart', evidenceMessage: 2 }] }) };
        };
        await api.run('scan'); api.open();
        assert.doesNotMatch(context.prompt, /Встреча у реки/);
        assert.ok(document.querySelector('.stcal-day-symbols .stcal-symbol-heart svg'));
        assert.match(document.querySelector('.stcal-event').textContent, /только календарь/);
        document.querySelector('[aria-label="Редактировать пометку"]').click();
        document.querySelector('[data-symbol="people"]').click();
        document.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
        assert.equal(context.chatMetadata[KEY].events[0].symbol, 'people');
        assert.equal(context.chatMetadata[KEY].events[0].importance, 'medium');
        assert.doesNotMatch(context.prompt, /Встреча у реки/);
        document.querySelector('[aria-label="Закрепить на дне"]').click();
        assert.match(context.prompt, /Встреча у реки/);
    } finally { await env.cleanup(); }
});
test('pin survives the six-message auto-scan threshold, reload and source rollback', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        context.ConnectionManagerRequestService.sendRequest = async () => ({ content: JSON.stringify({ currentDate: '2040-01-01', events: [{ date: '2040-01-01', title: 'Встреча у реки', importance: 'medium', evidenceMessage: 2 }] }) });
        await api.run('scan'); api.open();
        document.querySelector('[aria-label="Закрепить на дне"]').click();
        const pinned = structuredClone(api.state().events[0]);
        assert.equal(pinned.pinned, true);
        assert.equal(document.querySelector('[aria-label="Открепить пометку"]').getAttribute('aria-pressed'), 'true');
        api.settings.interval = 6; api.settings.autoScan = true; api.saveSettings();
        let calls = 0;
        context.ConnectionManagerRequestService.sendRequest = async () => {
            calls++;
            return { content: JSON.stringify({ currentDate: '2040-01-02', dateEvidence: 'Наступил следующий день', events: [] }) };
        };
        for (let i = 0; i < 6; i++) context.chat.push({ mes: `Продолжение ${i}`, name: i % 2 ? 'Char' : 'User', is_user: i % 2 === 0 });
        context.eventSource.emit('MESSAGE_RECEIVED');
        const deadline = Date.now() + 3000;
        while (api.state().processed.length < context.chat.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(calls, 1);
        assert.equal(api.state().processed.length, 9);
        assert.deepEqual(api.state().events, [pinned]);
        context.chatMetadata = JSON.parse(JSON.stringify(context.chatMetadata));
        const reloaded = startCalendar();
        context.chat[2].mes = 'Другой вариант ответа';
        context.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
        const { sourceScan, ...retained } = pinned;
        assert.deepEqual(reloaded.state().events, [retained]);
        assert.match(context.prompt, /Встреча у реки/);
        reloaded.open();
        assert.match(document.querySelector('[data-date="2040-01-01"]').getAttribute('aria-label'), /Встреча у реки/);
    } finally { await env.cleanup(); }
});
test('refreshing generated world events preserves pinned entries on their original day', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        const pinned = { id: 'pinned-world', date: '2040-01-01', kind: 'holiday', title: 'Праздник', generated: true, pinned: true };
        api.state().events = [pinned, { ...pinned, id: 'unpinned-world', title: 'Ярмарка', pinned: false }];
        await api.run('seed', 2040);
        assert.deepEqual(api.state().events, [pinned]);
    } finally { await env.cleanup(); }
});
test('editing source during an in-flight request discards the result', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        let respond;
        context.ConnectionManagerRequestService.sendRequest = () => new Promise(resolve => { respond = resolve; });
        const pending = api.run('scan'); await tick();
        context.chat[2].mes = 'Никакого союза';
        respond({ content: JSON.stringify({ currentDate: '2040-01-01', events: [] }) });
        await pending;
        assert.equal(context.chatMetadata[KEY].processed.length, 1);
        assert.match(api.status, /устаревший результат/);
    } finally { await env.cleanup(); }
});
test('successful scan stores concise event and auto mode waits for character completion', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        context.ConnectionManagerRequestService.sendRequest = async () => ({ content: JSON.stringify({ currentDate: '2040-01-02', dateEvidence: 'На следующее утро', events: [{ date: '2040-01-02', title: 'Союз заключён', detail: 'Герои договорились о взаимной защите', importance: 'high', evidenceMessage: 2 }] }) });
        context.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
        await api.run('scan');
        assert.equal(context.chatMetadata[KEY].events.length, 0);
        context.eventSource.emit('GENERATION_ENDED');
        await api.run('scan');
        assert.equal(context.chatMetadata[KEY].events.length, 1);
        assert.equal(context.chatMetadata[KEY].processed.length, 3);
        assert.equal(context.chatMetadata[KEY].currentDate, '2040-01-02');
    } finally { await env.cleanup(); }
});

test('active profile fallback isolates requests, cancellation and other extension state', async () => {
    const prompts = new Map([['OtherExtension', 'Keep this memory']]);
    const env = setup(context => {
        context.extensionSettings[KEY].profileId = '';
        context.extensionSettings.connectionManager.selectedProfile = 'analyst';
        context.chatMetadata.OtherExtension = { notes: ['untouched'] };
        context.setExtensionPrompt = (key, text) => prompts.set(key, text);
        context.generateRaw = () => { throw new Error('Global generator must not be used'); };
    });
    try {
        const { api, context } = env;
        const chat = structuredClone(context.chat);
        const profiles = structuredClone(context.extensionSettings.connectionManager);
        let signal;
        context.ConnectionManagerRequestService.sendRequest = (_profile, messages, _tokens, options) => {
            assert.equal(messages.length, 2);
            assert.match(messages[0].content, /language of the ongoing roleplay/);
            signal = options.signal;
            return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
        };
        const pending = api.run('seed'); await tick();
        api.cancel(); await pending;
        assert.equal(signal.aborted, true);
        assert.equal(context.chatMetadata[KEY].currentDate, '');
        assert.deepEqual(context.chat, chat);
        assert.deepEqual(context.extensionSettings.connectionManager, profiles);
        assert.deepEqual(context.chatMetadata.OtherExtension, { notes: ['untouched'] });
        assert.equal(prompts.get('OtherExtension'), 'Keep this memory');
        context.extensionSettings.connectionManager.selectedProfile = null;
        await api.run('seed');
        assert.match(api.status, /Текущее подключение/);
    } finally { await env.cleanup(); }
    assert.equal(prompts.get('OtherExtension'), 'Keep this memory');
});

test('default connection works without a saved profile via isolated current CC request', async () => {
    const env = setup(context => {
        context.extensionSettings[KEY].profileId = '';
        delete context.extensionSettings.connectionManager;
        context.mainApi = 'openai';
        context.chatCompletionSettings = { chat_completion_source: 'custom', custom_model: 'my-model', custom_url: 'https://example.invalid/v1' };
        context.generateRaw = () => { throw new Error('Global generator must not be used'); };
    });
    try {
        const { api, context } = env;
        const before = structuredClone(context.chatCompletionSettings);
        let sent = false;
        context.ChatCompletionService = {
            presetToGeneratePayload: async (_preset, settings, overrides) => {
                assert.deepEqual(settings, before);
                assert.notEqual(settings, context.chatCompletionSettings);
                assert.equal(overrides.model, 'my-model');
                assert.equal(overrides.messages.length, 2);
                return { ...overrides, custom_url: settings.custom_url };
            },
            sendRequest: async (payload, extract, signal) => {
                sent = true;
                assert.equal(payload.custom_url, before.custom_url);
                assert.equal(payload.stream, false);
                assert.equal(extract, true);
                assert.ok(signal instanceof AbortSignal);
                return { content: JSON.stringify(replyFor(payload.messages)) };
            },
        };
        await api.run('seed');
        assert.equal(sent, true);
        assert.ok(context.chatMetadata[KEY].currentDate);
        assert.deepEqual(context.chatCompletionSettings, before);
    } finally { await env.cleanup(); }
});

test('experimental macros keep other owners and cleanup only owned definitions', async () => {
    const registry = new Map([['rp_date', { handler: () => 'Other date' }]]);
    const env = setup(context => {
        context.powerUserSettings = { experimental_macro_engine: true };
        context.macros = {
            register: (name, definition) => registry.set(name, definition),
            registry: { hasMacro: name => registry.has(name), getMacro: name => registry.get(name), unregisterMacro: name => registry.delete(name) },
        };
    });
    try {
        const { api, context } = env;
        ready(context);
        api.settings.memoryMode = 'macro'; api.saveSettings();
        assert.equal(context.prompt, '');
        assert.match(registry.get('rp_calendar').handler(), /2040-01-01/);
        assert.equal(registry.get('rp_date').handler(), 'Other date');
        api.settings.enabled = false; api.saveSettings();
        assert.equal(registry.get('rp_calendar').handler(), '');
        registry.set('rp_events', { handler: () => 'Later owner' });
    } finally { await env.cleanup(); }
    assert.equal(registry.has('rp_calendar'), false);
    assert.equal(registry.get('rp_date').handler(), 'Other date');
    assert.equal(registry.get('rp_events').handler(), 'Later owner');
});

test('edits are reconciled before the next prompt and quiet generation blocks analysis', async () => {
    const env = setup();
    try {
        const { api, context } = env; ready(context);
        let calls = 0;
        context.ConnectionManagerRequestService.sendRequest = async () => {
            calls++;
            return { content: JSON.stringify({ currentDate: '2040-01-01', events: [{ date: '2040-01-01', title: 'Союз заключён', importance: 'high', evidenceMessage: 2 }] }) };
        };
        await api.run('scan');
        assert.match(context.prompt, /Союз заключён/);
        context.chat[2].mes = 'Союз отвергнут';
        context.eventSource.emit('GENERATION_STARTED', 'quiet', {}, false);
        assert.doesNotMatch(context.prompt, /Союз заключён/);
        await api.run('scan');
        assert.equal(calls, 1);
        context.eventSource.emit('GENERATION_ENDED');
        assert.equal(context.chatMetadata[KEY].processed.length, 1);
    } finally { await env.cleanup(); }
});
