(() => {
  'use strict';

  const card = document.getElementById('conversation-card');
  const audioButton = document.getElementById('audio-call-button');
  const videoButton = document.getElementById('video-call-button');

  if (!card || window.__callsInitialized) return;
  window.__callsInitialized = true;

  if (!document.querySelector('link[href="/css/calls.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/calls.css';
    document.head.appendChild(link);
  }

  const stage = document.createElement('section');
  stage.id = 'call-stage';
  stage.className = 'call-stage hidden';

  stage.innerHTML = `
    <div class="call-experience">

      <div
        id="call-kind"
        class="call-kind"
      >
        Appel audio
      </div>

      <div
        id="call-avatar-shell"
        class="call-avatar-shell"
      >
        <span
          class="call-pulse-ring call-pulse-ring-one"
        ></span>

        <span
          class="call-pulse-ring call-pulse-ring-two"
        ></span>

        <div
          id="call-avatar-letter"
          class="call-avatar-letter"
        >
          ?
        </div>
      </div>

      <h2
        id="call-person-name"
        class="call-person-name"
      ></h2>

      <p
        id="call-status-text"
        class="call-status-text"
        role="status"
      ></p>

      <div
        id="call-duration"
        class="call-duration hidden"
      >
        00:00
      </div>

      <!-- APPEL PRIVÉ VIDÉO -->
      <div
        id="call-video-area"
        class="call-video-area hidden"
      >
        <video
          id="remote-call-video"
          autoplay
          playsinline
          muted
        ></video>

        <div class="call-local-preview">

          <video
            id="local-call-video"
            autoplay
            playsinline
            muted
          ></video>

          <span id="local-camera-label">
            Vous
          </span>

        </div>
      </div>

      <!-- APPEL DE GROUPE -->
      <div
        id="group-call-area"
        class="group-call-area hidden"
      >
        <div
          id="group-call-grid"
          class="group-call-grid"
        ></div>
      </div>

      <audio
        id="remote-call-audio"
        autoplay
        playsinline
      ></audio>

      <button
        id="call-playback-button"
        type="button"
        class="call-playback hidden"
      >
        Activer le son
      </button>

      <!-- APPEL ENTRANT -->
      <div
        id="incoming-call-controls"
        class="call-controls hidden"
      >

        <div class="call-control-item">

          <button
            id="reject-call-button"
            type="button"
            class="big-call-button call-reject"
            title="Refuser"
            aria-label="Refuser"
          >
            <span class="material-symbols-rounded">
              call_end
            </span>
          </button>

          <span>
            Refuser
          </span>

        </div>

        <div class="call-control-item">

          <button
            id="accept-call-button"
            type="button"
            class="big-call-button call-accept"
            title="Accepter"
            aria-label="Accepter"
          >
            <span class="material-symbols-rounded">
              call
            </span>
          </button>

          <span>
            Accepter
          </span>

        </div>

      </div>

      <!-- APPEL ACTIF -->
      <div
        id="active-call-controls"
        class="call-controls hidden"
      >

        <div
          id="mute-control-item"
          class="call-control-item hidden"
        >

          <button
            id="mute-call-button"
            type="button"
            class="big-call-button call-secondary"
            title="Couper le microphone"
            aria-label="Couper le microphone"
          >
            <span class="material-symbols-rounded">
              mic
            </span>
          </button>

          <span id="mute-control-label">
            Muet
          </span>

        </div>

        <div
          id="camera-control-item"
          class="call-control-item hidden"
        >

          <button
            id="camera-call-button"
            type="button"
            class="big-call-button call-secondary"
            title="Couper la caméra"
            aria-label="Couper la caméra"
          >
            <span class="material-symbols-rounded">
              videocam
            </span>
          </button>

          <span id="camera-control-label">
            Caméra
          </span>

        </div>

        <div class="call-control-item">

          <button
            id="hangup-call-button"
            type="button"
            class="big-call-button call-reject"
            title="Raccrocher"
            aria-label="Raccrocher"
          >
            <span class="material-symbols-rounded">
              call_end
            </span>
          </button>

          <span>
            Raccrocher
          </span>

        </div>

      </div>

    </div>
  `;

  card.appendChild(stage);


  const el = id =>
    stage.querySelector(
      '#' + id
    );


  const status =
    el('call-status-text');

  const avatar =
    el('call-avatar-shell');

  const duration =
    el('call-duration');

  const remoteAudio =
    el('remote-call-audio');

  const remoteVideo =
    el('remote-call-video');

  const localVideo =
    el('local-call-video');

  const playback =
    el('call-playback-button');

  const groupArea =
    el('group-call-area');

  const groupGrid =
    el('group-call-grid');


  let socket = null;

  let conversation = null;

  let selectedUser = null;

  let currentUser = null;

  let call = null;

  let forcedVisible = false;


  let timer = null;

  let closeTimer = null;


  let toneContext = null;

  let toneInterval = null;

  let toneGeneration = 0;

  let toneTimeout = null;

  const oscillators =
    new Set();


  let activityContext = null;

  let activityAnimation = null;


  const rtcConfiguration = {
    iceServers: [
      {
        urls:
          'stun:stun.l.google.com:19302',
      },

      {
        urls:
          'stun:stun1.l.google.com:19302',
      },
    ],
  };


  const alive = c =>
    call === c &&
    !c.ending;


  const nameOf = user =>
    user?.displayName ||
    user?.display_name ||
    user?.username ||
    'Utilisateur';


  const groupTitleOf = c =>
    c?.groupTitle ||
    c?.user?.displayName ||
    c?.user?.username ||
    conversation?.title ||
    'Groupe';


  /*
   * =========================================================
   * BOUTONS AUDIO / VIDÉO
   * =========================================================
   */

  function updateButtons() {

    const available =
      !call;


    const privateConversation =
      conversation?.kind ===
        'private' &&
      Boolean(
        selectedUser?.id
      );


    const groupConversation =
      conversation?.kind ===
        'group' &&
      Boolean(
        conversation?.id
      );


    const enabled =
      available &&
      (
        privateConversation ||
        groupConversation
      );


    if (audioButton) {

      audioButton.disabled =
        !enabled;
    }


    if (videoButton) {

      videoButton.disabled =
        !enabled;
    }
  }


  /*
   * =========================================================
   * AFFICHAGE DE L'APPEL
   * =========================================================
   */

  function show(
    c,
    text
  ) {

    if (
      card.classList.contains(
        'hidden'
      )
    ) {

      forcedVisible =
        true;

      card.classList.remove(
        'hidden'
      );
    }


    stage.classList.remove(
      'hidden'
    );


    stage.classList.toggle(
      'is-video',
      c.kind === 'video'
    );


    stage.classList.toggle(
      'is-group-call',
      c.scope === 'group'
    );


    el('call-kind').textContent =

      c.scope === 'group'

        ? (
            c.kind === 'video'

              ? 'Appel vidéo de groupe'

              : 'Appel audio de groupe'
          )

        : (
            c.kind === 'video'

              ? 'Appel vidéo'

              : 'Appel audio'
          );


    const displayName =

      c.scope === 'group'

        ? groupTitleOf(c)

        : nameOf(c.user);


    el('call-person-name')
      .textContent =
        displayName;


    el('call-avatar-letter')
      .textContent =

        displayName
          .trim()
          .charAt(0)
          .toUpperCase() ||
        '?';


    status.textContent =
      text;


    if (
      c.scope === 'group'
    ) {

      groupArea.classList
        .remove(
          'hidden'
        );


      el('call-video-area')
        .classList
        .add(
          'hidden'
        );

    } else {

      groupArea.classList
        .add(
          'hidden'
        );
    }


    updateButtons();
  }


  /*
   * =========================================================
   * CONTRÔLES
   * =========================================================
   */

  function controls(
    mode
  ) {

    el('incoming-call-controls')
      .classList
      .toggle(
        'hidden',
        mode !== 'incoming'
      );


    el('active-call-controls')
      .classList
      .toggle(
        'hidden',
        mode === 'incoming'
      );


    el('mute-control-item')
      .classList
      .toggle(
        'hidden',
        !call?.stream
      );


    el('camera-control-item')
      .classList
      .toggle(
        'hidden',
        !call?.stream ||
        call.kind !== 'video'
      );


    duration.classList.toggle(
      'hidden',
      mode !== 'active'
    );


    avatar.classList.toggle(
      'ringing',
      mode !== 'active'
    );
  }


  /*
   * =========================================================
   * DURÉE
   * =========================================================
   */

  function startTimer() {

    if (timer) {
      return;
    }


    const started =
      Date.now();


    duration.textContent =
      '00:00';


    timer =
      setInterval(
        () => {

          const seconds =
            Math.floor(
              (
                Date.now() -
                started
              ) /
              1000
            );


          duration.textContent =

            `${String(
              Math.floor(
                seconds / 60
              )
            ).padStart(
              2,
              '0'
            )}:` +

            `${String(
              seconds % 60
            ).padStart(
              2,
              '0'
            )}`;

        },
        1000
      );
  }


  /*
   * =========================================================
   * SONNERIE
   * =========================================================
   */

  async function unlockAudio() {

    const AudioContextClass =

      window.AudioContext ||
      window.webkitAudioContext;


    if (!AudioContextClass) {
      return;
    }


    try {

      toneContext ||=

        new AudioContextClass();


      if (
        toneContext.state ===
        'suspended'
      ) {

        await toneContext.resume();
      }

    } catch (error) {

      console.warn(
        '[CALL son]',
        error
      );
    }
  }


  document.addEventListener(
    'pointerdown',
    unlockAudio,
    {
      once:
        true,
    }
  );


  document.addEventListener(
    'keydown',
    unlockAudio,
    {
      once:
        true,
    }
  );


  async function tone(
    frequency,
    milliseconds,
    volume,
    generation
  ) {

    await unlockAudio();


    if (
      generation !==
        toneGeneration ||

      toneContext?.state !==
        'running'
    ) {

      return;
    }


    const oscillator =
      toneContext
        .createOscillator();


    const gain =
      toneContext
        .createGain();


    oscillator
      .frequency
      .value =
        frequency;


    gain
      .gain
      .value =
        volume;


    oscillator.connect(
      gain
    );


    gain.connect(
      toneContext.destination
    );


    oscillators.add(
      oscillator
    );


    oscillator.onended =
      () => {

        oscillators.delete(
          oscillator
        );


        oscillator.disconnect();

        gain.disconnect();
      };


    oscillator.start();


    gain
      .gain
      .exponentialRampToValueAtTime(
        0.001,

        toneContext
          .currentTime +

        milliseconds /
          1000
      );


    oscillator.stop(

      toneContext
        .currentTime +

      milliseconds /
        1000
    );
  }


  function stopRingtone() {

    toneGeneration +=
      1;


    clearInterval(
      toneInterval
    );


    clearTimeout(
      toneTimeout
    );


    toneInterval =
      null;


    toneTimeout =
      null;


    for (
      const oscillator
      of oscillators
    ) {

      try {

        oscillator.stop();

      } catch {}
    }


    oscillators.clear();
  }


  function ringtone(
    incoming
  ) {

    stopRingtone();


    const generation =
      toneGeneration;


    const cycle =
      () => {

        tone(
          incoming
            ? 880
            : 440,

          incoming
            ? 180
            : 330,

          0.06,

          generation
        );


        toneTimeout =
          setTimeout(
            () => {

              tone(
                incoming
                  ? 660
                  : 480,

                incoming
                  ? 230
                  : 330,

                0.06,

                generation
              );

            },

            incoming
              ? 240
              : 420
          );
      };


    cycle();


    toneInterval =
      setInterval(
        cycle,

        incoming
          ? 1500
          : 2600
      );
  }


  /*
   * =========================================================
   * ANIMATION AUDIO
   * =========================================================
   */

  function stopActivity() {

    cancelAnimationFrame(
      activityAnimation
    );


    activityAnimation =
      null;


    if (
      activityContext
    ) {

      activityContext
        .close()
        .catch(
          () => {}
        );
    }


    activityContext =
      null;


    avatar.classList.remove(
      'speaking'
    );
  }


  function startActivity(
    stream
  ) {

    stopActivity();


    const AudioContextClass =

      window.AudioContext ||
      window.webkitAudioContext;


    if (
      !AudioContextClass ||

      !stream
        .getAudioTracks()
        .length
    ) {

      return;
    }


    try {

      activityContext =
        new AudioContextClass();


      const analyser =
        activityContext
          .createAnalyser();


      analyser.fftSize =
        256;


      analyser.smoothingTimeConstant =
        0.82;


      activityContext
        .createMediaStreamSource(
          stream
        )
        .connect(
          analyser
        );


      activityContext
        .resume()
        .catch(
          () => {}
        );


      const values =
        new Uint8Array(
          analyser
            .frequencyBinCount
        );


      const animate =
        () => {

          analyser
            .getByteFrequencyData(
              values
            );


          const level =

            Math.min(
              1,

              values.reduce(
                (a, b) =>
                  a + b,
                0
              ) /

              values.length /

              85
            );


          avatar.style
            .setProperty(
              '--voice-scale',

              String(
                1.04 +
                level *
                  0.34
              )
            );


          avatar.style
            .setProperty(
              '--voice-opacity',

              String(
                0.12 +
                level *
                  0.35
              )
            );


          avatar.classList
            .toggle(
              'speaking',
              level > 0.08
            );


          activityAnimation =
            requestAnimationFrame(
              animate
            );
        };


      animate();

    } catch (error) {

      console.warn(
        '[CALL animation]',
        error
      );
    }
  }


  /*
   * =========================================================
   * PARTICIPANTS D'UN GROUPE
   * =========================================================
   */

  function groupParticipantName(
    user,
    local = false
  ) {

    if (local) {

      return (
        nameOf(
          currentUser
        ) ===
        'Utilisateur'
      )
        ? 'Vous'

        : `${nameOf(
            currentUser
          )} (vous)`;
    }


    return nameOf(
      user
    );
  }


  function participantKey(
    userId,
    local = false
  ) {

    return local

      ? '__local__'

      : String(
          userId ||
          'unknown'
        );
  }


  function ensureGroupParticipantTile(
    c,
    user,
    local = false
  ) {

    if (
      !c ||
      c.scope !== 'group'
    ) {

      return null;
    }


    const key =
      participantKey(
        user?.id,
        local
      );


    if (
      c.tiles.has(
        key
      )
    ) {

      return c.tiles.get(
        key
      );
    }


    const tile =
      document.createElement(
        'div'
      );


    tile.className =
      'group-call-tile';


    tile.dataset
      .participantId =
        key;


    if (local) {

      tile.classList.add(
        'local-participant'
      );
    }


    const media =
      document.createElement(
        'div'
      );


    media.className =
      'group-call-tile-media';


    const initial =
      document.createElement(
        'div'
      );


    initial.className =
      'group-call-tile-avatar';


    initial.textContent =

      groupParticipantName(
        user,
        local
      )
        .replace(
          /\s*\(vous\)\s*$/i,
          ''
        )
        .trim()
        .charAt(0)
        .toUpperCase() ||

      '?';


    media.appendChild(
      initial
    );


    let video =
      null;


    if (
      c.kind === 'video'
    ) {

      video =
        document.createElement(
          'video'
        );


      video.autoplay =
        true;


      video.playsInline =
        true;


      video.muted =
        true;


      video.className =
        'group-call-video';


      if (local) {

        video.classList.add(
          'group-call-local-video'
        );
      }


      media.appendChild(
        video
      );
    }


    const footer =
      document.createElement(
        'div'
      );


    footer.className =
      'group-call-tile-footer';


    const name =
      document.createElement(
        'span'
      );


    name.className =
      'group-call-tile-name';


    name.textContent =
      groupParticipantName(
        user,
        local
      );


    const state =
      document.createElement(
        'span'
      );


    state.className =
      'group-call-tile-state';


    state.textContent =
      local
        ? 'Vous'
        : 'Connexion…';


    footer.appendChild(
      name
    );


    footer.appendChild(
      state
    );


    tile.appendChild(
      media
    );


    tile.appendChild(
      footer
    );


    groupGrid.appendChild(
      tile
    );


    const item = {
      tile,
      media,
      initial,
      video,
      state,
      user,
      local,
    };


    c.tiles.set(
      key,
      item
    );


    if (
      local &&
      c.stream &&
      video
    ) {

      video.srcObject =
        c.stream;


      video.play()
        .catch(
          () => {}
        );


      initial.classList.add(
        'hidden'
      );
    }


    return item;
  }


  function updateGroupTileState(
    c,
    userId,
    text,
    connected = false
  ) {

    const item =
      c?.tiles?.get(
        participantKey(
          userId
        )
      );


    if (!item) {
      return;
    }


    item.state.textContent =
      text;


    item.tile
      .classList
      .toggle(
        'connected',
        Boolean(
          connected
        )
      );
  }


  function removeGroupParticipantTile(
    c,
    userId
  ) {

    const key =
      participantKey(
        userId
      );


    const item =
      c?.tiles?.get(
        key
      );


    if (!item) {
      return;
    }


    item.tile.remove();


    c.tiles.delete(
      key
    );
  }


  function renderLocalGroupParticipant(
    c
  ) {

    if (
      !c ||
      c.scope !== 'group'
    ) {

      return;
    }


    const local =
      ensureGroupParticipantTile(
        c,

        currentUser || {
          displayName:
            'Vous',
        },

        true
      );


    if (!local) {
      return;
    }


    local.state.textContent =
      'Vous';


    local.tile.classList.add(
      'connected'
    );


    if (
      c.kind === 'video' &&
      local.video &&
      c.stream
    ) {

      local.video.srcObject =
        c.stream;


      local.video
        .play()
        .catch(
          () => {}
        );


      local.initial
        .classList
        .add(
          'hidden'
        );
    }
  }


  function renderKnownGroupParticipant(
    c,
    user,
    text = 'Connexion…'
  ) {

    if (
      !c ||
      !user?.id
    ) {

      return;
    }


    const item =
      ensureGroupParticipantTile(
        c,
        user,
        false
      );


    if (item) {

      item.state.textContent =
        text;
    }
  }


  /*
   * =========================================================
   * NETTOYAGE DES CONNEXIONS
   * =========================================================
   */

  function closePrivatePeer(
    c
  ) {

    if (!c?.pc) {
      return;
    }


    c.pc.ontrack =
      null;


    c.pc.onicecandidate =
      null;


    c.pc.onconnectionstatechange =
      null;


    c.pc.close();


    c.pc =
      null;
  }


  function closeGroupPeer(
    c,
    userId,
    removeTile = false
  ) {

    const peer =
      c?.peers?.get(
        userId
      );


    if (!peer) {

      if (removeTile) {

        removeGroupParticipantTile(
          c,
          userId
        );
      }

      return;
    }


    peer.pc.ontrack =
      null;


    peer.pc.onicecandidate =
      null;


    peer.pc.onconnectionstatechange =
      null;


    try {

      peer.pc.close();

    } catch {}


    peer.audio?.pause();


    if (
      peer.audio
    ) {

      peer.audio.srcObject =
        null;


      peer.audio.remove();
    }


    if (
      peer.video
    ) {

      peer.video.srcObject =
        null;
    }


    peer.remote
      ?.getTracks()
      .forEach(
        track =>
          track.stop()
      );


    c.peers.delete(
      userId
    );


    if (removeTile) {

      removeGroupParticipantTile(
        c,
        userId
      );
    }
  }


  function release(
    c
  ) {

    clearTimeout(
      c.connectTimer
    );


    if (
      c.scope === 'group'
    ) {

      for (
        const userId
        of Array.from(
          c.peers.keys()
        )
      ) {

        closeGroupPeer(
          c,
          userId,
          true
        );
      }


      c.peers.clear();

      c.pendingIce.clear();

      c.tiles.clear();

      groupGrid
        .replaceChildren();

    } else {

      closePrivatePeer(
        c
      );


      c.remote
        ?.getTracks()
        .forEach(
          track =>
            track.stop()
        );


      c.remote =
        null;


      c.ice =
        [];
    }


    c.stream
      ?.getTracks()
      .forEach(
        track =>
          track.stop()
      );


    c.stream =
      null;


    c.mediaPromise =
      null;


    for (
      const media
      of [
        remoteAudio,
        remoteVideo,
        localVideo,
      ]
    ) {

      media.pause();

      media.srcObject =
        null;
    }


    stopRingtone();

    stopActivity();


    clearInterval(
      timer
    );


    timer =
      null;


    playback.classList.add(
      'hidden'
    );
  }


  function cleanup(
    c = call
  ) {

    if (
      !c ||
      call !== c
    ) {

      return;
    }


    clearTimeout(
      closeTimer
    );


    release(
      c
    );


    call =
      null;


    stage.classList.add(
      'hidden'
    );


    stage.classList.remove(
      'is-video',
      'is-group-call'
    );


    el('call-video-area')
      .classList
      .add(
        'hidden'
      );


    groupArea.classList.add(
      'hidden'
    );


    groupGrid
      .replaceChildren();


    avatar.classList.remove(
      'ringing',
      'speaking'
    );


    el('accept-call-button')
      .disabled =
        false;


    if (
      forcedVisible &&
      !conversation
    ) {

      card.classList.add(
        'hidden'
      );
    }


    forcedVisible =
      false;


    updateButtons();
  }


  function notifyServerCallEnd(
    c,
    reason = 'hangup'
  ) {

    if (!c?.id) {
      return;
    }


    if (
      c.scope === 'group'
    ) {

      socket?.emit(
        'group-call:leave',
        {
          callId:
            c.id,

          reason,
        }
      );

    } else {

      socket?.emit(
        'call:hangup',
        {
          callId:
            c.id,

          reason,
        }
      );
    }
  }


  function end(
    c,
    text,
    notify = false
  ) {

    if (!alive(c)) {
      return;
    }


    if (notify) {

      notifyServerCallEnd(
        c,
        'hangup'
      );
    }


    c.ending =
      true;


    release(
      c
    );


    status.textContent =
      text;


    avatar.classList.remove(
      'ringing'
    );


    el('incoming-call-controls')
      .classList
      .add(
        'hidden'
      );


    el('active-call-controls')
      .classList
      .add(
        'hidden'
      );


    closeTimer =
      setTimeout(
        () =>
          cleanup(c),
        1400
      );
  }


  function mediaError(
    error
  ) {

    if (
      error.name ===
      'NotAllowedError'
    ) {

      return (
        'Accès au microphone ou à la caméra refusé. ' +
        'Vérifiez les permissions du navigateur.'
      );
    }


    if (
      error.name ===
      'NotFoundError'
    ) {

      return (
        'Microphone ou caméra introuvable. ' +
        'Vérifiez les périphériques de votre machine.'
      );
    }


    if (
      error.name ===
      'NotReadableError'
    ) {

      return (
        'Microphone ou caméra inaccessible ou déjà utilisé ' +
        'par une autre application.'
      );
    }


    return (
      error.message ||
      'Impossible de préparer les médias.'
    );
  }


  /*
   * =========================================================
   * MICROPHONE / CAMÉRA
   * =========================================================
   */

  async function prepareMedia(
    c
  ) {

    if (c.stream) {
      return c.stream;
    }


    if (
      c.mediaPromise
    ) {

      return c.mediaPromise;
    }


    c.mediaPromise =
      (
        async () => {

          if (
            !navigator
              .mediaDevices
              ?.getUserMedia
          ) {

            throw new Error(
              'Microphone/caméra indisponibles. ' +
              'Ouvrez l’application en HTTPS.'
            );
          }


          const stream =

            await navigator
              .mediaDevices
              .getUserMedia(
                {
                  audio: {
                    echoCancellation:
                      true,

                    noiseSuppression:
                      true,

                    autoGainControl:
                      true,
                  },

                  video:
                    c.kind ===
                    'video'

                      ? {
                          width: {
                            ideal:
                              1280,
                          },

                          height: {
                            ideal:
                              720,
                          },

                          frameRate: {
                            ideal:
                              24,

                            max:
                              30,
                          },
                        }

                      : false,
                }
              );


          if (!alive(c)) {

            stream
              .getTracks()
              .forEach(
                track =>
                  track.stop()
              );


            throw new Error(
              'Appel annulé.'
            );
          }


          c.stream =
            stream;


          if (
            c.scope ===
            'group'
          ) {

            renderLocalGroupParticipant(
              c
            );

          } else if (
            c.kind ===
            'video'
          ) {

            localVideo.muted =
              true;


            localVideo.srcObject =
              stream;


            localVideo
              .play()
              .catch(
                () => {}
              );


            el('call-video-area')
              .classList
              .remove(
                'hidden'
              );
          }


          updateMediaButtons(
            c
          );


          return stream;
        }
      )();


    return c.mediaPromise;
  }


  function updateMediaButtons(
    c
  ) {

    const buttons = [
      [
        'mute-call-button',
        c.micOff,
        'mic',
        'mic_off',
        'mute-control-label',
        'Muet',
        'Réactiver',
      ],

      [
        'camera-call-button',
        c.cameraOff,
        'videocam',
        'videocam_off',
        'camera-control-label',
        'Caméra',
        'Réactiver',
      ],
    ];


    for (
      const [
        id,
        muted,
        iconOn,
        iconOff,
        labelId,
        labelOn,
        labelOff,
      ]
      of buttons
    ) {

      const button =
        el(id);


      button.classList.toggle(
        'muted',
        Boolean(
          muted
        )
      );


      button.setAttribute(
        'aria-pressed',
        String(
          Boolean(
            muted
          )
        )
      );


      button
        .querySelector(
          'span'
        )
        .textContent =

          muted
            ? iconOff
            : iconOn;


      el(labelId)
        .textContent =

          muted
            ? labelOff
            : labelOn;


      const device =

        id ===
        'mute-call-button'

          ? 'le microphone'

          : 'la caméra';


      button.title =

        (
          muted
            ? 'Réactiver '
            : 'Couper '
        ) +

        device;


      button.setAttribute(
        'aria-label',
        button.title
      );
    }


    el('local-camera-label')
      .textContent =

        c.cameraOff
          ? 'Caméra coupée'
          : 'Vous';


    localVideo.style.visibility =

      c.cameraOff
        ? 'hidden'
        : 'visible';


    if (
      c.scope ===
      'group'
    ) {

      const local =
        c.tiles.get(
          participantKey(
            null,
            true
          )
        );


      if (
        local?.video
      ) {

        local.video
          .style
          .visibility =

            c.cameraOff
              ? 'hidden'
              : 'visible';


        local.initial
          .classList
          .toggle(
            'hidden',
            !c.cameraOff
          );


        local.state
          .textContent =

            c.cameraOff
              ? 'Caméra coupée'
              : 'Vous';
      }
    }
  }


  /*
   * =========================================================
   * LECTURE MÉDIAS DISTANTS
   * =========================================================
   */

  async function playRemotePrivate(
    c
  ) {

    if (!alive(c)) {
      return;
    }


    try {

      await remoteAudio.play();


      if (alive(c)) {

        playback.classList.add(
          'hidden'
        );
      }

    } catch {

      if (alive(c)) {

        playback.classList.remove(
          'hidden'
        );
      }
    }


    if (
      c.kind === 'video'
    ) {

      remoteVideo
        .play()
        .catch(
          () => {}
        );
    }
  }


  async function playGroupPeer(
    peer
  ) {

    if (!peer) {
      return;
    }


    try {

      await peer.audio.play();

    } catch {

      playback.classList.remove(
        'hidden'
      );
    }


    if (
      peer.video
    ) {

      peer.video
        .play()
        .catch(
          () => {}
        );
    }
  }


  async function playAllRemoteMedia() {

    if (!call) {
      return;
    }


    if (
      call.scope ===
      'group'
    ) {

      for (
        const peer
        of call.peers.values()
      ) {

        await playGroupPeer(
          peer
        );
      }


      playback.classList.add(
        'hidden'
      );


      return;
    }


    await playRemotePrivate(
      call
    );
  }


  playback.addEventListener(
    'click',
    playAllRemoteMedia
  );


  /*
   * =========================================================
   * WEBRTC PRIVÉ
   * =========================================================
   */

  async function makePrivatePeer(
    c
  ) {

    if (c.pc) {
      return c.pc;
    }


    await prepareMedia(
      c
    );


    if (!alive(c)) {

      throw new Error(
        'Appel annulé.'
      );
    }


    if (c.pc) {
      return c.pc;
    }


    const pc =
      new RTCPeerConnection(
        rtcConfiguration
      );


    c.pc =
      pc;


    c.remote =
      new MediaStream();


    for (
      const track
      of c.stream.getTracks()
    ) {

      pc.addTrack(
        track,
        c.stream
      );
    }


    pc.ontrack =
      event => {

        if (!alive(c)) {
          return;
        }


        if (
          !c.remote
            .getTracks()
            .some(
              track =>
                track.id ===
                event.track.id
            )
        ) {

          c.remote.addTrack(
            event.track
          );
        }


        remoteAudio.srcObject =
          c.remote;


        remoteVideo.muted =
          true;


        remoteVideo.srcObject =
          c.remote;


        if (
          event.track.kind ===
          'audio'
        ) {

          startActivity(
            c.remote
          );
        }


        playRemotePrivate(
          c
        );
      };


    pc.onicecandidate =
      event => {

        if (
          alive(c) &&
          event.candidate &&
          c.id
        ) {

          socket.emit(
            'webrtc:ice-candidate',
            {
              callId:
                c.id,

              candidate:
                event.candidate,
            }
          );
        }
      };


    pc.onconnectionstatechange =
      () => {

        if (!alive(c)) {
          return;
        }


        console.info(
          '[CALL WebRTC]',
          pc.connectionState
        );


        if (
          pc.connectionState ===
          'connected'
        ) {

          clearTimeout(
            c.connectTimer
          );


          stopRingtone();


          status.textContent =
            'En ligne';


          controls(
            'active'
          );


          startTimer();

        } else if (
          pc.connectionState ===
          'disconnected'
        ) {

          status.textContent =
            'Connexion interrompue…';

        } else if (
          pc.connectionState ===
          'failed'
        ) {

          end(
            c,

            'Connexion impossible entre les deux appareils.',

            true
          );
        }
      };


    c.connectTimer =
      setTimeout(
        () => {

          if (
            alive(c) &&
            pc.connectionState !==
              'connected'
          ) {

            end(
              c,

              'La connexion n’a pas abouti.',

              true
            );
          }

        },

        35000
      );


    return pc;
  }


  async function flushPrivateIce(
    c
  ) {

    if (
      !c.pc
        ?.remoteDescription
    ) {

      return;
    }


    const candidates =
      c.ice.splice(
        0
      );


    for (
      const candidate
      of candidates
    ) {

      if (!alive(c)) {
        return;
      }


      try {

        await c.pc
          .addIceCandidate(
            candidate
          );

      } catch (error) {

        console.warn(
          '[CALL ICE]',
          error
        );
      }
    }
  }


  /*
   * =========================================================
   * WEBRTC GROUPE
   * =========================================================
   */

  function pendingIceFor(
    c,
    userId
  ) {

    if (
      !c.pendingIce.has(
        userId
      )
    ) {

      c.pendingIce.set(
        userId,
        []
      );
    }


    return c.pendingIce.get(
      userId
    );
  }


  async function flushGroupIce(
    c,
    userId
  ) {

    const peer =
      c.peers.get(
        userId
      );


    if (
      !peer
        ?.pc
        ?.remoteDescription
    ) {

      return;
    }


    const candidates =
      pendingIceFor(
        c,
        userId
      )
        .splice(
          0
        );


    for (
      const candidate
      of candidates
    ) {

      if (!alive(c)) {
        return;
      }


      try {

        await peer.pc
          .addIceCandidate(
            candidate
          );

      } catch (error) {

        console.warn(
          '[GROUP CALL ICE]',
          error
        );
      }
    }
  }


  async function makeGroupPeer(
    c,
    user,
    createOffer = false
  ) {

    const userId =
      user?.id;


    if (!userId) {

      throw new Error(
        'Participant de groupe invalide.'
      );
    }


    if (
      c.peers.has(
        userId
      )
    ) {

      const existing =
        c.peers.get(
          userId
        );


      if (user) {

        existing.user =
          user;
      }


      return existing;
    }


    await prepareMedia(
      c
    );


    if (!alive(c)) {

      throw new Error(
        'Appel annulé.'
      );
    }


    renderKnownGroupParticipant(
      c,
      user
    );


    const tile =
      ensureGroupParticipantTile(
        c,
        user,
        false
      );


    const pc =
      new RTCPeerConnection(
        rtcConfiguration
      );


    const remote =
      new MediaStream();


    const audio =
      document.createElement(
        'audio'
      );


    audio.autoplay =
      true;


    audio.playsInline =
      true;


    audio.className =
      'group-call-hidden-audio';


    stage.appendChild(
      audio
    );


    const peer = {
      user,
      pc,
      remote,
      audio,

      video:
        tile?.video ||
        null,

      connected:
        false,
    };


    c.peers.set(
      userId,
      peer
    );


    for (
      const track
      of c.stream.getTracks()
    ) {

      pc.addTrack(
        track,
        c.stream
      );
    }


    pc.ontrack =
      event => {

        if (!alive(c)) {
          return;
        }


        if (
          !remote
            .getTracks()
            .some(
              track =>
                track.id ===
                event.track.id
            )
        ) {

          remote.addTrack(
            event.track
          );
        }


        audio.srcObject =
          remote;


        if (
          peer.video
        ) {

          peer.video.srcObject =
            remote;


          peer.video.muted =
            true;


          peer.video
            .play()
            .catch(
              () => {}
            );


          if (
            remote
              .getVideoTracks()
              .length >
            0
          ) {

            tile?.initial
              .classList
              .add(
                'hidden'
              );
          }
        }


        playGroupPeer(
          peer
        );
      };


    pc.onicecandidate =
      event => {

        if (
          alive(c) &&
          event.candidate &&
          c.id
        ) {

          socket.emit(
            'group-webrtc:ice-candidate',
            {
              callId:
                c.id,

              toUserId:
                userId,

              candidate:
                event.candidate,
            }
          );
        }
      };


    pc.onconnectionstatechange =
      () => {

        if (!alive(c)) {
          return;
        }


        console.info(
          '[GROUP CALL WebRTC]',
          userId,
          pc.connectionState
        );


        if (
          pc.connectionState ===
          'connected'
        ) {

          peer.connected =
            true;


          updateGroupTileState(
            c,
            userId,
            'En ligne',
            true
          );


          stopRingtone();


          status.textContent =
            'Appel de groupe en cours';


          controls(
            'active'
          );


          startTimer();

        } else if (
          pc.connectionState ===
          'connecting'
        ) {

          updateGroupTileState(
            c,
            userId,
            'Connexion…',
            false
          );

        } else if (
          pc.connectionState ===
          'disconnected'
        ) {

          peer.connected =
            false;


          updateGroupTileState(
            c,
            userId,
            'Connexion interrompue',
            false
          );

        } else if (
          pc.connectionState ===
            'failed' ||

          pc.connectionState ===
            'closed'
        ) {

          peer.connected =
            false;


          updateGroupTileState(
            c,
            userId,
            'Déconnecté',
            false
          );
        }
      };


    if (
      createOffer
    ) {

      const offer =
        await pc.createOffer();


      if (!alive(c)) {

        return peer;
      }


      await pc
        .setLocalDescription(
          offer
        );


      if (alive(c)) {

        socket.emit(
          'group-webrtc:offer',
          {
            callId:
              c.id,

            toUserId:
              userId,

            description:
              pc.localDescription,
          }
        );
      }
    }


    return peer;
  }


  /*
   * =========================================================
   * NOUVEL OBJET APPEL
   * =========================================================
   */

  function newCall(
    data
  ) {

    const scope =

      data.scope ===
      'group'

        ? 'group'

        : 'private';


    return {
      ...data,

      scope,

      ice:
        [],

      stream:
        null,

      mediaPromise:
        null,

      pc:
        null,

      remote:
        null,

      micOff:
        false,

      cameraOff:
        false,

      ending:
        false,

      accepted:
        false,

      accepting:
        false,

      connectTimer:
        null,

      peers:
        scope === 'group'
          ? new Map()
          : null,

      pendingIce:
        scope === 'group'
          ? new Map()
          : null,

      tiles:
        scope === 'group'
          ? new Map()
          : null,

      joined:
        scope === 'group'
          ? false
          : null,
    };
  }


  /*
   * =========================================================
   * SOCKET.IO
   * =========================================================
   */

  function connectSignaling() {

    if (socket) {
      return;
    }


    if (
      typeof io !==
      'function'
    ) {

      throw new Error(
        'Socket.IO indisponible.'
      );
    }


    socket =
      io();


    socket.on(
      'connect',
      () => {

        console.info(
          '[CALL] socket connecté'
        );
      }
    );


    socket.on(
      'disconnect',
      () => {

        if (call) {

          end(
            call,
            'Connexion au serveur interrompue.'
          );
        }
      }
    );


    socket.on(
      'connect_error',
      error => {

        console.error(
          '[CALL socket]',
          error.message
        );
      }
    );


    /*
     * =======================================================
     * APPEL PRIVÉ ENTRANT
     * =======================================================
     */

    socket.on(
      'call:incoming',
      payload => {

        if (call) {

          if (
            call.id !==
            payload.callId
          ) {

            socket.emit(
              'call:reject',
              {
                callId:
                  payload.callId,
              }
            );
          }

          return;
        }


        const c =
          newCall({
            scope:
              'private',

            id:
              payload.callId,

            conversationId:
              payload.conversationId,

            user:
              payload.caller,

            kind:
              payload.kind ===
              'video'
                ? 'video'
                : 'audio',

            direction:
              'incoming',
          });


        call =
          c;


        show(
          c,

          c.kind === 'video'

            ? 'Appel vidéo entrant'

            : 'Appel audio entrant'
        );


        controls(
          'incoming'
        );


        ringtone(
          true
        );


        socket.emit(
          'call:ringing',
          {
            callId:
              c.id,
          }
        );
      }
    );


    socket.on(
      'call:ringing',
      payload => {

        if (
          call?.scope !==
            'private' ||

          call?.id !==
            payload.callId ||

          call.ending ||

          call.accepted
        ) {

          return;
        }


        status.textContent =
          'Ça sonne…';


        ringtone(
          false
        );
      }
    );


    socket.on(
      'call:accepted',
      async payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'private' ||

          c.id !==
            payload.callId ||

          !alive(c) ||

          c.accepted
        ) {

          return;
        }


        c.accepted =
          true;


        stopRingtone();


        status.textContent =
          'Connexion…';


        try {

          const pc =
            await makePrivatePeer(
              c
            );


          const offer =
            await pc.createOffer();


          if (!alive(c)) {
            return;
          }


          await pc
            .setLocalDescription(
              offer
            );


          if (alive(c)) {

            socket.emit(
              'webrtc:offer',
              {
                callId:
                  c.id,

                description:
                  pc.localDescription,
              }
            );
          }

        } catch (error) {

          if (alive(c)) {

            end(
              c,
              mediaError(error),
              true
            );
          }
        }
      }
    );


    socket.on(
      'webrtc:offer',
      async payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'private' ||

          c.id !==
            payload.callId ||

          !c.accepted ||

          !alive(c)
        ) {

          return;
        }


        try {

          const pc =
            await makePrivatePeer(
              c
            );


          await pc
            .setRemoteDescription(
              payload.description
            );


          await flushPrivateIce(
            c
          );


          if (!alive(c)) {
            return;
          }


          const answer =
            await pc
              .createAnswer();


          if (!alive(c)) {
            return;
          }


          await pc
            .setLocalDescription(
              answer
            );


          if (alive(c)) {

            socket.emit(
              'webrtc:answer',
              {
                callId:
                  c.id,

                description:
                  pc.localDescription,
              }
            );
          }

        } catch (error) {

          if (alive(c)) {

            end(
              c,
              mediaError(error),
              true
            );
          }
        }
      }
    );


    socket.on(
      'webrtc:answer',
      async payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'private' ||

          c.id !==
            payload.callId ||

          !c.pc ||

          !alive(c)
        ) {

          return;
        }


        try {

          await c.pc
            .setRemoteDescription(
              payload.description
            );


          await flushPrivateIce(
            c
          );

        } catch (error) {

          if (alive(c)) {

            end(
              c,
              mediaError(error),
              true
            );
          }
        }
      }
    );


    socket.on(
      'webrtc:ice-candidate',
      async payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'private' ||

          c.id !==
            payload.callId ||

          !payload.candidate ||

          !alive(c)
        ) {

          return;
        }


        c.ice.push(
          payload.candidate
        );


        await flushPrivateIce(
          c
        );
      }
    );


    for (
      const [
        event,
        text,
      ]

      of [
        [
          'call:rejected',
          'Appel refusé',
        ],

        [
          'call:missed',
          'Pas de réponse',
        ],

        [
          'call:ended',
          'Appel terminé',
        ],
      ]
    ) {

      socket.on(
        event,
        payload => {

          if (
            call?.scope ===
              'private' &&

            call?.id ===
              payload.callId
          ) {

            end(
              call,

              payload.reason ===
                'timeout'

                ? 'Appel manqué'

                : text
            );
          }
        }
      );
    }


    /*
     * =======================================================
     * APPEL DE GROUPE ENTRANT
     * =======================================================
     */

    socket.on(
      'group-call:incoming',
      payload => {

        if (call) {

          socket.emit(
            'group-call:reject',
            {
              callId:
                payload.callId,
            }
          );


          return;
        }


        const c =
          newCall({
            scope:
              'group',

            id:
              payload.callId,

            conversationId:
              payload.conversationId,

            groupTitle:
              payload.groupTitle ||
              'Groupe',

            user:
              payload.caller,

            kind:
              payload.kind ===
              'video'

                ? 'video'

                : 'audio',

            direction:
              'incoming',
          });


        call =
          c;


        show(
          c,

          c.kind === 'video'

            ? (
                'Appel vidéo de groupe entrant — ' +
                nameOf(
                  payload.caller
                )
              )

            : (
                'Appel audio de groupe entrant — ' +
                nameOf(
                  payload.caller
                )
              )
        );


        renderKnownGroupParticipant(
          c,
          payload.caller,
          'Appelant'
        );


        controls(
          'incoming'
        );


        ringtone(
          true
        );


        socket.emit(
          'group-call:ringing',
          {
            callId:
              c.id,
          }
        );
      }
    );


    /*
     * =======================================================
     * SONNERIE GROUPE
     * =======================================================
     */

    socket.on(
      'group-call:ringing',
      payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'group' ||

          c.id !==
            payload.callId ||

          !alive(c)
        ) {

          return;
        }


        const user =
          payload.user;


        if (
          user?.id
        ) {

          renderKnownGroupParticipant(
            c,
            user,
            'Ça sonne…'
          );
        }


        status.textContent =

          user

            ? `${nameOf(user)} sonne…`

            : 'Ça sonne…';


        if (
          c.direction ===
          'outgoing'
        ) {

          ringtone(
            false
          );
        }
      }
    );


    /*
     * =======================================================
     * ACCEPTATION D'UN APPEL GROUPE
     * =======================================================
     */

    socket.on(
      'group-call:accepted',
      async payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'group' ||

          c.id !==
            payload.callId ||

          !alive(c)
        ) {

          return;
        }


        c.accepted =
          true;


        c.joined =
          true;


        c.accepting =
          false;


        stopRingtone();


        controls(
          'waiting'
        );


        status.textContent =
          'Connexion aux participants…';


        renderLocalGroupParticipant(
          c
        );


        const participants =

          Array.isArray(
            payload.participants
          )

            ? payload.participants

            : [];


        if (
          participants.length ===
          0
        ) {

          controls(
            'active'
          );


          startTimer();


          status.textContent =
            'En attente d’un participant…';


          return;
        }


        try {

          for (
            const item
            of participants
          ) {

            const user =
              item?.user;


            if (
              !user?.id
            ) {

              continue;
            }


            renderKnownGroupParticipant(
              c,
              user
            );


            await makeGroupPeer(
              c,
              user,
              true
            );
          }

        } catch (error) {

          console.error(
            '[GROUP CALL accept]',
            error
          );


          if (alive(c)) {

            end(
              c,
              mediaError(error),
              true
            );
          }
        }
      }
    );


    /*
     * =======================================================
     * UN PARTICIPANT REJOINT
     * =======================================================
     */

    socket.on(
      'group-call:participant-joined',
      payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'group' ||

          c.id !==
            payload.callId ||

          !alive(c) ||

          !payload.user?.id
        ) {

          return;
        }


        renderKnownGroupParticipant(
          c,
          payload.user,
          'Connexion…'
        );


        status.textContent =

          `${nameOf(
            payload.user
          )} a rejoint l’appel`;
      }
    );


    /*
     * =======================================================
     * UN PARTICIPANT QUITTE
     * =======================================================
     */

    socket.on(
      'group-call:participant-left',
      payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'group' ||

          c.id !==
            payload.callId ||

          !alive(c) ||

          !payload.userId
        ) {

          return;
        }


        const peer =
          c.peers.get(
            payload.userId
          );


        const participantName =

          peer?.user

            ? nameOf(
                peer.user
              )

            : 'Un participant';


        closeGroupPeer(
          c,
          payload.userId,
          true
        );


        status.textContent =

          `${participantName} a quitté l’appel`;
      }
    );


    /*
     * =======================================================
     * REFUS D'UN MEMBRE
     * =======================================================
     */

    socket.on(
      'group-call:rejected',
      payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'group' ||

          c.id !==
            payload.callId ||

          !alive(c)
        ) {

          return;
        }


        if (
          payload.user?.id
        ) {

          removeGroupParticipantTile(
            c,
            payload.user.id
          );


          status.textContent =

            `${nameOf(
              payload.user
            )} a refusé l’appel`;
        }
      }
    );


    /*
     * =======================================================
     * PERSONNE N'A RÉPONDU
     * =======================================================
     */

    socket.on(
      'group-call:missed',
      payload => {

        if (
          call?.scope ===
            'group' &&

          call?.id ===
            payload.callId
        ) {

          end(
            call,
            'Aucun membre n’a répondu'
          );
        }
      }
    );


    /*
     * =======================================================
     * APPEL GROUPE TERMINÉ
     * =======================================================
     */

    socket.on(
      'group-call:ended',
      payload => {

        if (
          call?.scope ===
            'group' &&

          call?.id ===
            payload.callId
        ) {

          const text =

            payload.reason ===
              'timeout'

              ? (
                  'Appel de groupe terminé : ' +
                  'délai dépassé'
                )

              : 'Appel de groupe terminé';


          end(
            call,
            text
          );
        }
      }
    );


    /*
     * =======================================================
     * OFFRE WEBRTC GROUPE
     * =======================================================
     */

    socket.on(
      'group-webrtc:offer',
      async payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'group' ||

          c.id !==
            payload.callId ||

          !c.joined ||

          !alive(c) ||

          !payload.fromUserId ||

          payload
            .description
            ?.type !==
              'offer'
        ) {

          return;
        }


        try {

          const user =

            payload.fromUser ||

            c.peers.get(
              payload.fromUserId
            )?.user ||

            {
              id:
                payload.fromUserId,

              displayName:
                'Participant',
            };


          renderKnownGroupParticipant(
            c,
            user
          );


          const peer =

            await makeGroupPeer(
              c,
              user,
              false
            );


          await peer.pc
            .setRemoteDescription(
              payload.description
            );


          await flushGroupIce(
            c,
            payload.fromUserId
          );


          if (!alive(c)) {
            return;
          }


          const answer =

            await peer.pc
              .createAnswer();


          await peer.pc
            .setLocalDescription(
              answer
            );


          if (alive(c)) {

            socket.emit(
              'group-webrtc:answer',
              {
                callId:
                  c.id,

                toUserId:
                  payload.fromUserId,

                description:
                  peer.pc
                    .localDescription,
              }
            );
          }

        } catch (error) {

          console.error(
            '[GROUP CALL offer]',
            error
          );


          if (alive(c)) {

            status.textContent =
              'Connexion à un participant impossible.';
          }
        }
      }
    );


    /*
     * =======================================================
     * RÉPONSE WEBRTC GROUPE
     * =======================================================
     */

    socket.on(
      'group-webrtc:answer',
      async payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'group' ||

          c.id !==
            payload.callId ||

          !alive(c) ||

          !payload.fromUserId ||

          payload
            .description
            ?.type !==
              'answer'
        ) {

          return;
        }


        const peer =
          c.peers.get(
            payload.fromUserId
          );


        if (!peer) {
          return;
        }


        try {

          await peer.pc
            .setRemoteDescription(
              payload.description
            );


          await flushGroupIce(
            c,
            payload.fromUserId
          );

        } catch (error) {

          console.error(
            '[GROUP CALL answer]',
            error
          );


          status.textContent =
            'Connexion à un participant impossible.';
        }
      }
    );


    /*
     * =======================================================
     * CANDIDAT ICE GROUPE
     * =======================================================
     */

    socket.on(
      'group-webrtc:ice-candidate',
      async payload => {

        const c =
          call;


        if (
          !c ||

          c.scope !==
            'group' ||

          c.id !==
            payload.callId ||

          !alive(c) ||

          !payload.fromUserId ||

          !payload.candidate
        ) {

          return;
        }


        pendingIceFor(
          c,
          payload.fromUserId
        ).push(
          payload.candidate
        );


        await flushGroupIce(
          c,
          payload.fromUserId
        );
      }
    );
  }


  /*
   * =========================================================
   * APPEL PRIVÉ SORTANT
   * =========================================================
   */

  async function startPrivateCall(
    kind
  ) {

    if (
      call ||

      conversation?.kind !==
        'private' ||

      !selectedUser?.id
    ) {

      return;
    }


    try {

      connectSignaling();

    } catch (error) {

      alert(
        error.message
      );


      return;
    }


    if (
      !socket.connected
    ) {

      alert(
        'Connexion au serveur en cours. ' +
        'Réessayez dans quelques secondes.'
      );


      return;
    }


    const c =
      newCall({
        scope:
          'private',

        kind,

        direction:
          'outgoing',

        conversationId:
          conversation.id,

        user:
          selectedUser,
      });


    call =
      c;


    show(
      c,

      kind === 'video'

        ? (
            'Préparation de la caméra ' +
            'et du microphone…'
          )

        : 'Préparation du microphone…'
    );


    controls(
      'waiting'
    );


    unlockAudio();


    try {

      await prepareMedia(
        c
      );


      if (!alive(c)) {
        return;
      }


      controls(
        'waiting'
      );


      status.textContent =
        'Appel…';


      socket
        .timeout(
          6000
        )
        .emit(
          'call:invite',

          {
            conversationId:
              c.conversationId,

            targetUserId:
              c.user.id,

            kind:
              c.kind,
          },

          (
            error,
            response
          ) => {

            if (!alive(c)) {

              if (
                response?.ok
              ) {

                socket?.emit(
                  'call:hangup',
                  {
                    callId:
                      response.callId,
                  }
                );
              }

              return;
            }


            if (
              error ||
              !response?.ok
            ) {

              end(
                c,

                response?.error ||
                'Serveur d’appel sans réponse.'
              );


              return;
            }


            c.id =
              response.callId;


            status.textContent =
              'Appel envoyé…';


            ringtone(
              false
            );
          }
        );

    } catch (error) {

      if (alive(c)) {

        end(
          c,
          mediaError(error),
          true
        );
      }
    }
  }


  /*
   * =========================================================
   * APPEL GROUPE SORTANT
   * =========================================================
   */

  async function startGroupCall(
    kind
  ) {

    if (
      call ||

      conversation?.kind !==
        'group' ||

      !conversation?.id
    ) {

      return;
    }


    try {

      connectSignaling();

    } catch (error) {

      alert(
        error.message
      );


      return;
    }


    if (
      !socket.connected
    ) {

      alert(
        'Connexion au serveur en cours. ' +
        'Réessayez dans quelques secondes.'
      );


      return;
    }


    const c =
      newCall({
        scope:
          'group',

        kind,

        direction:
          'outgoing',

        conversationId:
          conversation.id,

        groupTitle:
          conversation.title ||
          selectedUser?.displayName ||
          selectedUser?.username ||
          'Groupe',

        user:
          selectedUser,
      });


    call =
      c;


    show(
      c,

      kind === 'video'

        ? (
            'Préparation de la caméra ' +
            'et du microphone…'
          )

        : 'Préparation du microphone…'
    );


    controls(
      'waiting'
    );


    unlockAudio();


    try {

      await prepareMedia(
        c
      );


      if (!alive(c)) {
        return;
      }


      renderLocalGroupParticipant(
        c
      );


      status.textContent =
        'Invitation des membres du groupe…';


      socket
        .timeout(
          6000
        )
        .emit(
          'group-call:invite',

          {
            conversationId:
              c.conversationId,

            kind:
              c.kind,
          },

          (
            error,
            response
          ) => {

            if (!alive(c)) {

              if (
                response?.ok
              ) {

                socket?.emit(
                  'group-call:leave',
                  {
                    callId:
                      response.callId,

                    reason:
                      'cancelled',
                  }
                );
              }

              return;
            }


            if (
              error ||
              !response?.ok
            ) {

              end(
                c,

                response?.error ||
                'Serveur d’appel sans réponse.'
              );


              return;
            }


            c.id =
              response.callId;


            c.joined =
              true;


            c.accepted =
              true;


            c.groupTitle =

              response.groupTitle ||
              c.groupTitle;


            status.textContent =

              response.invitedCount >
              1

                ? (
                    `${response.invitedCount} ` +
                    'membres appelés…'
                  )

                : '1 membre appelé…';


            ringtone(
              false
            );
          }
        );

    } catch (error) {

      if (alive(c)) {

        end(
          c,
          mediaError(error),
          true
        );
      }
    }
  }


  /*
   * =========================================================
   * CHOISIR APPEL PRIVÉ OU GROUPE
   * =========================================================
   */

  async function startCall(
    kind
  ) {

    if (
      conversation?.kind ===
      'group'
    ) {

      await startGroupCall(
        kind
      );


      return;
    }


    await startPrivateCall(
      kind
    );
  }


  /*
   * =========================================================
   * ACCEPTER
   * =========================================================
   */

  el('accept-call-button')
    .addEventListener(
      'click',
      async () => {

        const c =
          call;


        if (
          !c ||

          c.direction !==
            'incoming' ||

          c.accepting ||

          !alive(c)
        ) {

          return;
        }


        c.accepting =
          true;


        el('accept-call-button')
          .disabled =
            true;


        stopRingtone();

        unlockAudio();


        status.textContent =
          'Préparation des médias…';


        try {

          await prepareMedia(
            c
          );


          if (!alive(c)) {
            return;
          }


          controls(
            'waiting'
          );


          status.textContent =
            'Connexion…';


          if (
            c.scope ===
            'group'
          ) {

            socket.emit(
              'group-call:accept',
              {
                callId:
                  c.id,
              }
            );

          } else {

            c.accepted =
              true;


            socket.emit(
              'call:accept',
              {
                callId:
                  c.id,
              }
            );
          }

        } catch (error) {

          if (!alive(c)) {
            return;
          }


          if (
            c.scope ===
            'group'
          ) {

            socket.emit(
              'group-call:reject',
              {
                callId:
                  c.id,
              }
            );

          } else {

            socket.emit(
              'call:reject',
              {
                callId:
                  c.id,
              }
            );
          }


          end(
            c,
            mediaError(error)
          );
        }
      }
    );


  /*
   * =========================================================
   * REFUSER
   * =========================================================
   */

  el('reject-call-button')
    .addEventListener(
      'click',
      () => {

        if (!call) {
          return;
        }


        if (
          call.scope ===
          'group'
        ) {

          socket?.emit(
            'group-call:reject',
            {
              callId:
                call.id,
            }
          );

        } else {

          socket?.emit(
            'call:reject',
            {
              callId:
                call.id,
            }
          );
        }


        cleanup();
      }
    );


  /*
   * =========================================================
   * RACCROCHER
   * =========================================================
   */

  el('hangup-call-button')
    .addEventListener(
      'click',
      () => {

        if (!call) {
          return;
        }


        notifyServerCallEnd(
          call,
          'hangup'
        );


        cleanup();
      }
    );


  /*
   * =========================================================
   * MICROPHONE ON / OFF
   * =========================================================
   */

  el('mute-call-button')
    .addEventListener(
      'click',
      () => {

        if (
          !call?.stream
        ) {

          return;
        }


        call.micOff =
          !call.micOff;


        call.stream
          .getAudioTracks()
          .forEach(
            track => {

              track.enabled =
                !call.micOff;
            }
          );


        updateMediaButtons(
          call
        );
      }
    );


  /*
   * =========================================================
   * CAMÉRA ON / OFF
   * =========================================================
   */

  el('camera-call-button')
    .addEventListener(
      'click',
      () => {

        if (
          !call?.stream ||

          call.kind !==
          'video'
        ) {

          return;
        }


        call.cameraOff =
          !call.cameraOff;


        call.stream
          .getVideoTracks()
          .forEach(
            track => {

              track.enabled =
                !call.cameraOff;
            }
          );


        updateMediaButtons(
          call
        );
      }
    );


  /*
   * =========================================================
   * CONVERSATION SÉLECTIONNÉE
   * =========================================================
   */

  window.addEventListener(
    'conversation:selected',
    event => {

      conversation =
        event.detail
          ?.conversation ||
        null;


      selectedUser =
        event.detail
          ?.user ||
        null;


      updateButtons();
    }
  );


  /*
   * =========================================================
   * AUTHENTIFICATION
   * =========================================================
   */

  window.addEventListener(
    'auth:changed',
    event => {

      if (
        event.detail?.user
      ) {

        currentUser =
          event.detail.user;


        connectSignaling();

      } else {

        if (
          call?.id
        ) {

          notifyServerCallEnd(
            call,
            'logout'
          );
        }


        cleanup();


        socket
          ?.removeAllListeners();


        socket
          ?.disconnect();


        socket =
          null;


        currentUser =
          null;


        conversation =
          null;


        selectedUser =
          null;


        updateButtons();
      }
    }
  );


  /*
   * =========================================================
   * FERMETURE DE PAGE
   * =========================================================
   */

  window.addEventListener(
    'pagehide',
    () => {

      if (
        call?.id
      ) {

        notifyServerCallEnd(
          call,
          'pagehide'
        );
      }


      cleanup();
    }
  );


  /*
   * =========================================================
   * BOUTONS PRINCIPAUX
   * =========================================================
   */

  audioButton
    ?.addEventListener(
      'click',
      () =>
        startCall(
          'audio'
        )
    );


  videoButton
    ?.addEventListener(
      'click',
      () =>
        startCall(
          'video'
        )
    );


  updateButtons();

})();