const express = require("express");
const router = express.Router();
const Project = require("../../models/Project");

// GET /api/projects
router.get("/", async (req, res) => {
  const projects = await Project.find();
  res.json(projects);
});

// POST /api/projects
router.post("/", async (req, res) => {
  const p = new Project(req.body);
  await p.save();
  res.json(p);
});

module.exports = router;
