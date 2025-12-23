const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    progress: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", ProjectSchema);
