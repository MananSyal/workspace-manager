// app.js - Workspace Manager with auth + WebSockets

const path = require("path");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { WebSocketServer } = require("ws");
const expressLayouts = require("express-ejs-layouts");

dotenv.config();

// =====================
// MongoDB
// =====================
const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });

// =====================
// Models
// =====================
const Project = require("./models/Project");
const Task = require("./models/Task");
const User = require("./models/User");

// =====================
// Auth middleware
// =====================
const { authMiddleware, requireAuth, JWT_SECRET } = require("./middleware/auth");

// =====================
// Express + HTTP + WS
// =====================
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// =====================
// WebSocket helpers
// =====================
async function computeStats() {
  const [projects, tasks] = await Promise.all([
    Project.find(),
    Task.find()
  ]);

  const totalProjects = projects.length;
  const totalTasks = tasks.length;

  let overallCompletion = 0;
  if (totalTasks > 0) {
    const completedTasks = tasks.filter(t => t.completed).length;
    overallCompletion = Math.round((completedTasks / totalTasks) * 100);
  }

  return {
    totalProjects,
    totalTasks,
    overallCompletion,
    projects: projects.map(p => ({
      id: p._id,
      name: p.title,
      description: p.description,
      progress: p.progress || 0
    }))
  };
}

async function broadcastStats() {
  const stats = await computeStats();
  const payload = JSON.stringify({ type: "stats", data: stats });

  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

wss.on("connection", async ws => {
  ws.send(JSON.stringify({ type: "info", message: "Connected" }));
  ws.send(JSON.stringify({ type: "stats", data: await computeStats() }));
});

// =====================
// Express middleware
// =====================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use(express.static(path.join(__dirname, "public")));

// Attach user from JWT
app.use(authMiddleware);

// =====================
// Railway health check
// =====================
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// =====================
// Root = Dashboard
// =====================
app.get("/", async (req, res, next) => {
  if (!req.user) return res.redirect("/login");

  try {
    const stats = await computeStats();
    res.render("dashboard", stats);
  } catch (err) {
    next(err);
  }
});

// =====================
// Auth routes
// =====================
app.get("/register", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("register", { layout: "auth-layout", error: null });
});

app.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password)
      return res.render("register", { error: "All fields required" });

    if (password !== confirmPassword)
      return res.render("register", { error: "Passwords do not match" });

    if (await User.findOne({ email }))
      return res.render("register", { error: "Email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, { httpOnly: true });
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login", { layout: "auth-layout", error: null });
});

app.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.render("login", { error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, { httpOnly: true });
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// =====================
// Projects & Tasks
// =====================
app.get("/projects", requireAuth, async (req, res) => {
  const projects = await Project.find();
  res.render("projects", { projects });
});

app.post("/projects", requireAuth, async (req, res) => {
  await Project.create({
    title: req.body.title || req.body.name,
    description: req.body.description,
    progress: 0
  });
  await broadcastStats();
  res.redirect("/projects");
});

app.get("/tasks", requireAuth, async (req, res) => {
  const tasks = await Task.find().populate("projectId");
  res.render("tasks", { tasks });
});

// =====================
// Error handler
// =====================
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", { error: err });
});

// =====================
// Start server
// =====================
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
