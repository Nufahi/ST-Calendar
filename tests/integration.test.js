import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Window } from 'happy-dom';
import { startCalendar } from '../index.js';
import { KEY, emptyState, messageHash } from '../core.js';

function setup() {
    const window = new Window();
    Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver });
    document.body.innerHTML = '<div id="extensionsMenu"></div><div id="extensions_settings2"></div>';
    const eventSource = new EventEmitter();
    const eventTypes = Object.fromEntries(['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED'].map(e => [e, e]));
    const macros = new Map();
    const context = {
        extensionSettings: { [KEY]: { autoScan: false, profileId: 'analyst' }, connectionManager: { profiles: [{ id: 'analyst', name: 'Analyst', api: 'test' }] } },
        chatMetadata: {}, chat: [{ mes: 'Сегодня 1 января 2040 года', name: 'Char', is_user: false }],
        name1: 'User', name2: 'Char', characterId: 0, characters: [{ name: 'Char', personality: 'Добрый', scenario: 'Лондон' }],
        getCurrentChatId() { return this.id; }, id: 'chat-one',
        CONNECT_API_MAP: { test: { selected: 'openai', source: 'openai' } },
        ConnectionManagerRequestService: { sendRequest: async () => ({ content: JSON.stringify(yearReply()) }) },
        saveSettingsDebounced() {}, saveMetadata() {},
        setExtensionPrompt(_key, text) { context.prompt = text; },
        registerMacro(name, callback) { macros.set(name, callback); }, unregisterMacro(name) { macros.delete(name); },
        eventSource, eventTypes,
    };
    globalThis.SillyTavern = { getContext: () => context };
    const api = startCalendar();
    return { api, context, macros, async cleanup() { window.__stCalendarDispose(); await window.happyDOM.close(); } };
}
function yearReply() { return { currentDate: '2040-01-01', country: 'Англия', setting: 'Лондон', months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, events: [] })) }; }
function ready(context) {
    context.chatMetadata[KEY] = { ...emptyState(), currentDate: '2040-01-01', country: 'Англия', processed: context.chat.map(messageHash) };
    context.chat.push({ mes: 'Обещаю вернуться', name: 'User', is_user: true }, { mes: 'Мы заключили союз', name: 'Char', is_user: false });
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('seed via separate profile, DOM rendering, macros and scoped entrypoints', async () => {
    const env = setup();
    try {
        const { api, context, macros } = env;
        let request;
        context.ConnectionManagerRequestService.sendRequest = async (...args) => { request = args; return { content: JSON.stringify(yearReply()) }; };
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
