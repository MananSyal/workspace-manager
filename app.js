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

// === MongoDB connection ===
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/workspace_db";

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB:", MONGODB_URI))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// === Models ===
const Project = require("./models/Project");
const Task = require("./models/Task");
const User = require("./models/User");

// === Auth helpers (middleware) ===
const { authMiddleware, requireAuth, JWT_SECRET } = require("./middleware/auth");

// === Express app + HTTP server (for WebSocket) ===
const app = express();
const server = http.createServer(app);

// === WebSocket server ===
const wss = new WebSocketServer({ server });

// Helper: compute current stats
async function computeStats() {
  const [projects, tasks] = await Promise.all([Project.find(), Task.find()]);

  const totalProjects = projects.length;
  const totalTasks = tasks.length;

  let overallCompletion = 0;
  if (totalTasks > 0) {
    const completedTasks = tasks.filter((t) => t.completed).length;
    overallCompletion = Math.round((completedTasks / totalTasks) * 100);
  }

  const formattedProjects = projects.map((doc) => ({
    id: doc._id,
    name: doc.title,
    description: doc.description,
    progress: doc.progress || 0
  }));

  return { totalProjects, totalTasks, overallCompletion, projects: formattedProjects };
}

// Broadcast stats to all connected WebSocket clients
async function broadcastStats() {
  const stats = await computeStats();
  const message = JSON.stringify({ type: "stats", data: stats });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

wss.on("connection", async (ws) => {
  console.log("🔌 WebSocket client connected");
  ws.send(JSON.stringify({ type: "info", message: "Connected to live updates" }));

  // send current stats immediately
  const stats = await computeStats();
  ws.send(JSON.stringify({ type: "stats", data: stats }));
});

// === Express middleware ===
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// EJS + static
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.static(path.join(__dirname, "public")));



// Custom auth middleware (adds req.user & res.locals.user)
app.use(authMiddleware);

// === Auth routes ===
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});


app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});


// GET /register
app.get("/register", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("register", { layout: "auth-layout", error: null });
});
// List all tasks
app.get("/tasks", requireAuth, async (req, res, next) => {
  try {
    const tasks = await Task.find().populate("projectId");

    const formattedTasks = tasks.map(task => ({
      id: task._id,
      title: task.title,
      completed: task.completed,
      projectTitle: task.projectId?.title || "Unknown"
    }));

res.render("tasks", { tasks: formattedTasks });
  } catch (err) {
    next(err);
  }
});


// POST /register
app.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password) {
      return res.status(400).render("register", {
        error: "All fields are required."
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).render("register", {
        error: "Passwords do not match."
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).render("register", {
        error: "Email already registered. Please log in."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = new User({ name, email, passwordHash });
    await user.save();

    // create JWT
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

// GET /login
app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login", { layout: "auth-layout", error: null });
});


// POST /login
app.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).render("login", {
        error: "Invalid email or password."
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).render("login", {
        error: "Invalid email or password."
      });
    }

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

// POST /logout
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// === Protected routes (dashboard + projects) ===

// Dashboard
app.get("/", async (req, res, next) => {
  if (!req.user) return res.redirect("/login");

  try {
    const stats = await computeStats();
    res.render("dashboard", stats);
  } catch (err) {
    next(err);
  }
});


// List projects
app.get("/projects", requireAuth, async (req, res, next) => {
  try {
    const projects = await Project.find();
    const formattedProjects = projects.map((doc) => ({
      id: doc._id,
      name: doc.title,
      description: doc.description,
      progress: doc.progress || 0
    }));
    res.render("projects", { projects: formattedProjects });
  } catch (err) {
    next(err);
  }
});

// New project form
app.get("/projects/new", requireAuth, (req, res) => {
  res.render("new-project", { error: null });
});

// Create project
app.post("/projects", requireAuth, async (req, res, next) => {
  try {
    const { name, title, description } = req.body;
    const projectTitle = title || name;

    if (!projectTitle) {
      return res.status(400).render("new-project", {
        error: "Project name is required."
      });
    }

    const project = new Project({
      title: projectTitle,
      description,
      progress: 0
    });

    await project.save();
    await broadcastStats();
    res.redirect("/projects");
  } catch (err) {
    next(err);
  }
});

// Project detail page
app.get("/projects/:id", requireAuth, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).render("error", {
        error: new Error("Project not found")
      });
    }

    const tasks = await Task.find({ projectId: project._id });

    res.render("project-detail", {
      project: {
        id: project._id,
        name: project.title,
        description: project.description,
        progress: project.progress || 0
      },
      tasks
    });
  } catch (err) {
    next(err);
  }
});

// Add task to project
app.post("/projects/:id/tasks", requireAuth, async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).render("error", {
        error: new Error("Task title is required")
      });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).render("error", {
        error: new Error("Project not found")
      });
    }

    const task = new Task({
      title,
      projectId: project._id
    });

    await task.save();
    await broadcastStats();
    res.redirect(`/projects/${project._id}`);
  } catch (err) {
    next(err);
  }
});

// Toggle task completion
app.post("/tasks/:id/toggle", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).render("error", {
        error: new Error("Task not found")
      });
    }

    task.completed = !task.completed;
    await task.save();
    await broadcastStats();

res.redirect(req.get("Referrer") || "/tasks");
  } catch (err) {
    next(err);
  }
});

// Simple JSON API (protected)
const apiProjectsRouter = require("./routes/api/projects");
app.use("/api/projects", requireAuth, apiProjectsRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error("Error handler:", err);
  res.status(500).render("error", { error: err });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

