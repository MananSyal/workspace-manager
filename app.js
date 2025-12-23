// app.js - Workspace Manager with auth + WebSockets (Railway-safe)

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

/* =========================
   MongoDB
========================= */
const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB error:", err.message));

/* =========================
   Models
========================= */
const Project = require("./models/Project");
const Task = require("./models/Task");
const User = require("./models/User");

/* =========================
   Auth Middleware
========================= */
const {
  authMiddleware,
  requireAuth,
  JWT_SECRET
} = require("./middleware/auth");

/* =========================
   Express + Server
========================= */
const app = express();
const server = http.createServer(app);

/* =========================
   WebSocket
========================= */
const wss = new WebSocketServer({ server });

async function computeStats() {
  const [projects, tasks] = await Promise.all([
    Project.find(),
    Task.find()
  ]);

  const completed = tasks.filter(t => t.completed).length;

  return {
    totalProjects: projects.length,
    totalTasks: tasks.length,
    overallCompletion:
      tasks.length === 0
        ? 0
        : Math.round((completed / tasks.length) * 100),
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
  const msg = JSON.stringify({ type: "stats", data: stats });

  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

wss.on("connection", async ws => {
  ws.send(JSON.stringify({ type: "info", message: "Connected" }));
  ws.send(JSON.stringify({ type: "stats", data: await computeStats() }));
});

/* =========================
   Middleware
========================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.static(path.join(__dirname, "public")));

/* =========================
   Railway Health Check
========================= */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* =========================
   Helpers
========================= */
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

/* =========================
   Auth Routes
========================= */
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
    const user = await new User({ name, email, passwordHash }).save();

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true });
    res.redirect("/");
  } catch (e) {
    next(e);
  }
});

app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login", { layout: "auth-layout", error: null });
});

app.post("/login", async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash)))
    return res.render("login", { error: "Invalid credentials" });

  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true });
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

/* =========================
   Dashboard (ONLY ROOT ROUTE)
========================= */
app.get("/", async (req, res, next) => {
  if (!req.user) return res.redirect("/login");
  try {
    res.render("dashboard", await computeStats());
  } catch (e) {
    next(e);
  }
});

/* =========================
   Projects
========================= */
app.get("/projects", requireAuth, async (req, res) => {
  const projects = await Project.find();
  res.render("projects", { projects });
});

app.get("/projects/new", requireAuth, (req, res) =>
  res.render("new-project", { error: null })
);

app.post("/projects", requireAuth, async (req, res) => {
  await new Project({
    title: req.body.title || req.body.name,
    description: req.body.description,
    progress: 0
  }).save();
  await broadcastStats();
  res.redirect("/projects");
});

app.get("/projects/:id", requireAuth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  const tasks = await Task.find({ projectId: project._id });
  res.render("project-detail", { project, tasks });
});

app.post("/projects/:id/tasks", requireAuth, async (req, res) => {
  await new Task({ title: req.body.title, projectId: req.params.id }).save();
  await broadcastStats();
  res.redirect(`/projects/${req.params.id}`);
});

/* =========================
   Tasks
========================= */
app.get("/tasks", requireAuth, async (req, res) => {
  const tasks = await Task.find().populate("projectId");
  res.render("tasks", { tasks });
});

app.post("/tasks/:id/toggle", requireAuth, async (req, res) => {
  const task = await Task.findById(req.params.id);
  task.completed = !task.completed;
  await task.save();
  await broadcastStats();
  res.redirect("back");
});

/* =========================
   API
========================= */
app.use("/api/projects", requireAuth, require("./routes/api/projects"));

/* =========================
   Error Handler
========================= */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", { error: err });
});

/* =========================
   Start Server
========================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
