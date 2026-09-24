(() => {
  'use strict';


  const list =
    document.getElementById(
      'users-list'
    );

  const status =
    document.getElementById(
      'users-status'
    );

  const refreshButton =
    document.getElementById(
      'refresh-users'
    );

  const newChatButton =
    document.getElementById(
      'new-chat-button'
    );

  const discoveryPanel =
    document.getElementById(
      'discovery-panel'
    );

  const discoveryList =
    document.getElementById(
      'discovery-list'
    );

  const closeDiscoveryButton =
    document.getElementById(
      'close-discovery'
    );


  let loggedIn = false;
  let activeUserId = null;

  let chatsController = null;
  let discoveryController = null;


  const onlineUsers =
    new Set();

  const unreadCounts =
    new Map();

  const chatUserIds =
    new Set();


  /*
   * =========================================================
   * OUTILS
   * =========================================================
   */

  async function readJsonResponse(
    response
  ) {
    const contentType =
      response.headers.get(
        'content-type'
      ) || '';


    if (
      !contentType.includes(
        'application/json'
      )
    ) {
      const text =
        await response.text();

      throw new Error(
        text ||
        `Réponse serveur invalide (${response.status}).`
      );
    }


    return response.json();
  }


  async function getCsrfToken() {
    const response =
      await fetch(
        '/api/auth/csrf',
        {
          credentials:
            'same-origin',

          cache:
            'no-store',
        }
      );


    const data =
      await readJsonResponse(
        response
      );


    if (!response.ok) {
      throw new Error(
        data.error ||
        'Impossible de préparer la requête.'
      );
    }


    return data.csrfToken;
  }


  function getInitial(user) {
    const value =
      user.displayName ||
      user.username ||
      '?';


    return (
      value
        .trim()
        .charAt(0)
        .toUpperCase() ||
      '?'
    );
  }


  function lastMessageText(chat) {
    const message =
      chat.lastMessage;


    if (!message) {
      return '';
    }


    if (
      message.kind === 'text'
    ) {
      const body =
        message.body || '';


      return body.length > 45
        ? `${body.slice(0, 45)}…`
        : body;
    }


    if (
      message.kind === 'file'
    ) {
      return (
        `📎 ${
          message.originalName ||
          'Fichier'
        }`
      );
    }


    if (
      message.kind === 'voice'
    ) {
      return '🎤 Message vocal';
    }


    return '';
  }


  function formatMessageTime(value) {
    if (!value) {
      return '';
    }


    const date =
      new Date(value);


    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return '';
    }


    return date.toLocaleTimeString(
      'fr-FR',
      {
        hour:
          '2-digit',

        minute:
          '2-digit',
      }
    );
  }


  /*
   * =========================================================
   * PRÉSENCE
   * =========================================================
   */

  function applyPresence(
    element,
    userId
  ) {
    const dot =
      element.querySelector(
        '.presence-dot'
      );


    if (!dot) {
      return;
    }


    dot.classList.toggle(
      'online',
      onlineUsers.has(
        userId
      )
    );
  }


  function updatePresenceEverywhere(
    userId
  ) {
    document
      .querySelectorAll(
        `[data-user-id="${userId}"]`
      )
      .forEach(
        (element) => {
          applyPresence(
            element,
            userId
          );
        }
      );
  }


  /*
   * =========================================================
   * OUVERTURE D'UNE CONVERSATION
   * =========================================================
   */

  async function openConversation(user) {
    status.textContent = '';


    try {
      const csrfToken =
        await getCsrfToken();


      const response =
        await fetch(
          '/api/conversations/direct',
          {
            method:
              'POST',

            credentials:
              'same-origin',

            headers: {
              'Content-Type':
                'application/json',

              'X-CSRF-Token':
                csrfToken,
            },

            body:
              JSON.stringify({
                userId:
                  user.id,
              }),
          }
        );


      const data =
        await readJsonResponse(
          response
        );


      if (!response.ok) {
        throw new Error(
          data.error ||
          'Impossible d’ouvrir la discussion.'
        );
      }


      activeUserId =
        user.id;


      unreadCounts.delete(
        user.id
      );


      closeDiscovery();


      /*
       * AUCUN texte du genre :
       * "Conversation avec khadim prête."
       */
      status.textContent = '';


      window.dispatchEvent(
        new CustomEvent(
          'conversation:selected',
          {
            detail: {
              conversation:
                data.conversation,

              user,
            },
          }
        )
      );


      renderActiveState();

    } catch (error) {
      console.error(error);

      status.textContent =
        error.message;
    }
  }


  function renderActiveState() {
    document
      .querySelectorAll(
        '.chat-list-button'
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            'active',

            button.dataset.userId ===
              activeUserId
          );
        }
      );
  }


  /*
   * =========================================================
   * DISCUSSIONS
   * =========================================================
   */

  function renderChats(chats) {
    list.replaceChildren();

    chatUserIds.clear();


    if (
      !Array.isArray(chats) ||
      chats.length === 0
    ) {
      const empty =
        document.createElement(
          'li'
        );


      empty.className =
        'sidebar-empty';


      empty.textContent =
        'Aucune discussion';


      list.appendChild(
        empty
      );


      return;
    }


    for (const chat of chats) {
      chatUserIds.add(
        chat.id
      );


      const item =
        document.createElement(
          'li'
        );


      const button =
        document.createElement(
          'button'
        );


      button.type =
        'button';

      button.className =
        'chat-list-button';

      button.dataset.userId =
        chat.id;


      /*
       * Avatar
       */
      const avatar =
        document.createElement(
          'div'
        );


      avatar.className =
        'chat-list-avatar';


      avatar.textContent =
        getInitial(chat);


      const presence =
        document.createElement(
          'span'
        );


      presence.className =
        'presence-dot';


      avatar.appendChild(
        presence
      );


      /*
       * Zone centrale
       */
      const content =
        document.createElement(
          'div'
        );


      content.className =
        'chat-list-content';


      const topRow =
        document.createElement(
          'div'
        );


      topRow.className =
        'chat-list-top-row';


      const name =
        document.createElement(
          'strong'
        );


      name.className =
        'chat-list-name';


      name.textContent =
        chat.displayName;


      const time =
        document.createElement(
          'span'
        );


      time.className =
        'chat-list-time';


      time.textContent =
        formatMessageTime(
          chat.lastMessage
            ?.createdAt
        );


      topRow.appendChild(
        name
      );


      topRow.appendChild(
        time
      );


      const bottomRow =
        document.createElement(
          'div'
        );


      bottomRow.className =
        'chat-list-bottom-row';


      const preview =
        document.createElement(
          'div'
        );


      preview.className =
        'chat-list-preview';


      preview.textContent =
        lastMessageText(chat);


      const badge =
        document.createElement(
          'span'
        );


      badge.className =
        'unread-badge';


      const unread =
        unreadCounts.get(
          chat.id
        ) || 0;


      if (unread > 0) {
        badge.textContent =
          String(unread);

      } else {
        badge.classList.add(
          'hidden'
        );
      }


      bottomRow.appendChild(
        preview
      );


      bottomRow.appendChild(
        badge
      );


      content.appendChild(
        topRow
      );


      content.appendChild(
        bottomRow
      );


      button.appendChild(
        avatar
      );


      button.appendChild(
        content
      );


      applyPresence(
        button,
        chat.id
      );


      button.addEventListener(
        'click',
        () => {
          openConversation(
            chat
          );
        }
      );


      item.appendChild(
        button
      );


      list.appendChild(
        item
      );
    }


    renderActiveState();
  }


  async function loadChats() {
    if (!loggedIn) {
      return;
    }


    chatsController?.abort();


    const controller =
      new AbortController();


    chatsController =
      controller;


    try {
      const response =
        await fetch(
          '/api/users/chats',
          {
            credentials:
              'same-origin',

            cache:
              'no-store',

            signal:
              controller.signal,
          }
        );


      const data =
        await readJsonResponse(
          response
        );


      if (
        controller.signal.aborted
      ) {
        return;
      }


      if (!response.ok) {
        throw new Error(
          data.error ||
          'Impossible de charger les discussions.'
        );
      }


      renderChats(
        Array.isArray(data.chats)
          ? data.chats
          : []
      );


      status.textContent = '';

    } catch (error) {
      if (
        controller.signal.aborted
      ) {
        return;
      }


      console.error(error);

      status.textContent =
        error.message;

    } finally {
      if (
        chatsController ===
        controller
      ) {
        chatsController =
          null;
      }
    }
  }


  /*
   * =========================================================
   * NOUVELLE DISCUSSION
   * =========================================================
   */

  function closeDiscovery() {
    discoveryController?.abort();

    discoveryController =
      null;


    discoveryPanel?.classList.add(
      'hidden'
    );
  }


  function renderDiscovery(users) {
    discoveryList.replaceChildren();


    /*
     * Ne montrer ici que les comptes
     * absents des discussions existantes.
     */
    const available =
      users.filter(
        (user) =>
          !chatUserIds.has(
            user.id
          )
      );


    if (
      available.length === 0
    ) {
      const empty =
        document.createElement(
          'div'
        );


      empty.className =
        'discovery-empty';


      empty.textContent =
        'Aucun nouveau contact';


      discoveryList.appendChild(
        empty
      );


      return;
    }


    for (
      const user
      of available
    ) {
      const button =
        document.createElement(
          'button'
        );


      button.type =
        'button';

      button.className =
        'discovery-user';

      button.dataset.userId =
        user.id;


      const avatar =
        document.createElement(
          'div'
        );


      avatar.className =
        'discovery-avatar';


      avatar.textContent =
        getInitial(user);


      const presence =
        document.createElement(
          'span'
        );


      presence.className =
        'presence-dot';


      avatar.appendChild(
        presence
      );


      const text =
        document.createElement(
          'div'
        );


      text.className =
        'discovery-user-text';


      const name =
        document.createElement(
          'strong'
        );


      name.textContent =
        user.displayName;


      const username =
        document.createElement(
          'span'
        );


      username.textContent =
        `@${user.username}`;


      text.appendChild(
        name
      );


      text.appendChild(
        username
      );


      button.appendChild(
        avatar
      );


      button.appendChild(
        text
      );


      applyPresence(
        button,
        user.id
      );


      button.addEventListener(
        'click',
        () => {
          openConversation(
            user
          );
        }
      );


      discoveryList.appendChild(
        button
      );
    }
  }


  async function openDiscovery() {
    if (!loggedIn) {
      return;
    }


    discoveryPanel.classList.remove(
      'hidden'
    );


    discoveryList.innerHTML =
      '<div class="discovery-loading">Chargement…</div>';


    discoveryController?.abort();


    const controller =
      new AbortController();


    discoveryController =
      controller;


    try {
      const response =
        await fetch(
          '/api/users',
          {
            credentials:
              'same-origin',

            cache:
              'no-store',

            signal:
              controller.signal,
          }
        );


      const data =
        await readJsonResponse(
          response
        );


      if (
        controller.signal.aborted
      ) {
        return;
      }


      if (!response.ok) {
        throw new Error(
          data.error ||
          'Impossible de charger les utilisateurs.'
        );
      }


      renderDiscovery(
        Array.isArray(
          data.users
        )
          ? data.users
          : []
      );

    } catch (error) {
      if (
        controller.signal.aborted
      ) {
        return;
      }


      console.error(error);

      discoveryList.textContent =
        error.message;
    }
  }


  /*
   * =========================================================
   * AUTHENTIFICATION
   * =========================================================
   */

  window.addEventListener(
    'auth:changed',
    (event) => {
      loggedIn =
        Boolean(
          event.detail?.user
        );


      chatsController?.abort();

      discoveryController?.abort();


      unreadCounts.clear();

      chatUserIds.clear();

      activeUserId =
        null;


      list.replaceChildren();

      status.textContent =
        '';


      closeDiscovery();


      if (loggedIn) {
        loadChats();
      }
    }
  );


  /*
   * =========================================================
   * PRÉSENCE
   * =========================================================
   */

  window.addEventListener(
    'presence:list',
    (event) => {
      onlineUsers.clear();


      for (
        const userId
        of event.detail?.userIds || []
      ) {
        onlineUsers.add(
          userId
        );
      }


      document
        .querySelectorAll(
          '[data-user-id]'
        )
        .forEach(
          (element) => {
            applyPresence(
              element,
              element.dataset.userId
            );
          }
        );
    }
  );


  window.addEventListener(
    'presence:update',
    (event) => {
      const {
        userId,
        online,
      } =
        event.detail || {};


      if (!userId) {
        return;
      }


      if (online) {
        onlineUsers.add(
          userId
        );

      } else {
        onlineUsers.delete(
          userId
        );
      }


      updatePresenceEverywhere(
        userId
      );
    }
  );


  /*
   * =========================================================
   * MESSAGE NON LU
   * =========================================================
   */

  window.addEventListener(
    'message:unread',
    async (event) => {
      const senderId =
        event.detail
          ?.message
          ?.senderId;


      if (!senderId) {
        return;
      }


      const count =
        (
          unreadCounts.get(
            senderId
          ) || 0
        ) + 1;


      unreadCounts.set(
        senderId,
        count
      );


      await loadChats();
    }
  );


  /*
   * Un message vient d'être envoyé ou reçu :
   * mettre à jour ordre et aperçu.
   */
  window.addEventListener(
    'conversation:activity',
    () => {
      loadChats();
    }
  );


  /*
   * =========================================================
   * BOUTONS
   * =========================================================
   */

  refreshButton
    ?.addEventListener(
      'click',
      loadChats
    );


  newChatButton
    ?.addEventListener(
      'click',
      openDiscovery
    );


  closeDiscoveryButton
    ?.addEventListener(
      'click',
      closeDiscovery
    );

})();