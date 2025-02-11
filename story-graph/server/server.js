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

app.get("/story-graph/:story_line_id", async (req, res) => {
  try {
    const storyLineId = req.params.story_line_id.trim();

    if (!storyLineId || storyLineId.length > 255) {
      return res.status(400).json({ error: "Invalid story_line_id." });
    }

    const storyLineQueryText = "SELECT * FROM story_lines WHERE story_line_id = $1";
    const storyLineQuery = await client.query(storyLineQueryText, [storyLineId]);

    if (storyLineQuery.rows.length === 0) {
      return res.status(404).json({ error: "Storyline not found" });
    }

    const startNodeId = storyLineQuery.rows[0].fk_story_lines_start_node_id_story_nodes;

    let elements = [];
    let queue = [startNodeId];
    let visited = new Set();

    while (queue.length > 0) {
      let nodeId = queue.shift();
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const nodeQueryText = "SELECT * FROM story_nodes WHERE id = $1";
      const nodeQuery = await client.query(nodeQueryText, [nodeId]);

      if (nodeQuery.rows.length === 0) continue;
      const node = nodeQuery.rows[0];

      elements.push({
        data: {
          id: `N${node.id}`,
          name: node.title,
          description: node.description
        }
      });

      if (node.next_node_id) {
        elements.push({
          data: {
            id: `E${node.id}-${node.next_node_id}`,
            source: `N${node.id}`,
            target: `N${node.next_node_id}`
          }
        });
        queue.push(node.next_node_id);
      }
    }

    const responsePayload = {
      storyLine: {
        story_line_id: storyLineQuery.rows[0].story_line_id,
        title: storyLineQuery.rows[0].title
      },
      elements
    };

    res.json(responsePayload);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
});
