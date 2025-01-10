const express = require("express");
const { Client } = require("pg");
const cors = require("cors");

const app = express();
const port = 3000;

const allowedOrigins = ["https://admin.spiritbrewgame.com"];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS 限制：來源不允許"));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

app.use(cors(corsOptions));

const client = new Client({
  user: process.env.PG_USER || "readonly_user",
  host: process.env.PG_HOST || "localhost",
  database: process.env.PG_DATABASE || "nocobase",
  password: process.env.PG_PASSWORD || "",
  port: 5432
});

client
  .connect()
  .then(() => console.log("✅ PostgreSQL 連線成功"))
  .catch((err) => {
    console.error("❌ 無法連接到 PostgreSQL", err);
    process.exit(1);
  });

app.get("/story-graph/:story_line_id", async (req, res) => {
  try {
    const storyLineId = req.params.story_line_id;

    const storyLineQuery = await client.query(
      "SELECT * FROM side_story_lines WHERE story_line_id = $1",
      [storyLineId]
    );

    if (storyLineQuery.rows.length === 0) {
      return res.status(404).json({ error: "❌ 劇情線不存在" });
    }

    const nodesQuery = await client.query(
      "SELECT * FROM side_story_nodes WHERE store_line_ids = $1",
      [storyLineId]
    );

    let elements = [];

    nodesQuery.rows.forEach((node) => {
      elements.push({
        data: {
          id: `N${node.store_node_id}`,
          label: `📌 ${node.store_node_id}\n📝 ${node.title}\n${node.description}`
        },
        style: {
          "background-color": "#28a745",
          color: "#fff",
          shape: "roundrectangle",
          width: "250px",
          height: "auto",
          "text-wrap": "wrap",
          "text-valign": "center",
          "text-halign": "center",
          padding: "10px"
        }
      });

      if (node.next_story_node_id) {
        elements.push({
          data: {
            id: `E${node.store_node_id}-${node.next_story_node_id}`,
            source: `N${node.store_node_id}`,
            target: `N${node.next_story_node_id}`
          }
        });
      }
    });

    res.json({ storyLine: storyLineQuery.rows[0], elements });
  } catch (error) {
    console.error("❌ 查詢錯誤", error);
    res.status(500).json({ error: "❌ 伺服器錯誤，請檢查日誌" });
  }
});

app.listen(port, () => {
  console.log(`🚀 API 運行於 http://localhost:${port}`);
});
