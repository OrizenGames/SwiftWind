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

// API：根據劇情線 ID 取得流程圖資料（包含分支）
app.get("/story-graph/:story_line_id", async (req, res) => {
  try {
    const storyLineId = req.params.story_line_id.trim();

    if (!storyLineId || storyLineId.length > 255) {
      return res.status(400).json({ error: "Invalid story_line_id." });
    }

    // 1. 取得劇情線與其開始節點資訊
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
      return res.status(404).json({ error: "Storyline not found" });
    }

    const storyLine = storyLineQuery.rows[0];
    const startNodeId = storyLine.start_node_id;
    if (!startNodeId) {
      return res.status(404).json({ error: "Start node not found for this storyline" });
    }

    let elements = [];
    let queue = [startNodeId];
    let visited = new Set();

    // 將開始節點加入元素清單
    elements.push({
      data: {
        id: `N${startNodeId}`,
        name: storyLine.start_node_title,
        description: storyLine.start_node_description
      }
    });

    // 使用 BFS 依序查詢每個節點的連接
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      // 取得該節點的詳細資訊（包含連接資訊）
      const nodeQuery = await client.query(
        `SELECT id, title, description, next_node_id, branch_nodes
         FROM story_nodes
         WHERE id = $1 AND fk_storyline_storynode = (
           SELECT id FROM story_lines WHERE story_line_id = $2
         )`,
        [currentId, storyLineId]
      );

      if (nodeQuery.rows.length === 0) continue;
      const node = nodeQuery.rows[0];

      // 若有 next_node_id，建立連接邊並將目標節點加入待查詢佇列
      if (node.next_node_id) {
        elements.push({
          data: {
            id: `E${node.id}-${node.next_node_id}`,
            source: `N${node.id}`,
            target: `N${node.next_node_id}`
          }
        });
        if (!visited.has(node.next_node_id)) {
          queue.push(node.next_node_id);
          // 為避免重複查詢，嘗試先取得目標節點基本資料
          const nextNodeQuery = await client.query(
            `SELECT id, title, description FROM story_nodes WHERE id = $1`,
            [node.next_node_id]
          );
          if (nextNodeQuery.rows.length > 0) {
            const nextNode = nextNodeQuery.rows[0];
            elements.push({
              data: {
                id: `N${nextNode.id}`,
                name: nextNode.title,
                description: nextNode.description
              }
            });
          }
        }
      }

      // 處理分支連接：假設 branch_nodes 為 JSON 字串，格式例如 "[3,4]"
      if (node.branch_nodes) {
        let branchArray = [];
        try {
          branchArray = JSON.parse(node.branch_nodes);
        } catch (err) {
          console.error("Error parsing branch_nodes for node", node.id, err);
        }
        if (Array.isArray(branchArray)) {
          branchArray.forEach((branchId) => {
            elements.push({
              data: {
                id: `E${node.id}-${branchId}`,
                source: `N${node.id}`,
                target: `N${branchId}`
              }
            });
            if (!visited.has(branchId)) {
              queue.push(branchId);
              // 嘗試先取得分支節點資料
              // 注意：這裡不檢查 fk_storyline_storynode，假設資料完整
              client.query(
                `SELECT id, title, description FROM story_nodes WHERE id = $1`,
                [branchId]
              ).then((branchNodeQuery) => {
                if (branchNodeQuery.rows.length > 0) {
                  const branchNode = branchNodeQuery.rows[0];
                  // 避免重複加入節點資料
                  if (!elements.find(el => el.data.id === `N${branchNode.id}`)) {
                    elements.push({
                      data: {
                        id: `N${branchNode.id}`,
                        name: branchNode.title,
                        description: branchNode.description
                      }
                    });
                  }
                }
              }).catch((err) => {
                console.error("Error querying branch node", branchId, err);
              });
            }
          });
        }
      }
    }

    res.json({
      storyLine: {
        story_line_id: storyLine.story_line_id,
        title: storyLine.title
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
