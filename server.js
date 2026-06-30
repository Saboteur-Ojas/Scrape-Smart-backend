require("dotenv").config();

const express = require("express");
const cors = require("cors");
const aiRoutes = require("./routes/aiRoutes");
const collectorRoutes = require("./routes/collectorRoutes");
const requestRoutes = require("./routes/requestRoutes");
const userRoutes = require("./routes/userRoutes");

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/ai", aiRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/collector", collectorRoutes);
app.use("/api/user", userRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({ error: error.message || "Internal server error." });
});

app.listen(port, () => {
  console.log(`Smart Kabadi API listening on ${port}`);
});
