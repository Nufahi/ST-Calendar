import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../core.js';
import { contextSnapshot, readLore } from '../prompts.js';

test('lore snapshot includes persona and group books plus unattached embedded character lore', async () => {
    const context = {
        groupId: 'g', groups: [{ id: 'g', members: ['a', 'b'] }],
        chatMetadata: { world_info: 'Chat' }, powerUserSettings: { persona_description_lorebook: 'Persona' },
        characters: [
            { avatar: 'a', data: { extensions: { world: 'Chat' } } },
            { avatar: 'b', data: { character_book: { entries: [{ enabled: true, content: 'Embedded history' }, { enabled: false, content: 'Disabled entry' }] } } },
        ],
    };
    const snapshot = contextSnapshot(context, [], DEFAULTS);
    assert.deepEqual(snapshot.books, ['Chat', 'Persona']);
    context.characters[1].data.character_book.entries[0].content = 'Changed after snapshot';
    const lore = await readLore({ loadWorldInfo: async name => ({ entries: { one: { content: name } } }) }, snapshot.books, snapshot.embeddedLore);
    assert.match(lore, /Chat\nPersona\nEmbedded history/);
    assert.doesNotMatch(lore, /Disabled|Changed/);
    assert.equal(await readLore({}, [], snapshot.embeddedLore), 'Embedded history');
});
