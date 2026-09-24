let csrfToken = null;

const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

const logoutButton = document.getElementById('logout-button');

const currentUser = document.getElementById('current-user');
const message = document.getElementById('message');


function showMessage(text, type = 'info') {
  message.textContent = text;
  message.className = type;
}


function showLoggedOut() {
  authSection.classList.remove('hidden');
  appSection.classList.add('hidden');

  currentUser.textContent = '';

  window.dispatchEvent(
    new CustomEvent('auth:changed', {
      detail: { user: null },
    })
  );
}

function showLoggedIn(user) {
  authSection.classList.add('hidden');
  appSection.classList.remove('hidden');

  currentUser.textContent =
    `${user.displayName} (@${user.username})`;

  window.dispatchEvent(
    new CustomEvent('auth:changed', {
      detail: { user },
    })
  );
}


async function getCsrfToken() {

  const response = await fetch('/api/auth/csrf', {
    credentials: 'same-origin'
  });

  if (!response.ok) {
    throw new Error(
      'Impossible de récupérer le jeton CSRF.'
    );
  }

  const data = await response.json();

  csrfToken = data.csrfToken;
}


async function checkSession() {

  try {

    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin'
    });

    if (response.status === 401) {
      showLoggedOut();
      return;
    }

    if (!response.ok) {
      throw new Error(
        'Impossible de vérifier la session.'
      );
    }

    const data = await response.json();

    showLoggedIn(data.user);

  } catch (error) {

    console.error(error);

    showMessage(
      'Erreur lors de la vérification de la session.',
      'error'
    );

  }
}


registerForm.addEventListener('submit', async (event) => {

  event.preventDefault();

  showMessage('');

  const formData = new FormData(registerForm);

  const body = {
    displayName: formData.get('displayName'),
    username: formData.get('username'),
    password: formData.get('password')
  };

  try {

    const response = await fetch('/api/auth/register', {

      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },

      credentials: 'same-origin',

      body: JSON.stringify(body)
    });


    const data = await response.json();


    if (!response.ok) {

      showMessage(
        data.error || 'Inscription impossible.',
        'error'
      );

      return;
    }


    csrfToken = data.csrfToken;

    registerForm.reset();

    showLoggedIn(data.user);

    showMessage(
      'Compte créé avec succès.',
      'success'
    );


  } catch (error) {

    console.error(error);

    showMessage(
      'Erreur réseau pendant l’inscription.',
      'error'
    );

  }

});


loginForm.addEventListener('submit', async (event) => {

  event.preventDefault();

  showMessage('');

  const formData = new FormData(loginForm);

  const body = {
    username: formData.get('username'),
    password: formData.get('password')
  };


  try {

    const response = await fetch('/api/auth/login', {

      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },

      credentials: 'same-origin',

      body: JSON.stringify(body)
    });


    const data = await response.json();


    if (!response.ok) {

      showMessage(
        data.error || 'Connexion impossible.',
        'error'
      );

      return;
    }


    csrfToken = data.csrfToken;

    loginForm.reset();

    showLoggedIn(data.user);

    showMessage(
      'Connexion réussie.',
      'success'
    );


  } catch (error) {

    console.error(error);

    showMessage(
      'Erreur réseau pendant la connexion.',
      'error'
    );

  }

});


logoutButton.addEventListener('click', async () => {

  try {

    const response = await fetch('/api/auth/logout', {

      method: 'POST',

      headers: {
        'X-CSRF-Token': csrfToken
      },

      credentials: 'same-origin'
    });


    const data = await response.json();


    if (!response.ok) {

      showMessage(
        data.error || 'Déconnexion impossible.',
        'error'
      );

      return;
    }


    csrfToken = null;

    showLoggedOut();

    await getCsrfToken();

    showMessage(
      'Déconnexion réussie.',
      'success'
    );


  } catch (error) {

    console.error(error);

    showMessage(
      'Erreur pendant la déconnexion.',
      'error'
    );

  }

});


async function init() {

  try {

    await getCsrfToken();

    await checkSession();

  } catch (error) {

    console.error(error);

    showMessage(
      'Impossible d’initialiser l’application.',
      'error'
    );

  }

}


init();