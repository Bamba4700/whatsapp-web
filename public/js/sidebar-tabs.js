(() => {
  'use strict';


  const privateTab =
    document.getElementById(
      'private-tab'
    );

  const groupsTab =
    document.getElementById(
      'groups-tab'
    );

  const privateView =
    document.getElementById(
      'private-view'
    );

  const groupsView =
    document.getElementById(
      'groups-view'
    );


  if (
    !privateTab ||
    !groupsTab ||
    !privateView ||
    !groupsView
  ) {
    return;
  }


  /*
   * =========================================================
   * PRIVÉE
   * =========================================================
   */

  function showPrivate() {

    privateTab.classList.add(
      'active'
    );

    privateTab.setAttribute(
      'aria-selected',
      'true'
    );


    groupsTab.classList.remove(
      'active'
    );

    groupsTab.setAttribute(
      'aria-selected',
      'false'
    );


    privateView.classList.remove(
      'hidden'
    );

    groupsView.classList.add(
      'hidden'
    );
  }


  /*
   * =========================================================
   * GROUPES
   * =========================================================
   */

  function showGroups() {

    groupsTab.classList.add(
      'active'
    );

    groupsTab.setAttribute(
      'aria-selected',
      'true'
    );


    privateTab.classList.remove(
      'active'
    );

    privateTab.setAttribute(
      'aria-selected',
      'false'
    );


    groupsView.classList.remove(
      'hidden'
    );

    privateView.classList.add(
      'hidden'
    );
  }


  /*
   * =========================================================
   * CLIC SUR LES ONGLETS
   * =========================================================
   */

  privateTab.addEventListener(
    'click',
    showPrivate
  );


  groupsTab.addEventListener(
    'click',
    showGroups
  );


  /*
   * =========================================================
   * CONVERSATION OUVERTE
   *
   * Groupe ouvert  -> onglet Groupes.
   * Privée ouverte -> onglet Privée.
   * =========================================================
   */

  window.addEventListener(
    'conversation:selected',
    (event) => {

      const kind =
        event.detail
          ?.conversation
          ?.kind;


      if (
        kind === 'group'
      ) {
        showGroups();

      } else {
        showPrivate();
      }
    }
  );


  /*
   * État initial.
   */
  showPrivate();

})();