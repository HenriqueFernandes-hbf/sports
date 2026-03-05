import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : "*";

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function parseId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildDbErrorResponse(err, fallbackMessage) {
  if (err?.code === "22P02") {
    return {
      status: 400,
      body: {
        message: "Invalid value format for one or more fields.",
        pg_code: err.code,
        pg_message: err.message,
        pg_detail: err.detail ?? null,
      },
    };
  }

  return {
    status: 500,
    body: { message: err?.message || fallbackMessage },
  };
}

app.get("/sports", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, created_by
       FROM sports
       ORDER BY id ASC`
    );

    return res.json(rows);
  } catch (err) {
    console.error("Error fetching sports:", err);
    return res.status(500).json({ message: "Failed to fetch sports." });
  }
});

app.post("/sports", async (req, res) => {
  const body = req.body ?? {};
  const name = normalizeText(body.name);
  const description = normalizeText(body.description);
  const createdBy = parseId(body.created_by ?? body.createdBy);

  if (!name || !description || !createdBy) {
    return res.status(400).json({ message: "Missing required fields: name, description, created_by." });
  }

  if (name.length > 50) {
    return res.status(400).json({ message: "name must be at most 50 characters." });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO sports (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_by`,
      [name, description, createdBy]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error creating sport:", err);
    const dbError = buildDbErrorResponse(err, "Failed to create sport.");
    return res.status(dbError.status).json(dbError.body);
  }
});

app.put("/sports/:id", async (req, res) => {
  const sportId = parseId(req.params.id);

  if (!sportId) {
    return res.status(400).json({ message: "Invalid sport id." });
  }

  const body = req.body ?? {};
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
  const hasCreatedBy =
    Object.prototype.hasOwnProperty.call(body, "created_by") ||
    Object.prototype.hasOwnProperty.call(body, "createdBy");

  if (!hasName && !hasDescription && !hasCreatedBy) {
    return res.status(400).json({ message: "Provide at least one field to update: name, description, created_by." });
  }

  const name = hasName ? normalizeText(body.name) : null;
  const description = hasDescription ? normalizeText(body.description) : null;
  const createdBy = hasCreatedBy ? parseId(body.created_by ?? body.createdBy) : null;

  if (hasName && !name) {
    return res.status(400).json({ message: "name cannot be empty." });
  }

  if (hasDescription && !description) {
    return res.status(400).json({ message: "description cannot be empty." });
  }

  if (hasName && name.length > 50) {
    return res.status(400).json({ message: "name must be at most 50 characters." });
  }

  if (hasCreatedBy && !createdBy) {
    return res.status(400).json({ message: "created_by must be a positive integer." });
  }

  try {
    const { rowCount, rows } = await pool.query(
      `UPDATE sports SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         created_by = COALESCE($3, created_by)
       WHERE id = $4
       RETURNING id, name, description, created_by`,
      [name, description, createdBy, sportId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: "Sport not found." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("Error updating sport:", err);
    const dbError = buildDbErrorResponse(err, "Failed to update sport.");
    return res.status(dbError.status).json(dbError.body);
  }
});

app.delete("/sports/:id", async (req, res) => {
  const sportId = parseId(req.params.id);

  if (!sportId) {
    return res.status(400).json({ message: "Invalid sport id." });
  }

  try {
    const { rowCount } = await pool.query("DELETE FROM sports WHERE id = $1", [sportId]);

    if (rowCount === 0) {
      return res.status(404).json({ message: "Sport not found." });
    }

    return res.json({ message: "Sport deleted successfully." });
  } catch (err) {
    console.error("Error deleting sport:", err);
    return res.status(500).json({ message: "Failed to delete sport." });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Sports service on :${port}`));
