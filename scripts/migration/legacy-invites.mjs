/** beta.42 Slack redemptions omit the Telegram identity; preserve SQL NULL exactly. */
const fields = ['code', 'created_by', 'created_by_slack', 'created_via_web', 'created_at', 'comment', 'used_by', 'used_by_slack', 'used_at', 'slug'];
function text(value) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.from(value).toString('utf8') !== value)
        throw new Error();
}
function date(value) {
    text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        throw new Error();
}
export async function importInvitesInTransaction(client, codec, records) {
    try {
        for (const raw of records) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !fields.includes(key)))
                throw new Error();
            const record = structuredClone(raw);
            text(record.code);
            date(record.created_at);
            if (!Number.isSafeInteger(record.created_by) || Number(record.created_by) < 0)
                throw new Error();
            for (const field of ['created_by_slack', 'created_via_web', 'used_by_slack', 'slug'])
                if (Object.hasOwn(record, field))
                    text(record[field]);
            if (record.created_by === 0 && !Object.hasOwn(record, 'created_by_slack') && !Object.hasOwn(record, 'created_via_web'))
                throw new Error();
            if (Object.hasOwn(record, 'comment') && (typeof record.comment !== 'string' || record.comment.includes('\0')
                || Buffer.from(record.comment).toString('utf8') !== record.comment))
                throw new Error();
            const used = ['used_by', 'used_at', 'used_by_slack', 'slug'].some((field) => Object.hasOwn(record, field));
            let userId = null;
            if (used) {
                date(record.used_at);
                text(record.slug);
                if ((Object.hasOwn(record, 'used_by') && (!Number.isSafeInteger(record.used_by) || Number(record.used_by) < 0)) || (!Object.hasOwn(record, 'used_by') && !Object.hasOwn(record, 'used_by_slack')) || record.used_at < record.created_at)
                    throw new Error();
                const owner = await client.query('SELECT id FROM utarus.users WHERE slug=$1', [record.slug]);
                if (owner.rowCount !== 1)
                    throw new Error();
                userId = owner.rows[0].id;
            }
            const digest = codec.blindIndex(record.code, 'invitation');
            const optional = (field) => Object.hasOwn(record, field) ? record[field] : null;
            await client.query(`INSERT INTO utarus.invites
        (code_digest,secret,created_by,created_by_slack,created_via_web,created_at,comment,used_by,used_by_slack,used_at,user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [digest, codec.encrypt(record.code, JSON.stringify([digest, 'invitation'])), record.created_by, optional('created_by_slack'),
                optional('created_via_web'), record.created_at, optional('comment'), optional('used_by'), optional('used_by_slack'), optional('used_at'), userId]);
        }
    }
    catch {
        throw new Error('Historical invitation import failed; invalid or unmapped source');
    }
}
