const express = require('express');

const pool = require('../config/database');
const {
  requireAuth,
} = require('../middleware/auth');

const router = express.Router();


router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});


/*
 * =========================================================
 * DISCUSSIONS EXISTANTES
 *
 * Un utilisateur apparaît dans cette liste uniquement
 * lorsqu'au moins un message a été échangé avec lui.
 *
 * GET /api/users/chats
 * =========================================================
 */
router.get(
  '/chats',
  requireAuth,
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `
          SELECT
            u.id,
            u.username,
            u.display_name,

            c.id AS conversation_id,

            last_message.id
              AS last_message_id,

            last_message.kind
              AS last_message_kind,

            last_message.body
              AS last_message_body,

            last_message.original_name
              AS last_message_original_name,

            last_message.created_at
              AS last_message_created_at

          FROM conversations c

          JOIN conversation_members me
            ON me.conversation_id = c.id
           AND me.user_id = $1
           AND me.left_at IS NULL

          JOIN conversation_members other_member
            ON other_member.conversation_id = c.id
           AND other_member.user_id <> $1
           AND other_member.left_at IS NULL

          JOIN users u
            ON u.id = other_member.user_id

          /*
           * INNER JOIN LATERAL :
           * aucune ligne si la conversation
           * ne contient encore aucun message.
           */
          JOIN LATERAL (
            SELECT
              m.id,
              m.kind,
              m.body,
              m.original_name,
              m.created_at

            FROM messages m

            WHERE
              m.conversation_id = c.id

            ORDER BY
              m.created_at DESC,
              m.id DESC

            LIMIT 1
          ) last_message
            ON TRUE

          WHERE
            c.kind = 'private'

          ORDER BY
            last_message.created_at DESC,
            last_message.id DESC
        `,
        [
          req.session.userId,
        ]
      );


      const chats =
        result.rows.map(
          (row) => ({
            id:
              row.id,

            username:
              row.username,

            displayName:
              row.display_name,

            conversationId:
              row.conversation_id,

            lastMessage: {
              id:
                row.last_message_id,

              kind:
                row.last_message_kind,

              body:
                row.last_message_body,

              originalName:
                row.last_message_original_name,

              createdAt:
                row.last_message_created_at,
            },
          })
        );


      return res.json({
        chats,
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * =========================================================
 * UTILISATEURS DISPONIBLES
 *
 * Cette route sert à "Nouvelle discussion".
 *
 * GET /api/users
 * =========================================================
 */
router.get(
  '/',
  requireAuth,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          `
            SELECT
              id,
              username,
              display_name

            FROM users

            WHERE id <> $1

            ORDER BY
              display_name ASC,
              username ASC
          `,
          [
            req.session.userId,
          ]
        );


      return res.json({
        users:
          result.rows.map(
            (user) => ({
              id:
                user.id,

              username:
                user.username,

              displayName:
                user.display_name,
            })
          ),
      });

    } catch (error) {
      next(error);
    }
  }
);


module.exports = router;