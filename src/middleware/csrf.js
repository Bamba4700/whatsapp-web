const { randomBytes, timingSafeEqual } = require('node:crypto');

function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }

  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const received = req.get('X-CSRF-Token');
  const expected = req.session?.csrfToken;

  if (
    typeof received !== 'string' ||
    typeof expected !== 'string' ||
    received.length !== 64 ||
    expected.length !== 64
  ) {
    return res.status(403).json({
      error: 'Session de formulaire invalide. Rechargez la page.',
    });
  }

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return res.status(403).json({
      error: 'Session de formulaire invalide. Rechargez la page.',
    });
  }

  next();
}

module.exports = {
  getCsrfToken,
  requireCsrf,
};