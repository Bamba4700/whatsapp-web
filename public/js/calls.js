(() => {
  'use strict';


  const conversationCard =
    document.getElementById(
      'conversation-card'
    );

  const audioCallButton =
    document.getElementById(
      'audio-call-button'
    );

  const videoCallButton =
    document.getElementById(
      'video-call-button'
    );


  /*
   * =========================================================
   * CHARGER calls.css AUTOMATIQUEMENT
   * =========================================================
   */

  function ensureCallsStyles() {

    if (
      document.querySelector(
        'link[data-calls-css]'
      )
    ) {
      return;
    }


    const link =
      document.createElement(
        'link'
      );


    link.rel =
      'stylesheet';

    link.href =
      '/css/calls.css';

    link.dataset.callsCss =
      'true';


    document.head.appendChild(
      link
    );
  }


  ensureCallsStyles();


  /*
   * =========================================================
   * ÉTAT
   * =========================================================
   */

  let socket =
    null;


  let selectedConversation =
    null;

  let selectedUser =
    null;


  let incomingCall =
    null;

  let currentCall =
    null;


  let localStream =
    null;

  let peerConnection =
    null;


  let pendingIceCandidates =
    [];


  let callTimerInterval =
    null;

  let callStartedAt =
    null;


  let microphoneMuted =
    false;

  let forcedChatVisible =
    false;


  /*
   * Animation voix.
   */
  let activityContext =
    null;

  let activityAnalyser =
    null;

  let activitySource =
    null;

  let activityAnimation =
    null;


  /*
   * Sonnerie.
   */
  let toneContext =
    null;

  let toneInterval =
    null;

  let toneTimeouts =
    [];


  /*
   * =========================================================
   * WEBRTC
   * =========================================================
   */

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


  /*
   * =========================================================
   * INTERFACE
   * =========================================================
   */

  const callStage =
    document.createElement(
      'section'
    );


  callStage.id =
    'call-stage';


  callStage.className =
    'call-stage hidden';


  callStage.innerHTML = `

    <div class="call-experience">


      <div class="call-kind">
        Appel audio
      </div>


      <div
        id="call-avatar-shell"
        class="call-avatar-shell"
      >

        <span
          class="
            call-pulse-ring
            call-pulse-ring-one
          "
        ></span>

        <span
          class="
            call-pulse-ring
            call-pulse-ring-two
          "
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
      >
        Utilisateur
      </h2>


      <p
        id="call-status-text"
        class="call-status-text"
      >
        Appel…
      </p>


      <div
        id="call-duration"
        class="call-duration hidden"
      >
        00:00
      </div>


      <audio
        id="remote-call-audio"
        autoplay
        playsinline
      ></audio>


      <div
        id="incoming-call-controls"
        class="call-controls hidden"
      >

        <div class="call-control-item">

          <button
            id="reject-call-button"
            type="button"
            class="
              big-call-button
              call-reject
            "
            aria-label="Refuser"
            title="Refuser"
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
            class="
              big-call-button
              call-accept
            "
            aria-label="Accepter"
            title="Accepter"
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


      <div
        id="active-call-controls"
        class="call-controls hidden"
      >

        <div
          id="mute-control-item"
          class="
            call-control-item
            hidden
          "
        >

          <button
            id="mute-call-button"
            type="button"
            class="
              big-call-button
              call-secondary
            "
            aria-label="Couper le microphone"
            title="Couper le microphone"
          >

            <span class="material-symbols-rounded">
              mic
            </span>

          </button>

          <span id="mute-control-label">
            Muet
          </span>

        </div>


        <div class="call-control-item">

          <button
            id="hangup-call-button"
            type="button"
            class="
              big-call-button
              call-reject
            "
            aria-label="Raccrocher"
            title="Raccrocher"
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


  if (
    conversationCard
  ) {

    conversationCard.appendChild(
      callStage
    );
  }


  const avatarShell =
    document.getElementById(
      'call-avatar-shell'
    );

  const avatarLetter =
    document.getElementById(
      'call-avatar-letter'
    );

  const personName =
    document.getElementById(
      'call-person-name'
    );

  const statusText =
    document.getElementById(
      'call-status-text'
    );

  const durationElement =
    document.getElementById(
      'call-duration'
    );

  const remoteAudio =
    document.getElementById(
      'remote-call-audio'
    );


  const incomingControls =
    document.getElementById(
      'incoming-call-controls'
    );

  const activeControls =
    document.getElementById(
      'active-call-controls'
    );


  const acceptButton =
    document.getElementById(
      'accept-call-button'
    );

  const rejectButton =
    document.getElementById(
      'reject-call-button'
    );

  const muteButton =
    document.getElementById(
      'mute-call-button'
    );

  const muteControlItem =
    document.getElementById(
      'mute-control-item'
    );

  const muteControlLabel =
    document.getElementById(
      'mute-control-label'
    );

  const hangupButton =
    document.getElementById(
      'hangup-call-button'
    );


  /*
   * =========================================================
   * OUTILS
   * =========================================================
   */

  function displayName(user) {

    return (
      user?.displayName ||
      user?.username ||
      'Utilisateur'
    );
  }


  function initialOf(user) {

    return (
      displayName(user)
        .trim()
        .charAt(0)
        .toUpperCase() ||
      '?'
    );
  }


  function setPerson(user) {

    personName.textContent =
      displayName(user);


    avatarLetter.textContent =
      initialOf(user);
  }


  function formatDuration(
    totalSeconds
  ) {

    const minutes =
      Math.floor(
        totalSeconds /
        60
      );


    const seconds =
      totalSeconds %
      60;


    return (
      `${String(minutes)
        .padStart(2, '0')}:` +
      `${String(seconds)
        .padStart(2, '0')}`
    );
  }


  /*
   * =========================================================
   * AFFICHAGE APPEL
   * =========================================================
   */

  function showStage() {

    if (
      !conversationCard
    ) {
      return;
    }


    if (
      conversationCard
        .classList
        .contains(
          'hidden'
        )
    ) {

      conversationCard
        .classList
        .remove(
          'hidden'
        );


      forcedChatVisible =
        true;
    }


    callStage
      .classList
      .remove(
        'hidden'
      );
  }


  function hideStage() {

    callStage
      .classList
      .add(
        'hidden'
      );


    if (
      forcedChatVisible &&
      !selectedConversation
    ) {

      conversationCard
        ?.classList
        .add(
          'hidden'
        );
    }


    forcedChatVisible =
      false;
  }


  function showIncomingControls() {

    incomingControls
      .classList
      .remove(
        'hidden'
      );


    activeControls
      .classList
      .add(
        'hidden'
      );


    durationElement
      .classList
      .add(
        'hidden'
      );


    avatarShell
      .classList
      .add(
        'ringing'
      );
  }


  function showWaitingControls() {

    incomingControls
      .classList
      .add(
        'hidden'
      );


    activeControls
      .classList
      .remove(
        'hidden'
      );


    muteControlItem
      .classList
      .add(
        'hidden'
      );


    durationElement
      .classList
      .add(
        'hidden'
      );


    avatarShell
      .classList
      .add(
        'ringing'
      );
  }


  function showActiveControls() {

    incomingControls
      .classList
      .add(
        'hidden'
      );


    activeControls
      .classList
      .remove(
        'hidden'
      );


    muteControlItem
      .classList
      .remove(
        'hidden'
      );


    durationElement
      .classList
      .remove(
        'hidden'
      );


    avatarShell
      .classList
      .remove(
        'ringing'
      );
  }


  /*
   * =========================================================
   * CHRONOMÈTRE
   * =========================================================
   */

  function startTimer() {

    if (
      callTimerInterval
    ) {
      return;
    }


    callStartedAt =
      Date.now();


    durationElement.textContent =
      '00:00';


    callTimerInterval =
      setInterval(
        () => {

          const seconds =
            Math.floor(
              (
                Date.now() -
                callStartedAt
              ) /
              1000
            );


          durationElement.textContent =
            formatDuration(
              seconds
            );

        },
        1000
      );
  }


  function stopTimer() {

    if (
      callTimerInterval
    ) {

      clearInterval(
        callTimerInterval
      );
    }


    callTimerInterval =
      null;


    callStartedAt =
      null;


    durationElement.textContent =
      '00:00';
  }


  /*
   * =========================================================
   * SONNERIE
   * =========================================================
   */

  async function getToneContext() {

    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;


    if (
      !AudioContextClass
    ) {
      return null;
    }


    if (
      !toneContext
    ) {

      toneContext =
        new AudioContextClass();
    }


    if (
      toneContext.state ===
      'suspended'
    ) {

      try {

        await toneContext.resume();

      } catch {

        // Certains navigateurs demandent
        // une première interaction.
      }
    }


    return toneContext;
  }


  async function unlockAudio() {

    try {

      await getToneContext();

    } catch {

      // Rien.
    }
  }


  /*
   * La première interaction dans la page
   * autorise la future sonnerie.
   */
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


  async function playTone(
    frequency,
    duration = 180,
    volume = 0.07
  ) {

    const context =
      await getToneContext();


    if (
      !context ||
      context.state !==
        'running'
    ) {
      return;
    }


    const oscillator =
      context.createOscillator();


    const gain =
      context.createGain();


    oscillator.type =
      'sine';


    oscillator.frequency.value =
      frequency;


    gain.gain.value =
      volume;


    oscillator.connect(
      gain
    );


    gain.connect(
      context.destination
    );


    oscillator.start();


    gain.gain
      .exponentialRampToValueAtTime(
        0.001,

        context.currentTime +
        duration /
        1000
      );


    oscillator.stop(
      context.currentTime +
      duration /
      1000
    );
  }


  function clearToneTimeouts() {

    for (
      const timeout
      of toneTimeouts
    ) {

      clearTimeout(
        timeout
      );
    }


    toneTimeouts =
      [];
  }


  function stopRingtone() {

    if (
      toneInterval
    ) {

      clearInterval(
        toneInterval
      );
    }


    toneInterval =
      null;


    clearToneTimeouts();
  }


  function incomingCycle() {

    playTone(
      880,
      180,
      0.07
    );


    const timeout =
      setTimeout(
        () => {

          playTone(
            660,
            230,
            0.07
          );

        },
        240
      );


    toneTimeouts.push(
      timeout
    );
  }


  function outgoingCycle() {

    playTone(
      440,
      330,
      0.045
    );


    const timeout =
      setTimeout(
        () => {

          playTone(
            480,
            330,
            0.045
          );

        },
        420
      );


    toneTimeouts.push(
      timeout
    );
  }


  function startIncomingRingtone() {

    stopRingtone();

    incomingCycle();


    toneInterval =
      setInterval(
        incomingCycle,
        1500
      );
  }


  function startOutgoingRingtone() {

    stopRingtone();

    outgoingCycle();


    toneInterval =
      setInterval(
        outgoingCycle,
        2600
      );
  }


  /*
   * =========================================================
   * OSCILLATION AUTOUR DE L'INITIALE
   * =========================================================
   */

  function stopVoiceActivity() {

    if (
      activityAnimation
    ) {

      cancelAnimationFrame(
        activityAnimation
      );
    }


    activityAnimation =
      null;


    try {

      activitySource
        ?.disconnect();

    } catch {

      // Rien.
    }


    activitySource =
      null;


    activityAnalyser =
      null;


    if (
      activityContext
    ) {

      try {

        activityContext.close();

      } catch {

        // Rien.
      }
    }


    activityContext =
      null;


    avatarShell.style
      .removeProperty(
        '--voice-scale'
      );


    avatarShell.style
      .removeProperty(
        '--voice-opacity'
      );


    avatarShell
      .classList
      .remove(
        'speaking'
      );
  }


  function startVoiceActivity(
    stream
  ) {

    stopVoiceActivity();


    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;


    if (
      !AudioContextClass
    ) {
      return;
    }


    activityContext =
      new AudioContextClass();


    activityAnalyser =
      activityContext
        .createAnalyser();


    activityAnalyser.fftSize =
      256;


    activityAnalyser
      .smoothingTimeConstant =
      0.82;


    activitySource =
      activityContext
        .createMediaStreamSource(
          stream
        );


    activitySource.connect(
      activityAnalyser
    );


    const values =
      new Uint8Array(
        activityAnalyser
          .frequencyBinCount
      );


    function animate() {

      if (
        !activityAnalyser
      ) {
        return;
      }


      activityAnalyser
        .getByteFrequencyData(
          values
        );


      let total = 0;


      for (
        const value
        of values
      ) {

        total += value;
      }


      const average =
        total /
        values.length;


      const level =
        Math.min(
          1,
          average /
          85
        );


      const scale =
        1.04 +
        level *
        0.34;


      const opacity =
        0.12 +
        level *
        0.35;


      avatarShell.style
        .setProperty(
          '--voice-scale',
          String(scale)
        );


      avatarShell.style
        .setProperty(
          '--voice-opacity',
          String(opacity)
        );


      avatarShell
        .classList
        .toggle(
          'speaking',
          level > 0.08
        );


      activityAnimation =
        requestAnimationFrame(
          animate
        );
    }


    animate();
  }


  /*
   * =========================================================
   * MICROPHONE
   * =========================================================
   */

  async function requestMicrophone() {

    if (
      localStream
    ) {
      return localStream;
    }


    if (
      !navigator.mediaDevices
        ?.getUserMedia
    ) {

      throw new Error(
        'Microphone indisponible.'
      );
    }


    localStream =
      await navigator
        .mediaDevices
        .getUserMedia({

          audio: {

            echoCancellation:
              true,

            noiseSuppression:
              true,

            autoGainControl:
              true,
          },

          video:
            false,
        });


    return localStream;
  }


  function stopLocalMedia() {

    if (
      !localStream
    ) {
      return;
    }


    for (
      const track
      of localStream
        .getTracks()
    ) {

      track.stop();
    }


    localStream =
      null;
  }


  /*
   * =========================================================
   * RTCPeerConnection
   * =========================================================
   */

  async function createPeerConnection() {

    if (
      peerConnection
    ) {
      return peerConnection;
    }


    await requestMicrophone();


    peerConnection =
      new RTCPeerConnection(
        rtcConfiguration
      );


    for (
      const track
      of localStream
        .getTracks()
    ) {

      peerConnection.addTrack(
        track,
        localStream
      );
    }


    /*
     * AUDIO DISTANT.
     */
    peerConnection.ontrack =
      async (event) => {

        const stream =
          event.streams?.[0];


        if (!stream) {
          return;
        }


        remoteAudio.srcObject =
          stream;


        /*
         * La voix distante pilote
         * les anneaux autour de l'initiale.
         */
        startVoiceActivity(
          stream
        );


        try {

          await remoteAudio.play();

        } catch (error) {

          console.warn(
            'Lecture audio distante :',
            error
          );
        }
      };


    /*
     * ICE LOCAL.
     */
    peerConnection.onicecandidate =
      (event) => {

        if (
          !event.candidate ||
          !currentCall?.callId
        ) {
          return;
        }


        socket?.emit(
          'webrtc:ice-candidate',
          {
            callId:
              currentCall.callId,

            candidate:
              event.candidate,
          }
        );
      };


    peerConnection
      .onconnectionstatechange =
      () => {

        const state =
          peerConnection
            ?.connectionState;


        console.log(
          '[WebRTC]',
          state
        );


        if (
          state ===
          'connecting'
        ) {

          statusText.textContent =
            'Connexion…';
        }


        if (
          state ===
          'connected'
        ) {

          stopRingtone();


          statusText.textContent =
            'En ligne';


          showActiveControls();


          startTimer();
        }


        if (
          state ===
          'disconnected'
        ) {

          statusText.textContent =
            'Connexion interrompue…';
        }


        if (
          state ===
          'failed'
        ) {

          statusText.textContent =
            'Connexion impossible';


          setTimeout(
            () => {

              finishCall(
                true,
                'failed'
              );

            },
            1200
          );
        }
      };


    return peerConnection;
  }


  async function flushPendingIce() {

    if (
      !peerConnection ||
      !peerConnection
        .remoteDescription
    ) {
      return;
    }


    const candidates =
      pendingIceCandidates;


    pendingIceCandidates =
      [];


    for (
      const candidate
      of candidates
    ) {

      try {

        await peerConnection
          .addIceCandidate(
            candidate
          );

      } catch (error) {

        console.error(
          'ICE :',
          error
        );
      }
    }
  }


  /*
   * =========================================================
   * NETTOYAGE
   * =========================================================
   */

  function closePeerConnection() {

    if (
      peerConnection
    ) {

      try {

        peerConnection.ontrack =
          null;


        peerConnection
          .onicecandidate =
          null;


        peerConnection
          .onconnectionstatechange =
          null;


        peerConnection.close();

      } catch {

        // Rien.
      }
    }


    peerConnection =
      null;


    pendingIceCandidates =
      [];


    remoteAudio.srcObject =
      null;
  }


  function cleanupCall() {

    stopRingtone();

    stopTimer();

    stopVoiceActivity();

    closePeerConnection();

    stopLocalMedia();


    incomingCall =
      null;


    currentCall =
      null;


    microphoneMuted =
      false;


    const muteIcon =
      muteButton
        ?.querySelector(
          '.material-symbols-rounded'
        );


    if (
      muteIcon
    ) {

      muteIcon.textContent =
        'mic';
    }


    if (
      muteControlLabel
    ) {

      muteControlLabel.textContent =
        'Muet';
    }


    muteButton
      ?.classList
      .remove(
        'muted'
      );


    avatarShell
      ?.classList
      .remove(
        'ringing',
        'speaking'
      );


    hideStage();
  }


  function finishCall(
    notifyServer,
    reason = 'hangup'
  ) {

    const callId =
      currentCall?.callId ||
      incomingCall?.callId;


    if (
      notifyServer &&
      callId
    ) {

      socket?.emit(
        'call:hangup',
        {
          callId,

          reason,
        }
      );
    }


    cleanupCall();
  }


  /*
   * =========================================================
   * SOCKET SIGNALISATION
   * =========================================================
   */

  function connectSignaling() {

    if (
      socket?.connected
    ) {
      return;
    }


    if (
      typeof io !==
      'function'
    ) {
      return;
    }


    if (
      socket
    ) {

      socket.removeAllListeners();

      socket.disconnect();
    }


    socket =
      io();


    socket.on(
      'connect',
      () => {

        console.log(
          '[CALL] socket connecté'
        );
      }
    );


    /*
     * =====================================================
     * APPEL ENTRANT
     * =====================================================
     */

    socket.on(
      'call:incoming',
      (payload) => {

        console.log(
          '[CALL] appel entrant',
          payload
        );


        if (
          incomingCall ||
          currentCall
        ) {

          socket.emit(
            'call:reject',
            {
              callId:
                payload.callId,
            }
          );


          return;
        }


        incomingCall =
          payload;


        setPerson(
          payload.caller
        );


        statusText.textContent =
          'Appel audio entrant';


        showStage();

        showIncomingControls();

        startIncomingRingtone();


        socket.emit(
          'call:ringing',
          {
            callId:
              payload.callId,
          }
        );
      }
    );


    /*
     * LE DESTINATAIRE SONNE.
     */
    socket.on(
      'call:ringing',
      (payload) => {

        if (
          currentCall?.callId !==
          payload.callId
        ) {
          return;
        }


        statusText.textContent =
          'Ça sonne…';


        startOutgoingRingtone();
      }
    );


    /*
     * ACCEPTÉ.
     */
    socket.on(
      'call:accepted',
      async (payload) => {

        if (
          currentCall?.callId !==
          payload.callId
        ) {
          return;
        }


        stopRingtone();


        statusText.textContent =
          'Connexion…';


        try {

          const pc =
            await createPeerConnection();


          const offer =
            await pc.createOffer();


          await pc
            .setLocalDescription(
              offer
            );


          socket.emit(
            'webrtc:offer',
            {
              callId:
                currentCall.callId,

              description:
                pc.localDescription,
            }
          );


        } catch (error) {

          console.error(
            '[CALL accepted]',
            error
          );


          statusText.textContent =
            'Impossible d’établir l’appel';


          setTimeout(
            () => {

              finishCall(
                true,
                'media-error'
              );

            },
            1000
          );
        }
      }
    );


    /*
     * REFUSÉ.
     */
    socket.on(
      'call:rejected',
      (payload) => {

        if (
          currentCall?.callId !==
          payload.callId
        ) {
          return;
        }


        stopRingtone();


        statusText.textContent =
          'Appel refusé';


        avatarShell
          .classList
          .remove(
            'ringing'
          );


        setTimeout(
          cleanupCall,
          1200
        );
      }
    );


    /*
     * PAS DE RÉPONSE.
     */
    socket.on(
      'call:missed',
      (payload) => {

        if (
          currentCall?.callId !==
          payload.callId
        ) {
          return;
        }


        stopRingtone();


        statusText.textContent =
          'Pas de réponse';


        avatarShell
          .classList
          .remove(
            'ringing'
          );


        setTimeout(
          cleanupCall,
          1500
        );
      }
    );


    /*
     * OFFER.
     */
    socket.on(
      'webrtc:offer',
      async (payload) => {

        if (
          currentCall?.callId !==
          payload.callId
        ) {
          return;
        }


        try {

          const pc =
            await createPeerConnection();


          await pc
            .setRemoteDescription(
              payload.description
            );


          await flushPendingIce();


          const answer =
            await pc.createAnswer();


          await pc
            .setLocalDescription(
              answer
            );


          socket.emit(
            'webrtc:answer',
            {
              callId:
                currentCall.callId,

              description:
                pc.localDescription,
            }
          );


        } catch (error) {

          console.error(
            'WebRTC offer :',
            error
          );


          finishCall(
            true,
            'webrtc-error'
          );
        }
      }
    );


    /*
     * ANSWER.
     */
    socket.on(
      'webrtc:answer',
      async (payload) => {

        if (
          currentCall?.callId !==
            payload.callId ||
          !peerConnection
        ) {
          return;
        }


        try {

          await peerConnection
            .setRemoteDescription(
              payload.description
            );


          await flushPendingIce();


        } catch (error) {

          console.error(
            'WebRTC answer :',
            error
          );
        }
      }
    );


    /*
     * ICE.
     */
    socket.on(
      'webrtc:ice-candidate',
      async (payload) => {

        if (
          currentCall?.callId !==
            payload.callId ||
          !payload.candidate
        ) {
          return;
        }


        if (
          peerConnection
            ?.remoteDescription
        ) {

          try {

            await peerConnection
              .addIceCandidate(
                payload.candidate
              );

          } catch (error) {

            console.error(
              'ICE :',
              error
            );
          }

        } else {

          pendingIceCandidates.push(
            payload.candidate
          );
        }
      }
    );


    /*
     * AUTRE UTILISATEUR RACCROCHE.
     */
    socket.on(
      'call:ended',
      (payload) => {

        const callId =
          currentCall?.callId ||
          incomingCall?.callId;


        if (
          callId !==
          payload.callId
        ) {
          return;
        }


        stopRingtone();


        statusText.textContent =
          payload.reason ===
            'timeout'
            ? 'Appel manqué'
            : 'Appel terminé';


        avatarShell
          .classList
          .remove(
            'ringing',
            'speaking'
          );


        setTimeout(
          cleanupCall,
          900
        );
      }
    );


    socket.on(
      'connect_error',
      (error) => {

        console.error(
          '[CALL socket]',
          error.message
        );
      }
    );
  }


  /*
   * =========================================================
   * APPEL SORTANT
   * =========================================================
   */

  async function startAudioCall() {

    if (
      !selectedConversation ||
      selectedConversation.kind !==
        'private' ||
      !selectedUser?.id
    ) {
      return;
    }


    if (
      currentCall ||
      incomingCall
    ) {
      return;
    }


    connectSignaling();

    await unlockAudio();


    setPerson(
      selectedUser
    );


    statusText.textContent =
      'Préparation de l’appel…';


    showStage();

    showWaitingControls();


    try {

      await requestMicrophone();


      statusText.textContent =
        'Appel…';


      socket
        .timeout(
          6000
        )
        .emit(
          'call:invite',

          {
            conversationId:
              selectedConversation.id,

            targetUserId:
              selectedUser.id,

            kind:
              'audio',
          },

          (
            error,
            response
          ) => {

            if (error) {

              statusText.textContent =
                'Serveur d’appel indisponible';


              setTimeout(
                cleanupCall,
                1400
              );


              return;
            }


            if (
              !response?.ok
            ) {

              statusText.textContent =
                response?.error ||
                'Impossible de lancer l’appel.';


              setTimeout(
                cleanupCall,
                1700
              );


              return;
            }


            currentCall = {

              callId:
                response.callId,

              conversationId:
                selectedConversation.id,

              targetUserId:
                selectedUser.id,

              direction:
                'outgoing',

              kind:
                'audio',
            };


            statusText.textContent =
              'Appel envoyé…';
          }
        );


    } catch (error) {

      console.error(
        'Microphone :',
        error
      );


      if (
        error.name ===
        'NotAllowedError'
      ) {

        statusText.textContent =
          'Accès au microphone refusé';

      } else if (
        error.name ===
        'NotFoundError'
      ) {

        statusText.textContent =
          'Aucun microphone détecté';

      } else {

        statusText.textContent =
          'Microphone indisponible';
      }


      setTimeout(
        cleanupCall,
        1600
      );
    }
  }


  /*
   * =========================================================
   * ACCEPTER
   * =========================================================
   */

  acceptButton
    ?.addEventListener(
      'click',

      async () => {

        if (
          !incomingCall
        ) {
          return;
        }


        const call =
          incomingCall;


        stopRingtone();

        await unlockAudio();


        statusText.textContent =
          'Préparation du microphone…';


        try {

          await requestMicrophone();


          currentCall = {

            callId:
              call.callId,

            conversationId:
              call.conversationId,

            targetUserId:
              call.caller.id,

            direction:
              'incoming',

            kind:
              'audio',
          };


          incomingCall =
            null;


          statusText.textContent =
            'Connexion…';


          showWaitingControls();


          await createPeerConnection();


          socket.emit(
            'call:accept',
            {
              callId:
                currentCall.callId,
            }
          );


        } catch (error) {

          console.error(
            error
          );


          socket.emit(
            'call:reject',
            {
              callId:
                call.callId,
            }
          );


          statusText.textContent =
            'Microphone indisponible';


          setTimeout(
            cleanupCall,
            1300
          );
        }
      }
    );


  /*
   * =========================================================
   * REFUSER
   * =========================================================
   */

  rejectButton
    ?.addEventListener(
      'click',
      () => {

        if (
          !incomingCall
        ) {
          return;
        }


        stopRingtone();


        socket.emit(
          'call:reject',
          {
            callId:
              incomingCall.callId,
          }
        );


        cleanupCall();
      }
    );


  /*
   * =========================================================
   * RACCROCHER
   * =========================================================
   */

  hangupButton
    ?.addEventListener(
      'click',
      () => {

        finishCall(
          true,
          'hangup'
        );
      }
    );


  /*
   * =========================================================
   * MUET
   * =========================================================
   */

  muteButton
    ?.addEventListener(
      'click',
      () => {

        if (
          !localStream
        ) {
          return;
        }


        microphoneMuted =
          !microphoneMuted;


        for (
          const track
          of localStream
            .getAudioTracks()
        ) {

          track.enabled =
            !microphoneMuted;
        }


        const icon =
          muteButton
            .querySelector(
              '.material-symbols-rounded'
            );


        if (icon) {

          icon.textContent =
            microphoneMuted
              ? 'mic_off'
              : 'mic';
        }


        muteControlLabel.textContent =
          microphoneMuted
            ? 'Réactiver'
            : 'Muet';


        muteButton
          .classList
          .toggle(
            'muted',
            microphoneMuted
          );
      }
    );


  /*
   * =========================================================
   * CONVERSATION OUVERTE
   * =========================================================
   */

  window.addEventListener(
    'conversation:selected',
    (event) => {

      selectedConversation =
        event.detail
          ?.conversation ||
        null;


      selectedUser =
        event.detail
          ?.user ||
        null;


      const privateConversation =
        selectedConversation
          ?.kind ===
          'private' &&
        Boolean(
          selectedUser?.id
        );


      if (
        audioCallButton
      ) {

        audioCallButton.disabled =
          !privateConversation;
      }


      if (
        videoCallButton
      ) {

        videoCallButton.disabled =
          true;
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

      if (
        event.detail?.user
      ) {

        connectSignaling();

      } else {

        finishCall(
          false
        );


        socket
          ?.removeAllListeners();


        socket
          ?.disconnect();


        socket =
          null;


        if (
          audioCallButton
        ) {

          audioCallButton.disabled =
            true;
        }


        if (
          videoCallButton
        ) {

          videoCallButton.disabled =
            true;
        }
      }
    }
  );


  audioCallButton
    ?.addEventListener(
      'click',
      startAudioCall
    );

})();