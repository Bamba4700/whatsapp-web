BEGIN;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(30) NOT NULL UNIQUE,
    display_name VARCHAR(80) NOT NULL,
    password_hash TEXT NOT NULL,
    message_sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    call_sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (username ~ '^[a-z0-9_]{3,30}$'),
    CHECK (char_length(trim(display_name)) BETWEEN 1 AND 80)
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('private', 'group')),
    title VARCHAR(100),
    direct_key TEXT UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        (
            kind = 'private'
            AND direct_key IS NOT NULL
            AND title IS NULL
        )
        OR
        (
            kind = 'group'
            AND direct_key IS NULL
            AND title IS NOT NULL
            AND char_length(trim(title)) BETWEEN 1 AND 100
        )
    )
);

CREATE TABLE conversation_members (
    conversation_id UUID NOT NULL
        REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,

    PRIMARY KEY (conversation_id, user_id),
    CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE INDEX conversation_members_user_idx
    ON conversation_members(user_id)
    WHERE left_at IS NULL;

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    sender_id UUID NOT NULL REFERENCES users(id),
    client_message_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'file', 'voice')),
    body TEXT,

    storage_bucket TEXT,
    storage_key TEXT,
    original_name TEXT,
    mime_type TEXT,
    size_bytes BIGINT,
    duration_ms INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (sender_id, client_message_id),
    UNIQUE (storage_bucket, storage_key),

    FOREIGN KEY (conversation_id, sender_id)
        REFERENCES conversation_members(conversation_id, user_id),

    CHECK (body IS NULL OR char_length(body) <= 10000),

    CHECK (
        (
            kind = 'text'
            AND body IS NOT NULL
            AND char_length(trim(body)) > 0
            AND storage_bucket IS NULL
            AND storage_key IS NULL
            AND original_name IS NULL
            AND mime_type IS NULL
            AND size_bytes IS NULL
            AND duration_ms IS NULL
        )
        OR
        (
            kind IN ('file', 'voice')
            AND storage_bucket IS NOT NULL
            AND storage_key IS NOT NULL
            AND original_name IS NOT NULL
            AND mime_type IS NOT NULL
            AND size_bytes IS NOT NULL
            AND size_bytes > 0
            AND (
                (kind = 'file' AND duration_ms IS NULL)
                OR
                (
                    kind = 'voice'
                    AND duration_ms IS NOT NULL
                    AND duration_ms > 0
                )
            )
        )
    )
);

CREATE INDEX messages_conversation_history_idx
    ON messages(conversation_id, created_at DESC, id DESC);

CREATE TABLE calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    initiated_by UUID NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
    status TEXT NOT NULL DEFAULT 'ringing'
        CHECK (
            status IN (
                'ringing', 'active', 'ended',
                'cancelled', 'missed', 'failed'
            )
        ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,

    FOREIGN KEY (conversation_id, initiated_by)
        REFERENCES conversation_members(conversation_id, user_id),

    CHECK (started_at IS NULL OR started_at >= created_at),
    CHECK (
        ended_at IS NULL
        OR ended_at >= COALESCE(started_at, created_at)
    )
);

CREATE UNIQUE INDEX calls_one_open_per_conversation_idx
    ON calls(conversation_id)
    WHERE status IN ('ringing', 'active');

CREATE INDEX calls_conversation_history_idx
    ON calls(conversation_id, created_at DESC);

CREATE TABLE call_participants (
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'invited'
        CHECK (
            status IN (
                'invited', 'joined', 'declined',
                'left', 'missed', 'busy'
            )
        ),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,

    PRIMARY KEY (call_id, user_id),
    CHECK (joined_at IS NULL OR joined_at >= invited_at),
    CHECK (
        left_at IS NULL
        OR (joined_at IS NOT NULL AND left_at >= joined_at)
    )
);

COMMIT;
