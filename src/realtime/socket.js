const { randomUUID } = require('node:crypto');
const pool = require('../config/database');

const connectedUsers = new Map();

// Appels privés existants.
const activeCalls = new Map();

// Appels de groupe.
const activeGroupCalls = new Map();

const CALL_TIMEOUT_MS = 45000;


function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}


function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
  };
}


async function getUser(userId) {
  const result = await pool.query(
    `
      SELECT
        id,
        username,
        display_name

      FROM users

      WHERE id = $1

      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}


/*
 * =========================================================
 * APPEL PRIVÉ
 * =========================================================
 */

async function canCall(
  conversationId,
  callerId,
  targetUserId
) {
  const result = await pool.query(
    `
      SELECT c.id

      FROM conversations c

      JOIN conversation_members caller
        ON caller.conversation_id = c.id
        AND caller.user_id = $2
        AND caller.left_at IS NULL

      JOIN conversation_members target
        ON target.conversation_id = c.id
        AND target.user_id = $3
        AND target.left_at IS NULL

      WHERE c.id = $1
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


function removeCall(call) {
  clearTimeout(
    call.timeout
  );

  activeCalls.delete(
    call.id
  );
}


/*
 * =========================================================
 * GROUPE
 * =========================================================
 */

async function getGroupConversation(
  conversationId,
  callerId
) {
  const conversationResult =
    await pool.query(
      `
        SELECT
          c.id,
          c.title

        FROM conversations c

        JOIN conversation_members caller
          ON caller.conversation_id = c.id
          AND caller.user_id = $2
          AND caller.left_at IS NULL

        WHERE c.id = $1
          AND c.kind = 'group'

        LIMIT 1
      `,
      [
        conversationId,
        callerId,
      ]
    );


  if (
    conversationResult.rowCount === 0
  ) {
    return null;
  }


  const membersResult =
    await pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.display_name

        FROM conversation_members cm

        JOIN users u
          ON u.id = cm.user_id

        WHERE cm.conversation_id = $1
          AND cm.left_at IS NULL

        ORDER BY
          cm.joined_at ASC,
          u.username ASC
      `,
      [
        conversationId,
      ]
    );


  return {
    id:
      conversationResult
        .rows[0]
        .id,

    title:
      conversationResult
        .rows[0]
        .title,

    members:
      membersResult.rows,
  };
}


async function isGroupMember(
  conversationId,
  userId
) {
  const result =
    await pool.query(
      `
        SELECT 1

        FROM conversations c

        JOIN conversation_members cm
          ON cm.conversation_id = c.id

        WHERE c.id = $1
          AND c.kind = 'group'
          AND cm.user_id = $2
          AND cm.left_at IS NULL

        LIMIT 1
      `,
      [
        conversationId,
        userId,
      ]
    );


  return result.rowCount > 0;
}


function isGroupParticipantBusyStatus(
  status
) {
  return [
    'invited',
    'ringing',
    'connecting',
    'active',
  ].includes(status);
}


/*
 * =========================================================
 * UTILISATEUR OCCUPÉ
 * =========================================================
 */

function isUserBusy(
  userId,
  ignoredGroupCallId = null
) {
  const privateBusy =
    Array
      .from(
        activeCalls.values()
      )
      .some(
        call =>
          call.callerId === userId ||
          call.calleeId === userId
      );


  if (privateBusy) {
    return true;
  }


  for (
    const groupCall
    of activeGroupCalls.values()
  ) {
    if (
      groupCall.id ===
      ignoredGroupCallId
    ) {
      continue;
    }


    const participant =
      groupCall
        .participants
        .get(
          userId
        );


    if (
      participant &&
      isGroupParticipantBusyStatus(
        participant.status
      )
    ) {
      return true;
    }
  }


  return false;
}


/*
 * =========================================================
 * OUTILS APPEL DE GROUPE
 * =========================================================
 */

function groupCallParticipantPayload(
  participant
) {
  return {
    user:
      participant.user,

    status:
      participant.status,
  };
}


function activeGroupParticipants(
  call,
  exceptUserId = null
) {
  const participants =
    [];


  for (
    const [
      participantId,
      participant,
    ]
    of call.participants
  ) {
    if (
      participantId ===
      exceptUserId
    ) {
      continue;
    }


    if (
      participant.status !==
      'active'
    ) {
      continue;
    }


    participants.push(
      groupCallParticipantPayload(
        participant
      )
    );
  }


  return participants;
}


function pendingGroupParticipants(
  call
) {
  return Array
    .from(
      call.participants.values()
    )
    .filter(
      participant =>
        [
          'invited',
          'ringing',
          'connecting',
        ].includes(
          participant.status
        )
    );
}


function emitToActiveGroupParticipants(
  io,
  call,
  event,
  payload,
  exceptUserId = null
) {
  for (
    const [
      participantId,
      participant,
    ]
    of call.participants
  ) {
    if (
      participantId ===
      exceptUserId
    ) {
      continue;
    }


    if (
      participant.status !==
      'active'
    ) {
      continue;
    }


    io
      .to(
        `user:${participantId}`
      )
      .emit(
        event,
        payload
      );
  }
}


function removeGroupCall(
  io,
  call,
  reason = 'ended'
) {
  if (
    !call ||
    !activeGroupCalls.has(
      call.id
    )
  ) {
    return;
  }


  clearTimeout(
    call.timeout
  );


  call.timeout =
    null;


  for (
    const [
      participantId,
      participant,
    ]
    of call.participants
  ) {
    if (
      [
        'left',
        'rejected',
      ].includes(
        participant.status
      )
    ) {
      continue;
    }


    io
      .to(
        `user:${participantId}`
      )
      .emit(
        'group-call:ended',
        {
          callId:
            call.id,

          conversationId:
            call.conversationId,

          reason,
        }
      );
  }


  activeGroupCalls.delete(
    call.id
  );
}


function finishGroupParticipant(
  io,
  call,
  userId,
  reason = 'left'
) {
  const participant =
    call
      ?.participants
      .get(
        userId
      );


  if (!participant) {
    return false;
  }


  participant.status =
    reason === 'rejected'
      ? 'rejected'
      : 'left';


  emitToActiveGroupParticipants(
    io,
    call,
    'group-call:participant-left',
    {
      callId:
        call.id,

      conversationId:
        call.conversationId,

      userId,

      reason,
    },
    userId
  );


  return true;
}


function maybeRemoveEmptyGroupCall(
  io,
  call
) {
  if (
    !call ||
    !activeGroupCalls.has(
      call.id
    )
  ) {
    return;
  }


  const activeCount =
    activeGroupParticipants(
      call
    ).length;


  const pendingCount =
    pendingGroupParticipants(
      call
    ).length;


  if (
    activeCount === 0 &&
    pendingCount === 0
  ) {
    removeGroupCall(
      io,
      call,
      'empty'
    );
  }
}


/*
 * =========================================================
 * SOCKET.IO
 * =========================================================
 */

function configureSocket(
  io,
  sessionMiddleware
) {
  io.engine.use(
    sessionMiddleware
  );


  /*
   * =======================================================
   * AUTHENTIFICATION SOCKET
   * =======================================================
   */

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
        next(
          error
        );
      }
    }
  );


  /*
   * =======================================================
   * CONNEXION
   * =======================================================
   */

  io.on(
    'connection',
    socket => {
      const userId =
        socket.data.userId;


      /*
       * Room personnelle.
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
       * APPELS PRIVÉS
       *
       * Partie existante conservée.
       * =====================================================
       */


      /*
       * INVITATION PRIVÉE
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
            const {
              conversationId,
              targetUserId,
              kind,
            } =
              payload || {};


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
              kind !== 'audio' &&
              kind !== 'video'
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


            if (
              !socket.connected
            ) {
              return;
            }


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
              isUserBusy(
                userId
              ) ||
              isUserBusy(
                targetUserId
              )
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Un des utilisateurs est déjà en appel.',
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

              kind,

              status:
                'invited',

              timeout:
                null,
            };


            call.timeout =
              setTimeout(
                () => {
                  if (
                    !activeCalls.has(
                      callId
                    )
                  ) {
                    return;
                  }


                  io
                    .to(
                      `user:${call.callerId}`
                    )
                    .emit(
                      'call:missed',
                      {
                        callId,
                      }
                    );


                  io
                    .to(
                      `user:${call.calleeId}`
                    )
                    .emit(
                      'call:ended',
                      {
                        callId,

                        reason:
                          'timeout',
                      }
                    );


                  removeCall(
                    call
                  );
                },
                CALL_TIMEOUT_MS
              );


            activeCalls.set(
              callId,
              call
            );


            console.log(
              `[CALL ${kind}] ${userId} -> ${targetUserId} (${callId})`
            );


            ack({
              ok:
                true,

              callId,
            });


            io
              .to(
                `user:${targetUserId}`
              )
              .emit(
                'call:incoming',
                {
                  callId,

                  conversationId,

                  kind,

                  caller:
                    publicUser(
                      caller
                    ),
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
       * SONNERIE PRIVÉE
       */
      socket.on(
        'call:ringing',
        payload => {
          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            call.calleeId !==
              userId ||
            ![
              'invited',
              'ringing',
            ].includes(
              call.status
            )
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
       * ACCEPTATION PRIVÉE
       */
      socket.on(
        'call:accept',
        payload => {
          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            call.calleeId !==
              userId ||
            ![
              'invited',
              'ringing',
            ].includes(
              call.status
            )
          ) {
            return;
          }


          clearTimeout(
            call.timeout
          );


          call.timeout =
            null;


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

                kind:
                  call.kind,

                user:
                  publicUser(
                    callee
                  ),
              }
            );
        }
      );


      /*
       * REFUS PRIVÉ
       */
      socket.on(
        'call:reject',
        payload => {
          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            call.calleeId !==
              userId ||
            ![
              'invited',
              'ringing',
            ].includes(
              call.status
            )
          ) {
            return;
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


          removeCall(
            call
          );
        }
      );


      /*
       * OFFRE WEBRTC PRIVÉE
       */
      socket.on(
        'webrtc:offer',
        payload => {
          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            call.callerId !==
              userId ||
            call.status !==
              'connecting' ||
            payload
              ?.description
              ?.type !==
              'offer'
          ) {
            return;
          }


          io
            .to(
              `user:${call.calleeId}`
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
       * RÉPONSE WEBRTC PRIVÉE
       */
      socket.on(
        'webrtc:answer',
        payload => {
          const call =
            activeCalls.get(
              payload?.callId
            );


          if (
            !call ||
            call.calleeId !==
              userId ||
            call.status !==
              'connecting' ||
            payload
              ?.description
              ?.type !==
              'answer'
          ) {
            return;
          }


          call.status =
            'active';


          io
            .to(
              `user:${call.callerId}`
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
       * ICE PRIVÉ
       */
      socket.on(
        'webrtc:ice-candidate',
        payload => {
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
       * RACCROCHAGE PRIVÉ
       */
      socket.on(
        'call:hangup',
        payload => {
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


          removeCall(
            call
          );
        }
      );


      /*
       * =====================================================
       * APPELS AUDIO / VIDÉO EN GROUPE
       * =====================================================
       */


      /*
       * CRÉER UN APPEL DE GROUPE
       */
      socket.on(
        'group-call:invite',
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
              payload
                ?.conversationId;


            const kind =
              payload
                ?.kind;


            if (
              !isUuid(
                conversationId
              )
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Groupe invalide.',
              });
            }


            if (
              kind !== 'audio' &&
              kind !== 'video'
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Type d’appel non pris en charge.',
              });
            }


            if (
              isUserBusy(
                userId
              )
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Vous êtes déjà en appel.',
              });
            }


            const group =
              await getGroupConversation(
                conversationId,
                userId
              );


            if (!group) {
              return ack({
                ok:
                  false,

                error:
                  'Appel de groupe non autorisé.',
              });
            }


            /*
             * Inviter uniquement :
             *
             * - les membres du groupe ;
             * - connectés ;
             * - qui ne sont pas déjà occupés.
             */
            const onlineMembers =
              group.members.filter(
                member =>
                  member.id !==
                    userId &&
                  connectedUsers.has(
                    member.id
                  ) &&
                  !isUserBusy(
                    member.id
                  )
              );


            if (
              onlineMembers.length ===
              0
            ) {
              return ack({
                ok:
                  false,

                error:
                  'Aucun autre membre du groupe n’est disponible.',
              });
            }


            const callId =
              randomUUID();


            const caller =
              publicUser(
                socket.data.user
              );


            const call = {
              id:
                callId,

              conversationId,

              groupTitle:
                group.title,

              callerId:
                userId,

              kind,

              createdAt:
                Date.now(),

              timeout:
                null,

              participants:
                new Map(),
            };


            /*
             * L'appelant est déjà dans l'appel.
             */
            call
              .participants
              .set(
                userId,
                {
                  user:
                    caller,

                  status:
                    'active',
                }
              );


            /*
             * Membres invités.
             */
            for (
              const member
              of onlineMembers
            ) {
              call
                .participants
                .set(
                  member.id,
                  {
                    user:
                      publicUser(
                        member
                      ),

                    status:
                      'invited',
                  }
                );
            }


            /*
             * Timeout de sonnerie.
             */
            call.timeout =
              setTimeout(
                () => {
                  if (
                    !activeGroupCalls.has(
                      callId
                    )
                  ) {
                    return;
                  }


                  let acceptedSomeone =
                    false;


                  for (
                    const [
                      participantId,
                      participant,
                    ]
                    of call.participants
                  ) {
                    if (
                      participant.status ===
                      'active'
                    ) {
                      if (
                        participantId !==
                        call.callerId
                      ) {
                        acceptedSomeone =
                          true;
                      }

                      continue;
                    }


                    if (
                      ![
                        'invited',
                        'ringing',
                        'connecting',
                      ].includes(
                        participant.status
                      )
                    ) {
                      continue;
                    }


                    participant.status =
                      'left';


                    io
                      .to(
                        `user:${participantId}`
                      )
                      .emit(
                        'group-call:ended',
                        {
                          callId:
                            call.id,

                          conversationId:
                            call.conversationId,

                          reason:
                            'timeout',
                        }
                      );
                  }


                  /*
                   * Personne n'a répondu.
                   */
                  if (
                    !acceptedSomeone
                  ) {
                    io
                      .to(
                        `user:${call.callerId}`
                      )
                      .emit(
                        'group-call:missed',
                        {
                          callId:
                            call.id,

                          conversationId:
                            call.conversationId,
                        }
                      );


                    removeGroupCall(
                      io,
                      call,
                      'timeout'
                    );


                    return;
                  }


                  /*
                   * Certains ont accepté :
                   * l'appel continue.
                   */
                  call.timeout =
                    null;

                },
                CALL_TIMEOUT_MS
              );


            activeGroupCalls.set(
              callId,
              call
            );


            console.log(
              `[GROUP CALL ${kind}] ${userId} -> ${conversationId} (${callId})`
            );


            /*
             * Réponse à l'appelant.
             */
            ack({
              ok:
                true,

              callId,

              conversationId,

              kind,

              groupTitle:
                group.title,

              invitedCount:
                onlineMembers.length,
            });


            /*
             * Sonnerie chez tous les membres.
             */
            for (
              const member
              of onlineMembers
            ) {
              io
                .to(
                  `user:${member.id}`
                )
                .emit(
                  'group-call:incoming',
                  {
                    callId,

                    conversationId,

                    kind,

                    groupTitle:
                      group.title,

                    caller,
                  }
                );
            }

          } catch (error) {
            console.error(
              '[GROUP CALL invite]',
              error
            );


            ack({
              ok:
                false,

              error:
                'Impossible de démarrer l’appel de groupe.',
            });
          }
        }
      );


      /*
       * =====================================================
       * SONNERIE GROUPE
       * =====================================================
       */

      socket.on(
        'group-call:ringing',
        payload => {
          const call =
            activeGroupCalls.get(
              payload?.callId
            );


          const participant =
            call
              ?.participants
              .get(
                userId
              );


          if (
            !call ||
            !participant ||
            ![
              'invited',
              'ringing',
            ].includes(
              participant.status
            )
          ) {
            return;
          }


          participant.status =
            'ringing';


          io
            .to(
              `user:${call.callerId}`
            )
            .emit(
              'group-call:ringing',
              {
                callId:
                  call.id,

                conversationId:
                  call.conversationId,

                user:
                  participant.user,
              }
            );
        }
      );


      /*
       * =====================================================
       * ACCEPTATION GROUPE
       * =====================================================
       */

      socket.on(
        'group-call:accept',
        async payload => {
          const call =
            activeGroupCalls.get(
              payload?.callId
            );


          const participant =
            call
              ?.participants
              .get(
                userId
              );


          if (
            !call ||
            !participant ||
            ![
              'invited',
              'ringing',
            ].includes(
              participant.status
            )
          ) {
            return;
          }


          /*
           * Vérifier que la personne appartient
           * toujours au groupe.
           */
          const stillMember =
            await isGroupMember(
              call.conversationId,
              userId
            );


          if (
            !stillMember
          ) {
            participant.status =
              'left';


            socket.emit(
              'group-call:ended',
              {
                callId:
                  call.id,

                conversationId:
                  call.conversationId,

                reason:
                  'not-member',
              }
            );


            maybeRemoveEmptyGroupCall(
              io,
              call
            );


            return;
          }


          participant.status =
            'active';


          /*
           * Tous ceux déjà présents dans l'appel.
           */
          const existingParticipants =
            activeGroupParticipants(
              call,
              userId
            );


          /*
           * Informer celui qui vient d'accepter.
           */
          socket.emit(
            'group-call:accepted',
            {
              callId:
                call.id,

              conversationId:
                call.conversationId,

              kind:
                call.kind,

              groupTitle:
                call.groupTitle,

              participants:
                existingParticipants,
            }
          );


          /*
           * Informer les autres qu'un membre
           * vient de rejoindre.
           */
          emitToActiveGroupParticipants(
            io,
            call,
            'group-call:participant-joined',
            {
              callId:
                call.id,

              conversationId:
                call.conversationId,

              user:
                participant.user,
            },
            userId
          );
        }
      );


      /*
       * =====================================================
       * REFUS GROUPE
       * =====================================================
       */

      socket.on(
        'group-call:reject',
        payload => {
          const call =
            activeGroupCalls.get(
              payload?.callId
            );


          const participant =
            call
              ?.participants
              .get(
                userId
              );


          if (
            !call ||
            !participant ||
            ![
              'invited',
              'ringing',
            ].includes(
              participant.status
            )
          ) {
            return;
          }


          participant.status =
            'rejected';


          /*
           * Le refus d'une personne ne coupe pas
           * l'appel pour les autres.
           */
          io
            .to(
              `user:${call.callerId}`
            )
            .emit(
              'group-call:rejected',
              {
                callId:
                  call.id,

                conversationId:
                  call.conversationId,

                user:
                  participant.user,
              }
            );


          maybeRemoveEmptyGroupCall(
            io,
            call
          );
        }
      );


      /*
       * =====================================================
       * OFFRE WEBRTC GROUPE
       *
       * Chaque membre possède une connexion WebRTC
       * avec chacun des autres membres.
       * =====================================================
       */

      socket.on(
        'group-webrtc:offer',
        payload => {
          const call =
            activeGroupCalls.get(
              payload?.callId
            );


          const fromParticipant =
            call
              ?.participants
              .get(
                userId
              );


          const toUserId =
            payload
              ?.toUserId;


          const toParticipant =
            call
              ?.participants
              .get(
                toUserId
              );


          if (
            !call ||
            !fromParticipant ||
            fromParticipant.status !==
              'active' ||
            !isUuid(
              toUserId
            ) ||
            !toParticipant ||
            toParticipant.status !==
              'active' ||
            payload
              ?.description
              ?.type !==
              'offer'
          ) {
            return;
          }


          io
            .to(
              `user:${toUserId}`
            )
            .emit(
              'group-webrtc:offer',
              {
                callId:
                  call.id,

                conversationId:
                  call.conversationId,

                fromUserId:
                  userId,

                fromUser:
                  fromParticipant.user,

                description:
                  payload.description,
              }
            );
        }
      );


      /*
       * =====================================================
       * RÉPONSE WEBRTC GROUPE
       * =====================================================
       */

      socket.on(
        'group-webrtc:answer',
        payload => {
          const call =
            activeGroupCalls.get(
              payload?.callId
            );


          const fromParticipant =
            call
              ?.participants
              .get(
                userId
              );


          const toUserId =
            payload
              ?.toUserId;


          const toParticipant =
            call
              ?.participants
              .get(
                toUserId
              );


          if (
            !call ||
            !fromParticipant ||
            fromParticipant.status !==
              'active' ||
            !isUuid(
              toUserId
            ) ||
            !toParticipant ||
            toParticipant.status !==
              'active' ||
            payload
              ?.description
              ?.type !==
              'answer'
          ) {
            return;
          }


          io
            .to(
              `user:${toUserId}`
            )
            .emit(
              'group-webrtc:answer',
              {
                callId:
                  call.id,

                conversationId:
                  call.conversationId,

                fromUserId:
                  userId,

                description:
                  payload.description,
              }
            );
        }
      );


      /*
       * =====================================================
       * ICE GROUPE
       * =====================================================
       */

      socket.on(
        'group-webrtc:ice-candidate',
        payload => {
          const call =
            activeGroupCalls.get(
              payload?.callId
            );


          const fromParticipant =
            call
              ?.participants
              .get(
                userId
              );


          const toUserId =
            payload
              ?.toUserId;


          const toParticipant =
            call
              ?.participants
              .get(
                toUserId
              );


          if (
            !call ||
            !fromParticipant ||
            fromParticipant.status !==
              'active' ||
            !isUuid(
              toUserId
            ) ||
            !toParticipant ||
            toParticipant.status !==
              'active' ||
            !payload?.candidate
          ) {
            return;
          }


          io
            .to(
              `user:${toUserId}`
            )
            .emit(
              'group-webrtc:ice-candidate',
              {
                callId:
                  call.id,

                conversationId:
                  call.conversationId,

                fromUserId:
                  userId,

                candidate:
                  payload.candidate,
              }
            );
        }
      );


      /*
       * =====================================================
       * QUITTER UN APPEL DE GROUPE
       * =====================================================
       */

      socket.on(
        'group-call:leave',
        payload => {
          const call =
            activeGroupCalls.get(
              payload?.callId
            );


          if (!call) {
            return;
          }


          const participant =
            call
              .participants
              .get(
                userId
              );


          if (
            !participant ||
            !isGroupParticipantBusyStatus(
              participant.status
            )
          ) {
            return;
          }


          finishGroupParticipant(
            io,
            call,
            userId,
            payload?.reason ||
              'left'
          );


          maybeRemoveEmptyGroupCall(
            io,
            call
          );
        }
      );


      /*
       * =====================================================
       * DÉCONNEXION SOCKET
       * =====================================================
       */

      socket.on(
        'disconnect',
        () => {
          const nextCount =
            (
              connectedUsers.get(
                userId
              ) || 0
            ) - 1;


          /*
           * L'utilisateur possède encore
           * une autre connexion navigateur.
           */
          if (
            nextCount > 0
          ) {
            connectedUsers.set(
              userId,
              nextCount
            );

            return;
          }


          /*
           * Complètement hors ligne.
           */
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
           * ===============================================
           * APPELS PRIVÉS
           * ===============================================
           */

          for (
            const call
            of Array.from(
              activeCalls.values()
            )
          ) {
            const targetId =
              otherParticipant(
                call,
                userId
              );


            if (!targetId) {
              continue;
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
                    'disconnect',
                }
              );


            removeCall(
              call
            );
          }


          /*
           * ===============================================
           * APPELS DE GROUPE
           *
           * Le départ d'un membre ne coupe PAS
           * les autres participants.
           * ===============================================
           */

          for (
            const call
            of Array.from(
              activeGroupCalls.values()
            )
          ) {
            const participant =
              call
                .participants
                .get(
                  userId
                );


            if (
              !participant ||
              !isGroupParticipantBusyStatus(
                participant.status
              )
            ) {
              continue;
            }


            finishGroupParticipant(
              io,
              call,
              userId,
              'disconnect'
            );


            maybeRemoveEmptyGroupCall(
              io,
              call
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