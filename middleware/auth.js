const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-me";

function authMiddleware(req, res, next) {
  const token = req.cookies ? req.cookies.token : null;

  if (!token) {
    req.user = null;
    res.locals.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    res.locals.user = decoded; // available in EJS as "user"
  } catch (err) {
    req.user = null;
    res.locals.user = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect("/login");
  }
  next();
}

module.exports = {
  authMiddleware,
  requireAuth,
  JWT_SECRET
};
