import { clean } from './core.js';

export const SEED_PROMPT = `Ты — календарист ролевой истории. По карточкам персонажей (описание, personality, scenario), персоне пользователя, лору и сообщениям определи текущие год, месяц, день, страну/регион и сеттинг.
Приоритет: явные даты и факты последних сообщений > сценарий и лор > правдоподобная гипотеза. Не используй реальную сегодняшнюю дату. Если данных мало — выбери согласованную гипотезу и честно укажи её в dateBasis. Для фантастического мира допустимы вымышленная страна и название эры, но числовые даты хранятся в сетке из 12 григорианских месяцев, годы 0001–9999.
Составь календарь НА ВЕСЬ запрошенный год: все 12 месяцев, по 0–4 уместных праздника или фоновых события в каждом. В среднем 1–2 события в месяц. Существующие праздники подбирай по стране, эпохе и сеттингу, не переноси современные праздники в неподходящую эпоху. Можно придумывать местные фестивали, сезонные ярмарки, памятные дни. Не предсказывай решения, смерть, свадьбу или победы главных героев. Эти записи — план/фон мира, НЕ свершившиеся факты.
Пиши по-русски, имена сохраняй. title — 2–7 слов, максимум 60 символов; detail — одна тезисная фраза до 12 слов, максимум 120 символов. Никакого художественного текста.
Ответ: только JSON без markdown. Обязательны все 12 объектов months с уникальными month от 1 до 12, даже если events пуст.
{"currentDate":"YYYY-MM-DD","country":"страна / регион","setting":"сеттинг в одной строке","era":"название эры или пустая строка","dateBasis":"какие сведения подтверждают дату, что предположено","months":[{"month":1,"events":[{"date":"YYYY-01-DD","kind":"holiday или world","title":"Название","detail":"Короткая суть"}]}]}`;

export const SCAN_PROMPT = `Ты — строгий календарист РП. Проверь НОВЫЕ сообщения, учитывая контекст, и запиши только ВАЖНЫЕ свершившиеся сюжетные изменения: клятва/договор с последствиями, значимое раскрытие тайны, потеря, серьёзный конфликт, перелом отношений, завершение цели, переезд. Обычные разговоры, взгляды, еда, мелкие эмоции, передвижения по комнате и повтор уже известного НЕ заслуживают записи. Пустой events — нормальный и предпочтительный ответ. Не додумывай события.
Максимум 3 пометки. Каждая: title 2–7 слов до 60 символов; detail ОЧЕНЬ ТЕЗИСНО, одна фраза до 12 слов / 120 символов: кто → что изменилось / почему это важно. Не пересказ поста. importance только high или critical. evidenceMessage — целый индекс сообщения из НОВОГО диапазона (индексы уже даны).
currentDate меняй ТОЛЬКО если время действительно прошло в сюжете: явная дата, следующий день, три дня спустя и т.п. Количество сообщений и реальное время ничего не значат. Если дата меняется — dateEvidence кратко цитирует основание. Флешбэк получает прошлую дату события, но не переводит текущую сцену в прошлое. При отсутствии сведений оставь текущую дату. Год 0001–9999, 12 григорианских месяцев.
Праздники/планы мира сами по себе не доказывают, что герои в них участвовали. Новые записи не должны дублировать существующие.
Ответ по-русски, только JSON без markdown:
{"currentDate":"YYYY-MM-DD","dateEvidence":"основание смены даты или пустая строка","events":[{"date":"YYYY-MM-DD","title":"Коротко","detail":"Кто; изменение; следствие","importance":"high","evidenceMessage":0}]}`;

/** Snapshot everything before awaiting network calls; never read another chat mid-job. */
export function contextSnapshot(ctx, messages, settings) {
    const fields = ctx.getCharacterCardFields?.() || {};
    const ids = ctx.groupId != null
        ? (ctx.groups?.find(g => String(g.id) === String(ctx.groupId))?.members || [])
        : [];
    const cards = ids.length ? (ctx.characters || []).filter(c => ids.includes(c.avatar)) : [ctx.characters?.[ctx.characterId]].filter(Boolean);
    const parts = cards.map(c => ({ name: c.name, description: clean(c.description || c.data?.description, 8000), personality: clean(c.personality || c.data?.personality, 4000), scenario: clean(c.scenario || c.data?.scenario, 5000) }));
    const books = [...new Set([ctx.chatMetadata?.world_info, ...cards.map(c => c.data?.extensions?.world)].filter(n => typeof n === 'string' && n))];
    return {
        material: {
            characters: parts.length ? parts : [{ name: ctx.name2, description: clean(fields.description, 8000), personality: clean(fields.personality, 4000), scenario: clean(fields.scenario, 5000) }],
            user: { name: ctx.name1, persona: clean(fields.persona || ctx.powerUserSettings?.persona_description, 6000) },
            authorSetting: clean(settings.extraContext, 8000),
            recentMessages: messages.slice(-settings.historyCount).map((m, i, list) => ({ index: messages.length - list.length + i, name: m.name, role: m.is_user ? 'user' : 'character', text: m.mes.slice(-6000) })),
        }, books,
    };
}
export async function readLore(ctx, books) {
    if (!ctx.loadWorldInfo || !books.length) return '';
    const parts = [];
    let remaining = 12000;
    for (const name of books.slice(0, 5)) {
        const book = await ctx.loadWorldInfo(name);
        const text = Object.values(book?.entries || {}).filter(e => !e.disable && e.content).map(e => clean(e.content, 3000)).join('\n').slice(0, remaining);
        parts.push(text); remaining -= text.length;
        if (remaining <= 0) break;
    }
    return parts.join('\n');
}
