const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    completed: { type: Boolean, default: false },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", TaskSchema);
