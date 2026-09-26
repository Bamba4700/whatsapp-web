const statusElement =
  document.getElementById(
    'secure-status'
  );

if (!statusElement) {
  console.error(
    'Élément #secure-status introuvable.'
  );

} else if (!window.isSecureContext) {

  statusElement.textContent =
    'Une connexion sécurisée est nécessaire pour utiliser les appels audio et vidéo.';

  statusElement.className =
    'error';

} else if (
  !navigator.mediaDevices?.getUserMedia
) {

  statusElement.textContent =
    'La caméra et le microphone ne sont pas disponibles sur ce navigateur.';

  statusElement.className =
    'error';

} else {

  statusElement.textContent =
    'Messagerie, appels audio et vidéo en temps réel.';

  statusElement.className =
    'success';
}