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
 * CONVERSATION PRIVÉE
 *
 * POST /api/conversations/direct
 * =========================================================
 */

router.post(
  '/direct',
  requireAuth,
  requireCsrf,

  async (req, res, next) => {
    const currentUserId =
      req.session.userId;

    const targetUserId =
      req.body?.userId;


    if (
      !isUuid(targetUserId)
    ) {
      return res
        .status(400)
        .json({
          error:
            'Utilisateur invalide.',
        });
    }


    if (
      targetUserId ===
      currentUserId
    ) {
      return res
        .status(400)
        .json({
          error:
            'Vous ne pouvez pas créer une discussion avec vous-même.',
        });
    }


    const client =
      await pool.connect();


    try {
      await client.query(
        'BEGIN'
      );


      const targetResult =
        await client.query(
          `
            SELECT
              id,
              username,
              display_name

            FROM users

            WHERE id = $1

            LIMIT 1
          `,
          [
            targetUserId,
          ]
        );


      if (
        targetResult.rowCount === 0
      ) {
        await client.query(
          'ROLLBACK'
        );


        return res
          .status(404)
          .json({
            error:
              'Utilisateur introuvable.',
          });
      }


      const ids = [
        currentUserId,
        targetUserId,
      ].sort();


      const directKey =
        `direct:${ids.join(':')}`;


      /*
       * Évite deux créations simultanées
       * de la même conversation privée.
       */
      await client.query(
        `
          SELECT
            pg_advisory_xact_lock(
              hashtext($1)
            )
        `,
        [
          directKey,
        ]
      );


      let conversationResult =
        await client.query(
          `
            SELECT
              id,
              kind,
              title,
              created_by,
              created_at

            FROM conversations

            WHERE
              kind = 'private'
              AND direct_key = $1

            LIMIT 1
          `,
          [
            directKey,
          ]
        );


      let created = false;


      if (
        conversationResult.rowCount === 0
      ) {
        const conversationId =
          randomUUID();


        conversationResult =
          await client.query(
            `
              INSERT INTO conversations (
                id,
                kind,
                title,
                direct_key,
                created_by
              )

              VALUES (
                $1,
                'private',
                NULL,
                $2,
                $3
              )

              RETURNING
                id,
                kind,
                title,
                created_by,
                created_at
            `,
            [
              conversationId,
              directKey,
              currentUserId,
            ]
          );


        created = true;
      }


      const conversation =
        conversationResult.rows[0];


      /*
       * Réactiver / créer les deux membres.
       */
      for (
        const userId
        of [
          currentUserId,
          targetUserId,
        ]
      ) {
        await client.query(
          `
            INSERT INTO conversation_members (
              conversation_id,
              user_id,
              role,
              joined_at,
              left_at
            )

            VALUES (
              $1,
              $2,
              'member',
              NOW(),
              NULL
            )

            ON CONFLICT (
              conversation_id,
              user_id
            )

            DO UPDATE SET
              left_at = NULL
          `,
          [
            conversation.id,
            userId,
          ]
        );
      }


      await client.query(
        'COMMIT'
      );


      const target =
        targetResult.rows[0];


      return res
        .status(
          created
            ? 201
            : 200
        )
        .json({
          conversation: {
            id:
              conversation.id,

            kind:
              conversation.kind,

            user: {
              id:
                target.id,

              username:
                target.username,

              displayName:
                target.display_name,
            },
          },

          created,
        });

    } catch (error) {
      try {
        await client.query(
          'ROLLBACK'
        );
      } catch {
        // Rien.
      }


      next(error);

    } finally {
      client.release();
    }
  }
);


/*
 * =========================================================
 * LISTE DES GROUPES
 *
 * GET /api/conversations/groups
 * =========================================================
 */

router.get(
  '/groups',
  requireAuth,

  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          `
            SELECT
              c.id,
              c.title,
              c.created_by,
              c.created_at,

              (
                c.created_by = $1
              ) AS created_by_me,

              (
                SELECT
                  COUNT(*)::integer

                FROM conversation_members member_count

                WHERE
                  member_count.conversation_id = c.id
                  AND member_count.left_at IS NULL
              ) AS member_count,

              last_message.id
                AS last_message_id,

              last_message.kind
                AS last_message_kind,

              last_message.body
                AS last_message_body,

              last_message.original_name
                AS last_message_original_name,

              last_message.created_at
                AS last_message_created_at,

              last_message.sender_name
                AS last_message_sender_name

            FROM conversations c

            JOIN conversation_members me
              ON me.conversation_id = c.id
             AND me.user_id = $1
             AND me.left_at IS NULL

            LEFT JOIN LATERAL (
              SELECT
                m.id,
                m.kind,
                m.body,
                m.original_name,
                m.created_at,

                COALESCE(
                  u.display_name,
                  u.username
                ) AS sender_name

              FROM messages m

              JOIN users u
                ON u.id = m.sender_id

              WHERE
                m.conversation_id = c.id

              ORDER BY
                m.created_at DESC,
                m.id DESC

              LIMIT 1
            ) last_message
              ON TRUE

            WHERE
              c.kind = 'group'

            ORDER BY
              COALESCE(
                last_message.created_at,
                c.created_at
              ) DESC,
              c.id DESC
          `,
          [
            req.session.userId,
          ]
        );


      const groups =
        result.rows.map(
          (row) => ({
            id:
              row.id,

            kind:
              'group',

            title:
              row.title,

            createdBy:
              row.created_by,

            createdByMe:
              Boolean(
                row.created_by_me
              ),

            memberCount:
              Number(
                row.member_count
              ),

            createdAt:
              row.created_at,

            lastMessage:
              row.last_message_id
                ? {
                    id:
                      row.last_message_id,

                    kind:
                      row.last_message_kind,

                    body:
                      row.last_message_body,

                    originalName:
                      row.last_message_original_name,

                    senderName:
                      row.last_message_sender_name,

                    createdAt:
                      row.last_message_created_at,
                  }
                : null,
          })
        );


      return res.json({
        groups,
      });

    } catch (error) {
      next(error);
    }
  }
);


/*
 * =========================================================
 * CRÉATION D'UN GROUPE
 *
 * POST /api/conversations/groups
 *
 * body :
 * {
 *   "title": "Projet L3",
 *   "memberIds": ["uuid1", "uuid2"]
 * }
 * =========================================================
 */

router.post(
  '/groups',
  requireAuth,
  requireCsrf,

  async (req, res, next) => {
    const creatorId =
      req.session.userId;


    const title =
      typeof req.body?.title ===
      'string'
        ? req.body.title.trim()
        : '';


    if (
      title.length < 1 ||
      title.length > 100
    ) {
      return res
        .status(400)
        .json({
          error:
            'Le nom du groupe doit contenir entre 1 et 100 caractères.',
        });
    }


    if (
      !Array.isArray(
        req.body?.memberIds
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            'La liste des membres est invalide.',
        });
    }


    /*
     * Supprimer :
     * - doublons
     * - créateur
     */
    const memberIds =
      [
        ...new Set(
          req.body.memberIds
        ),
      ]
        .filter(
          (userId) =>
            userId !== creatorId
        );


    if (
      memberIds.length < 1
    ) {
      return res
        .status(400)
        .json({
          error:
            'Sélectionnez au moins un membre.',
        });
    }


    if (
      memberIds.length > 100
    ) {
      return res
        .status(400)
        .json({
          error:
            'Le groupe contient trop de membres.',
        });
    }


    if (
      memberIds.some(
        (userId) =>
          !isUuid(userId)
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            'Un membre sélectionné est invalide.',
        });
    }


    const client =
      await pool.connect();


    try {
      await client.query(
        'BEGIN'
      );


      /*
       * Vérifier que tous les utilisateurs existent.
       */
      const usersResult =
        await client.query(
          `
            SELECT
              id

            FROM users

            WHERE
              id = ANY(
                $1::uuid[]
              )
          `,
          [
            memberIds,
          ]
        );


      if (
        usersResult.rowCount !==
        memberIds.length
      ) {
        await client.query(
          'ROLLBACK'
        );


        return res
          .status(400)
          .json({
            error:
              'Un ou plusieurs utilisateurs n’existent pas.',
          });
      }


      const conversationId =
        randomUUID();


      const conversationResult =
        await client.query(
          `
            INSERT INTO conversations (
              id,
              kind,
              title,
              direct_key,
              created_by
            )

            VALUES (
              $1,
              'group',
              $2,
              NULL,
              $3
            )

            RETURNING
              id,
              kind,
              title,
              created_by,
              created_at
          `,
          [
            conversationId,
            title,
            creatorId,
          ]
        );


      /*
       * Créateur = admin.
       */
      await client.query(
        `
          INSERT INTO conversation_members (
            conversation_id,
            user_id,
            role,
            joined_at,
            left_at
          )

          VALUES (
            $1,
            $2,
            'admin',
            NOW(),
            NULL
          )
        `,
        [
          conversationId,
          creatorId,
        ]
      );


      /*
       * Autres membres.
       */
      await client.query(
        `
          INSERT INTO conversation_members (
            conversation_id,
            user_id,
            role,
            joined_at,
            left_at
          )

          SELECT
            $1,
            selected_user_id,
            'member',
            NOW(),
            NULL

          FROM unnest(
            $2::uuid[]
          ) AS selected_user_id
        `,
        [
          conversationId,
          memberIds,
        ]
      );


      await client.query(
        'COMMIT'
      );


      const conversation =
        conversationResult.rows[0];


      return res
        .status(201)
        .json({
          group: {
            id:
              conversation.id,

            kind:
              conversation.kind,

            title:
              conversation.title,

            createdBy:
              conversation.created_by,

            createdByMe:
              true,

            memberCount:
              memberIds.length + 1,

            createdAt:
              conversation.created_at,

            lastMessage:
              null,
          },
        });

    } catch (error) {
      try {
        await client.query(
          'ROLLBACK'
        );
      } catch {
        // Rien.
      }


      next(error);

    } finally {
      client.release();
    }
  }
);


module.exports = router;