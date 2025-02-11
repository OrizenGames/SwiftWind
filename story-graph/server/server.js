const express = require("express");
const { Client } = require("pg");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const port = 3000;

const allowedOrigins = ["https://admin.spiritbrewgame.com"];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS restriction: Origin not allowed"));
    }
  },
  methods: ["GET"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

app.use(cors(corsOptions));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many requests. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

const client = new Client({
  user: process.env.PG_USER || "readonly_user",
  host: process.env.PG_HOST || "localhost",
  database: process.env.PG_DATABASE || "nocobase",
  password: process.env.PG_PASSWORD || "",
  port: 5432
});

client
  .connect()
  .then(() => console.log("PostgreSQL connection established"))
  .catch((err) => {
    console.error("Failed to connect to PostgreSQL:", err);
    process.exit(1);
  });

function validateRequest(req, res, next) {
  const referer = req.headers.referer || req.headers.origin;
  if (!referer || !allowedOrigins.some(origin => referer.startsWith(origin))) {
    console.warn(`Unauthorized request from origin: ${referer}`);
    return res.status(403).json({ error: "Unauthorized access" });
  }
  next();
}

app.get("/story-graph/:story_line_id", validateRequest, async (req, res) => {
  try {
    const storyLineId = req.params.story_line_id.trim();

    if (!storyLineId || storyLineId.length > 255) {
      console.warn(`Invalid story_line_id: ${storyLineId}`);
      return res.status(400).json({ error: "Invalid story_line_id" });
    }

    console.log(`API request: /story-graph/${storyLineId}`);

    const storyLineQueryText = "SELECT * FROM side_story_lines WHERE story_line_id = $1";
    console.log(`Executing SQL query: ${storyLineQueryText}, Params: ${storyLineId}`);

    const storyLineQuery = await client.query(storyLineQueryText, [storyLineId]);

    if (storyLineQuery.rows.length === 0) {
      console.warn(`Storyline not found: ${storyLineId}`);
      return res.status(404).json({ error: "Storyline not found" });
    }

    const nodesQueryText = "SELECT * FROM side_story_nodes WHERE side_story_ids = $1";
    console.log(`Executing SQL query: ${nodesQueryText}, Params: ${storyLineId}`);

    const nodesQuery = await client.query(nodesQueryText, [storyLineId]);

    console.log(`Found ${nodesQuery.rows.length} nodes`);

    let elements = [];

    nodesQuery.rows.forEach((node, index) => {
      console.log(`Processing node: ${node.store_node_id} - ${node.title}`);

      elements.push({
        data: {
          id: `N${node.store_node_id}`,
          index: index + 1,
          name: node.title,
          description: node.description
        }
      });

      if (node.f_m0kx8faa6ej) {
        console.log(`Creating edge: ${node.store_node_id} -> ${node.f_m0kx8faa6ej}`);

        elements.push({
          data: {
            id: `E${node.store_node_id}-${node.f_m0kx8faa6ej}`,
            source: `N${node.store_node_id}`,
            target: `N${node.f_m0kx8faa6ej}`
          }
        });
      }
    });

    const responsePayload = {
      storyLine: {
        pipeline_id: storyLineQuery.rows[0].f_g3az5f1c5tu,
        story_line_id: storyLineQuery.rows[0].story_line_id,
        title: storyLineQuery.rows[0].title
      },
      elements
    };

    console.log("Returning JSON response");
    res.json(responsePayload);
  } catch (error) {
    console.error("Query execution error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
});
