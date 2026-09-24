const express = require('express');
const { randomUUID } = require('node:crypto');

const pool = require('../config/database');

const {
  requireAuth,
} = require('../middleware/auth');

const {
  requireCsrf,
} = require('../middleware/csrf');


const router = express.Router();


function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  );
}


async function isMember(
  conversationId,
  userId
) {
  const result =
    await pool.query(
      `
        SELECT 1

        FROM conversation_members

        WHERE
          conversation_id = $1
          AND user_id = $2
          AND left_at IS NULL

        LIMIT 1
      `,
      [
        conversationId,
        userId,
      ]
    );


  return result.rowCount > 0;
}


function publicMessage(
  message,
  mine
) {
  return {
    id:
      message.id,

    conversationId:
      message.conversation_id,

    senderId:
      message.sender_id,

    clientMessageId:
      message.client_message_id,

    kind:
      message.kind,

    body:
      message.body,

    originalName:
      message.original_name,

    mimeType:
      message.mime_type,

    sizeBytes:
      message.size_bytes === null
        ? null
        : Number(
          message.size_bytes
        ),

    durationMs:
      message.duration_ms,

    fileUrl:
      message.kind === 'file'
        ? `/api/messages/${message.id}/file`
        : null,

    voiceUrl:
      message.kind === 'voice'
        ? `/api/messages/${message.id}/voice`
        : null,

    sender: {
      id:
        message.sender_id,

      username:
        message.username,

      displayName:
        message.display_name,
    },

    mine:
      Boolean(mine),

    createdAt:
      message.created_at,
  };
}


router.use(
  (req, res, next) => {
    res.set(
      'Cache-Control',
      'no-store'
    );

    next();
  }
);


/*
 * =========================================================
 * HISTORIQUE
 * =========================================================
 */

router.get(
  '/:conversationId/messages',
  requireAuth,

  async (req, res, next) => {
    const conversationId =
      req.params.conversationId;

    const userId =
      req.session.userId;


    if (
      !isUuid(conversationId)
    ) {
      return res
        .status(400)
        .json({
          error:
            'Conversation invalide.',
        });
    }


    try {
      const member =
        await isMember(
          conversationId,
          userId
        );


      if (!member) {
        return res
          .status(403)
          .json({
            error:
              'Accès refusé.',
          });
      }


      const result =
        await pool.query(
          `
            SELECT *

            FROM (
              SELECT
                m.id,
                m.conversation_id,
                m.sender_id,
                m.client_message_id,
                m.kind,
                m.body,
                m.storage_bucket,
                m.storage_key,
                m.original_name,
                m.mime_type,
                m.size_bytes,
                m.duration_ms,
                m.created_at,

                u.username,
                u.display_name,

                (
                  m.sender_id = $2
                ) AS mine

              FROM messages m

              JOIN users u
                ON u.id =
                   m.sender_id

              WHERE
                m.conversation_id = $1

              ORDER BY
                m.created_at DESC,
                m.id DESC

              LIMIT 100
            ) recent

            ORDER BY
              created_at ASC,
              id ASC
          `,
          [
            conversationId,
            userId,
          ]
        );


      const messages =
        result.rows.map(
          (message) =>
            publicMessage(
              message,
              message.mine
            )
        );


      return res.json({
        messages,
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * =========================================================
 * MESSAGE TEXTE
 * =========================================================
 */

router.post(
  '/:conversationId/messages',
  requireAuth,
  requireCsrf,

  async (req, res, next) => {
    const conversationId =
      req.params.conversationId;

    const userId =
      req.session.userId;


    if (
      !isUuid(conversationId)
    ) {
      return res
        .status(400)
        .json({
          error:
            'Conversation invalide.',
        });
    }


    const body =
      typeof req.body?.body ===
      'string'
        ? req.body.body.trim()
        : '';


    if (
      body.length < 1 ||
      body.length > 4000
    ) {
      return res
        .status(400)
        .json({
          error:
            'Le message doit contenir entre 1 et 4000 caractères.',
        });
    }


    try {
      const member =
        await isMember(
          conversationId,
          userId
        );


      if (!member) {
        return res
          .status(403)
          .json({
            error:
              'Accès refusé.',
          });
      }


      const messageId =
        randomUUID();

      const clientMessageId =
        randomUUID();


      const result =
        await pool.query(
          `
            INSERT INTO messages (
              id,
              conversation_id,
              sender_id,
              client_message_id,
              kind,
              body,
              storage_bucket,
              storage_key,
              original_name,
              mime_type,
              size_bytes,
              duration_ms
            )

            VALUES (
              $1,
              $2,
              $3,
              $4,
              'text',
              $5,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL
            )

            RETURNING
              id,
              conversation_id,
              sender_id,
              client_message_id,
              kind,
              body,
              storage_bucket,
              storage_key,
              original_name,
              mime_type,
              size_bytes,
              duration_ms,
              created_at
          `,
          [
            messageId,
            conversationId,
            userId,
            clientMessageId,
            body,
          ]
        );


      const senderResult =
        await pool.query(
          `
            SELECT
              username,
              display_name

            FROM users

            WHERE id = $1

            LIMIT 1
          `,
          [
            userId,
          ]
        );


      const completeMessage = {
        ...result.rows[0],

        username:
          senderResult.rows[0]
            ?.username,

        display_name:
          senderResult.rows[0]
            ?.display_name,
      };


      const responseMessage =
        publicMessage(
          completeMessage,
          true
        );


      const recipients =
        await pool.query(
          `
            SELECT user_id

            FROM conversation_members

            WHERE
              conversation_id = $1
              AND left_at IS NULL
              AND user_id <> $2
          `,
          [
            conversationId,
            userId,
          ]
        );


      const io =
        req.app.get('io');


      if (io) {
        const realtimeMessage =
          publicMessage(
            completeMessage,
            false
          );


        for (
          const memberRow
          of recipients.rows
        ) {
          io
            .to(
              `user:${memberRow.user_id}`
            )
            .emit(
              'message:new',
              realtimeMessage
            );
        }
      }


      return res
        .status(201)
        .json({
          message:
            responseMessage,
        });

    } catch (error) {
      next(error);
    }
  }
);


module.exports = router;