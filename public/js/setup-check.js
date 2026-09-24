const statusElement = document.getElementById('secure-status');

if (!statusElement) {
  console.error('Élément #secure-status introuvable.');
} else if (!window.isSecureContext) {
  statusElement.textContent =
    'Le navigateur ne reconnaît pas un contexte sécurisé.';
  statusElement.className = 'error';

} else if (!navigator.mediaDevices?.getUserMedia) {
  statusElement.textContent =
    'Contexte sécurisé reconnu, mais l’API caméra/microphone est indisponible.';
  statusElement.className = 'error';

} else {
  statusElement.textContent =
    'Contexte sécurisé reconnu. L’API caméra/microphone est disponible.';
  statusElement.className = 'success';
}