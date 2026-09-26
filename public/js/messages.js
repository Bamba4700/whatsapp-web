(() => {
  'use strict';

  const card = document.getElementById('conversation-card');
  const title = document.getElementById('conversation-title');
  const status = document.getElementById('conversation-status');
  const list = document.getElementById('messages-list');
  const form = document.getElementById('message-form');
  const input = document.getElementById('message-input');
  const sendButton = document.getElementById('send-message');
  const fileInput = document.getElementById('file-input');
  const chooseFileButton = document.getElementById('choose-file');
  const selectedFileName = document.getElementById('selected-file-name');
  const stickerButton = document.getElementById('sticker-button');
  const stickerPanel = document.getElementById('sticker-panel');
  const voiceButton = document.getElementById('voice-button');
  const composer = document.querySelector('.chat-composer');

  function ensureMediaStyles() {
    if (document.querySelector('link[data-media-ui]')) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/media-ui.css';
    link.dataset.mediaUi = 'true';
    document.head.appendChild(link);
  }

  ensureMediaStyles();

  if (input) input.required = false;

  let activeConversation = null;
  let activeUser = null;
  let loadingController = null;
  let socket = null;

  const renderedMessageIds = new Set();

  let sending = false;
  let readingFile = false;
  let fileSelectionVersion = 0;
  let activeFileReader = null;
  let pendingFile = null;
  let pendingFileUrl = null;

  let mediaRecorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let recordingStartedAt = 0;
  let recordingTimer = null;
  let shouldUploadRecording = false;

  let audioContext = null;
  let analyser = null;
  let analyserSource = null;
  let waveformAnimation = null;

  const MAX_VOICE_DURATION = 10 * 60 * 1000;

  const attachmentPreview = document.createElement('div');
  attachmentPreview.id = 'attachment-inline-preview';
  attachmentPreview.className = 'attachment-inline-preview hidden';

  if (form && input) {
    form.insertBefore(attachmentPreview, input);
  }

  const recordingUi = document.createElement('div');
  recordingUi.id = 'voice-recording-ui';
  recordingUi.className = 'voice-recording-ui hidden';

  if (composer && form) {
    composer.insertBefore(recordingUi, form);
  }

  if (selectedFileName) {
    selectedFileName.textContent = '';
    selectedFileName.classList.add('legacy-selected-file');
  }

  // OUTILS

  async function readJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(
        text || `Réponse serveur invalide (${response.status}).`
      );
    }

    return response.json();
  }

  async function getCsrfToken() {
    const response = await fetch('/api/auth/csrf', {
      credentials: 'same-origin',
      cache: 'no-store',
    });

    const data = await readJsonResponse(response);

    if (!response.ok || !data.csrfToken) {
      throw new Error(
        data.error || 'Impossible de préparer la requête.'
      );
    }

    return data.csrfToken;
  }

  function formatFileSize(bytes) {
    const value = Number(bytes);

    if (!Number.isFinite(value)) return '';
    if (value < 1024) return `${value} octets`;

    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} Ko`;
    }

    return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(milliseconds) / 1000)
    );

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function isImage(mimeType) {
    return [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ].includes(mimeType);
  }

  function notifyActivity(message) {
    window.dispatchEvent(
      new CustomEvent('conversation:activity', {
        detail: { message },
      })
    );
  }

  // BOUTONS DU FORMULAIRE

  function syncComposerAction() {
    const hasText = Boolean(input?.value.trim());
    const hasFile = Boolean(pendingFile);
    const recording = mediaRecorder?.state === 'recording';

    if (recording) return;

    const canSend = hasText || hasFile;

    if (sendButton) {
      sendButton.disabled = sending || readingFile;
    }

    if (chooseFileButton) {
      chooseFileButton.disabled = sending;
    }

    if (voiceButton) {
      voiceButton.disabled = sending || readingFile;
    }

    voiceButton?.classList.toggle('hidden', canSend);
    sendButton?.classList.toggle('hidden', !canSend);
  }

  for (const button of [
    chooseFileButton,
    voiceButton,
    stickerButton,
  ]) {
    if (button) button.type = 'button';
  }

  if (sendButton) sendButton.type = 'submit';

  // PIÈCE JOINTE

  function clearPendingFile() {
    fileSelectionVersion += 1;

    activeFileReader?.abort();
    activeFileReader = null;
    readingFile = false;
    pendingFile = null;

    if (pendingFileUrl) {
      URL.revokeObjectURL(pendingFileUrl);
      pendingFileUrl = null;
    }

    if (fileInput) fileInput.value = '';

    attachmentPreview.replaceChildren();
    attachmentPreview.classList.add('hidden');
    form?.classList.remove('has-attachment');

    syncComposerAction();
  }

  function renderPendingFile(file) {
    attachmentPreview.replaceChildren();
    attachmentPreview.classList.remove('hidden');
    form?.classList.add('has-attachment');

    const content = document.createElement('div');
    content.className = 'attachment-inline-content';

    if (isImage(file.type)) {
      pendingFileUrl = URL.createObjectURL(file);

      const image = document.createElement('img');
      image.className = 'attachment-inline-image';
      image.src = pendingFileUrl;
      image.alt = file.name;

      content.appendChild(image);
    } else {
      const icon = document.createElement('div');
      icon.className = 'attachment-inline-icon';
      icon.innerHTML = `
        <span class="material-symbols-rounded">description</span>
      `;
      content.appendChild(icon);
    }

    const info = document.createElement('div');
    info.className = 'attachment-inline-info';

    const name = document.createElement('strong');
    name.textContent = file.name;

    const size = document.createElement('span');
    size.textContent = formatFileSize(file.size);

    info.appendChild(name);
    info.appendChild(size);
    content.appendChild(info);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attachment-inline-remove';
    remove.title = 'Retirer le fichier';
    remove.setAttribute('aria-label', 'Retirer le fichier');
    remove.innerHTML = `
      <span class="material-symbols-rounded">close</span>
    `;

    remove.addEventListener('click', () => {
      if (!sending) clearPendingFile();
    });

    attachmentPreview.appendChild(content);
    attachmentPreview.appendChild(remove);

    syncComposerAction();
  }

  // Lire le fichier immédiatement après sa sélection.
  // Le fichier envoyé sera ensuite une copie en mémoire.

  function readSelectedFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      activeFileReader = reader;

      let finished = false;

      const finish = (error, bytes) => {
        if (finished) return;
        finished = true;

        clearTimeout(timer);

        if (activeFileReader === reader) {
          activeFileReader = null;
        }

        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;

        if (error) reject(error);
        else resolve(bytes);
      };

      const timer = setTimeout(() => {
        finish(new Error(
          'Lecture locale sans réponse après 15 secondes. ' +
          'Aucun fichier envoyé.'
        ));
        reader.abort();
      }, 15000);

      reader.onload = () => {
        const bytes = reader.result;

        if (
          !(bytes instanceof ArrayBuffer) ||
          bytes.byteLength !== file.size
        ) {
          finish(new Error(
            'Lecture locale incomplète. Aucun fichier envoyé.'
          ));
        } else {
          finish(null, bytes);
        }
      };

      reader.onerror = () => {
        console.error('[FICHIER] Lecture locale', reader.error);

        finish(new Error(
          'Le navigateur ne peut pas lire ce fichier (' +
          (reader.error?.name || 'erreur de lecture') +
          '). Copiez-le dans Téléchargements sur la machine ' +
          'du navigateur, puis sélectionnez-le à nouveau.'
        ));
      };

      reader.onabort = () => {
        finish(new Error(
          'Lecture locale annulée. Aucun fichier envoyé.'
        ));
      };

      try {
        reader.readAsArrayBuffer(file);
      } catch (error) {
        finish(new Error(
          'Lecture locale impossible : ' + error.message
        ));
      }
    });
  }

  chooseFileButton?.addEventListener('click', (event) => {
    event.preventDefault();

    if (!activeConversation || sending || readingFile) return;

    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];

    if (!file || sending) return;

    // Garder le sélecteur intact pendant la lecture.
    const version = ++fileSelectionVersion;

    activeFileReader?.abort();
    pendingFile = null;

    if (pendingFileUrl) {
      URL.revokeObjectURL(pendingFileUrl);
    }

    pendingFileUrl = null;
    attachmentPreview.replaceChildren();
    attachmentPreview.classList.add('hidden');
    form?.classList.remove('has-attachment');

    if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
      clearPendingFile();
      status.textContent =
        'Choisissez un fichier non vide de 20 Mo maximum.';
      return;
    }

    readingFile = true;
    syncComposerAction();

    status.textContent = 'Lecture du fichier sélectionné…';

    console.info(
      '[FICHIER] Lecture locale : début',
      file.name,
      file.size
    );

    try {
      const bytes = await readSelectedFile(file);

      if (version !== fileSelectionVersion) return;

      pendingFile = new File([bytes], file.name, {
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
      });

      console.info(
        '[FICHIER] Lecture locale OK :',
        bytes.byteLength,
        'octets'
      );

      renderPendingFile(pendingFile);
      status.textContent = 'Fichier prêt. Cliquez sur Envoyer.';
    } catch (error) {
      if (version !== fileSelectionVersion) return;

      console.error('[FICHIER]', error);
      fileInput.value = '';
      status.textContent = error.message;
    } finally {
      if (version === fileSelectionVersion) {
        readingFile = false;
        syncComposerAction();
      }
    }
  });

  // ENVOI DU FICHIER

  async function uploadPendingFile(file, conversationId) {
    if (!conversationId) {
      throw new Error('Sélectionnez une conversation.');
    }

    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new Error(
        'Fichier invalide. Sélectionnez-le à nouveau.'
      );
    }

    if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
      throw new Error(
        'Choisissez un fichier non vide de 20 Mo maximum.'
      );
    }

    async function requestJson(url, options, timeoutMs, label) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        timeoutMs
      );

      console.info(`[FICHIER] ${label} : début`);

      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          cache: 'no-store',
          ...options,
          signal: controller.signal,
        });

        console.info(
          `[FICHIER] ${label} : HTTP ${response.status}`
        );

        const raw = await response.text();
        let data;

        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(
            `${label} : HTTP ${response.status}, réponse non JSON. ` +
            'Consultez F12 → Réseau → Réponse.'
          );
        }

        if (!response.ok) {
          throw new Error(
            `${label} : HTTP ${response.status} — ` +
            (data?.error || 'Requête refusée.')
          );
        }

        return data;
      } catch (error) {
        if (controller.signal.aborted) {
          if (label === 'Session') {
            throw new Error(
              'Session sans réponse après 15 secondes. ' +
              'Aucun fichier envoyé.'
            );
          }

          throw new Error(
            'Envoi sans réponse complète après 60 secondes. ' +
            'Rechargez la conversation avant de réessayer : ' +
            'le serveur pourrait avoir enregistré le fichier.'
          );
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    status.textContent = 'Préparation de la session…';

    const session = await requestJson(
      '/api/auth/csrf',
      {},
      15000,
      'Session'
    );

    if (!session?.csrfToken) {
      throw new Error('Jeton CSRF absent. Rechargez la page.');
    }

    const formData = new FormData();
    formData.append('file', file, file.name);

    status.textContent =
      'Envoi du fichier… Attente de confirmation du serveur.';

    // Le navigateur définit le Content-Type multipart.
    const data = await requestJson(
      `/api/conversations/${encodeURIComponent(conversationId)}/files`,
      {
        method: 'POST',
        headers: {
          'X-CSRF-Token': session.csrfToken,
        },
        body: formData,
      },
      60000,
      'Envoi'
    );

    if (!data?.message?.id) {
      throw new Error(
        'Réponse sans message valide. ' +
        'Rechargez la conversation avant de réessayer.'
      );
    }

    console.info('[FICHIER] Envoi confirmé par le serveur.');

    if (activeConversation?.id === conversationId) {
      appendMessage(data.message);
    }

    notifyActivity(data.message);
    return data.message;
  }

  // RÉCEPTION EN TEMPS RÉEL

  function connectRealtime() {
    if (socket) return;

    if (typeof io !== 'function') {
      console.error('Socket.IO indisponible.');
      return;
    }

    socket = io();

    socket.on('connect', () => {
      console.log('[MESSAGES] socket connecté');
    });

    socket.on('presence:list', (data) => {
      window.dispatchEvent(
        new CustomEvent('presence:list', {
          detail: {
            userIds: Array.isArray(data?.userIds)
              ? data.userIds
              : [],
          },
        })
      );
    });

    socket.on('presence:update', (data) => {
      window.dispatchEvent(
        new CustomEvent('presence:update', {
          detail: data,
        })
      );
    });

    socket.on('message:new', (message) => {
      notifyActivity(message);

      if (
        !activeConversation ||
        message.conversationId !== activeConversation.id
      ) {
        window.dispatchEvent(
          new CustomEvent('message:unread', {
            detail: { message },
          })
        );
        return;
      }

      appendMessage({
        ...message,
        mine: false,
      });

      status.textContent = '';
    });

    socket.on('connect_error', (error) => {
      console.error('[MESSAGES Socket.IO]', error.message);
    });
  }

  function disconnectRealtime() {
    socket?.disconnect();
    socket = null;
  }

  // LECTEUR VOCAL

  function createWaveformBars(container, count = 38) {
    const bars = [];

    const pattern = [
      9, 15, 22, 13, 27, 17, 30, 20,
      12, 24, 16, 29, 19, 11, 25, 15,
      31, 22, 13, 27, 18, 10, 24, 29,
      17, 12, 26, 20, 14, 30, 18, 11,
      23, 16, 27, 14, 21, 10,
    ];

    for (let index = 0; index < count; index += 1) {
      const bar = document.createElement('span');
      bar.className = 'voice-wave-bar';
      bar.style.height = `${pattern[index % pattern.length]}px`;

      container.appendChild(bar);
      bars.push(bar);
    }

    return bars;
  }

  function createVoicePlayer(message) {
    const player = document.createElement('div');
    player.className = 'voice-player';

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'voice-play-button';
    playButton.innerHTML = `
      <span class="material-symbols-rounded">play_arrow</span>
    `;

    const waveform = document.createElement('div');
    waveform.className = 'voice-playback-waveform';

    const bars = createWaveformBars(waveform);

    const time = document.createElement('span');
    time.className = 'voice-player-time';
    time.textContent = formatDuration(message.durationMs || 0);

    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.className = 'voice-hidden-audio';

    if (message.voiceUrl) audio.src = message.voiceUrl;

    function updateWaveform() {
      let ratio = 0;

      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        ratio = audio.currentTime / audio.duration;
      }

      const played = Math.floor(ratio * bars.length);

      bars.forEach((bar, index) => {
        bar.classList.toggle('played', index < played);
      });

      if (!audio.paused) {
        time.textContent = formatDuration(audio.currentTime * 1000);
      }
    }

    audio.addEventListener('timeupdate', updateWaveform);

    audio.addEventListener('play', () => {
      playButton.innerHTML = `
        <span class="material-symbols-rounded">pause</span>
      `;
    });

    audio.addEventListener('pause', () => {
      playButton.innerHTML = `
        <span class="material-symbols-rounded">play_arrow</span>
      `;
    });

    audio.addEventListener('ended', () => {
      audio.currentTime = 0;

      bars.forEach((bar) => {
        bar.classList.remove('played');
      });

      time.textContent = formatDuration(message.durationMs || 0);
    });

    playButton.addEventListener('click', async () => {
      document.querySelectorAll('.voice-hidden-audio')
        .forEach((otherAudio) => {
          if (otherAudio !== audio) otherAudio.pause();
        });

      try {
        if (audio.paused) {
          await audio.play();
        } else {
          audio.pause();
        }
      } catch (error) {
        console.error('Lecture audio :', error);
      }
    });

    waveform.addEventListener('click', (event) => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        return;
      }

      const rect = waveform.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width)
      );

      audio.currentTime = ratio * audio.duration;
      updateWaveform();
    });

    player.appendChild(playButton);
    player.appendChild(waveform);
    player.appendChild(time);
    player.appendChild(audio);

    return player;
  }

  // AFFICHAGE DES MESSAGES

  function createMessageElement(message) {
    const item = document.createElement('li');

    item.className = message.mine
      ? 'message-item message-mine'
      : 'message-item message-other';

    if (!message.mine && activeConversation?.kind === 'group') {
      const sender = document.createElement('strong');
      sender.className = 'group-message-sender';
      sender.textContent =
        message.sender?.displayName ||
        message.sender?.username ||
        'Utilisateur';

      item.appendChild(sender);
    }

    if (message.kind === 'text') {
      const body = document.createElement('div');
      body.className = 'message-body';
      body.textContent = message.body || '';
      item.appendChild(body);
    }

    if (message.kind === 'file') {
      const container = document.createElement('div');
      container.className = 'message-file';

      if (message.fileUrl && isImage(message.mimeType)) {
        const image = document.createElement('img');
        image.className = 'message-image';
        image.src = message.fileUrl;
        image.alt = message.originalName || 'Image';
        image.loading = 'lazy';

        image.addEventListener('click', () => {
          window.open(message.fileUrl, '_blank', 'noopener');
        });

        container.appendChild(image);
      }

      if (message.fileUrl) {
        const link = document.createElement('a');
        link.className = 'file-download';
        link.href = `${message.fileUrl}?download=1`;
        link.textContent =
          message.originalName || 'Télécharger le fichier';

        container.appendChild(link);
      }

      if (
        message.sizeBytes !== null &&
        message.sizeBytes !== undefined
      ) {
        const size = document.createElement('small');
        size.className = 'file-size';
        size.textContent = formatFileSize(message.sizeBytes);
        container.appendChild(size);
      }

      item.appendChild(container);
    }

    if (message.kind === 'voice') {
      item.appendChild(createVoicePlayer(message));
    }

    const date = new Date(message.createdAt);

    if (!Number.isNaN(date.getTime())) {
      const time = document.createElement('small');
      time.className = 'message-time';
      time.textContent = date.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });

      item.appendChild(time);
    }

    return item;
  }

  function appendMessage(message) {
    if (!message?.id || renderedMessageIds.has(message.id)) {
      return;
    }

    renderedMessageIds.add(message.id);
    list.appendChild(createMessageElement(message));
    list.scrollTop = list.scrollHeight;
  }

  // HISTORIQUE

  async function loadMessages() {
    if (!activeConversation) return;

    loadingController?.abort();

    const controller = new AbortController();
    loadingController = controller;

    renderedMessageIds.clear();
    list.replaceChildren();

    try {
      const response = await fetch(
        `/api/conversations/${activeConversation.id}/messages`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        }
      );

      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(
          data.error || 'Impossible de charger les messages.'
        );
      }

      if (controller.signal.aborted) return;

      const messages = Array.isArray(data.messages)
        ? data.messages
        : [];

      for (const message of messages) {
        appendMessage(message);
      }

      status.textContent = '';

      requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight;
      });
    } catch (error) {
      if (controller.signal.aborted) return;

      console.error(error);
      status.textContent = error.message;
    } finally {
      if (loadingController === controller) {
        loadingController = null;
      }
    }
  }

  // INTERFACE D'ENREGISTREMENT

  function buildRecordingUi() {
    recordingUi.replaceChildren();

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'recording-cancel-button';
    cancelButton.title = 'Annuler';
    cancelButton.innerHTML = `
      <span class="material-symbols-rounded">delete</span>
    `;

    const liveZone = document.createElement('div');
    liveZone.className = 'recording-live-zone';

    const redDot = document.createElement('span');
    redDot.className = 'recording-red-dot';

    const timer = document.createElement('span');
    timer.className = 'recording-timer';
    timer.textContent = '0:00';

    const waveform = document.createElement('div');
    waveform.className = 'recording-waveform';

    const bars = [];

    for (let index = 0; index < 32; index += 1) {
      const bar = document.createElement('span');
      bar.className = 'recording-wave-bar';
      waveform.appendChild(bar);
      bars.push(bar);
    }

    liveZone.appendChild(redDot);
    liveZone.appendChild(timer);
    liveZone.appendChild(waveform);

    const sendVoiceButton = document.createElement('button');
    sendVoiceButton.type = 'button';
    sendVoiceButton.className = 'recording-send-button';
    sendVoiceButton.title = 'Envoyer le vocal';
    sendVoiceButton.innerHTML = `
      <span class="material-symbols-rounded">send</span>
    `;

    recordingUi.appendChild(cancelButton);
    recordingUi.appendChild(liveZone);
    recordingUi.appendChild(sendVoiceButton);

    cancelButton.addEventListener('click', () => {
      stopVoiceRecording(false);
    });

    sendVoiceButton.addEventListener('click', () => {
      stopVoiceRecording(true);
    });

    return { timer, bars };
  }

  // ANIMATION DU MICROPHONE

  function startLiveWaveform(stream, bars) {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    audioContext = new AudioContextClass();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;

    analyserSource = audioContext.createMediaStreamSource(stream);
    analyserSource.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      if (!analyser) return;

      analyser.getByteFrequencyData(data);

      bars.forEach((bar, index) => {
        const dataIndex = Math.floor(
          (index / bars.length) * data.length
        );

        const value = data[dataIndex] || 0;

        const height = Math.max(
          4,
          Math.min(30, 4 + (value / 255) * 26)
        );

        bar.style.height = `${height}px`;
      });

      waveformAnimation = requestAnimationFrame(draw);
    }

    draw();
  }

  async function stopLiveWaveform() {
    if (waveformAnimation) {
      cancelAnimationFrame(waveformAnimation);
    }

    waveformAnimation = null;

    try {
      analyserSource?.disconnect();
    } catch {
      // Source déjà déconnectée.
    }

    analyserSource = null;
    analyser = null;

    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // Contexte déjà fermé.
      }
    }

    audioContext = null;
  }

  function stopRecordingStream() {
    if (recordingTimer) clearInterval(recordingTimer);
    recordingTimer = null;

    stopLiveWaveform();

    if (recordingStream) {
      for (const track of recordingStream.getTracks()) {
        track.stop();
      }

      recordingStream = null;
    }
  }

  // FORMAT AUDIO

  function chooseRecorderMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/ogg',
    ];

    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  function normalizeMimeType(mimeType) {
    return (
      String(mimeType || 'audio/webm')
        .split(';')[0]
        .trim()
        .toLowerCase() || 'audio/webm'
    );
  }

  function extensionFromMime(mimeType) {
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4')) return 'm4a';
    if (mimeType.includes('mpeg')) return 'mp3';
    return 'webm';
  }

  // ENVOI DU VOCAL

  async function uploadVoice(blob, durationMs) {
    if (!activeConversation || !blob || blob.size <= 0) {
      return;
    }

    const csrfToken = await getCsrfToken();
    const mimeType = normalizeMimeType(blob.type);
    const extension = extensionFromMime(mimeType);

    const file = new File(
      [blob],
      `message-vocal-${Date.now()}.${extension}`,
      { type: mimeType }
    );

    const formData = new FormData();
    formData.append('file', file);
    formData.append(
      'durationMs',
      String(Math.max(1, Math.round(durationMs)))
    );

    status.textContent = 'Envoi du vocal…';

    const response = await fetch(
      `/api/conversations/${activeConversation.id}/voice`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        body: formData,
      }
    );

    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error || 'Impossible d’envoyer le message vocal.'
      );
    }

    appendMessage(data.message);
    notifyActivity(data.message);
    status.textContent = '';
  }

  // ENREGISTREMENT VOCAL

  async function startVoiceRecording() {
    if (!activeConversation) return;

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      status.textContent =
        'L’enregistrement vocal n’est pas disponible.';
      return;
    }

    try {
      recordingStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });

      const mimeType = chooseRecorderMimeType();

      mediaRecorder = mimeType
        ? new MediaRecorder(recordingStream, { mimeType })
        : new MediaRecorder(recordingStream);

      recordingChunks = [];
      recordingStartedAt = Date.now();
      shouldUploadRecording = false;

      const ui = buildRecordingUi();

      form.classList.add('hidden-during-recording');
      recordingUi.classList.remove('hidden');

      startLiveWaveform(recordingStream, ui.bars);

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunks.push(event.data);
        }
      });

      mediaRecorder.addEventListener('stop', async () => {
        const durationMs = Math.max(
          1,
          Date.now() - recordingStartedAt
        );

        const mime =
          mediaRecorder.mimeType || mimeType || 'audio/webm';

        const blob = new Blob(recordingChunks, {
          type: mime,
        });

        const mustSend = shouldUploadRecording;
        recordingChunks = [];

        stopRecordingStream();
        mediaRecorder = null;

        recordingUi.classList.add('hidden');
        form.classList.remove('hidden-during-recording');

        syncComposerAction();

        if (!mustSend) return;

        try {
          await uploadVoice(blob, durationMs);
        } catch (error) {
          console.error(error);
          status.textContent = error.message;
        }
      });

      mediaRecorder.addEventListener('error', () => {
        stopRecordingStream();
        mediaRecorder = null;

        recordingUi.classList.add('hidden');
        form.classList.remove('hidden-during-recording');

        status.textContent =
          'Erreur pendant l’enregistrement vocal.';

        syncComposerAction();
      });

      mediaRecorder.start(250);

      recordingTimer = setInterval(() => {
        const elapsed = Date.now() - recordingStartedAt;
        ui.timer.textContent = formatDuration(elapsed);

        if (elapsed >= MAX_VOICE_DURATION) {
          stopVoiceRecording(true);
        }
      }, 250);

      status.textContent = '';
    } catch (error) {
      console.error(error);

      stopRecordingStream();
      mediaRecorder = null;

      if (error.name === 'NotAllowedError') {
        status.textContent = 'Autorisation du microphone refusée.';
      } else if (error.name === 'NotFoundError') {
        status.textContent = 'Aucun microphone détecté.';
      } else {
        status.textContent = 'Impossible d’utiliser le microphone.';
      }
    }
  }

  function stopVoiceRecording(send) {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
      return;
    }

    shouldUploadRecording = Boolean(send);
    mediaRecorder.stop();
  }

  voiceButton?.addEventListener('click', startVoiceRecording);

  // EMOJIS

  stickerButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    stickerPanel?.classList.toggle('hidden');
  });

  stickerPanel?.addEventListener('click', (event) => {
    const option = event.target.closest('.sticker-option');
    if (!option) return;

    input.value += option.dataset.sticker || '';
    stickerPanel.classList.add('hidden');

    syncComposerAction();
    input.focus();
  });

  document.addEventListener('click', (event) => {
    if (
      stickerPanel &&
      !stickerPanel.classList.contains('hidden') &&
      !stickerPanel.contains(event.target) &&
      !stickerButton?.contains(event.target)
    ) {
      stickerPanel.classList.add('hidden');
    }
  });

  // NETTOYAGE

  function clearConversation() {
    if (mediaRecorder?.state === 'recording') {
      stopVoiceRecording(false);
    }

    activeConversation = null;
    activeUser = null;

    loadingController?.abort();
    loadingController = null;

    renderedMessageIds.clear();
    list.replaceChildren();

    title.textContent = '';
    status.textContent = '';
    input.value = '';

    clearPendingFile();
    card.classList.add('hidden');

    syncComposerAction();
  }

  // OUVERTURE D'UNE CONVERSATION

  window.addEventListener('conversation:selected', (event) => {
    if (mediaRecorder?.state === 'recording') {
      stopVoiceRecording(false);
    }

    clearPendingFile();

    const conversation = event.detail?.conversation;
    const user = event.detail?.user;

    if (!conversation?.id || !user) return;

    activeConversation = conversation;
    activeUser = user;

    title.textContent =
      user.displayName ||
      user.username ||
      conversation.title ||
      'Conversation';

    card.classList.remove('hidden');

    loadMessages();
    input.focus();
  });

  // AUTHENTIFICATION

  window.addEventListener('auth:changed', (event) => {
    if (event.detail?.user) {
      connectRealtime();
    } else {
      disconnectRealtime();
      clearConversation();
    }
  });

  // ENVOI TEXTE

  async function sendTextMessage(body, conversationId) {
    const csrfToken = await getCsrfToken();

    const response = await fetch(
      `/api/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ body }),
      }
    );

    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error || 'Impossible d’envoyer le message.'
      );
    }

    if (activeConversation?.id === conversationId) {
      appendMessage(data.message);
    }

    notifyActivity(data.message);
  }

  input?.addEventListener('input', syncComposerAction);

  // ENVOI TEXTE, FICHIER OU LES DEUX

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!activeConversation || sending || readingFile) return;

    const conversationId = activeConversation.id;
    const originalText = input.value;
    const body = originalText.trim();
    const fileToSend = pendingFile;

    if (!body && !fileToSend) return;

    sending = true;
    input.disabled = true;
    syncComposerAction();

    try {
      if (fileToSend) {
        status.textContent = 'Envoi du fichier…';

        await uploadPendingFile(fileToSend, conversationId);

        // Retirer uniquement le fichier effectivement envoyé.
        if (pendingFile === fileToSend) {
          clearPendingFile();
        }
      }

      if (body) {
        await sendTextMessage(body, conversationId);

        if (
          activeConversation?.id === conversationId &&
          input.value === originalText
        ) {
          input.value = '';
        }
      }

      if (activeConversation?.id === conversationId) {
        status.textContent = '';
      }
    } catch (error) {
      console.error('[ENVOI]', error);

      if (activeConversation?.id === conversationId) {
        status.textContent = error.message;
      }
    } finally {
      sending = false;
      input.disabled = false;

      syncComposerAction();
      input.focus();
    }
  });

  syncComposerAction();
})();