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
  .then(() => console.log("✅ PostgreSQL connection established"))
  .catch((err) => {
    console.error("❌ Failed to connect to PostgreSQL:", err);
    process.exit(1);
  });

// API：取得劇情線的流程圖
app.get("/story-graph/:story_line_id", async (req, res) => {
  try {
    const storyLineId = req.params.story_line_id.trim();
    console.log(`📌 Received request for storyline: ${storyLineId}`);

    if (!storyLineId || storyLineId.length > 255) {
      console.warn("⚠️ Invalid storyline ID received.");
      return res.status(400).json({ error: "Invalid story_line_id." });
    }

    // 1️⃣ 取得劇情線與其開始節點資訊
    console.log("🔍 Querying storyline and start node...");
    const storyLineQuery = await client.query(
      `SELECT sl.*, 
              sn.id AS start_node_id, 
              sn.title AS start_node_title, 
              sn.description AS start_node_description
       FROM story_lines sl
       LEFT JOIN story_nodes sn ON sn.id = sl.fk_story_lines_start_node_id_story_nodes
       WHERE sl.story_line_id = $1`,
      [storyLineId]
    );

    if (storyLineQuery.rows.length === 0) {
      console.warn(`⚠️ Storyline '${storyLineId}' not found.`);
      return res.status(404).json({ error: "Storyline not found" });
    }

    const storyLine = storyLineQuery.rows[0];
    const startNodeId = storyLine.start_node_id;
    if (!startNodeId) {
      console.warn(`⚠️ No start node found for storyline '${storyLineId}'.`);
      return res.status(404).json({ error: "Start node not found" });
    }

    console.log(`✅ Storyline '${storyLineId}' found. Start node ID: ${startNodeId}`);

    // 2️⃣ 取得所有劇情節點資料，存入 key-object 快速查找
    console.log("🔍 Fetching all story nodes for storyline...");
    const allNodesQuery = await client.query(
      `SELECT id, title, description, next_node_id, branch_nodes
       FROM story_nodes
       WHERE fk_storyline_storynode = (
         SELECT id FROM story_lines WHERE story_line_id = $1
       )`,
      [storyLineId]
    );

    const nodesMap = {};
    allNodesQuery.rows.forEach((node) => {
      nodesMap[node.id] = node;
    });

    console.log(`✅ Retrieved ${allNodesQuery.rows.length} story nodes.`);

    // 3️⃣ 開始遍歷，構建流程圖
    let elements = [];
    let queue = [startNodeId];
    let visited = new Set();

    // 加入開始節點
    elements.push({
      data: {
        id: `N${startNodeId}`,
        name: storyLine.start_node_title,
        description: storyLine.start_node_description
      }
    });

    console.log("🚀 Starting BFS traversal...");
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = nodesMap[currentId];
      if (!node) continue;

      console.log(`📍 Processing node: ${currentId} (${node.title})`);

      // 處理 next_node_id
      if (node.next_node_id && nodesMap[node.next_node_id]) {
        console.log(`🔗 Adding link: ${currentId} → ${node.next_node_id}`);
        elements.push({
          data: {
            id: `E${node.id}-${node.next_node_id}`,
            source: `N${node.id}`,
            target: `N${node.next_node_id}`
          }
        });

        if (!visited.has(node.next_node_id)) {
          queue.push(node.next_node_id);
          elements.push({
            data: {
              id: `N${node.next_node_id}`,
              name: nodesMap[node.next_node_id].title,
              description: nodesMap[node.next_node_id].description
            }
          });
        }
      }

      // 處理 branch_nodes（分支）
      if (node.branch_nodes) {
        let branchArray = [];
        try {
          branchArray = JSON.parse(node.branch_nodes);
        } catch (err) {
          console.error(`❌ Error parsing branch_nodes for node ${node.id}`, err);
        }

        if (Array.isArray(branchArray)) {
          branchArray.forEach((branchId) => {
            if (nodesMap[branchId]) {
              console.log(`🔀 Adding branch link: ${currentId} → ${branchId}`);
              elements.push({
                data: {
                  id: `E${node.id}-${branchId}`,
                  source: `N${node.id}`,
                  target: `N${branchId}`
                }
              });

              if (!visited.has(branchId)) {
                queue.push(branchId);
                elements.push({
                  data: {
                    id: `N${branchId}`,
                    name: nodesMap[branchId].title,
                    description: nodesMap[branchId].description
                  }
                });
              }
            }
          });
        }
      }
    }

    console.log(`✅ BFS traversal complete. Total elements: ${elements.length}`);

    // 回傳 JSON
    res.json({
      storyLine: {
        story_line_id: storyLine.story_line_id,
        title: storyLine.title
      },
      elements
    });
  } catch (error) {
    console.error("❌ Internal server error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`🚀 API server running at http://localhost:${port}`);
});
