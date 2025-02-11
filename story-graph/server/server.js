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

    // 1. 查詢該劇情線及其開始節點
    const storyLineQuery = await client.query(
      `SELECT sl.*, sn.* 
       FROM story_lines sl
       LEFT JOIN story_nodes sn ON sn.id = sl.fk_story_lines_start_node_id_story_nodes
       WHERE sl.story_line_id = $1`,
      [storyLineId]
    );

    if (storyLineQuery.rows.length === 0) {
      return res.status(404).json({ error: "Storyline not found" });
    }

    const startNode = storyLineQuery.rows[0];
    let elements = [];
    let queue = [startNode.id];
    let visited = new Set();

    while (queue.length > 0) {
      let nodeId = queue.shift();
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      // 2. 查詢該節點的後續節點
      const nodeQuery = await client.query(
        `SELECT * 
         FROM story_nodes 
         WHERE fk_storyline_storynode = (
           SELECT id FROM story_lines WHERE story_line_id = $1
         )
         AND (next_node_id IS NOT NULL OR branch_nodes IS NOT NULL)`,
        [storyLineId]
      );

      nodeQuery.rows.forEach((node) => {
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

        if (node.branch_nodes) {
          const branches = JSON.parse(node.branch_nodes);
          branches.forEach((branchNodeId) => {
            elements.push({
              data: {
                id: `E${node.id}-${branchNodeId}`,
                source: `N${node.id}`,
                target: `N${branchNodeId}`
              }
            });
            queue.push(branchNodeId);
          });
        }
      });
    }

    res.json({
      storyLine: {
        story_line_id: storyLineQuery.rows[0].story_line_id,
        title: storyLineQuery.rows[0].title
      },
      elements
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
});
