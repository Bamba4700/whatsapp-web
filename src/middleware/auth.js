function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: 'Veuillez vous connecter.',
    });
  }

  next();
}

module.exports = {
  requireAuth,
};