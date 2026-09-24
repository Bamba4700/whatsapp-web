(() => {
  'use strict';


  const groupsList =
    document.getElementById(
      'groups-list'
    );

  const newGroupButton =
    document.getElementById(
      'new-group-button'
    );

  const groupPanel =
    document.getElementById(
      'group-panel'
    );

  const closeGroupPanelButton =
    document.getElementById(
      'close-group-panel'
    );

  const groupForm =
    document.getElementById(
      'group-form'
    );

  const groupTitleInput =
    document.getElementById(
      'group-title-input'
    );

  const groupMembersList =
    document.getElementById(
      'group-members-list'
    );

  const groupStatus =
    document.getElementById(
      'group-status'
    );

  const createGroupButton =
    document.getElementById(
      'create-group-button'
    );


  let loggedIn =
    false;

  let groupsController =
    null;

  let membersController =
    null;

  let activeGroupId =
    null;


  const knownGroupIds =
    new Set();

  const unreadCounts =
    new Map();


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


  function groupInitial(title) {
    return (
      String(
        title || 'G'
      )
        .trim()
        .charAt(0)
        .toUpperCase() ||
      'G'
    );
  }


  function formatTime(value) {
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


  function previewText(group) {
    const message =
      group.lastMessage;


    if (!message) {
      return (
        `${group.memberCount} membre` +
        (
          group.memberCount > 1
            ? 's'
            : ''
        )
      );
    }


    const sender =
      message.senderName
        ? `${message.senderName}: `
        : '';


    if (
      message.kind === 'text'
    ) {
      const body =
        message.body || '';


      const text =
        `${sender}${body}`;


      return text.length > 44
        ? `${text.slice(0, 44)}…`
        : text;
    }


    if (
      message.kind === 'file'
    ) {
      return (
        `${sender}📎 ${
          message.originalName ||
          'Fichier'
        }`
      );
    }


    if (
      message.kind === 'voice'
    ) {
      return (
        `${sender}🎤 Message vocal`
      );
    }


    return '';
  }


  /*
   * =========================================================
   * AFFICHAGE DES GROUPES
   * =========================================================
   */

  function renderGroups(groups) {
    groupsList.replaceChildren();

    knownGroupIds.clear();


    if (
      !Array.isArray(groups) ||
      groups.length === 0
    ) {
      const empty =
        document.createElement(
          'li'
        );


      empty.className =
        'groups-empty';


      empty.textContent =
        'Aucun groupe';


      groupsList.appendChild(
        empty
      );


      return;
    }


    for (
      const group
      of groups
    ) {
      knownGroupIds.add(
        group.id
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
        'group-list-button';

      button.dataset.groupId =
        group.id;


      if (
        group.id ===
        activeGroupId
      ) {
        button.classList.add(
          'active'
        );
      }


      const avatar =
        document.createElement(
          'div'
        );


      avatar.className =
        'group-avatar';


      avatar.textContent =
        groupInitial(
          group.title
        );


      const content =
        document.createElement(
          'div'
        );


      content.className =
        'group-list-content';


      const top =
        document.createElement(
          'div'
        );


      top.className =
        'group-list-top';


      const name =
        document.createElement(
          'strong'
        );


      name.textContent =
        group.title;


      const time =
        document.createElement(
          'span'
        );


      time.textContent =
        formatTime(
          group.lastMessage
            ?.createdAt
        );


      top.appendChild(
        name
      );

      top.appendChild(
        time
      );


      const bottom =
        document.createElement(
          'div'
        );


      bottom.className =
        'group-list-bottom';


      const preview =
        document.createElement(
          'span'
        );


      preview.className =
        'group-preview';


      preview.textContent =
        previewText(
          group
        );


      const badge =
        document.createElement(
          'span'
        );


      badge.className =
        'unread-badge';


      const unread =
        unreadCounts.get(
          group.id
        ) || 0;


      if (
        unread > 0
      ) {
        badge.textContent =
          String(unread);

      } else {
        badge.classList.add(
          'hidden'
        );
      }


      bottom.appendChild(
        preview
      );

      bottom.appendChild(
        badge
      );


      content.appendChild(
        top
      );

      content.appendChild(
        bottom
      );


      button.appendChild(
        avatar
      );

      button.appendChild(
        content
      );


      button.addEventListener(
        'click',
        () => {
          openGroup(
            group
          );
        }
      );


      item.appendChild(
        button
      );


      groupsList.appendChild(
        item
      );
    }
  }


  async function loadGroups() {
    if (!loggedIn) {
      return;
    }


    groupsController?.abort();


    const controller =
      new AbortController();


    groupsController =
      controller;


    try {
      const response =
        await fetch(
          '/api/conversations/groups',
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
          'Impossible de charger les groupes.'
        );
      }


      renderGroups(
        Array.isArray(
          data.groups
        )
          ? data.groups
          : []
      );


    } catch (error) {
      if (
        controller.signal.aborted
      ) {
        return;
      }


      console.error(
        'Groupes :',
        error
      );


      groupsList.textContent =
        'Impossible de charger les groupes.';


    } finally {
      if (
        groupsController ===
        controller
      ) {
        groupsController =
          null;
      }
    }
  }


  /*
   * =========================================================
   * OUVRIR UN GROUPE
   * =========================================================
   */

  function openGroup(group) {
    activeGroupId =
      group.id;


    unreadCounts.delete(
      group.id
    );


    document
      .querySelectorAll(
        '.group-list-button'
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            'active',

            button.dataset.groupId ===
              group.id
          );
        }
      );


    /*
     * messages.js attend encore une propriété "user".
     * Pour un groupe, on lui fournit simplement
     * le titre du groupe comme nom affiché.
     */
    window.dispatchEvent(
      new CustomEvent(
        'conversation:selected',
        {
          detail: {
            conversation: {
              id:
                group.id,

              kind:
                'group',

              title:
                group.title,
            },

            user: {
              id:
                null,

              username:
                group.title,

              displayName:
                group.title,

              isGroup:
                true,
            },

            group,
          },
        }
      )
    );
  }


  /*
   * =========================================================
   * PANNEAU CRÉATION GROUPE
   * =========================================================
   */

  function closeGroupPanel() {
    membersController?.abort();

    membersController =
      null;


    groupPanel?.classList.add(
      'hidden'
    );


    groupStatus.textContent =
      '';


    groupTitleInput.value =
      '';


    groupMembersList
      .replaceChildren();
  }


  function renderAvailableMembers(
    users
  ) {
    groupMembersList
      .replaceChildren();


    if (
      !Array.isArray(users) ||
      users.length === 0
    ) {
      const empty =
        document.createElement(
          'div'
        );


      empty.className =
        'group-members-empty';


      empty.textContent =
        'Aucun autre utilisateur disponible.';


      groupMembersList
        .appendChild(
          empty
        );


      return;
    }


    for (
      const user
      of users
    ) {
      const label =
        document.createElement(
          'label'
        );


      label.className =
        'group-member-row';


      const checkbox =
        document.createElement(
          'input'
        );


      checkbox.type =
        'checkbox';

      checkbox.value =
        user.id;

      checkbox.name =
        'group-member';


      const avatar =
        document.createElement(
          'div'
        );


      avatar.className =
        'group-member-avatar';


      avatar.textContent =
        String(
          user.displayName ||
          user.username ||
          '?'
        )
          .charAt(0)
          .toUpperCase();


      const text =
        document.createElement(
          'div'
        );


      text.className =
        'group-member-text';


      const name =
        document.createElement(
          'strong'
        );


      name.textContent =
        user.displayName ||
        user.username;


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


      label.appendChild(
        checkbox
      );

      label.appendChild(
        avatar
      );

      label.appendChild(
        text
      );


      groupMembersList
        .appendChild(
          label
        );
    }
  }


  async function openGroupPanel() {
    groupPanel.classList.remove(
      'hidden'
    );


    groupStatus.textContent =
      'Chargement des utilisateurs…';


    groupMembersList
      .replaceChildren();


    membersController?.abort();


    const controller =
      new AbortController();


    membersController =
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


      renderAvailableMembers(
        data.users || []
      );


      groupStatus.textContent =
        '';


      groupTitleInput.focus();

    } catch (error) {
      if (
        controller.signal.aborted
      ) {
        return;
      }


      console.error(error);

      groupStatus.textContent =
        error.message;
    }
  }


  /*
   * =========================================================
   * CRÉER LE GROUPE
   * =========================================================
   */

  groupForm
    ?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();


        const title =
          groupTitleInput
            .value
            .trim();


        const memberIds =
          Array
            .from(
              groupMembersList
                .querySelectorAll(
                  'input[type="checkbox"]:checked'
                )
            )
            .map(
              (checkbox) =>
                checkbox.value
            );


        if (!title) {
          groupStatus.textContent =
            'Entrez un nom pour le groupe.';

          return;
        }


        if (
          memberIds.length === 0
        ) {
          groupStatus.textContent =
            'Sélectionnez au moins un membre.';

          return;
        }


        createGroupButton.disabled =
          true;


        groupStatus.textContent =
          'Création du groupe…';


        try {
          const csrfToken =
            await getCsrfToken();


          const response =
            await fetch(
              '/api/conversations/groups',
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
                    title,
                    memberIds,
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
              'Impossible de créer le groupe.'
            );
          }


          const group =
            data.group;


          closeGroupPanel();


          await loadGroups();


          openGroup(
            group
          );


        } catch (error) {
          console.error(error);

          groupStatus.textContent =
            error.message;

        } finally {
          createGroupButton.disabled =
            false;
        }
      }
    );


  /*
   * =========================================================
   * MESSAGES NON LUS DES GROUPES
   * =========================================================
   */

  window.addEventListener(
    'message:unread',
    (event) => {
      const message =
        event.detail?.message;


      if (
        !message?.conversationId
      ) {
        return;
      }


      /*
       * Si l'identifiant appartient à un groupe,
       * cet événement ne doit pas être traité
       * comme un message privé par users.js.
       */
      if (
        !knownGroupIds.has(
          message.conversationId
        )
      ) {
        return;
      }


      event.stopImmediatePropagation();


      const count =
        (
          unreadCounts.get(
            message.conversationId
          ) || 0
        ) + 1;


      unreadCounts.set(
        message.conversationId,
        count
      );


      loadGroups();
    }
  );


  /*
   * Un message texte, fichier ou vocal vient
   * d'être envoyé/reçu.
   */
  window.addEventListener(
    'conversation:activity',
    () => {
      loadGroups();
    }
  );


  /*
   * Une conversation privée vient d'être ouverte :
   * enlever la sélection visuelle du groupe.
   *
   * Une conversation groupe conserve son id.
   */
  window.addEventListener(
    'conversation:selected',
    (event) => {
      if (
        event.detail
          ?.conversation
          ?.kind !==
        'group'
      ) {
        activeGroupId =
          null;


        document
          .querySelectorAll(
            '.group-list-button.active'
          )
          .forEach(
            (button) => {
              button.classList.remove(
                'active'
              );
            }
          );
      }
    }
  );


  /*
   * =========================================================
   * AUTH
   * =========================================================
   */

  window.addEventListener(
    'auth:changed',
    (event) => {
      loggedIn =
        Boolean(
          event.detail?.user
        );


      activeGroupId =
        null;

      unreadCounts.clear();

      knownGroupIds.clear();

      groupsList.replaceChildren();

      closeGroupPanel();


      if (loggedIn) {
        loadGroups();
      }
    }
  );


  /*
   * =========================================================
   * BOUTONS
   * =========================================================
   */

  newGroupButton
    ?.addEventListener(
      'click',
      openGroupPanel
    );


  closeGroupPanelButton
    ?.addEventListener(
      'click',
      closeGroupPanel
    );

})();