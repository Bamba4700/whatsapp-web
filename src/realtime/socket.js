const { randomUUID } = require('node:crypto');

const pool = require('../config/database');


const connectedUsers = new Map();

const activeCalls = new Map();

const CALL_TIMEOUT_MS =
  45 * 1000;


function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  );
}


async function getUser(userId) {
  const result =
    await pool.query(
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
        userId,
      ]
    );


  return result.rows[0] || null;
}


async function canCall(
  conversationId,
  callerId,
  targetUserId
) {
  const result =
    await pool.query(
      `
        SELECT
          c.id

        FROM conversations c

        JOIN conversation_members caller
          ON caller.conversation_id = c.id
         AND caller.user_id = $2
         AND caller.left_at IS NULL

        JOIN conversation_members target
          ON target.conversation_id = c.id
         AND target.user_id = $3
         AND target.left_at IS NULL

        WHERE
          c.id = $1
          AND c.kind = 'private'

        LIMIT 1
      `,
      [
        conversationId,
        callerId,
        targetUserId,
      ]
    );


  return result.rowCount > 0;
}


function otherParticipant(
  call,
  userId
) {
  if (
    call.callerId === userId
  ) {
    return call.calleeId;
  }


  if (
    call.calleeId === userId
  ) {
    return call.callerId;
  }


  return null;
}


function isUserBusy(userId) {
  for (
    const call
    of activeCalls.values()
  ) {
    if (
      call.callerId === userId ||
      call.calleeId === userId
    ) {
      return true;
    }
  }


  return false;
}


function configureSocket(
  io,
  sessionMiddleware
) {

  io.engine.use(
    sessionMiddleware
  );


  io.use(
    async (
      socket,
      next
    ) => {

      try {

        const userId =
          socket.request
            ?.session
            ?.userId;


        if (!userId) {
          return next(
            new Error(
              'Authentification requise.'
            )
          );
        }


        const user =
          await getUser(
            userId
          );


        if (!user) {
          return next(
            new Error(
              'Utilisateur introuvable.'
            )
          );
        }


        socket.data.userId =
          userId;


        socket.data.user =
          user;


        next();

      } catch (error) {
        next(error);
      }
    }
  );


  io.on(
    'connection',
    (socket) => {

      const userId =
        socket.data.userId;


      /*
       * Room générale de l'utilisateur.
       *
       * Les messages ET les appels utilisent
       * cette room.
       */
      socket.join(
        `user:${userId}`
      );


      /*
       * =====================================================
       * PRÉSENCE
       * =====================================================
       */

      const previousCount =
        connectedUsers.get(
          userId
        ) || 0;


      connectedUsers.set(
        userId,
        previousCount + 1
      );


      socket.emit(
        'presence:list',
        {
          userIds:
            Array.from(
              connectedUsers.keys()
            ),
        }
      );


      if (
        previousCount === 0
      ) {
        socket.broadcast.emit(
          'presence:update',
          {
            userId,
            online:
              true,
          }
        );
      }


      socket.emit(
        'socket:ready',
        {
          userId,
        }
      );


      /*
       * =====================================================
       * DÉMARRER UN APPEL
       * =====================================================
       */

      socket.on(
        'call:invite',

        async (
          payload,
          acknowledgement
        ) => {

          const ack =
            typeof acknowledgement ===
            'function'
              ? acknowledgement
              : () => {};


          try {

            const conversationId =
              payload?.conversationId;

            const targetUserId =
              payload?.targetUserId;

            const kind =
              payload?.kind;


            if (
              !isUuid(
                conversationId
              ) ||
              !isUuid(
                targetUserId
              )
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Appel invalide.',
              });
            }


            if (
              targetUserId ===
              userId
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Vous ne pouvez pas vous appeler vous-même.',
              });
            }


            if (
              kind !== 'audio'
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Type d’appel non pris en charge.',
              });
            }


            const allowed =
              await canCall(
                conversationId,
                userId,
                targetUserId
              );


            if (!allowed) {
              return ack({
                ok:
                  false,

                error:
                  'Appel non autorisé.',
              });
            }


            /*
             * On vérifie simplement que l'autre
             * utilisateur est connecté.
             *
             * On ne dépend plus de callReadyUsers.
             */
            if (
              !connectedUsers.has(
                targetUserId
              )
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Cet utilisateur est hors ligne.',
              });
            }


            if (
              isUserBusy(userId)
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Vous avez déjà un appel en cours.',
              });
            }


            if (
              isUserBusy(
                targetUserId
              )
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Cet utilisateur est déjà en appel.',
              });
            }


            const callId =
              randomUUID();


            const caller =
              socket.data.user;


            const call = {
              id:
                callId,

              conversationId,

              callerId:
                userId,

              calleeId:
                targetUserId,

              kind:
                'audio',

              status:
                'invited',

              timeout:
                null,
            };


            call.timeout =
              setTimeout(
                () => {

                  const current =
                    activeCalls.get(
                      callId
                    );


                  if (!current) {
                    return;
                  }


                  io
                    .to(
                      `user:${current.callerId}`
                    )
                    .emit(
                      'call:missed',
                      {
                        callId,
                      }
                    );


                  io
                    .to(
                      `user:${current.calleeId}`
                    )
                    .emit(
                      'call:ended',
                      {
                        callId,

                        reason:
                          'timeout',
                      }
                    );


                  activeCalls.delete(
                    callId
                  );

                },
                CALL_TIMEOUT_MS
              );


            activeCalls.set(
              callId,
              call
            );


            console.log(
              `[CALL] ${userId} -> ${targetUserId} (${callId})`
            );


            /*
             * L'appelant reçoit d'abord son callId.
             */
            ack({
              ok:
                true,

              callId,
            });


            /*
             * Puis le correspondant reçoit
             * l'appel entrant.
             */
            io
              .to(
                `user:${targetUserId}`
              )
              .emit(
                'call:incoming',
                {
                  callId,

                  conversationId,

                  kind:
                    'audio',

                  caller: {
                    id:
                      caller.id,

                    username:
                      caller.username,

                    displayName:
                      caller.display_name,
                  },
                }
              );


          } catch (error) {

            console.error(
              '[CALL invite]',
              error
            );


            ack({
              ok:
                false,

              error:
                'Impossible de démarrer l’appel.',
            });
          }
        }
      );


      /*
       * =====================================================
       * LE DESTINATAIRE CONFIRME QU'IL SONNE
       * =====================================================
       */

      socket.on(
        'call:ringing',
        (payload) => {

          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            call.calleeId !==
              userId
          ) {
            return;
          }


          call.status =
            'ringing';


          io
            .to(
              `user:${call.callerId}`
            )
            .emit(
              'call:ringing',
              {
                callId:
                  call.id,
              }
            );
        }
      );


      /*
       * =====================================================
       * ACCEPTER
       * =====================================================
       */

      socket.on(
        'call:accept',
        (payload) => {

          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            call.calleeId !==
              userId
          ) {
            return;
          }


          if (
            call.timeout
          ) {
            clearTimeout(
              call.timeout
            );


            call.timeout =
              null;
          }


          call.status =
            'connecting';


          const callee =
            socket.data.user;


          io
            .to(
              `user:${call.callerId}`
            )
            .emit(
              'call:accepted',
              {
                callId:
                  call.id,

                conversationId:
                  call.conversationId,

                user: {
                  id:
                    callee.id,

                  username:
                    callee.username,

                  displayName:
                    callee.display_name,
                },
              }
            );
        }
      );


      /*
       * =====================================================
       * REFUSER
       * =====================================================
       */

      socket.on(
        'call:reject',
        (payload) => {

          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            call.calleeId !==
              userId
          ) {
            return;
          }


          if (
            call.timeout
          ) {
            clearTimeout(
              call.timeout
            );
          }


          io
            .to(
              `user:${call.callerId}`
            )
            .emit(
              'call:rejected',
              {
                callId:
                  call.id,
              }
            );


          activeCalls.delete(
            call.id
          );
        }
      );


      /*
       * =====================================================
       * WEBRTC OFFER
       * =====================================================
       */

      socket.on(
        'webrtc:offer',
        (payload) => {

          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            !payload?.description
          ) {
            return;
          }


          const targetId =
            otherParticipant(
              call,
              userId
            );


          if (!targetId) {
            return;
          }


          io
            .to(
              `user:${targetId}`
            )
            .emit(
              'webrtc:offer',
              {
                callId:
                  call.id,

                description:
                  payload.description,
              }
            );
        }
      );


      /*
       * =====================================================
       * WEBRTC ANSWER
       * =====================================================
       */

      socket.on(
        'webrtc:answer',
        (payload) => {

          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            !payload?.description
          ) {
            return;
          }


          const targetId =
            otherParticipant(
              call,
              userId
            );


          if (!targetId) {
            return;
          }


          call.status =
            'active';


          io
            .to(
              `user:${targetId}`
            )
            .emit(
              'webrtc:answer',
              {
                callId:
                  call.id,

                description:
                  payload.description,
              }
            );
        }
      );


      /*
       * =====================================================
       * ICE
       * =====================================================
       */

      socket.on(
        'webrtc:ice-candidate',
        (payload) => {

          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            !payload?.candidate
          ) {
            return;
          }


          const targetId =
            otherParticipant(
              call,
              userId
            );


          if (!targetId) {
            return;
          }


          io
            .to(
              `user:${targetId}`
            )
            .emit(
              'webrtc:ice-candidate',
              {
                callId:
                  call.id,

                candidate:
                  payload.candidate,
              }
            );
        }
      );


      /*
       * =====================================================
       * RACCROCHER
       * =====================================================
       */

      socket.on(
        'call:hangup',
        (payload) => {

          const call =
            activeCalls.get(
              payload?.callId
            );


          if (!call) {
            return;
          }


          const targetId =
            otherParticipant(
              call,
              userId
            );


          if (!targetId) {
            return;
          }


          if (
            call.timeout
          ) {
            clearTimeout(
              call.timeout
            );
          }


          io
            .to(
              `user:${targetId}`
            )
            .emit(
              'call:ended',
              {
                callId:
                  call.id,

                reason:
                  payload?.reason ||
                  'hangup',
              }
            );


          activeCalls.delete(
            call.id
          );
        }
      );


      /*
       * =====================================================
       * DÉCONNEXION
       * =====================================================
       */

      socket.on(
        'disconnect',
        () => {

          const currentCount =
            connectedUsers.get(
              userId
            ) || 0;


          const nextCount =
            currentCount - 1;


          if (
            nextCount <= 0
          ) {

            connectedUsers.delete(
              userId
            );


            io.emit(
              'presence:update',
              {
                userId,

                online:
                  false,
              }
            );


            /*
             * S'il ne reste aucune connexion
             * pour cet utilisateur, ses appels
             * sont terminés.
             */
            for (
              const [
                callId,
                call,
              ]
              of activeCalls
            ) {

              if (
                call.callerId !==
                  userId &&
                call.calleeId !==
                  userId
              ) {
                continue;
              }


              if (
                call.timeout
              ) {
                clearTimeout(
                  call.timeout
                );
              }


              const targetId =
                otherParticipant(
                  call,
                  userId
                );


              if (targetId) {

                io
                  .to(
                    `user:${targetId}`
                  )
                  .emit(
                    'call:ended',
                    {
                      callId,

                      reason:
                        'disconnect',
                    }
                  );
              }


              activeCalls.delete(
                callId
              );
            }

          } else {

            connectedUsers.set(
              userId,
              nextCount
            );
          }
        }
      );

    }
  );
}


module.exports = {
  configureSocket,
};